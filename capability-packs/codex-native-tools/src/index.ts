type JsonRecord = Record<string, unknown>;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

export async function codex_native_tool_policy(args: JsonRecord): Promise<JsonRecord> {
  const task = stringArg(args, "task", "coding");
  return {
    task,
    sourceEvidence: [
      "Muster runCodex delegates the model loop, shell, patch, web search, MCP, compaction, and native sessions to Codex CLI.",
      "OpenClaw AgentCommandOpts carries provider/model overrides and tool allowlists per run.",
    ],
    allowByTask: {
      answer: ["memory", "sessions"],
      inspect: ["read", "rg", "git status"],
      edit: ["read", "rg", "apply_patch", "tests"],
      frontend: ["read", "rg", "apply_patch", "browser screenshots", "tests"],
      release: ["read", "git diff", "tests", "human approval"],
    },
    denyByDefault: ["destructive git reset", "secret printing", "unbounded shell", "production deploy"],
  };
}

export async function codex_native_approval_policy(args: JsonRecord): Promise<JsonRecord> {
  const risk = stringArg(args, "risk", "medium");
  return {
    risk,
    modes: [
      { id: "read-only", useFor: "inspection and review", sandbox: "read-only", approval: "never" },
      { id: "workspace-write", useFor: "normal coding edits", sandbox: "workspace-write", approval: "never in headless exec; review diff after" },
      { id: "danger-full-access", useFor: "host sandbox failure or explicitly trusted local work", sandbox: "danger-full-access", approval: "requires explicit user trust and narrow workdir" },
    ],
    gates: ["show diff", "run focused tests", "run relevant full test", "never print secrets", "human approval before release/push when requested"],
  };
}

export async function codex_native_fast_path(args: JsonRecord): Promise<JsonRecord> {
  const prompt = stringArg(args, "prompt");
  const lower = prompt.toLowerCase();
  const directShell = /^(ls|pwd|git status|date|whoami)\b/.test(lower) || lower.includes("what is in this folder");
  return {
    prompt,
    route: directShell ? "native-tool-before-model" : "codex-runtime",
    reason: directShell ? "Simple local inspection should not wait for a model round-trip." : "Task likely needs agent reasoning or edits.",
    latencyBudgetMs: directShell ? 2000 : 30000,
    actions: directShell ? ["run bounded shell command", "render result directly", "record trace without provider call"] : ["choose runtime/model", "scope tools", "stream status"],
  };
}

export async function codex_native_surface_plan(args: JsonRecord): Promise<JsonRecord> {
  const surface = stringArg(args, "surface", "cli");
  return {
    surface,
    controls: [
      "/runtime picker should show codex, claude-code, native, pi, and configured runtimes.",
      "/model picker should show active provider models and fast/coding/reasoning tiers.",
      "/tools should show native Codex capabilities separately from MCP tools.",
      "/tokens should expose ledger totals before and after Codex delegation.",
    ],
    userFriendlyDefaults: ["fast path for shell/listing", "continue session by name", "visible provider/model", "explicit setup links when auth is missing"],
  };
}

export const tools = {
  codex_native_approval_policy,
  codex_native_fast_path,
  codex_native_surface_plan,
  codex_native_tool_policy,
};
