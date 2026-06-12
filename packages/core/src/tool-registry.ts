import { execFile } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { persistToolResult, resultFetch } from "./context-renderer.js";
import type { FlowToolRegistry } from "./flow.js";

const execFileAsync = promisify(execFile);

/**
 * Tool registry v2 — declarative entries, composable toolsets, availability
 * gates, and per-tool result caps enforced centrally. First-party tools stay
 * a small dependency-free set; anything integration-shaped belongs in MCP
 * servers or capability packs, never here (the upstream 72-tool sprawl is
 * maintenance debt we refuse).
 */

export type ToolResult =
  | { readonly ok: true; readonly data: unknown; readonly mediaRefs?: string[] }
  | { readonly ok: false; readonly error: string; readonly retryable?: boolean };

export interface ToolContext {
  readonly cwd: string;
  /** Explicit allowlist for the terminal tool; default deny-all. */
  readonly allowCommands?: readonly string[];
  /** Hosts the web_fetch tool may reach; default: any public host. */
  readonly allowHosts?: readonly string[];
}

export interface ToolEntry<A = Record<string, unknown>> {
  readonly name: string;
  readonly toolset: string;
  readonly description: string;
  readonly handler: (args: A, ctx: ToolContext) => Promise<ToolResult>;
  readonly available?: (ctx: ToolContext) => boolean;
  readonly requiresEnv?: readonly string[];
  readonly maxResultChars?: number;
}

export interface ToolsetDef {
  readonly description: string;
  readonly tools: readonly string[];
  readonly includes?: readonly string[];
}

const DEFAULT_MAX_RESULT_CHARS = 8000;

export interface ToolRegistryV2 {
  register<A>(entry: ToolEntry<A>): void;
  list(toolset?: string): ToolEntry[];
  resolveToolset(name: string): string[];
  execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  toFlowRegistry(ctx: ToolContext, allowlist?: readonly string[]): FlowToolRegistry;
}

export function createToolRegistry(toolsets: Record<string, ToolsetDef> = BUILTIN_TOOLSETS): ToolRegistryV2 {
  const entries = new Map<string, ToolEntry>();

  const resolveToolset = (name: string, seen = new Set<string>()): string[] => {
    if (seen.has(name)) return [];
    seen.add(name);
    const definition = toolsets[name];
    if (!definition) return [];
    return [...definition.tools, ...(definition.includes ?? []).flatMap((included) => resolveToolset(included, seen))];
  };

  return {
    register(entry) {
      if (entries.has(entry.name)) throw new Error(`Tool already registered: ${entry.name}`);
      entries.set(entry.name, entry as ToolEntry);
    },
    list(toolset) {
      const all = [...entries.values()];
      if (!toolset) return all;
      const allowed = new Set(resolveToolset(toolset));
      return all.filter((entry) => allowed.has(entry.name));
    },
    resolveToolset: (name) => resolveToolset(name),
    async execute(name, args, ctx) {
      const entry = entries.get(name);
      if (!entry) return { ok: false, error: `Unknown tool: ${name}` };
      for (const env of entry.requiresEnv ?? []) {
        if (!process.env[env]) return { ok: false, error: `Tool ${name} requires env ${env} (not set)` };
      }
      if (entry.available && !entry.available(ctx)) {
        return { ok: false, error: `Tool ${name} is not available in this context` };
      }
      let result: ToolResult;
      try {
        result = await entry.handler(args, ctx);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (result.ok) {
        const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
        const cap = entry.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
        if (text.length > cap) {
          const persisted = await persistToolResult({ toolName: name, ok: true, content: text }, ctx.cwd);
          return { ok: true, data: `${text.slice(0, 400)}\n${persisted.stub}` };
        }
      }
      return result;
    },
    toFlowRegistry(ctx, allowlist) {
      const registry: FlowToolRegistry = {};
      for (const entry of entries.values()) {
        if (allowlist && !allowlist.includes(entry.name)) continue;
        registry[entry.name] = async (args) => {
          const result = await this.execute(entry.name, args, ctx);
          if (!result.ok) throw new Error(result.error);
          return result.data;
        };
      }
      return registry;
    },
  };
}

export const BUILTIN_TOOLSETS: Record<string, ToolsetDef> = {
  files: { description: "Read/write/search the workspace", tools: ["read_file", "write_file", "search_files", "list_dir"] },
  web: { description: "Fetch public web content", tools: ["web_fetch"] },
  shell: { description: "Run allowlisted commands", tools: ["terminal"] },
  results: { description: "Fetch persisted oversized tool results", tools: ["result_fetch"] },
  core: { description: "Everything safe by default", tools: [], includes: ["files", "web", "results"] },
  full: { description: "Core plus shell", tools: [], includes: ["core", "shell"] },
};

/** Tools safe to expose to untrusted webhook triggers (no fs writes, no shell). */
export const WEBHOOK_SAFE_TOOLS: readonly string[] = ["web_fetch", "result_fetch"];

function insideWorkspace(ctx: ToolContext, target: string): string {
  const absolute = resolve(ctx.cwd, target);
  if (!absolute.startsWith(resolve(ctx.cwd))) throw new Error(`Path escapes the workspace: ${target}`);
  return absolute;
}

export function registerBuiltinTools(registry: ToolRegistryV2): void {
  registry.register<{ path: string; offset?: number; limit?: number }>({
    name: "read_file", toolset: "files", description: "Read a workspace file (offset/limit in lines).",
    async handler(args, ctx) {
      const lines = (await readFile(insideWorkspace(ctx, args.path), "utf8")).split("\n");
      const offset = args.offset ?? 0;
      return { ok: true, data: lines.slice(offset, offset + (args.limit ?? 2000)).join("\n") };
    },
  });
  registry.register<{ path: string; content: string }>({
    name: "write_file", toolset: "files", description: "Write a workspace file (creates parent dirs).",
    async handler(args, ctx) {
      const target = insideWorkspace(ctx, args.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, args.content);
      return { ok: true, data: `wrote ${args.content.length} chars to ${args.path}` };
    },
  });
  registry.register<{ query: string; dir?: string }>({
    name: "search_files", toolset: "files", description: "Substring search across workspace files.",
    async handler(args, ctx) {
      const root = insideWorkspace(ctx, args.dir ?? ".");
      const hits: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (hits.length < 50) {
            try {
              const content = await readFile(full, "utf8");
              const index = content.indexOf(args.query);
              if (index >= 0) hits.push(`${full.slice(root.length + 1)}: ${content.slice(Math.max(0, index - 40), index + 80).replace(/\s+/g, " ")}`);
            } catch { /* binary or unreadable: skip */ }
          }
        }
      };
      await walk(root);
      return { ok: true, data: hits.join("\n") || "no matches" };
    },
  });
  registry.register<{ dir?: string }>({
    name: "list_dir", toolset: "files", description: "List a workspace directory.",
    async handler(args, ctx) {
      const entries = await readdir(insideWorkspace(ctx, args.dir ?? "."), { withFileTypes: true });
      return { ok: true, data: entries.map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`).join("\n") };
    },
  });
  registry.register<{ url: string }>({
    name: "web_fetch", toolset: "web", description: "Fetch a public URL as text.",
    async handler(args, ctx) {
      const url = new URL(args.url);
      if (ctx.allowHosts && !ctx.allowHosts.includes(url.hostname)) {
        return { ok: false, error: `Host not in allowlist: ${url.hostname}` };
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      return { ok: response.ok, ...(response.ok ? { data: await response.text() } : { error: `HTTP ${response.status}`, retryable: response.status >= 500 }) } as ToolResult;
    },
  });
  registry.register<{ command: string; args?: string[] }>({
    name: "terminal", toolset: "shell", description: "Run an allowlisted command (no shell interpolation).",
    available: (ctx) => (ctx.allowCommands ?? []).length > 0,
    async handler(args, ctx) {
      if (!(ctx.allowCommands ?? []).includes(args.command)) {
        return { ok: false, error: `Command not allowlisted: ${args.command}` };
      }
      try {
        const { stdout, stderr } = await execFileAsync(args.command, args.args ?? [], { cwd: ctx.cwd, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
        return { ok: true, data: stdout + (stderr ? `\n[stderr] ${stderr}` : "") };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  registry.register<{ id: string; offset?: number; limit?: number }>({
    name: "result_fetch", toolset: "results", description: "Fetch a persisted oversized tool result by id.",
    async handler(args, ctx) {
      const fetched = await resultFetch(args.id, { offset: args.offset, limit: args.limit }, ctx.cwd);
      return { ok: true, data: fetched.content };
    },
  });
}
