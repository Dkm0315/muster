type JsonRecord = Record<string, unknown>;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] : fallback;
}

export async function codex_runtime_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const model = stringArg(args, "model", "gpt-5.5");
  const sandbox = stringArg(args, "sandbox", "workspace-write");
  return {
    runtime: "codex",
    sourceEvidence: [
      "Hermes codex skill delegates autonomous coding through `codex exec` and notes CLI OAuth may live in ~/.codex/auth.json.",
      "Hermes warns service contexts can break workspace-write sandboxing and recommends explicit workdir plus review gates.",
      "Muster runCodex uses `codex exec --json`, captures thread_id, injects system instructions through experimental_instructions_file, and reads the final reply from -o.",
    ],
    install: ["npm install -g @openai/codex", "codex --version", "codex login"],
    commands: [
      `muster provider add-codex-cli codex ${model}`,
      `muster runtime use-provider codex codex ${model}`,
      `muster run "hello" --runtime codex --model ${model}`,
      "muster plugins check codex",
    ],
    defaults: {
      model,
      sandbox,
      approvalPolicy: "never for headless exec; interactive approval belongs to native Codex TUI",
      sessionMode: "thread_id resume handle captured from JSONL events",
    },
    setupUrls: ["https://github.com/openai/codex"],
  };
}

export async function codex_runtime_readiness(args: JsonRecord): Promise<JsonRecord> {
  const cliAvailable = booleanArg(args, "cliAvailable");
  const authenticated = booleanArg(args, "authenticated");
  const gitRepo = booleanArg(args, "gitRepo");
  const runtimeConfigured = booleanArg(args, "runtimeConfigured");
  const checks = [
    { id: "cli", ok: cliAvailable, detail: cliAvailable ? "codex CLI is available." : "Install @openai/codex and ensure `codex --version` works." },
    { id: "auth", ok: authenticated, detail: authenticated ? "Codex CLI auth is configured." : "Run `codex login` or configure OPENAI_API_KEY if using API auth." },
    { id: "git_repo", ok: gitRepo, detail: gitRepo ? "Current workspace is a git repository." : "Codex expects a git repository; initialize scratch work with `git init`." },
    { id: "runtime", ok: runtimeConfigured, detail: runtimeConfigured ? "Muster codex runtime is configured." : "Run `muster runtime use-provider codex codex <model>`." },
  ];
  return {
    runtime: "codex",
    ready: checks.every((check) => check.ok),
    checks,
    next: checks.every((check) => check.ok) ? "muster run \"hello\" --runtime codex" : "muster plugins setup codex",
  };
}

export async function codex_session_policy(args: JsonRecord): Promise<JsonRecord> {
  const mode = stringArg(args, "mode", "continue");
  return {
    runtime: "codex",
    mode,
    policies: [
      { id: "ephemeral", useFor: "fast one-shot questions where continuity is not needed", behavior: "pass --ephemeral and do not persist a native session handle" },
      { id: "continue", useFor: "named chat sessions and follow-up coding turns", behavior: "persist thread_id per conversation/workspace/model" },
      { id: "resume", useFor: "explicit continuation of a known native Codex thread", behavior: "call `codex exec resume --json <thread_id>`" },
    ],
    safety: [
      "Inject Muster memory/skills as system instructions, not user text.",
      "Clear provider handles when switching runtime/provider/model.",
      "Keep shell/file-listing tasks on native tools instead of a Codex round-trip.",
    ],
  };
}

export async function codex_runtime_latency_triage(args: JsonRecord): Promise<JsonRecord> {
  const seconds = Number(args.lastResponseSeconds ?? 0);
  return {
    runtime: "codex",
    observedSeconds: Number.isFinite(seconds) ? seconds : undefined,
    likelyCauses: [
      "Native Codex CLI startup or auth lookup overhead.",
      "Session resume carrying too much context for a trivial command.",
      "Using Codex agent runtime for a direct shell task such as `ls`.",
      "Sandbox setup failure or retry in a service context.",
    ],
    actions: [
      "Use ephemeral mode for greetings and short answers.",
      "Route filesystem listing/status to shell tools before model calls.",
      "Record CLI startup, first-event, and final-message timings separately.",
      "Use danger-full-access only when the host sandbox blocks Codex, with explicit workdir and review gates.",
    ],
  };
}

export const tools = {
  codex_runtime_latency_triage,
  codex_runtime_readiness,
  codex_runtime_setup_plan,
  codex_session_policy,
};
