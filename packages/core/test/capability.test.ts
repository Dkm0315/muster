import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectCapabilityManifest } from "../src/index.js";

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
