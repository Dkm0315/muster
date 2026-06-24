type JsonRecord = Record<string, unknown>;

const DEFAULT_MODEL = "claude-fable-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] : fallback;
}

function safeShellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : JSON.stringify(value);
}

export async function anthropic_provider_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const apiKeyEnv = stringArg(args, "apiKeyEnv", "ANTHROPIC_API_KEY");
  const baseUrl = stringArg(args, "baseUrl", DEFAULT_BASE_URL);
  return {
    provider: "anthropic",
    sourceEvidence: [
      "Hermes AnthropicProfile uses x-api-key plus anthropic-version for model listing.",
      "Hermes aliases anthropic with claude, claude-oauth, and claude-code while keeping API auth separate from Claude Code runtime auth.",
      "OpenClaw treats providers as plugin-owned capabilities that setup can resolve before runtime.",
    ],
    setupUrls: ["https://console.anthropic.com/settings/keys", "https://docs.anthropic.com/en/api/models"],
    commands: [
      `muster provider add anthropic --model ${safeShellWord(model)} --api-key-env ${safeShellWord(apiKeyEnv)} --base-url ${safeShellWord(baseUrl)}`,
      `muster runtime set --provider anthropic --model ${safeShellWord(model)}`,
      "muster provider list",
      "muster plugins check anthropic",
    ],
    env: {
      accepted: ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
      apiPreferred: apiKeyEnv,
      printSecret: false,
    },
    configShape: {
      providers: {
        anthropic: { kind: "anthropic", baseUrl, apiKeyEnv, defaultModel: model },
      },
    },
    notes: [
      "Use ANTHROPIC_API_KEY for native API provider calls.",
      "Use the separate claude-code runtime when you want Claude Code subscription/OAuth behavior.",
    ],
  };
}

export async function anthropic_provider_readiness(args: JsonRecord): Promise<JsonRecord> {
  const apiKeyPresent = booleanArg(args, "apiKeyPresent");
  const configured = booleanArg(args, "configured");
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const baseUrl = stringArg(args, "baseUrl", DEFAULT_BASE_URL);
  const checks = [
    { id: "api_key", ok: apiKeyPresent, detail: apiKeyPresent ? "Anthropic API credential env is present." : "Set ANTHROPIC_API_KEY for native Anthropic API use." },
    { id: "provider_config", ok: configured, detail: configured ? "Muster provider config exists." : "Run `muster provider add anthropic --model <model>`." },
    { id: "base_url", ok: /^https?:\/\//.test(baseUrl), detail: `Base URL: ${baseUrl}` },
    { id: "model", ok: Boolean(model), detail: `Selected model: ${model}` },
  ];
  return {
    provider: "anthropic",
    ready: checks.every((check) => check.ok),
    checks,
    modelListProbe: "GET /v1/models with x-api-key and anthropic-version: 2023-06-01.",
    next: checks.every((check) => check.ok) ? "muster runtime set --provider anthropic --model " + model : "muster plugins setup anthropic",
  };
}

export async function anthropic_model_policy(args: JsonRecord): Promise<JsonRecord> {
  const task = stringArg(args, "task", "general");
  return {
    provider: "anthropic",
    selectedTask: task,
    tiers: [
      { id: "fast", models: ["claude-haiku-4-5-20251001"], useFor: "short answers, classification, summaries, command help" },
      { id: "coding", models: ["claude-sonnet-4-5", "claude-fable-5"], useFor: "agentic coding, repo edits, code review" },
      { id: "long-context", models: ["claude-fable-5"], useFor: "large repo/context recall and long-document reasoning" },
    ],
    pickerBehavior: "Show API Claude and Claude Code runtime as separate selectable rows so users do not confuse key-based API auth with CLI subscription auth.",
    defaultModel: DEFAULT_MODEL,
  };
}

export async function anthropic_latency_triage(args: JsonRecord): Promise<JsonRecord> {
  const seconds = Number(args.lastResponseSeconds ?? 0);
  return {
    provider: "anthropic",
    observedSeconds: Number.isFinite(seconds) ? seconds : undefined,
    likelyCauses: [
      "Long-context or high-thinking model selected for a trivial task.",
      "Provider key missing, causing fallback/retry before surfacing the error.",
      "CLI Claude Code runtime selected when the user expected native API latency.",
      "Oversized tool definitions or transcript context sent to the provider.",
    ],
    actions: [
      "Use fast tier for greetings, status, and small local commands.",
      "Keep Claude Code runtime separate from anthropic API provider in the picker.",
      "Add first-token timing to run traces.",
      "Use scoped memory retrieval before attaching broad context.",
    ],
  };
}

export const tools = {
  anthropic_latency_triage,
  anthropic_model_policy,
  anthropic_provider_readiness,
  anthropic_provider_setup_plan,
};
