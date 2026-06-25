import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";

export interface CodexAppServerRunInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly instructionsFile?: string;
  readonly networkAccess?: boolean;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly command?: string;
  readonly cacheKey?: string;
  readonly keepAlive?: boolean;
  readonly onDelta?: (text: string) => void;
}

export interface CodexAppServerRunResult {
  readonly status: "completed" | "failed";
  readonly finalMessage: string;
  readonly threadId?: string;
  readonly durationMs: number;
  readonly firstDeltaMs?: number;
  readonly errorMessage?: string;
  readonly tokenUsage?: {
    readonly inputTokens?: number;
    readonly cachedInputTokens?: number;
    readonly outputTokens?: number;
  };
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface CachedSession {
  readonly client: CodexAppServerClient;
  readonly threadId: string;
  readonly cwd: string;
  readonly model?: string;
  readonly createdAt: number;
  queue: Promise<void>;
}

const SESSION_CACHE = new Map<string, CachedSession>();

export function clearCodexAppServerSessions(): void {
  for (const session of SESSION_CACHE.values()) session.client.close();
  SESSION_CACHE.clear();
}

export async function runCodexAppServer(input: CodexAppServerRunInput): Promise<CodexAppServerRunResult> {
  if (!input.prompt.trim()) throw new Error("Codex prompt is required.");
  const started = Date.now();
  const keepAlive = input.keepAlive ?? true;
  const instructionsHash = await hashInstructionsFile(input.instructionsFile);
  const key = input.cacheKey
    ? `${input.cacheKey}\0instructions:${instructionsHash}`
    : `${input.cwd}\0${input.model ?? ""}\0instructions:${instructionsHash}`;
  let cached = keepAlive ? SESSION_CACHE.get(key) : undefined;
  if (!cached || !cached.client.isAlive()) {
    cached?.client.close();
    SESSION_CACHE.delete(key);
    const client = new CodexAppServerClient({
      command: resolveCodexCommand(input.command),
      cwd: input.cwd,
      model: input.model,
      instructionsFile: input.instructionsFile,
      networkAccess: input.networkAccess,
      env: input.env,
    });
    try {
      await client.initialize();
      const threadId = await client.startThread(input.cwd);
      cached = { client, threadId, cwd: input.cwd, model: input.model, createdAt: Date.now(), queue: Promise.resolve() };
      if (keepAlive) SESSION_CACHE.set(key, cached);
    } catch (error) {
      client.close();
      return {
        status: "failed",
        finalMessage: "",
        durationMs: Date.now() - started,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return await runExclusive(cached, async () => {
    const turn = await cached.client.runTurn({
      threadId: cached.threadId,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs ?? 180_000,
      onDelta: input.onDelta,
    });
    const result = {
      status: turn.errorMessage ? "failed" : "completed",
      finalMessage: turn.finalMessage,
      threadId: cached.threadId,
      durationMs: Date.now() - started,
      firstDeltaMs: turn.firstDeltaMs,
      errorMessage: turn.errorMessage,
      tokenUsage: turn.tokenUsage,
    } as const;
    if (!keepAlive) cached.client.close();
    return result;
  }).catch((error: unknown) => {
      cached.client.close();
      SESSION_CACHE.delete(key);
      return {
        status: "failed",
        finalMessage: "",
        threadId: cached.threadId,
        durationMs: Date.now() - started,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    });
}

async function runExclusive<T>(session: CachedSession, task: () => Promise<T>): Promise<T> {
  const previous = session.queue.catch(() => {});
  let release!: () => void;
  session.queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function hashInstructionsFile(path: string | undefined): Promise<string> {
  if (!path) return "";
  const content = await readFile(path, "utf8").catch(() => "");
  return createHash("sha256").update(content).digest("hex");
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notifications: Record<string, unknown>[] = [];
  private readonly waiters: Array<(message: Record<string, unknown>) => void> = [];
  private readonly stderrLines: string[] = [];
  private closed = false;

  constructor(input: {
    readonly command: string;
    readonly cwd: string;
    readonly model?: string;
    readonly instructionsFile?: string;
    readonly networkAccess?: boolean;
    readonly env?: Record<string, string>;
  }) {
    const args = ["app-server", "--stdio"];
    if (input.model) args.push("-c", `model=${JSON.stringify(input.model)}`);
    if (input.networkAccess) args.push("-c", "sandbox_workspace_write.network_access=true");
    if (input.instructionsFile) args.push("-c", `experimental_instructions_file=${JSON.stringify(input.instructionsFile)}`);
    this.child = spawn(input.command, args, {
      cwd: input.cwd,
      env: { ...process.env, ...(input.env ?? {}), RUST_LOG: process.env.RUST_LOG ?? "warn" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.readStdout(chunk.toString("utf8")));
    this.child.stderr.on("data", (chunk: Buffer) => this.readStderr(chunk.toString("utf8")));
    this.child.on("exit", () => {
      this.closed = true;
      const error = new Error(this.formatError("codex app-server exited"));
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  isAlive(): boolean {
    return !this.closed && this.child.exitCode === null && !this.child.killed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.child.stdin.destroy();
    this.child.kill();
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "muster", title: "Muster", version: "0.1" },
      capabilities: {},
    }, 10_000);
    this.notify("initialized");
  }

  async startThread(cwd: string): Promise<string> {
    const result = await this.request("thread/start", { cwd }, 15_000);
    const thread = asRecord(result.thread);
    const threadId = stringValue(thread.id) ?? stringValue(thread.sessionId) ?? stringValue(result.sessionId) ?? stringValue(result.threadId);
    if (!threadId) throw new Error("codex app-server thread/start returned no thread id");
    return threadId;
  }

  async runTurn(input: {
    readonly threadId: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly onDelta?: (text: string) => void;
  }): Promise<{
    readonly finalMessage: string;
    readonly firstDeltaMs?: number;
    readonly errorMessage?: string;
    readonly tokenUsage?: CodexAppServerRunResult["tokenUsage"];
  }> {
    const started = Date.now();
    const turnStart = await this.request("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.prompt }],
    }, 15_000);
    const turnId = stringValue(asRecord(turnStart.turn).id);
    let finalMessage = "";
    let firstDeltaMs: number | undefined;
    let tokenUsage: CodexAppServerRunResult["tokenUsage"] | undefined;

    while (Date.now() - started < input.timeoutMs) {
      const message = await this.takeNotification(250);
      if (!message) continue;
      const method = stringValue(message.method) ?? "";
      const params = asRecord(message.params);
      if (method.endsWith("/request")) {
        this.respond(message.id, { decision: "decline", action: "decline", content: null, _meta: null });
        continue;
      }
      if (method === "item/agentMessage/delta") {
        const delta = stringValue(params.delta) ?? "";
        if (delta) {
          firstDeltaMs ??= Date.now() - started;
          input.onDelta?.(delta);
        }
        continue;
      }
      if (method === "item/completed") {
        const item = asRecord(params.item);
        if (item.type === "agentMessage") {
          finalMessage = stringValue(item.text) ?? finalMessage;
        }
        continue;
      }
      if (method === "thread/tokenUsage/updated") {
        const last = asRecord(asRecord(params.tokenUsage).last);
        tokenUsage = {
          inputTokens: numberValue(last.inputTokens),
          cachedInputTokens: numberValue(last.cachedInputTokens),
          outputTokens: numberValue(last.outputTokens),
        };
        continue;
      }
      if (method === "turn/completed") {
        const turn = asRecord(params.turn);
        const error = asRecord(turn.error);
        const status = stringValue(turn.status);
        if (status && status !== "completed" && status !== "interrupted") {
          return { finalMessage, firstDeltaMs, errorMessage: stringValue(error.message) ?? `codex turn ended with status ${status}`, tokenUsage };
        }
        if (turnId && stringValue(turn.id) && stringValue(turn.id) !== turnId) continue;
        return { finalMessage, firstDeltaMs, tokenUsage };
      }
    }
    throw new Error(this.formatError(`codex app-server turn timed out after ${input.timeoutMs}ms`));
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    if (!this.isAlive()) return Promise.reject(new Error(this.formatError("codex app-server is not running")));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(this.formatError(`codex app-server method ${method} timed out`)));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    this.write({ method, params });
  }

  private respond(id: unknown, result: Record<string, unknown>): void {
    if (typeof id === "number" || typeof id === "string") this.write({ id, result });
  }

  private write(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = numberValue(message.id);
      if (id !== undefined && this.pending.has(id)) {
        const pending = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        const error = asRecord(message.error);
        if (Object.keys(error).length) {
          pending.reject(new Error(stringValue(error.message) ?? `codex app-server ${pending.method} failed`));
        } else {
          pending.resolve(asRecord(message.result));
        }
        continue;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.notifications.push(message);
    }
  }

  private readStderr(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) this.stderrLines.push(line.trim());
    }
    this.stderrLines.splice(0, Math.max(0, this.stderrLines.length - 80));
  }

  private takeNotification(timeoutMs: number): Promise<Record<string, unknown> | undefined> {
    const existing = this.notifications.shift();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(undefined);
      }, timeoutMs);
      const waiter = (message: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(waiter);
    });
  }

  private formatError(message: string): string {
    const tail = this.stderrLines.slice(-12).join("\n");
    return tail ? `${message}\ncodex stderr:\n${tail}` : message;
  }
}

function resolveCodexCommand(command?: string): string {
  if (command) return command;
  if (process.env.MUSTER_CODEX_COMMAND) return process.env.MUSTER_CODEX_COMMAND;
  const appBundle = "/Applications/Codex.app/Contents/Resources/codex";
  if (existsSync(appBundle)) return appBundle;
  const home = process.env.HOME;
  if (home) {
    const candidates = [
      pathJoin(home, ".nvm/versions/node/v24.17.0/bin/codex"),
      pathJoin(home, ".nvm/versions/node/v22.22.3/bin/codex"),
      pathJoin(home, ".nvm/versions/node/v22.15.1/bin/codex"),
      pathJoin(home, ".nvm/versions/node/v20.19.5/bin/codex"),
      pathJoin(home, ".local/bin/codex"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "codex";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
