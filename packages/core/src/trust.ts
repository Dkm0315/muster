import type { ContextObject, EvidenceRecord, MemoryScope, ReasoningLevel, RunPlan, TaskKind } from "./types.js";

export interface TrustPermissionInput {
  readonly capability: string;
  readonly requested: boolean;
  readonly granted: boolean;
  readonly reason?: string;
}

export type TrustPermissionVerdict = "allowed" | "denied" | "not_requested";

export interface TrustPermissionDecision extends TrustPermissionInput {
  readonly verdict: TrustPermissionVerdict;
}

export interface TrustEnvelopeInput {
  readonly plan: RunPlan;
  readonly contexts?: readonly ContextObject[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly permissions?: readonly TrustPermissionInput[];
  readonly scope?: MemoryScope;
}

export interface TrustRouteTrace {
  readonly runtimeId: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning?: ReasoningLevel;
  readonly taskKind: TaskKind;
  readonly sensitive: boolean;
}

export interface ScopedContextSummary {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly scope: string;
  readonly confidence: number;
  readonly redactionState: ContextObject["redactionState"];
  readonly provenance: readonly string[];
}

export interface TrustEvidenceLedgerEntry extends EvidenceRecord {
  readonly id: string;
  readonly trustWeight: number;
}

export interface TrustMemoryPromotionCandidate {
  readonly contextId: string;
  readonly kind: string;
  readonly risk: "low" | "medium" | "high";
  readonly summary: string;
  readonly autoApply: boolean;
}

export interface TrustEnvelope {
  readonly traceId: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly status: "ready" | "blocked";
  readonly route: TrustRouteTrace;
  readonly scopedContext: readonly ScopedContextSummary[];
  readonly permissionVerdicts: readonly TrustPermissionDecision[];
  readonly evidenceLedger: readonly TrustEvidenceLedgerEntry[];
  readonly memoryPromotionCandidates: readonly TrustMemoryPromotionCandidate[];
  readonly blockers: readonly string[];
}

export function buildTrustEnvelope(input: TrustEnvelopeInput): TrustEnvelope {
  const scopedContext = summarizeScopedContext(input.contexts ?? [], input.scope);
  const permissionVerdicts = summarizePermissionVerdicts(input.permissions ?? []);
  const evidenceLedger = buildEvidenceLedger(input.evidence ?? []);
  const blockers = buildBlockers(permissionVerdicts, scopedContext, evidenceLedger);

  return {
    traceId: `trust:${input.plan.runId}`,
    runId: input.plan.runId,
    createdAt: input.plan.createdAt,
    status: blockers.length === 0 ? "ready" : "blocked",
    route: {
      runtimeId: input.plan.runtimeId,
      provider: input.plan.route.provider,
      model: input.plan.route.model,
      reasoning: input.plan.route.reasoning,
      taskKind: input.plan.taskKind,
      sensitive: input.plan.sensitive
    },
    scopedContext,
    permissionVerdicts,
    evidenceLedger,
    memoryPromotionCandidates: blockers.length === 0 ? buildMemoryPromotionCandidates(scopedContext) : [],
    blockers
  };
}

function summarizeScopedContext(contexts: readonly ContextObject[], scope: MemoryScope | undefined): ScopedContextSummary[] {
  return contexts
    .filter((context) => !scope || context.scopes.some((candidate) => sameScope(candidate, scope)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((context) => ({
      id: context.id,
      kind: context.kind,
      summary: context.summary,
      scope: scopeLabel(context.scopes[0]),
      confidence: context.confidence,
      redactionState: context.redactionState,
      provenance: [...context.provenance].sort()
    }));
}

function summarizePermissionVerdicts(permissions: readonly TrustPermissionInput[]): TrustPermissionDecision[] {
  return [...permissions]
    .sort((left, right) => left.capability.localeCompare(right.capability))
    .map((permission) => ({
      capability: permission.capability,
      requested: permission.requested,
      granted: permission.granted,
      verdict: permission.requested ? (permission.granted ? "allowed" : "denied") : "not_requested",
      reason: permission.reason
    }));
}

function buildEvidenceLedger(evidence: readonly EvidenceRecord[]): TrustEvidenceLedgerEntry[] {
  return evidence.map((item, index) => ({
    ...item,
    id: `evidence:${String(index + 1).padStart(4, "0")}`,
    trustWeight: evidenceTrustWeight(item.status)
  }));
}

function buildMemoryPromotionCandidates(contexts: readonly ScopedContextSummary[]): TrustMemoryPromotionCandidate[] {
  return contexts
    .filter((context) => context.redactionState !== "blocked" && context.confidence >= 0.75)
    .map((context) => ({
      contextId: context.id,
      kind: context.kind,
      risk: context.redactionState === "none" ? "low" : "low",
      summary: `Promote verified ${context.kind} memory within ${context.scope}.`,
      autoApply: false
    }));
}

function buildBlockers(
  permissions: readonly TrustPermissionDecision[],
  contexts: readonly ScopedContextSummary[],
  evidence: readonly TrustEvidenceLedgerEntry[]
): string[] {
  const permissionBlockers = permissions
    .filter((permission) => permission.verdict === "denied")
    .map((permission) => `Permission denied: ${permission.capability}`);
  const contextBlockers = contexts
    .filter((context) => context.redactionState === "blocked")
    .map((context) => `Context blocked by redaction policy: ${context.id}`);
  const evidenceBlockers = evidence
    .filter((item) => item.status === "failed")
    .map((item) => `Evidence failed: ${item.label}`);

  return [...permissionBlockers, ...contextBlockers, ...evidenceBlockers];
}

function evidenceTrustWeight(status: EvidenceRecord["status"]): number {
  switch (status) {
    case "passed":
      return 1;
    case "observed":
      return 0.6;
    case "unknown":
      return 0.25;
    case "failed":
      return 0;
  }
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function scopeLabel(scope: MemoryScope | undefined): string {
  return scope ? `${scope.kind}:${scope.id}` : "unspecified";
}
