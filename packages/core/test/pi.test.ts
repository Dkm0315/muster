import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildPiCliArgs, inspectPiRuntime, runPiCliDiagnostic } from "../src/index.js";

test("inspectPiRuntime reports missing pi root without throwing", async () => {
  const home = await mkdtemp(join(tmpdir(), "hybrowclaw-no-pi-"));
  const report = await inspectPiRuntime({ homeDir: home });

  assert.equal(report.installed, false);
  assert.equal(report.integrationMode, "embedded_sdk");
  assert.equal(report.sdkLoadable, true);
  assert.equal(report.missingSdkExports.length, 0);
  assert.equal(typeof report.cliAvailable, "boolean");
  assert.equal(typeof report.npxAvailable, "boolean");
  assert.equal(report.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(report.adapterState, "sdk_ready");
  assert.match(report.nextActions.join("\n"), /createAgentSession/);
});

test("inspectPiRuntime detects workflow and config candidates", async () => {
  const home = await mkdtemp(join(tmpdir(), "hybrowclaw-pi-"));
  await mkdir(join(home, ".pi", "workflows"), { recursive: true });
  await writeFile(join(home, ".pi", "config.json"), "{}\n", "utf8");
  await writeFile(join(home, ".pi", "workflows", "incident-flow.yaml"), "name: incident\n", "utf8");

  const report = await inspectPiRuntime({ homeDir: home });

  assert.equal(report.installed, true);
  assert.equal(report.adapterState, "sdk_ready_with_pi_home");
  assert.deepEqual(report.configFiles, ["config.json"]);
  assert.deepEqual(report.workflowFiles, ["workflows/incident-flow.yaml"]);
});

test("buildPiCliArgs creates an explicit diagnostic Pi CLI invocation", () => {
  const args = buildPiCliArgs({
    prompt: "Review this repo",
    provider: "openai",
    model: "gpt-4o-mini",
    thinking: "low",
    tools: ["read", "grep"],
    noSession: true
  });

  assert.deepEqual(args, [
    "--mode",
    "text",
    "--print",
    "--no-session",
    "--tools",
    "read,grep",
    "--provider",
    "openai",
    "--model",
    "gpt-4o-mini",
    "--thinking",
    "low",
    "Review this repo"
  ]);
});

test("runPiCliDiagnostic invokes an external Pi-compatible command only when requested", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-pi-command-"));
  const command = join(cwd, "fake-pi.sh");
  await writeFile(command, "#!/usr/bin/env bash\nprintf 'pi-output:%s\\n' \"$*\"\n", "utf8");
  await chmod(command, 0o755);

  const result = await runPiCliDiagnostic({
    command,
    prompt: "Say hello",
    cwd,
    tools: ["read"],
    noSession: true
  });

  assert.equal(result.status, "completed");
  assert.equal(result.transport, "cli");
  assert.equal(result.command, command);
  assert.match(result.stdout, /pi-output:/);
  assert.match(result.stdout, /Say hello/);
});
