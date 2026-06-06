import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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

async function runCli(args: string[], cwd = resolve(import.meta.dirname, "..", "..", "..")): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("tsx", [cliPath, ...args], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
}
