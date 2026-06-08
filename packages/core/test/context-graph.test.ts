import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContextGraph, buildEpisodeContextGraph } from "../src/index.js";
import type { ContextObject, EpisodeRecord, RunPlan, TrustPermissionInput } from "../src/index.js";

const plan: RunPlan = {
  runId: "run-context-1",
  taskKind: "architecture",
  runtimeId: "pi",
  route: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    reasoning: "high"
  },
  sensitive: false,
  createdAt: "2026-06-08T10:00:00.000Z"
};

const memories: ContextObject[] = [
  {
    id: "mem-policy",
    kind: "policy",
    summary: "BFSI customer data must stay local unless explicitly approved.",
    observedAt: "2026-06-08T09:00:00.000Z",
    confidence: 0.95,
    provenance: ["manual:test"],
    scopes: [{ kind: "tenant", id: "hybrow" }],
    redactionState: "redacted",
    links: ["mem-runbook"]
  },
  {
    id: "mem-other-user",
    kind: "preference",
    summary: "Another user's private preference.",
    observedAt: "2026-06-08T09:10:00.000Z",
    confidence: 0.9,
    provenance: ["manual:test"],
    scopes: [{ kind: "user", id: "someone-else" }],
    redactionState: "none"
  }
];

test("buildContextGraph creates deterministic route, memory, evidence, and permission nodes", () => {
  const permissions: TrustPermissionInput[] = [
    { capability: "filesystem:read", requested: true, granted: true },
    { capability: "network", requested: true, granted: false, reason: "offline mode" }
  ];
  const graph = buildContextGraph({
    plan,
    contexts: memories,
    evidence: [{ kind: "test_result", label: "unit tests", status: "passed", detail: "43/43" }],
    permissions,
    scope: { kind: "tenant", id: "hybrow" }
  });

  assert.equal(graph.id, "graph:run-context-1");
  assert.equal(graph.status, "blocked");
  assert.ok(graph.nodes.some((node) => node.id === "run:run-context-1"));
  assert.ok(graph.nodes.some((node) => node.id === "provider:anthropic"));
  assert.ok(graph.nodes.some((node) => node.id === "model:anthropic:claude-sonnet-4-5"));
  assert.ok(graph.nodes.some((node) => node.id === "memory:mem-policy" && node.trustWeight === 0.76));
  assert.ok(!graph.nodes.some((node) => node.id === "memory:mem-other-user"));
  assert.ok(graph.edges.some((edge) => edge.kind === "uses_context" && edge.to === "memory:mem-policy"));
  assert.ok(graph.edges.some((edge) => edge.kind === "links_to" && edge.to === "memory:mem-runbook"));
  assert.ok(graph.blockers.includes("Permission denied: network"));
  assert.equal(graph.summary.scopedContext, 1);
  assert.equal(graph.summary.evidence, 1);
  assert.equal(graph.summary.permissions, 2);
});

test("buildEpisodeContextGraph turns recorded episodes into graphable context", () => {
  const episode: EpisodeRecord = {
    id: "episode-graph",
    createdAt: "2026-06-08T11:00:00.000Z",
    cwd: "/tmp/project",
    prompt: "Review the Redis runbook",
    taskKind: "research",
    runtimeId: "native",
    providerId: "local",
    model: "llama3.1",
    reasoning: "medium",
    responseText: "Redis runbook is ready.",
    evidence: [{ kind: "model_response", label: "assistant response", status: "observed" }]
  };

  const graph = buildEpisodeContextGraph({
    episode,
    memories,
    scope: { kind: "tenant", id: "hybrow" }
  });

  assert.equal(graph.id, "graph:episode-graph");
  assert.equal(graph.status, "ready");
  assert.ok(graph.nodes.some((node) => node.id === "task:research"));
  assert.ok(graph.nodes.some((node) => node.id === "evidence:0001"));
});
