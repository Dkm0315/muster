import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPackReadinessQa } from "../src/qa-pack-readiness.js";

test("pack readiness QA writes artifact-backed cases", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "muster-pack-readiness-"));
  const result = await runPackReadinessQa({ artifactDir, packsDir: join(process.cwd(), "..", "..", "capability-packs") });

  assert.equal(result.suite, "pack_readiness");
  assert.ok(result.cases.length > 0);
  assert.ok(result.cases.some((item) => item.id === "all_manifests_parse"));
  assert.ok(result.cases.some((item) => item.id === "readiness_metadata_visible"));
  assert.ok(result.manifestPath.endsWith("manifest.json"));
  assert.ok(result.casesPath.endsWith("cases.jsonl"));

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
    suite: string;
    status: string;
    caseCount: number;
    artifacts: { cases: string; catalog: string };
  };
  assert.equal(manifest.suite, "pack_readiness");
  assert.equal(manifest.caseCount, result.cases.length);
  assert.equal(manifest.artifacts.cases, "cases.jsonl");
  assert.equal(manifest.artifacts.catalog, "catalog.json");

  const cases = (await readFile(result.casesPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { id: string; status: string });
  assert.equal(cases.length, result.cases.length);
});

test("pack readiness QA fails honestly when bundled packs are missing", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "muster-pack-readiness-missing-"));
  const result = await runPackReadinessQa({ artifactDir, packsDir: join(artifactDir, "missing-packs") });

  assert.equal(result.status, "failed");
  assert.equal(result.cases.find((item) => item.id === "all_manifests_parse")?.status, "failed");
  assert.match(result.cases.find((item) => item.id === "all_manifests_parse")?.summary ?? "", /no bundled capability packs/);
});
