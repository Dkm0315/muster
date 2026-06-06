import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTrustEnvelope } from "../src/index.js";
import type { ContextObject, EvidenceRecord, RunPlan, TrustPermissionInput } from "../src/index.js";

const plan: RunPlan = {
  runId: "run-trust-1",
  taskKind: "coding",
  runtimeId: "native",
  route: {
    provider: "local",
    model: "llama3.1",
    reasoning: "medium"
  },
  sensitive: false,
  createdAt: "2026-06-06T10:00:00.000Z"
};

const contexts: ContextObject[] = [
  {
    id: "ctx-customer",
    kind: "ticket",
    summary: "Customer bank logs with raw account identifiers",
    observedAt: "2026-06-06T09:00:00.000Z",
    confidence: 0.95,
    provenance: ["helpdesk"],
    scopes: [{ kind: "tenant", id: "quant" }],
    redactionState: "blocked"
  },
  {
    id: "ctx-policy",
    kind: "preference",
    summary: "Run local-first for sensitive customer work",
    observedAt: "2026-06-06T08:00:00.000Z",
    confidence: 0.92,
    provenance: ["user"],
    scopes: [{ kind: "workspace", id: "hybrowclaw" }],
    redactionState: "redacted",
    feedbackScore: 0.8
  },
  {
    id: "ctx-stale",
    kind: "assumption",
    summary: "Old routing assumption",
    observedAt: "2026-05-01T08:00:00.000Z",
    confidence: 0.3,
    provenance: ["chat"],
    scopes: [{ kind: "session", id: "old" }],
    redactionState: "none"
  }
];

const evidence: EvidenceRecord[] = [
  {
    kind: "test_result",
    label: "trust tests",
    status: "passed",
    detail: "node:test"
  },
  {
    kind: "system_check",
    label: "permission scan",
    status: "observed"
  }
];

test("buildTrustEnvelope returns a ready deterministic execution envelope", () => {
  const permissions: TrustPermissionInput[] = [
    { capability: "repo:read", requested: true, granted: true, reason: "Inspect local code" },
    { capability: "network", requested: false, granted: false }
  ];

  const envelope = buildTrustEnvelope({
    plan,
    contexts,
    evidence,
    permissions,
    scope: { kind: "workspace", id: "hybrowclaw" }
  });

  assert.equal(envelope.status, "ready");
  assert.deepEqual(envelope.blockers, []);
  assert.equal(envelope.traceId, "trust:run-trust-1");
  assert.deepEqual(envelope.route, {
    runtimeId: "native",
    provider: "local",
    model: "llama3.1",
    reasoning: "medium",
    taskKind: "coding",
    sensitive: false
  });
  assert.deepEqual(
    envelope.scopedContext.map((item) => item.id),
    ["ctx-policy"]
  );
  assert.deepEqual(envelope.permissionVerdicts, [
    {
      capability: "network",
      requested: false,
      granted: false,
      verdict: "not_requested",
      reason: undefined
    },
    {
      capability: "repo:read",
      requested: true,
      granted: true,
      verdict: "allowed",
      reason: "Inspect local code"
    }
  ]);
  assert.deepEqual(
    envelope.evidenceLedger.map((item) => [item.id, item.status, item.trustWeight]),
    [
      ["evidence:0001", "passed", 1],
      ["evidence:0002", "observed", 0.6]
    ]
  );
  assert.deepEqual(envelope.memoryPromotionCandidates, [
    {
      contextId: "ctx-policy",
      kind: "preference",
      risk: "low",
      summary: "Promote verified preference memory within workspace:hybrowclaw.",
      autoApply: false
    }
  ]);
});

test("buildTrustEnvelope blocks execution for denied permissions and blocked context", () => {
  const envelope = buildTrustEnvelope({
    plan,
    contexts,
    evidence: [{ kind: "system_check", label: "redaction check", status: "failed" }],
    permissions: [
      { capability: "filesystem:write", requested: true, granted: false, reason: "Outside approved scope" }
    ],
    scope: { kind: "tenant", id: "quant" }
  });

  assert.equal(envelope.status, "blocked");
  assert.deepEqual(envelope.blockers, [
    "Permission denied: filesystem:write",
    "Context blocked by redaction policy: ctx-customer",
    "Evidence failed: redaction check"
  ]);
  assert.equal(envelope.permissionVerdicts[0]?.verdict, "denied");
  assert.equal(envelope.scopedContext[0]?.redactionState, "blocked");
  assert.deepEqual(envelope.memoryPromotionCandidates, []);
});
