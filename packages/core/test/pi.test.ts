import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectPiRuntime } from "../src/index.js";

test("inspectPiRuntime reports missing pi root without throwing", async () => {
  const home = await mkdtemp(join(tmpdir(), "hybrowclaw-no-pi-"));
  const report = await inspectPiRuntime({ homeDir: home });

  assert.equal(report.installed, false);
  assert.equal(report.adapterState, "not_connected");
  assert.match(report.nextActions.join("\n"), /pi\.dev runtime/);
});

test("inspectPiRuntime detects workflow and config candidates", async () => {
  const home = await mkdtemp(join(tmpdir(), "hybrowclaw-pi-"));
  await mkdir(join(home, ".pi", "workflows"), { recursive: true });
  await writeFile(join(home, ".pi", "config.json"), "{}\n", "utf8");
  await writeFile(join(home, ".pi", "workflows", "incident-flow.yaml"), "name: incident\n", "utf8");

  const report = await inspectPiRuntime({ homeDir: home });

  assert.equal(report.installed, true);
  assert.equal(report.adapterState, "ready_for_adapter");
  assert.deepEqual(report.configFiles, ["config.json"]);
  assert.deepEqual(report.workflowFiles, ["workflows/incident-flow.yaml"]);
});
