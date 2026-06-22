import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectCapabilityManifest, inspectCapabilityPack } from "../src/index.js";

test("inspectCapabilityManifest accepts a safe read-only skill manifest", () => {
  const result = inspectCapabilityManifest("/tmp/example", {
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
  });

  assert.equal(result.status, "ready");
  assert.equal(result.risk, "low");
  assert.equal(result.manifest?.id, "redis-runbook");
});

test("inspectCapabilityManifest blocks shell without write/full-trust sandbox", () => {
  const result = inspectCapabilityManifest("/tmp/example", {
    schemaVersion: 1,
    id: "shell-helper",
    name: "Shell Helper",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "index.ts",
    permissions: ["shell"],
    sandbox: "read_only"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.risk, "high");
  assert.match(result.blockers.join("\n"), /shell permission/);
});

test("inspectCapabilityManifest requires declared secret names for secret access", () => {
  const result = inspectCapabilityManifest("/tmp/example", {
    schemaVersion: 1,
    id: "aws-reader",
    name: "AWS Reader",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "index.ts",
    permissions: ["secrets"],
    sandbox: "workspace_write",
    secrets: []
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("\n"), /secrets permission/);
});

test("inspectCapabilityPack blocks a manifest whose entrypoint digest does not match", async () => {
  const dir = join(tmpdir(), `muster-capability-digest-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.js"), "export const tools = { noop: async () => ({ ok: true }) };\n", "utf8");
  await writeFile(
    join(dir, "muster.capability.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: "digest-check",
      name: "Digest Check",
      version: "0.1.0",
      kind: "tool",
      entrypoint: "index.js",
      permissions: ["filesystem:read"],
      sandbox: "read_only",
      evals: ["evals/noop.jsonl"],
      digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }, null, 2)}\n`,
    "utf8",
  );

  const result = await inspectCapabilityPack(dir);

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("\n"), /digest mismatch/);
});
