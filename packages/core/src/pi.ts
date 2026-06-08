import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_CODING_AGENT_VERSION = "0.78.1";
export const PI_CODING_AGENT_NPX_SPEC = `${PI_CODING_AGENT_PACKAGE}@${PI_CODING_AGENT_VERSION}`;

const REQUIRED_SDK_EXPORTS = [
  "createAgentSession",
  "AgentSession",
  "SessionManager",
  "DefaultResourceLoader",
  "SettingsManager",
  "createReadOnlyTools",
  "createCodingTools",
  "runPrintMode",
  "InteractiveMode"
] as const;

export interface PiRuntimeStatus {
  readonly rootPath: string;
  readonly installed: boolean;
  readonly configFiles: string[];
  readonly workflowFiles: string[];
  readonly cliAvailable: boolean;
  readonly npxAvailable: boolean;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly integrationMode: "embedded_sdk";
  readonly sdkLoadable: boolean;
  readonly sdkExports: string[];
  readonly missingSdkExports: string[];
  readonly adapterState: "sdk_missing" | "sdk_ready" | "sdk_ready_with_pi_home";
  readonly nextActions: string[];
}

export interface PiAgentRunInput {
  readonly prompt: string;
  readonly cwd?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly tools?: readonly string[];
  readonly timeoutMs?: number;
  readonly transport?: "sdk" | "cli";
  readonly sessionMode?: PiSessionMode;
  readonly sessionDir?: string;
  readonly agentDir?: string;
}

export interface PiCliDiagnosticRunInput extends PiAgentRunInput {
  readonly command?: string;
  readonly noSession?: boolean;
}

export interface PiAgentRunResult {
  readonly status: "completed" | "failed";
  readonly transport: "sdk" | "cli";
  readonly command?: string;
  readonly args?: string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sessionMode?: PiSessionMode;
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  readonly activeTools?: string[];
  readonly eventTypes?: string[];
  readonly eventCounts?: Record<string, number>;
  readonly errorMessage?: string;
}

export type PiSessionMode = "memory" | "create" | "continue";

export interface PiModelInfo {
  readonly provider: string;
  readonly providerName: string;
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly authSource?: string;
  readonly authLabel?: string;
  readonly api?: string;
  readonly reasoning: boolean;
  readonly input: string[];
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly usingOAuth: boolean;
}

export interface PiModelListInput {
  readonly agentDir?: string;
  readonly provider?: string;
  readonly availableOnly?: boolean;
}

export async function inspectPiRuntime(input: { readonly homeDir?: string } = {}): Promise<PiRuntimeStatus> {
  const home = input.homeDir ?? homedir();
  const rootPath = join(home, ".pi");
  const [cliAvailable, npxAvailable, sdk] = await Promise.all([
    canExecute("pi", ["--version"]),
    canExecute("npx", ["--version"]),
    inspectPiSdkExports()
  ]);
  const installed = await exists(rootPath);
  const configFiles: string[] = [];
  const workflowFiles: string[] = [];

  if (installed) {
    const entries = await readdir(rootPath, { recursive: true }).catch(() => []);
    const files = entries.map(String);
    configFiles.push(...files.filter((file) => /(^|\/)(config|settings|models|auth).*\.(json|ya?ml|toml)$/i.test(file)));
    workflowFiles.push(...files.filter((file) => /(^|\/)(workflow|flow|agent|task|skill).*\.(json|ya?ml|toml|ts|js|py|md)$/i.test(file)));
  }

  return {
    rootPath,
    installed,
    configFiles,
    workflowFiles,
    cliAvailable,
    npxAvailable,
    packageName: PI_CODING_AGENT_PACKAGE,
    packageVersion: PI_CODING_AGENT_VERSION,
    integrationMode: "embedded_sdk",
    sdkLoadable: sdk.loadable,
    sdkExports: sdk.exports,
    missingSdkExports: sdk.missingExports,
    adapterState: sdk.loadable ? (installed ? "sdk_ready_with_pi_home" : "sdk_ready") : "sdk_missing",
    nextActions: sdk.loadable
      ? [
          "Create HybrowClaw runs through Pi's createAgentSession() embedded SDK path.",
          "Inject HybrowClaw tools, context graph, memory hooks, eval hooks, and TUI event renderers around the real AgentSession.",
          "Use the Pi CLI only as an explicit diagnostic transport, never as the default harness runtime."
        ]
      : [
          `Install ${PI_CODING_AGENT_NPX_SPEC} and its sibling pi packages in @hybrowclaw/core.`,
          "Do not ship a fake local runner while the embedded Pi SDK is unavailable."
        ]
  };
}

export async function readPiCandidateFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function runPiAgent(input: PiAgentRunInput): Promise<PiAgentRunResult> {
  if (input.transport === "cli") return runPiCliDiagnostic(input);
  return runPiEmbeddedAgent(input);
}

export async function listPiModels(input: PiModelListInput = {}): Promise<PiModelInfo[]> {
  const pi = await import("@earendil-works/pi-coding-agent");
  const agentDir = input.agentDir ?? join(homedir(), ".pi", "agent");
  const { modelRegistry } = createPiModelRegistry(pi, agentDir);
  const sourceModels = input.availableOnly ? modelRegistry.getAvailable() : modelRegistry.getAll();
  return sourceModels
    .filter((model) => !input.provider || model.provider === input.provider)
    .map((model) => {
      const authStatus = modelRegistry.getProviderAuthStatus(model.provider);
      return {
        provider: model.provider,
        providerName: modelRegistry.getProviderDisplayName(model.provider),
        id: model.id,
        name: model.name,
        available: modelRegistry.hasConfiguredAuth(model),
        authSource: authStatus.source,
        authLabel: authStatus.label,
        api: model.api,
        reasoning: model.reasoning,
        input: [...model.input],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        usingOAuth: modelRegistry.isUsingOAuth(model)
      };
    })
    .sort((left, right) => {
      const providerOrder = left.provider.localeCompare(right.provider);
      return providerOrder || left.id.localeCompare(right.id);
    });
}

export async function runPiEmbeddedAgent(input: PiAgentRunInput): Promise<PiAgentRunResult> {
  if (!input.prompt.trim()) throw new Error("Pi prompt is required.");
  const started = Date.now();
  const eventTypes: string[] = [];
  const eventCounts: Record<string, number> = {};
  const sessionMode = input.sessionMode ?? "memory";
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    const cwd = input.cwd ?? process.cwd();
    const agentDir = input.agentDir ?? join(homedir(), ".pi", "agent");
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    const { authStorage, modelRegistry } = createPiModelRegistry(pi, agentDir);
    const selectedModel = resolvePiModel(modelRegistry, input.provider, input.model);
    const sessionManager = createPiSessionManager(pi.SessionManager, {
      cwd,
      sessionMode,
      sessionDir: input.sessionDir
    });
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager
    });
    await resourceLoader.reload();
    const { session } = await pi.createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      model: selectedModel,
      thinkingLevel: input.thinking,
      tools: [...(input.tools?.length ? input.tools : ["read", "grep", "find", "ls"])],
      sessionManager,
      settingsManager,
      resourceLoader
    });
    await prewarmPiSessionFile(sessionManager);
    const unsubscribe = session.subscribe((event) => {
      eventTypes.push(event.type);
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    });
    try {
      let responseText = "";
      let promptError: string | undefined;
      try {
        await session.prompt(input.prompt);
        responseText = extractLatestAssistantText(session.messages);
      } catch (error) {
        promptError = error instanceof Error ? error.message : String(error);
      }
      return {
        status: responseText && !promptError ? "completed" : "failed",
        transport: "sdk",
        stdout: responseText,
        stderr: "",
        durationMs: Date.now() - started,
        packageName: PI_CODING_AGENT_PACKAGE,
        packageVersion: PI_CODING_AGENT_VERSION,
        sessionMode,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
        sessionDir: sessionManager.getSessionDir(),
        activeTools: session.getActiveToolNames(),
        eventTypes,
        eventCounts,
        errorMessage: promptError ?? (responseText ? undefined : session.state.errorMessage ?? "Pi SDK completed without assistant text.")
      };
    } finally {
      unsubscribe();
      session.dispose();
    }
  } catch (error) {
    return {
      status: "failed",
      transport: "sdk",
      stdout: "",
      stderr: "",
      durationMs: Date.now() - started,
      packageName: PI_CODING_AGENT_PACKAGE,
      packageVersion: PI_CODING_AGENT_VERSION,
      sessionMode,
      eventTypes,
      eventCounts,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Diagnostic-only transport. HybrowClaw's product runtime must use runPiEmbeddedAgent().
 */
export async function runPiCliDiagnostic(input: PiCliDiagnosticRunInput): Promise<PiAgentRunResult> {
  if (!input.prompt.trim()) throw new Error("Pi prompt is required.");
  const command = input.command ?? ((await canExecute("pi", ["--version"])) ? "pi" : "npx");
  const piArgs = buildPiCliArgs(input);
  const args = command === "npx" ? ["--yes", PI_CODING_AGENT_NPX_SPEC, ...piArgs] : piArgs;
  const started = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: input.cwd ?? process.cwd(),
      timeout: input.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      status: "completed",
      transport: "cli",
      command,
      args,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: Date.now() - started,
      packageName: PI_CODING_AGENT_PACKAGE,
      packageVersion: PI_CODING_AGENT_VERSION
    };
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string };
    return {
      status: "failed",
      transport: "cli",
      command,
      args,
      stdout: detail.stdout?.trim() ?? "",
      stderr: detail.stderr?.trim() ?? "",
      durationMs: Date.now() - started,
      packageName: PI_CODING_AGENT_PACKAGE,
      packageVersion: PI_CODING_AGENT_VERSION,
      errorMessage: detail.message
    };
  }
}

export function buildPiCliArgs(input: PiCliDiagnosticRunInput): string[] {
  const args = ["--mode", "text", "--print"];
  if (input.noSession ?? true) args.push("--no-session");
  const tools = input.tools?.length ? input.tools : ["read", "grep", "find", "ls"];
  args.push("--tools", tools.join(","));
  if (input.provider) args.push("--provider", input.provider);
  if (input.model) args.push("--model", input.model);
  if (input.thinking) args.push("--thinking", input.thinking);
  args.push(input.prompt);
  return args;
}

export const buildPiAgentArgs = buildPiCliArgs;
export const runPiCodingAgent = runPiCliDiagnostic;

export function buildPiSessionLabel(result: Pick<PiAgentRunResult, "sessionMode" | "sessionId" | "sessionFile" | "sessionDir" | "activeTools" | "eventCounts">): string {
  const events = Object.entries(result.eventCounts ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}:${count}`)
    .join(",");
  return [
    `mode=${result.sessionMode ?? "unknown"}`,
    `session=${result.sessionId ?? "-"}`,
    `file=${result.sessionFile ?? "-"}`,
    `dir=${result.sessionDir ?? "-"}`,
    `tools=${result.activeTools?.join(",") ?? "-"}`,
    `events=${events || "-"}`
  ].join(" ");
}

function createPiSessionManager(
  SessionManager: typeof import("@earendil-works/pi-coding-agent").SessionManager,
  options: { readonly cwd: string; readonly sessionMode: PiSessionMode; readonly sessionDir?: string }
) {
  if (options.sessionMode === "memory") return SessionManager.inMemory(options.cwd);
  if (options.sessionMode === "create") return SessionManager.create(options.cwd, options.sessionDir);
  return SessionManager.continueRecent(options.cwd, options.sessionDir);
}

function createPiModelRegistry(pi: typeof import("@earendil-works/pi-coding-agent"), agentDir: string) {
  const authStorage = pi.AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = pi.ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  return { authStorage, modelRegistry };
}

function resolvePiModel(
  modelRegistry: import("@earendil-works/pi-coding-agent").ModelRegistry,
  provider?: string,
  modelId?: string
) {
  if (!provider && !modelId) return undefined;
  if (!provider || !modelId) {
    throw new Error("Pi provider and model must be passed together. Use `hybrowclaw pi models` to discover valid pairs.");
  }
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    const known = modelRegistry
      .getAll()
      .filter((candidate) => candidate.provider === provider)
      .slice(0, 8)
      .map((candidate) => candidate.id)
      .join(", ");
    throw new Error(
      `Pi model not found for provider=${provider} model=${modelId}.` +
        (known ? ` Known ${provider} models include: ${known}.` : " Run `hybrowclaw pi models` to discover providers and models.")
    );
  }
  return model;
}

async function prewarmPiSessionFile(sessionManager: Pick<import("@earendil-works/pi-coding-agent").SessionManager, "getHeader" | "getSessionFile">): Promise<void> {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) return;
  if (await exists(sessionFile)) return;
  const header = sessionManager.getHeader();
  if (!header) return;
  await mkdir(dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

async function inspectPiSdkExports(): Promise<{ loadable: boolean; exports: string[]; missingExports: string[] }> {
  try {
    const pi = await import("@earendil-works/pi-coding-agent");
    const exported = Object.keys(pi).sort();
    return {
      loadable: true,
      exports: exported,
      missingExports: REQUIRED_SDK_EXPORTS.filter((name) => !(name in pi))
    };
  } catch {
    return {
      loadable: false,
      exports: [],
      missingExports: [...REQUIRED_SDK_EXPORTS]
    };
  }
}

function extractLatestAssistantText(messages: readonly unknown[]): string {
  for (const message of [...messages].reverse()) {
    const candidate = message as { readonly role?: string; readonly content?: unknown };
    if (candidate.role !== "assistant") continue;
    if (typeof candidate.content === "string") return candidate.content.trim();
    if (Array.isArray(candidate.content)) {
      return candidate.content
        .map((part) => {
          const item = part as { readonly type?: string; readonly text?: string };
          return item.type === "text" && item.text ? item.text : "";
        })
        .join("")
        .trim();
    }
  }
  return "";
}

async function canExecute(command: string, args: string[]): Promise<boolean> {
  return execFileAsync(command, args, { timeout: 5000 }).then(
    () => true,
    () => false
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}
