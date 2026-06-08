import { buildTrustEnvelope, type TrustPermissionInput } from "./trust.js";
import type { ContextObject, EpisodeRecord, EvidenceRecord, MemoryScope, RunPlan } from "./types.js";

export type ContextGraphNodeKind =
  | "run"
  | "task"
  | "route"
  | "provider"
  | "model"
  | "memory"
  | "evidence"
  | "permission"
  | "blocker";

export type ContextGraphEdgeKind =
  | "classified_as"
  | "routed_through"
  | "uses_provider"
  | "uses_model"
  | "uses_context"
  | "has_evidence"
  | "requires_permission"
  | "blocked_by"
  | "links_to";

export interface ContextGraphNode {
  readonly id: string;
  readonly kind: ContextGraphNodeKind;
  readonly label: string;
  readonly summary?: string;
  readonly trustWeight: number;
  readonly metadata: Record<string, string | number | boolean>;
}

export interface ContextGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: ContextGraphEdgeKind;
  readonly weight: number;
  readonly reason: string;
}

export interface ContextGraph {
  readonly id: string;
  readonly createdAt: string;
  readonly status: "ready" | "blocked";
  readonly nodes: ContextGraphNode[];
  readonly edges: ContextGraphEdge[];
  readonly blockers: string[];
  readonly summary: {
    readonly runId: string;
    readonly scopedContext: number;
    readonly evidence: number;
    readonly permissions: number;
    readonly averageTrustWeight: number;
  };
}

export interface BuildContextGraphInput {
  readonly plan: RunPlan;
  readonly contexts?: readonly ContextObject[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly permissions?: readonly TrustPermissionInput[];
  readonly scope?: MemoryScope;
}

export interface BuildEpisodeContextGraphInput {
  readonly episode: EpisodeRecord;
  readonly memories?: readonly ContextObject[];
  readonly permissions?: readonly TrustPermissionInput[];
  readonly scope?: MemoryScope;
}

export function buildContextGraph(input: BuildContextGraphInput): ContextGraph {
  const envelope = buildTrustEnvelope(input);
  const nodes: ContextGraphNode[] = [];
  const edges: ContextGraphEdge[] = [];
  const runId = `run:${input.plan.runId}`;
  const taskId = `task:${input.plan.taskKind}`;
  const routeId = `route:${input.plan.runtimeId}`;
  const providerId = `provider:${input.plan.route.provider}`;
  const modelId = `model:${input.plan.route.provider}:${input.plan.route.model}`;

  nodes.push(
    node(runId, "run", input.plan.runId, input.plan.sensitive ? "Sensitive run" : "Run", 0.8, {
      runtime: input.plan.runtimeId,
      sensitive: input.plan.sensitive
    }),
    node(taskId, "task", input.plan.taskKind, "Classified task kind", 0.7, {}),
    node(routeId, "route", input.plan.runtimeId, "Selected runtime route", 0.75, {
      reasoning: input.plan.route.reasoning ?? "unspecified"
    }),
    node(providerId, "provider", input.plan.route.provider, "Selected provider", 0.75, {}),
    node(modelId, "model", input.plan.route.model, "Selected model", 0.75, {})
  );
  edges.push(
    edge(runId, taskId, "classified_as", 0.9, "Prompt classification selected this task kind."),
    edge(runId, routeId, "routed_through", 0.9, "Routing policy selected this runtime."),
    edge(routeId, providerId, "uses_provider", 0.9, "Route resolves to this provider."),
    edge(providerId, modelId, "uses_model", 0.9, "Provider route resolves to this model.")
  );

  for (const context of envelope.scopedContext) {
    const contextId = `memory:${context.id}`;
    nodes.push(
      node(contextId, "memory", context.kind, context.summary, contextTrustWeight(context.confidence, context.redactionState), {
        contextId: context.id,
        scope: context.scope,
        confidence: context.confidence,
        redaction: context.redactionState,
        provenance: context.provenance.join(",")
      })
    );
    edges.push(edge(runId, contextId, "uses_context", context.confidence, "Context is visible in the requested scope."));
  }

  for (const context of input.contexts ?? []) {
    for (const linkedId of context.links ?? []) {
      const from = `memory:${context.id}`;
      const to = linkedId.includes(":") ? linkedId : `memory:${linkedId}`;
      if (nodes.some((candidate) => candidate.id === from)) {
        edges.push(edge(from, to, "links_to", 0.4, "Context object declares an explicit link."));
      }
    }
  }

  for (const evidence of envelope.evidenceLedger) {
    const evidenceId = evidence.id;
    nodes.push(
      node(evidenceId, "evidence", evidence.label, evidence.detail, evidence.trustWeight, {
        evidenceKind: evidence.kind,
        status: evidence.status
      })
    );
    edges.push(edge(runId, evidenceId, "has_evidence", evidence.trustWeight, "Evidence was recorded for this run."));
  }

  for (const permission of envelope.permissionVerdicts) {
    const permissionId = `permission:${permission.capability}`;
    nodes.push(
      node(permissionId, "permission", permission.capability, permission.reason, permission.verdict === "allowed" ? 1 : 0, {
        requested: permission.requested,
        granted: permission.granted,
        verdict: permission.verdict
      })
    );
    edges.push(edge(runId, permissionId, "requires_permission", permission.requested ? 0.8 : 0.2, "Permission decision attached to this run."));
  }

  for (const [index, blocker] of envelope.blockers.entries()) {
    const blockerId = `blocker:${index + 1}`;
    nodes.push(node(blockerId, "blocker", blocker, blocker, 0, {}));
    edges.push(edge(runId, blockerId, "blocked_by", 1, "Trust envelope blocked this run."));
  }

  const sortedNodes = dedupeNodes(nodes).sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = dedupeEdges(edges).sort((left, right) => left.id.localeCompare(right.id));
  return {
    id: `graph:${input.plan.runId}`,
    createdAt: input.plan.createdAt,
    status: envelope.status,
    nodes: sortedNodes,
    edges: sortedEdges,
    blockers: [...envelope.blockers],
    summary: {
      runId: input.plan.runId,
      scopedContext: envelope.scopedContext.length,
      evidence: envelope.evidenceLedger.length,
      permissions: envelope.permissionVerdicts.length,
      averageTrustWeight: average(sortedNodes.map((item) => item.trustWeight))
    }
  };
}

export function buildEpisodeContextGraph(input: BuildEpisodeContextGraphInput): ContextGraph {
  return buildContextGraph({
    plan: {
      runId: input.episode.id,
      taskKind: input.episode.taskKind,
      runtimeId: input.episode.runtimeId,
      route: {
        provider: input.episode.providerId,
        model: input.episode.model,
        reasoning: input.episode.reasoning
      },
      sensitive: input.episode.taskKind === "private_analysis",
      createdAt: input.episode.createdAt
    },
    contexts: input.memories,
    evidence: input.episode.evidence,
    permissions: input.permissions,
    scope: input.scope
  });
}

function node(
  id: string,
  kind: ContextGraphNodeKind,
  label: string,
  summary: string | undefined,
  trustWeight: number,
  metadata: ContextGraphNode["metadata"]
): ContextGraphNode {
  return {
    id,
    kind,
    label,
    summary,
    trustWeight: clamp(trustWeight),
    metadata
  };
}

function edge(from: string, to: string, kind: ContextGraphEdgeKind, weight: number, reason: string): ContextGraphEdge {
  return {
    id: `${kind}:${from}->${to}`,
    from,
    to,
    kind,
    weight: clamp(weight),
    reason
  };
}

function contextTrustWeight(confidence: number, redactionState: ContextObject["redactionState"]): number {
  if (redactionState === "blocked") return 0;
  if (redactionState === "redacted" || redactionState === "hashed") return clamp(confidence * 0.8);
  return clamp(confidence);
}

function dedupeNodes(nodes: ContextGraphNode[]): ContextGraphNode[] {
  return [...new Map(nodes.map((item) => [item.id, item])).values()];
}

function dedupeEdges(edges: ContextGraphEdge[]): ContextGraphEdge[] {
  return [...new Map(edges.map((item) => [item.id, item])).values()];
}

function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
