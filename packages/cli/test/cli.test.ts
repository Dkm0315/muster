import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = resolve(import.meta.dirname, "..", "src", "index.ts");

test("CLI help exposes terminal and pi surfaces", async () => {
  const { stdout } = await runCli(["help"]);

  assert.match(stdout, /muster tui ask/);
  assert.match(stdout, /muster pi inspect/);
  assert.match(stdout, /muster pi models/);
  assert.match(stdout, /muster pi tools/);
  assert.match(stdout, /muster pi commands/);
  assert.match(stdout, /muster pi tui/);
  assert.match(stdout, /--transport sdk\|cli/);
  assert.match(stdout, /--session memory\|create\|continue/);
  assert.match(stdout, /muster claude inspect/);
  assert.match(stdout, /muster chat "your prompt"/);
  assert.match(stdout, /muster chat --session work/);
  assert.match(stdout, /muster runtime use-provider/);
  assert.match(stdout, /muster capability inspect/);
  assert.match(stdout, /muster memory add/);
  assert.match(stdout, /muster eval seed/);
});

test("CLI chat exposes a real named terminal chat surface without hanging in non-TTY tests", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-chat-"));

  const help = await runCli(["chat", "--help"], cwd);
  assert.match(help.stdout, /muster chat/);
  assert.match(help.stdout, /\/resume <name\|id>/);
  assert.match(help.stdout, /\/tools \[toolset\]/);
  assert.match(help.stdout, /\/agents/);
  assert.match(help.stdout, /@agent-name <task>/);

  const history = await runCli(["chat", "--session", "release-audit", "--history"], cwd);
  assert.match(history.stdout, /session=release-audit/);
  assert.match(history.stdout, /messages=0/);

  const listed = await runCli(["chat", "--list"], cwd);
  assert.match(listed.stdout, /release-audit/);

  const blocked = await runCliAllowFailure(["chat"], cwd);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /Interactive chat requires a TTY/);

  const bare = await runCliAllowFailure([], cwd);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /Interactive chat requires a TTY/);
  assert.doesNotMatch(bare.stdout, /Usage:/);
});

test("CLI can initialize, add codex provider, switch runtime, and render tui", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-"));

  await runCli(["init"], cwd);
  await runCli(["provider", "add-codex-cli", "codex", "o4-mini"], cwd);
  await runCli(["runtime", "use-provider", "native", "codex"], cwd);
  const { stdout } = await runCli(["tui"], cwd);

  assert.match(stdout, /Muster Terminal Cockpit/);
  assert.match(stdout, /configured=true/);
});

test("CLI pi inspect is safe when pi is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-cli-no-pi-"));
  const { stdout } = await runCli(["pi", "inspect", "--home", home]);

  assert.match(stdout, /installed=false/);
  assert.match(stdout, /integration_mode=embedded_sdk/);
  assert.match(stdout, /sdk_loadable=true/);
  assert.match(stdout, /adapter_state=sdk_ready/);
});

test("CLI pi models exposes Pi provider registry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-pi-models-"));
  const agentDir = join(cwd, ".pi-agent");
  const { stdout } = await runCli(["pi", "models", "--provider", "anthropic", "--agent-dir", agentDir], cwd);

  assert.match(stdout, /provider\tmodel\tavailable/);
  assert.match(stdout, /anthropic\t/);
  assert.match(stdout, /claude/i);
});

test("CLI pi tools exposes Pi tool registry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-pi-tools-"));
  const agentDir = join(cwd, ".pi-agent");
  const { stdout } = await runCli(["pi", "tools", "--agent-dir", agentDir, "--tools", "read,grep"], cwd);

  assert.match(stdout, /active_tools=read,grep/);
  assert.match(stdout, /tool\tactive\tscope\torigin\tsource\tparameters\tdescription/);
  assert.match(stdout, /read\tyes/);
  assert.match(stdout, /grep\tyes/);
  assert.match(stdout, /ls\tno/);
});

test("CLI pi commands exposes Pi prompt and skill slash catalog", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-pi-commands-"));
  const agentDir = join(cwd, ".pi-agent");
  await mkdir(join(agentDir, "skills", "postgres-dba"), { recursive: true });
  await mkdir(join(agentDir, "prompts"), { recursive: true });
  await writeFile(
    join(agentDir, "skills", "postgres-dba", "SKILL.md"),
    "---\nname: postgres-dba\ndescription: Investigate PostgreSQL operational issues.\n---\nBe careful with production data.\n",
    "utf8"
  );
  await writeFile(
    join(agentDir, "prompts", "release-note.md"),
    "---\ndescription: Draft a release note.\n---\nDraft release note for $ARGUMENTS.\n",
    "utf8"
  );
  const { stdout } = await runCli(["pi", "commands", "--agent-dir", agentDir, "--tools", "read,grep"], cwd);

  assert.match(stdout, /command\tsource\tscope\torigin\tpath\tdescription/);
  assert.match(stdout, /\/skill:postgres-dba\tskill/);
  assert.match(stdout, /\/release-note\tprompt/);
});

test("CLI pi tui reports a clear non-TTY guard instead of hanging", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-pi-tui-"));
  const result = await runCliAllowFailure(["pi", "tui", "hello", "--session", "memory"], cwd);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /runtime=pi transport=interactive/);
  assert.match(result.stdout, /status=blocked/);
  assert.match(result.stdout, /requires an attached TTY/);
});

test("CLI pi ask prints lifecycle trace when provider auth fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-pi-trace-"));
  const sessionDir = join(cwd, ".sessions");
  const result = await runCliAllowFailure([
    "pi",
    "ask",
    "Reply with one word.",
    "--provider",
    "anthropic",
    "--model",
    "claude-sonnet-4-5",
    "--session",
    "create",
    "--session-dir",
    sessionDir
  ], cwd);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /event_trace=/);
  assert.match(result.stdout, /session_created/);
  assert.match(result.stdout, /prompt_start/);
  assert.match(result.stdout, /prompt_end=failed/);
});

test("CLI capability inspect reports safe manifest status", async () => {
  const pack = await mkdtemp(join(tmpdir(), "muster-capability-"));
  const skillBody = "Be careful with Redis operational runbooks.\n";
  await writeFile(join(pack, "SKILL.md"), skillBody, "utf8");
  await writeFile(
    join(pack, "muster.capability.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "redis-runbook",
        name: "Redis Runbook",
        version: "0.1.0",
        kind: "skill",
        entrypoint: "SKILL.md",
        permissions: ["filesystem:read"],
        sandbox: "read_only",
        evals: ["evals/redis-runbook.jsonl"],
        digest: `sha256:${createHash("sha256").update(skillBody).digest("hex")}`
      },
      null,
      2
    )
  );

  const { stdout } = await runCli(["capability", "inspect", pack]);

  assert.match(stdout, /status=ready/);
  assert.match(stdout, /risk=low/);
  assert.match(stdout, /id=redis-runbook/);
});

test("CLI capability load honors configured plugin deny policy", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-capability-policy-"));
  const pack = await mkdtemp(join(tmpdir(), "muster-capability-policy-pack-"));
  const entrypoint = "export const tools = { noop: async () => ({ ok: true }) };\n";
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(
    join(cwd, ".muster", "config.json"),
    `${JSON.stringify({ version: 1, plugins: { deny: ["policy-pack"] } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(pack, "index.mjs"), entrypoint, "utf8");
  await writeFile(
    join(pack, "muster.capability.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "policy-pack",
        name: "Policy Pack",
        version: "0.1.0",
        kind: "tool",
        entrypoint: "index.mjs",
        permissions: [],
        sandbox: "none",
        evals: ["evals/noop.json"],
        digest: `sha256:${createHash("sha256").update(entrypoint).digest("hex")}`
      },
      null,
      2
    ),
    "utf8",
  );

  const result = await runCliAllowFailure(["capability", "load", pack], cwd);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /denied by plugins\.deny/);
});

test("CLI skills index renders pinned skill digests", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-skills-index-"));
  await mkdir(join(cwd, ".muster", "skills"), { recursive: true });
  await writeFile(
    join(cwd, ".muster", "skills", ".index.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-06-19T00:00:00.000Z",
      skills: {
        "audit-frappe": {
          name: "audit-frappe",
          description: "Audit Frappe deployments",
          version: "0.1.0",
          status: "active",
          digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          provenance: { createdBy: "user", createdAt: "2026-06-19T00:00:00.000Z" },
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  const { stdout } = await runCli(["skills", "index"], cwd);

  assert.match(stdout, /audit-frappe/);
  assert.match(stdout, /sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

test("CLI context graph exports graph JSON from episode and scoped memory ledgers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-context-"));
  await mkdir(join(cwd, ".muster", "data"), { recursive: true });
  await writeFile(
    join(cwd, ".muster", "data", "episodes.jsonl"),
    `${JSON.stringify({
      id: "episode-context",
      createdAt: "2026-06-08T12:00:00.000Z",
      cwd,
      prompt: "Architect the harness memory layer",
      taskKind: "architecture",
      runtimeId: "pi",
      providerId: "anthropic",
      model: "claude-sonnet-4-5",
      reasoning: "high",
      responseText: "Use scoped memory and eval gates.",
      evidence: [{ kind: "model_response", label: "assistant response", status: "observed" }]
    })}\n`,
    "utf8"
  );
  await writeFile(
    join(cwd, ".muster", "data", "memory.jsonl"),
    `${JSON.stringify({
      id: "mem-context",
      kind: "principle",
      summary: "Tenant memory must not leak across users.",
      observedAt: "2026-06-08T11:00:00.000Z",
      confidence: 0.9,
      provenance: ["manual:test"],
      scopes: [{ kind: "tenant", id: "hybrow" }],
      redactionState: "none"
    })}\n`,
    "utf8"
  );

  const { stdout } = await runCli(["context", "graph", "episode-context", "--scope", "tenant:hybrow"], cwd);
  const graph = JSON.parse(stdout) as { id: string; nodes: Array<{ id: string }>; edges: Array<{ kind: string }> };

  assert.equal(graph.id, "graph:episode-context");
  assert.ok(graph.nodes.some((node) => node.id === "memory:mem-context"));
  assert.ok(graph.edges.some((edge) => edge.kind === "uses_context"));
});

test("CLI memory add and search preserve scoped isolation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-memory-"));
  const added = await runCli(
    [
      "memory",
      "add",
      "--summary",
      "Dhairya wants terse CTO-style product critique.",
      "--scope",
      "tenant:hybrow",
      "--scope",
      "user:dhairya",
      "--provenance",
      "cli-test"
    ],
    cwd
  );
  const id = added.stdout.match(/id=(mem_[^\n]+)/)?.[1];

  const scoped = await runCli(
    ["memory", "search", "--scope", "tenant:hybrow", "--scope", "user:dhairya", "--query", "CTO-style"],
    cwd
  );
  const global = await runCli(["memory", "search", "--scope", "global:global", "--query", "Dhairya"], cwd);

  assert.ok(id);
  assert.match(scoped.stdout, /CTO-style/);
  assert.match(global.stdout, /No memory matched/);
});

test("CLI eval seed and run use recorded episode fixtures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-eval-"));
  await mkdir(join(cwd, ".muster", "data"), { recursive: true });
  await writeFile(
    join(cwd, ".muster", "data", "episodes.jsonl"),
    `${JSON.stringify({
      id: "episode-cli-eval",
      createdAt: "2026-06-06T00:00:00.000Z",
      cwd,
      prompt: "Summarize Redis risk",
      taskKind: "architecture",
      runtimeId: "native",
      providerId: "local",
      model: "llama3.1",
      responseText: "Redis risk is high until the patch is deployed.",
      evidence: [{ kind: "system_check", label: "fixture", status: "passed" }],
      outcome: { kind: "completed" }
    })}\n`,
    "utf8"
  );

  const seeded = await runCli(["eval", "seed", "episode-cli-eval", "--expect", "patch is deployed"], cwd);
  const run = await runCli(["eval", "run"], cwd);

  assert.match(seeded.stdout, /eval=eval_episode-cli-eval/);
  assert.match(run.stdout, /status=passed/);
});

test("CLI pi inspect exposes real Pi package adapter availability", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-cli-pi-home-"));
  const { stdout } = await runCli(["pi", "inspect", "--home", home]);

  assert.match(stdout, /package=@earendil-works\/pi-coding-agent@0\.79\.1/);
  assert.match(stdout, /missing_sdk_exports=-/);
  assert.match(stdout, /cli_available=/);
  assert.match(stdout, /npx_available=/);
});

test("CLI provider presets lists the multi-provider catalog", async () => {
  const { stdout } = await runCli(["provider", "presets"]);
  for (const id of ["openai", "anthropic", "xai", "kimi", "deepseek", "ollama", "openrouter"]) {
    assert.ok(stdout.includes(id), `presets output missing ${id}`);
  }
});

test("CLI profile, schedule, tokens, and verify work end to end in a fresh workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-beast-"));
  await runCli(["init"], cwd);

  await runCli(["profile", "create", "team-a"], cwd);
  await runCli(["profile", "use", "team-a"], cwd);
  const profiles = await runCli(["profile", "list"], cwd);
  assert.match(profiles.stdout, /\* team-a/);

  const added = await runCli(["provider", "add", "kimi", "--model", "kimi-latest"], cwd);
  assert.match(added.stdout, /provider_added=kimi/);
  assert.match(added.stdout, /MOONSHOT_API_KEY/);

  const schedule = await runCli(["schedule", "add", "*/5 * * * *", "daily digest"], cwd);
  assert.match(schedule.stdout, /Scheduled sched_/);
  const schedules = await runCli(["schedule", "list"], cwd);
  assert.match(schedules.stdout, /daily digest/);

  const tokens = await runCli(["tokens"], cwd);
  assert.match(tokens.stdout, /No token records yet/);

  const verify = await runCli(["verify"], cwd);
  assert.match(verify.stdout, /integrity check at .*: OK/);

  const selfcheck = await runCli(["evolve", "selfcheck"], cwd);
  assert.match(selfcheck.stdout, /\[PASS\] memory_isolation/);
  assert.match(selfcheck.stdout, /\[PASS\] replay_waste_detection/);
  assert.match(selfcheck.stdout, /\[PASS\] store_integrity/);
});

test("CLI flow save, check, run with gate, approve, and runs work end to end", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-flow-"));
  await runCli(["init"], cwd);
  await writeFile(
    join(cwd, "digest.json"),
    JSON.stringify({
      id: "digest",
      description: "gated echo digest",
      steps: [
        { id: "fetch", kind: "tool", tool: "echo", args: { summary: "3 open tickets" } },
        { id: "approve", kind: "gate", show: "fetch.summary", expiresHours: 48 },
        { id: "post", kind: "tool", tool: "echo", args: { body: "{{fetch.summary}}" }, when: "approve.granted" }
      ]
    }),
    "utf8"
  );

  const saved = await runCli(["flow", "save", "digest.json"], cwd);
  assert.match(saved.stdout, /flow=digest steps=3/);

  const listed = await runCli(["flow", "list"], cwd);
  assert.match(listed.stdout, /digest\s+3/);

  const checked = await runCli(["flow", "check", "digest"], cwd);
  assert.match(checked.stdout, /flow=digest preflight=ok/);

  const run = await runCli(["flow", "run", "digest"], cwd);
  assert.match(run.stdout, /step=fetch status=completed/);
  assert.match(run.stdout, /status=awaiting_approval gate=approve/);
  assert.match(run.stdout, /3 open tickets/, "gate shows the actual step output");
  const runId = run.stdout.match(/flow_run=(flowrun_[a-f0-9]+)/)?.[1];
  assert.ok(runId, "flow run id printed");

  const runs = await runCli(["flow", "runs"], cwd);
  assert.match(runs.stdout, /digest/);
  assert.match(runs.stdout, /awaiting_approval/);

  const approved = await runCli(["flow", "approve", runId!], cwd);
  assert.match(approved.stdout, /step=approve status=approved/);
  assert.match(approved.stdout, /step=post status=completed/);
  assert.match(approved.stdout, /status=completed/);

  const shown = await runCli(["flow", "show", runId!], cwd);
  assert.match(shown.stdout, /flow_run=flowrun_.* flow=digest status=completed/);
  assert.match(shown.stdout, /run_status=completed/);

  const badCheck = await runCliAllowFailure(["flow", "check", "missing-flow"], cwd);
  assert.equal(badCheck.code, 1);
  assert.match(badCheck.stderr, /Flow not found: missing-flow/);
});

test("CLI doctor --fix bootstraps a fresh workspace and status renders mission control", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cli-status-"));

  // status must never crash on an empty workspace
  const fresh = await runCli(["status"], cwd);
  assert.match(fresh.stdout, /muster status —/);
  assert.match(fresh.stdout, /providers\s+no config \(run: muster doctor --fix\)/);

  const fixed = await runCli(["doctor", "--fix"], cwd);
  assert.match(fixed.stdout, /fix config/);
  assert.match(fixed.stdout, /fix data-dir/);
  assert.match(fixed.stdout, /ok  config/);

  await runCli(["schedule", "add", "* * * * *", "daily digest"], cwd);

  const { stdout } = await runCli(["status"], cwd);
  assert.match(stdout, /profile\s+default/);
  assert.match(stdout, /providers\s+1 configured \(local\)/);
  assert.match(stdout, /episodes\s+0 recorded/);
  assert.match(stdout, /tokens today\s+0 across 0 runs/);
  assert.match(stdout, /schedules\s+1 total, 1 due now/);
  assert.match(stdout, /flows pending gate\s+none/);
  assert.match(stdout, /verify\s+OK/);
});

async function runCli(args: string[], cwd = resolve(import.meta.dirname, "..", "..", "..")): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("tsx", [cliPath, ...args], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
}

async function runCliAllowFailure(args: string[], cwd = resolve(import.meta.dirname, "..", "..", "..")): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await runCli(args, cwd);
    return { ...result, code: 0 };
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string; code?: number };
    return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "", code: detail.code ?? 1 };
  }
}
