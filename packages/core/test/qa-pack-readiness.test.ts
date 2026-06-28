import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runPackReadinessQa } from "../src/qa-pack-readiness.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("pack readiness QA writes artifact-backed cases", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "muster-pack-readiness-"));
  const result = await runPackReadinessQa({ artifactDir, packsDir: join(repoRoot, "capability-packs") });

  assert.equal(result.suite, "pack_readiness");
  assert.equal(result.status, "passed");
  assert.ok(result.cases.length > 0);
  assert.ok(result.cases.some((item) => item.id === "all_manifests_parse"));
  assert.ok(result.cases.some((item) => item.id === "readiness_metadata_visible"));
  assert.ok(result.cases.some((item) => item.id === "implemented_tool_surfaces_visible"));
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

  const catalog = JSON.parse(await readFile(result.catalogPath, "utf8")) as Array<{ manifest?: { id: string; implementedTools: string[] } }>;
  const artifactStudio = catalog.find((item) => item.manifest?.id === "artifact-studio");
  assert.ok(artifactStudio);
  assert.ok(artifactStudio.manifest?.implementedTools.includes("docx_document"));
});

test("pack readiness QA fails honestly when bundled packs are missing", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "muster-pack-readiness-missing-"));
  const result = await runPackReadinessQa({ artifactDir, packsDir: join(artifactDir, "missing-packs") });

  assert.equal(result.status, "failed");
  assert.equal(result.cases.find((item) => item.id === "all_manifests_parse")?.status, "failed");
  assert.match(result.cases.find((item) => item.id === "all_manifests_parse")?.summary ?? "", /no bundled capability packs/);
});

test("pack readiness QA fails shallow non-metadata packs without implemented tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "muster-pack-readiness-shallow-"));
  const packDir = join(root, "shallow-pack");
  const artifactDir = join(root, "artifacts");
  await mkdir(packDir, { recursive: true });
  await writeFile(join(packDir, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "shallow-pack",
    name: "Shallow Pack",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "src/index.ts",
    permissions: [],
    sandbox: "none",
    evals: ["evals/shallow.json"],
    readiness: {
      level: "executable",
      status: "beta",
      actionability: "local_tool",
      owner: "test",
      surfaces: ["cli"],
      setup: {
        urls: [],
        requiredEnv: [],
        requiredAnyEnv: [],
        credentialStorage: "none",
      },
      diagnostics: {
        doctorCommand: "muster plugins check shallow-pack",
        smokeCommand: "muster capability inspect capability-packs/shallow-pack",
        requiresLiveCredentials: false,
      },
      safety: {
        risk: "low",
        permissionMode: "allow_when_scoped",
        mutationApproval: "never",
        resultCapBytes: 1024,
        secretRedaction: true,
      },
      evidence: {
        unitTests: ["packages/core/test/capability.test.ts"],
        qaSuites: ["pack_readiness"],
        liveArtifacts: [],
        docs: ["README.md"],
      },
    },
  }, null, 2)}\n`, "utf8");

  const result = await runPackReadinessQa({ artifactDir, packsDir: root });

  assert.equal(result.status, "failed");
  const implementedTools = result.cases.find((item) => item.id === "implemented_tool_surfaces_visible");
  assert.equal(implementedTools?.status, "failed");
  assert.deepEqual(implementedTools?.evidence.missingImplementedTools, ["shallow-pack"]);
});
