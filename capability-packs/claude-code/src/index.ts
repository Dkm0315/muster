type JsonRecord = Record<string, unknown>;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] : fallback;
}

export async function claude_code_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const model = stringArg(args, "model", "sonnet");
  return {
    runtime: "claude-code",
    sourceEvidence: [
      "Hermes Claude Code skill prefers print mode for one-shot automation and tmux/PTY for interactive multi-turn sessions.",
      "Hermes records Claude auth, doctor, MCP, agents, plugins, and session-resume commands as first-class setup surfaces.",
      "Muster runClaudeCode uses `claude --print --output-format text`, pins session ids, and passes plugin dirs/allowedTools explicitly.",
    ],
    install: ["npm install -g @anthropic-ai/claude-code", "claude --version", "claude auth login", "claude doctor"],
    commands: [
      "muster runtime use-provider claude-code claude-code " + model,
      "muster run \"hello\" --runtime claude-code",
      "muster plugins check claude-code",
    ],
    setupUrls: ["https://docs.anthropic.com/en/docs/claude-code/setup", "https://code.claude.com/docs/en/cli-reference"],
    authModes: ["browser OAuth subscription login", "ANTHROPIC_API_KEY via console auth", "SSO for Enterprise"],
  };
}

export async function claude_code_readiness(args: JsonRecord): Promise<JsonRecord> {
  const cliAvailable = booleanArg(args, "cliAvailable");
  const authenticated = booleanArg(args, "authenticated");
  const runtimeConfigured = booleanArg(args, "runtimeConfigured");
  const doctorOk = booleanArg(args, "doctorOk", cliAvailable);
  const checks = [
    { id: "cli", ok: cliAvailable, detail: cliAvailable ? "claude CLI is available." : "Install @anthropic-ai/claude-code." },
    { id: "auth", ok: authenticated, detail: authenticated ? "Claude Code auth is configured." : "Run `claude auth login` or configure API billing auth." },
    { id: "doctor", ok: doctorOk, detail: doctorOk ? "Claude doctor is clean or not required." : "Run `claude doctor` for updater/install health." },
    { id: "runtime", ok: runtimeConfigured, detail: runtimeConfigured ? "Muster claude-code runtime is configured." : "Run `muster runtime use-provider claude-code claude-code <model>`." },
  ];
  return { runtime: "claude-code", ready: checks.every((check) => check.ok), checks, next: checks.every((check) => check.ok) ? "muster run \"hello\" --runtime claude-code" : "muster plugins setup claude-code" };
}

export async function claude_code_mode_policy(args: JsonRecord): Promise<JsonRecord> {
  const task = stringArg(args, "task", "one-shot");
  return {
    runtime: "claude-code",
    selectedTask: task,
    modes: [
      { id: "print", command: "claude -p", useFor: "one-shot coding, CI automation, structured output", ptyRequired: false },
      { id: "interactive", command: "claude", useFor: "human-in-the-loop sessions, slash commands, exploratory work", ptyRequired: true },
      { id: "tmux", command: "tmux + claude", useFor: "long-running multi-turn work that must be monitored", ptyRequired: true },
    ],
    musterDefault: "print mode through runClaudeCode for non-interactive reliability",
    permissioning: "Pass allowedTools/pluginDirs explicitly; avoid blanket permission bypass unless the user chooses it.",
  };
}

export async function claude_code_session_policy(args: JsonRecord): Promise<JsonRecord> {
  const sessionName = stringArg(args, "sessionName", "main");
  return {
    runtime: "claude-code",
    sessionName,
    policies: [
      "Muster pins its own session id with --session-id so resume does not depend on parsing prose output.",
      "Use --resume only when continuing a known Muster-managed session.",
      "Clear provider handles when switching model/runtime to avoid cross-provider context leaks.",
      "Export active Muster skills as temporary Claude plugin dirs instead of bloating the user prompt.",
    ],
  };
}

export const tools = {
  claude_code_mode_policy,
  claude_code_readiness,
  claude_code_session_policy,
  claude_code_setup_plan,
};
