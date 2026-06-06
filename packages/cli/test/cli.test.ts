import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = resolve(import.meta.dirname, "..", "src", "index.ts");

test("CLI help exposes terminal and pi surfaces", async () => {
  const { stdout } = await runCli(["help"]);

  assert.match(stdout, /hybrowclaw tui ask/);
  assert.match(stdout, /hybrowclaw pi inspect/);
  assert.match(stdout, /hybrowclaw runtime use-provider/);
  assert.match(stdout, /hybrowclaw capability inspect/);
  assert.match(stdout, /hybrowclaw memory add/);
});

test("CLI can initialize, add codex provider, switch runtime, and render tui", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-cli-"));

  await runCli(["init"], cwd);
  await runCli(["provider", "add-codex-cli", "codex", "o4-mini"], cwd);
  await runCli(["runtime", "use-provider", "native", "codex"], cwd);
  const { stdout } = await runCli(["tui"], cwd);

  assert.match(stdout, /HybrowClaw Terminal Cockpit/);
  assert.match(stdout, /configured=true/);
});

test("CLI pi inspect is safe when pi is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "hybrowclaw-cli-no-pi-"));
  const { stdout } = await runCli(["pi", "inspect", "--home", home]);

  assert.match(stdout, /installed=false/);
  assert.match(stdout, /adapter_state=not_connected/);
});

test("CLI capability inspect reports safe manifest status", async () => {
  const pack = await mkdtemp(join(tmpdir(), "hybrowclaw-capability-"));
  await writeFile(
    join(pack, "hybrowclaw.capability.json"),
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
        digest: "sha256:test"
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

test("CLI memory add and search preserve scoped isolation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-cli-memory-"));
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

async function runCli(args: string[], cwd = resolve(import.meta.dirname, "..", "..", "..")): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("tsx", [cliPath, ...args], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
}
