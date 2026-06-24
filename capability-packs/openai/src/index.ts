type JsonRecord = Record<string, unknown>;

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] : fallback;
}

function safeShellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : JSON.stringify(value);
}

export async function openai_provider_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const apiKeyEnv = stringArg(args, "apiKeyEnv", "OPENAI_API_KEY");
  const baseUrl = stringArg(args, "baseUrl", DEFAULT_BASE_URL);
  return {
    provider: "openai",
    sourceEvidence: [
      "Hermes ProviderProfile keeps auth, base URL, model catalog, and request quirks declarative.",
      "OpenClaw resolves provider ownership through plugin contributions so setup can be discovered before runtime.",
    ],
    setupUrls: ["https://platform.openai.com/api-keys", "https://platform.openai.com/docs/models"],
    commands: [
      `muster provider add openai --model ${safeShellWord(model)} --api-key-env ${safeShellWord(apiKeyEnv)} --base-url ${safeShellWord(baseUrl)}`,
      `muster runtime set --provider openai --model ${safeShellWord(model)}`,
      "muster provider list",
      "muster plugins check openai",
    ],
    env: { required: apiKeyEnv, printSecret: false },
    configShape: {
      providers: {
        openai: { kind: "openai", baseUrl, apiKeyEnv, defaultModel: model },
      },
    },
    notes: [
      "Use the API provider when you need native OpenAI tool/model access and predictable server-side latency.",
      "Use codex-cli instead when subscription CLI auth is the desired credential path.",
    ],
  };
}

export async function openai_provider_readiness(args: JsonRecord): Promise<JsonRecord> {
  const apiKeyPresent = booleanArg(args, "apiKeyPresent");
  const configured = booleanArg(args, "configured");
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const baseUrl = stringArg(args, "baseUrl", DEFAULT_BASE_URL);
  const checks = [
    { id: "api_key", ok: apiKeyPresent, detail: apiKeyPresent ? "OPENAI_API_KEY or selected apiKeyEnv is present." : "Set OPENAI_API_KEY or pass --api-key-env to provider add." },
    { id: "provider_config", ok: configured, detail: configured ? "Muster provider config exists." : "Run `muster provider add openai --model <model>`." },
    { id: "base_url", ok: /^https?:\/\//.test(baseUrl), detail: `Base URL: ${baseUrl}` },
    { id: "model", ok: Boolean(model), detail: `Selected model: ${model}` },
  ];
  return {
    provider: "openai",
    ready: checks.every((check) => check.ok),
    checks,
    next: checks.every((check) => check.ok) ? "muster runtime set --provider openai --model " + model : "muster plugins setup openai",
  };
}

export async function openai_model_policy(args: JsonRecord): Promise<JsonRecord> {
  const task = stringArg(args, "task", "general");
  return {
    provider: "openai",
    selectedTask: task,
    tiers: [
      { id: "fast", models: ["gpt-5.5-mini", "gpt-5.4-mini"], useFor: "short answers, routing, lightweight retrieval, command help" },
      { id: "coding", models: ["gpt-5.5", "gpt-5.4"], useFor: "repo edits, test repair, code review, multi-file reasoning" },
      { id: "reasoning", models: ["gpt-5.5-high", "gpt-5.4-high"], useFor: "hard debugging, architecture, migration planning" },
    ],
    pickerBehavior: "Expose these as selectable /model or provider-picker rows; do not require users to type exact model IDs.",
    defaultModel: DEFAULT_MODEL,
  };
}

export async function openai_latency_triage(args: JsonRecord): Promise<JsonRecord> {
  const seconds = Number(args.lastResponseSeconds ?? 0);
  return {
    provider: "openai",
    observedSeconds: Number.isFinite(seconds) ? seconds : undefined,
    likelyCauses: [
      "Using a high-reasoning model for a trivial command.",
      "Tool surface is too broad, causing slow planner/tool selection before first token.",
      "Provider request waits for full completion instead of streaming first-token output.",
      "Network/auth retry or local CLI wrapper overhead when using codex-cli instead of native API.",
    ],
    actions: [
      "Switch trivial chat/status/listing tasks to a fast model tier.",
      "Route shell/file-listing requests to native shell tools before model calls.",
      "Limit enabled tools for provider runs using per-task tool policy.",
      "Record time-to-first-token separately from total completion time.",
    ],
    openclawParity: "OpenClaw transport diagnostics distinguish provider stalls from oversized tool payloads; Muster should keep that split in run traces.",
  };
}

export const tools = {
  openai_latency_triage,
  openai_model_policy,
  openai_provider_readiness,
  openai_provider_setup_plan,
};
