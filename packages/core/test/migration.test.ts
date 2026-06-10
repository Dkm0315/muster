import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanMigrationSource } from "../src/index.js";

test("openclaw scanner reports missing root safely", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-missing-"));
  const report = await scanMigrationSource("openclaw", { homeDir: home });

  assert.equal(report.exists, false);
  assert.equal(report.assets.length, 0);
  assert.equal(report.missingPaths.length, 1);
  assert.match(report.recommendedNextActions[0] ?? "", /Nothing to migrate/);
});

test("hermes scanner discovers memory and provider assets", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-hermes-"));
  await mkdir(join(home, ".hermes", "memory"), { recursive: true });
  await writeFile(join(home, ".hermes", "memory", "project.md"), "remember this\n");
  await writeFile(join(home, ".hermes", "providers.json"), "{}\n");

  const report = await scanMigrationSource("hermes", { homeDir: home });

  assert.equal(report.exists, true);
  assert.equal(report.assets.some((asset) => asset.kind === "memory"), true);
  assert.equal(report.assets.some((asset) => asset.kind === "provider"), true);
  assert.equal(report.recommendedNextActions.includes("Run doctor and generated evals after migration."), true);
});

test("pi scanner marks historical flows as archive-only", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-pi-"));
  await mkdir(join(home, ".pi", "agents"), { recursive: true });
  await mkdir(join(home, ".pi", "flows"), { recursive: true });
  await writeFile(join(home, ".pi", "agents", "architect.md"), "# Architect\n");
  await writeFile(join(home, ".pi", "flows", "run.json"), "{}\n");

  const report = await scanMigrationSource("pi", { homeDir: home });

  assert.equal(report.exists, true);
  assert.equal(report.assets.some((asset) => asset.kind === "agent" && asset.importMode === "map"), true);
  assert.equal(report.assets.some((asset) => asset.kind === "workflow" && asset.importMode === "archive_only"), true);
  assert.equal(report.archiveOnlyNotes.length, 1);
});
