import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listBuiltinPlugins } from "./builtin-catalog.js";
import {
  runRetrievalEvalPathWithArtifacts,
  seedRepresentativeRetrievalEvalPack,
  type RetrievalEvalArtifactResult,
} from "./eval.js";
import { inspectMemoryStore, parseMemoryScope, probeMemorySearchLatency, type MemoryLatencyProbeResult } from "./memory.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaMemoryRetrievalSpeedResult {
  readonly suite: "memory_retrieval_speed";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly retrievalManifestPath: string;
  readonly probePath: string;
  readonly cases: readonly {
    readonly id: string;
    readonly status: RuntimeDoctorStatus;
    readonly summary: string;
  }[];
  readonly summary: string;
  readonly retrieval: RetrievalEvalArtifactResult;
  readonly probe: MemoryLatencyProbeResult;
}

export async function runMemoryRetrievalSpeedQa(input: {
  readonly artifactDir: string;
  readonly cwd?: string;
  readonly maxP95Ms?: number;
  readonly distractorCount?: number;
  readonly probeRuns?: number;
}): Promise<QaMemoryRetrievalSpeedResult> {
  const artifactDir = input.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  const runCwd = join(artifactDir, "workspace");
  await mkdir(runCwd, { recursive: true });
  const maxP95Ms = input.maxP95Ms ?? 75;
  const pack = await seedRepresentativeRetrievalEvalPack({
    id: "qa-memory-speed",
    tenant: "qa",
    user: "memory",
    otherUser: "intruder",
    distractorCount: input.distractorCount ?? 300,
  }, runCwd);
  const retrievalArtifactDir = join(artifactDir, "retrieval");
  const retrieval = await runRetrievalEvalPathWithArtifacts(
    pack.dir,
    { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0, maxP95LatencyMs: maxP95Ms },
    retrievalArtifactDir,
    runCwd,
  );
  const probe = await probeMemorySearchLatency({
    query: "qa-memory-speed exact deployment target",
    scopes: [parseMemoryScope("tenant:qa"), parseMemoryScope("user:memory")],
    limit: 5,
    runs: input.probeRuns ?? 25,
    match: "any",
  }, runCwd);
  const memoryStatus = await inspectMemoryStore(runCwd);
  const externalMemoryPolicy = caseExternalMemoryPolicy();
  const status: RuntimeDoctorStatus =
    retrieval.suite.status === "passed"
    && probe.recalledCount > 0
    && probe.p95Ms <= maxP95Ms
    && memoryStatus.index.readable
    && memoryStatus.index.initialized
    && externalMemoryPolicy.status === "passed"
      ? "passed"
      : "failed";
  const summary = status === "passed"
    ? `SQLite/FTS scoped retrieval passed recall, leakage, stale, and p95 latency gates (probe_p95=${probe.p95Ms.toFixed(3)}ms)`
    : `Memory retrieval speed suite failed one or more gates (eval=${retrieval.suite.status} probe_p95=${probe.p95Ms.toFixed(3)}ms max=${maxP95Ms}ms)`;
  const probePath = join(artifactDir, "probe.json");
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const cases = [
    {
      id: "retrieval_quality",
      status: retrieval.suite.status,
      summary: `recall@5=${retrieval.suite.recallAtK.toFixed(3)} mrr@5=${retrieval.suite.mrr.toFixed(3)} leakage=${retrieval.suite.leakageRate.toFixed(3)} stale=${retrieval.suite.staleHitRate.toFixed(3)}`,
    },
    {
      id: "probe_latency",
      status: probe.recalledCount > 0 && probe.p95Ms <= maxP95Ms ? "passed" : "failed",
      summary: `probe_p95_ms=${probe.p95Ms.toFixed(3)} max=${maxP95Ms} recalled=${probe.recalledCount}`,
    },
    {
      id: "index_health",
      status: memoryStatus.index.readable && memoryStatus.index.initialized ? "passed" : "failed",
      summary: `backend=${memoryStatus.index.backend ?? "unknown"} readable=${memoryStatus.index.readable} initialized=${memoryStatus.index.initialized}`,
    },
    externalMemoryPolicy,
  ] as const;
  await writeFile(probePath, `${JSON.stringify({ probe, memoryStatus }, null, 2)}\n`, "utf8");
  await writeFile(casesPath, `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "memory_retrieval_speed",
    status,
    summary,
    caseCount: cases.length,
    thresholds: { maxP95Ms },
    seededPack: { id: pack.id, dir: pack.dir, fixtureCount: pack.fixtures.length, distractorCount: pack.memoryIds.distractors.length },
    metrics: {
      retrievalP95Ms: retrieval.suite.p95LatencyMs,
      probeP50Ms: probe.p50Ms,
      probeP95Ms: probe.p95Ms,
      recallAtK: retrieval.suite.recallAtK,
      mrr: retrieval.suite.mrr,
      leakageRate: retrieval.suite.leakageRate,
      staleHitRate: retrieval.suite.staleHitRate,
      backend: probe.backend,
      recalledCount: probe.recalledCount,
      candidateCount: probe.candidateCount,
    },
    artifacts: {
      cases: "cases.jsonl",
      retrieval: "retrieval/manifest.json",
      probe: "probe.json",
      workspace: "workspace",
    },
  }, null, 2)}\n`, "utf8");
  return {
    suite: "memory_retrieval_speed",
    status,
    artifactDir,
    manifestPath,
    casesPath,
    retrievalManifestPath: retrieval.manifestPath,
    probePath,
    cases,
    summary,
    retrieval,
    probe,
  };
}

function caseExternalMemoryPolicy(): {
  readonly id: "external_memory_policy";
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
} {
  const providers = listBuiltinPlugins().filter((plugin) => plugin.category === "memory" || plugin.slot === "memory-provider");
  const missing = providers.filter((plugin) => {
    const notes = (plugin.setup?.notes ?? []).join(" ").toLowerCase();
    return plugin.risk !== "high"
      || plugin.actionability !== "setup_plan"
      || !plugin.setup?.setupUrls?.length
      || !(notes.includes("scoped") || notes.includes("scope"))
      || !(notes.includes("sync") || notes.includes("external") || notes.includes("local"));
  }).map((plugin) => plugin.id);
  const status: RuntimeDoctorStatus = providers.length && !missing.length ? "passed" : "failed";
  return {
    id: "external_memory_policy",
    status,
    summary: status === "passed"
      ? `${providers.length} external memory provider entries are high-risk setup plans with scoped/local-memory guardrails`
      : "external memory provider catalog entries are missing setup-plan or scoped/local-memory guardrails",
    evidence: {
      providerCount: providers.length,
      missing,
      providers: providers.map((plugin) => ({
        id: plugin.id,
        risk: plugin.risk,
        actionability: plugin.actionability,
        setupUrls: plugin.setup?.setupUrls ?? [],
        notes: plugin.setup?.notes ?? [],
      })),
    },
  };
}
