import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addMemory,
  appendEpisode,
  decideHybridRetrievalGate,
  listRetrievalEvalCases,
  parseMemoryScope,
  retrievalEvalPath,
  runEvalCase,
  runEvalCases,
  runRetrievalEvalCase,
  runRetrievalEvalPathWithArtifacts,
  runRetrievalEvalPath,
  runRetrievalEvalCases,
  seedFrappeGraphRetrievalEvalPack,
  seedRepresentativeRetrievalEvalPack,
  seedRetrievalEvalCase,
  seedEvalFromEpisode,
} from "../src/index.js";
import type { EpisodeRecord } from "../src/index.js";

const episode: EpisodeRecord = {
  id: "episode-eval-1",
  createdAt: "2026-06-06T00:00:00.000Z",
  cwd: "/tmp/muster",
  prompt: "Summarize Redis risk",
  taskKind: "architecture",
  runtimeId: "native",
  providerId: "local",
  model: "gpt-5.5",
  responseText: "Redis risk is high until the patch is deployed and unsafe commands are disabled.",
  evidence: [{ kind: "system_check", label: "fixture", status: "passed", detail: "recorded response" }],
  outcome: { kind: "completed" }
};

test("seedEvalFromEpisode writes a replayable fixture", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-eval-"));
  await appendEpisode(episode, cwd);

  const fixture = await seedEvalFromEpisode(episode.id, { expectedContains: ["patch is deployed"] }, cwd);
  const results = await runEvalCases(undefined, cwd);

  assert.equal(fixture.sourceEpisodeId, episode.id);
  assert.deepEqual(fixture.expectedContains, ["patch is deployed"]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "passed");
});

test("runEvalCase fails when expected text is missing", () => {
  const result = runEvalCase({
    schemaVersion: 1,
    id: "eval_fail",
    createdAt: "2026-06-06T00:00:00.000Z",
    sourceEpisodeId: "episode-fail",
    prompt: "Check",
    taskKind: "simple_qa",
    recordedResponseText: "The answer does not include the required phrase.",
    expectedContains: ["missing phrase"],
    evidenceLabels: []
  });

  assert.equal(result.status, "failed");
  assert.equal(result.checks[0]?.status, "failed");
});

test("runEvalCase enforces forbidden text", () => {
  const result = runEvalCase({
    schemaVersion: 1,
    id: "eval_forbidden",
    createdAt: "2026-06-06T00:00:00.000Z",
    sourceEpisodeId: "episode-forbidden",
    prompt: "Check",
    taskKind: "simple_qa",
    recordedResponseText: "Never leak customer private notes.",
    expectedContains: ["customer"],
    forbiddenContains: ["private notes"],
    evidenceLabels: []
  });

  assert.equal(result.status, "failed");
  assert.equal(result.checks.at(-1)?.label, "forbidden_absent");
});

test("runRetrievalEvalCase reports recall, MRR, latency, and leaks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-eval-"));
  const scopes = [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")];
  const expected = await addMemory({
    summary: "Frappe payroll export must run from the finance bench only.",
    provenance: ["retrieval-eval:test"],
    scopes,
  }, cwd);
  const forbidden = await addMemory({
    summary: "Frappe payroll secret for another user.",
    provenance: ["retrieval-eval:test"],
    scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:other")],
  }, cwd);

  const result = await runRetrievalEvalCase({
    schemaVersion: 1,
    kind: "retrieval",
    id: "frappe-payroll",
    query: "frappe payroll finance bench",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [expected.id],
    forbiddenIds: [forbidden.id],
    topK: 5,
  }, cwd);

  assert.equal(result.status, "passed");
  assert.equal(result.recallAtK, 1);
  assert.equal(result.mrr, 1);
  assert.equal(result.leakageCount, 0);
  assert.ok(result.latencyMs >= 0);
  assert.deepEqual(result.returnedIds, [expected.id]);
});

test("seedRetrievalEvalCase writes a durable fixture that the retrieval runner can execute", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-seed-"));
  const scopes = [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")];
  const expected = await addMemory({
    summary: "OAuth setup requires browser auth.",
    provenance: ["retrieval-eval-seed:test"],
    scopes,
  }, cwd);

  const fixture = await seedRetrievalEvalCase({
    id: "OAuth Setup!",
    query: "oauth browser auth",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [expected.id],
    topK: 5,
  }, cwd);
  const suite = await runRetrievalEvalPath(retrievalEvalPath(fixture.id, cwd), { minRecallAtK: 1, minMrr: 1 }, cwd);

  assert.equal(fixture.id, "OAuth-Setup-");
  assert.match(retrievalEvalPath(fixture.id, cwd), /evals\/retrieval\/OAuth-Setup-\.json$/);
  const listed = await listRetrievalEvalCases(undefined, cwd);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.fixture.id, fixture.id);
  assert.equal(listed[0]?.path, retrievalEvalPath(fixture.id, cwd));
  assert.equal(suite.status, "passed");
  assert.equal(suite.results[0]?.returnedIds[0], expected.id);
  await assert.rejects(() => seedRetrievalEvalCase({
    id: "bad",
    query: "oauth",
    scopes: ["broken"],
    expectedIds: [expected.id],
  }, cwd), /Invalid memory scope/);
  await assert.rejects(() => seedRetrievalEvalCase({
    id: "bad-stale",
    query: "oauth",
    scopes: ["tenant:hybrow"],
    expectedIds: [expected.id],
    staleBefore: "not-a-date",
  }, cwd), /valid ISO timestamp/);
  const emptyCwd = await mkdtemp(join(tmpdir(), "muster-retrieval-empty-"));
  assert.deepEqual(await listRetrievalEvalCases(undefined, emptyCwd), []);
  const emptySuite = await runRetrievalEvalPath("missing-dir", {}, emptyCwd);
  assert.equal(emptySuite.status, "failed");
  assert.equal(emptySuite.caseCount, 0);
  assert.equal(emptySuite.recallAtK, 0);
  assert.equal(emptySuite.mrr, 0);
  assert.equal(emptySuite.checks.find((check) => check.label === "non_empty_suite")?.status, "failed");
  const emptyGate = decideHybridRetrievalGate(emptySuite);
  assert.equal(emptyGate.allowed, false);
  assert.match(emptyGate.reason, /suite is empty/);
});

test("runRetrievalEvalPathWithArtifacts writes manifest, suite, case snapshots, and memory status", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-artifacts-"));
  const scopes = [parseMemoryScope("tenant:f2"), parseMemoryScope("user:pavan")];
  const expected = await addMemory({
    summary: "Frappe deploy artifact target lives in scoped memory.",
    provenance: ["retrieval-artifact:test"],
    scopes,
  }, cwd);
  const fixture = await seedRetrievalEvalCase({
    id: "artifact-pass",
    query: "frappe deploy artifact target",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [expected.id],
    topK: 5,
  }, cwd);

  const artifact = await runRetrievalEvalPathWithArtifacts(
    retrievalEvalPath(fixture.id, cwd),
    { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0, maxP95LatencyMs: 1000 },
    "artifacts/retrieval-pass",
    cwd
  );
  const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8")) as {
    status: string;
    caseCount: number;
    artifacts: { suite: string; cases: string; memoryStatus: string };
    fixtures: Array<{ id: string; query: string; scopes: string[] }>;
  };
  const suite = JSON.parse(await readFile(artifact.suitePath, "utf8")) as { suite: { status: string; caseCount: number } };
  const cases = (await readFile(artifact.casesPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { fixture: { id: string }; result: { returnedIds: string[] } });
  const memoryStatus = JSON.parse(await readFile(artifact.memoryStatusPath, "utf8")) as { jsonl: { valid: boolean }; index: { readable: boolean } };

  assert.equal(artifact.suite.status, "passed");
  assert.equal(manifest.status, "passed");
  assert.equal(manifest.caseCount, 1);
  assert.equal(manifest.artifacts.cases, "cases.jsonl");
  assert.equal(manifest.fixtures[0]?.id, fixture.id);
  assert.deepEqual(manifest.fixtures[0]?.scopes, ["tenant:f2", "user:pavan"]);
  assert.equal(suite.suite.caseCount, 1);
  assert.equal(cases[0]?.fixture.id, fixture.id);
  assert.deepEqual(cases[0]?.result.returnedIds, [expected.id]);
  assert.equal(memoryStatus.jsonl.valid, true);
  assert.equal(memoryStatus.index.readable, true);
});

test("seedRepresentativeRetrievalEvalPack creates exact, no-hit, stale, forbidden, and latency fixtures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-pack-"));
  const pack = await seedRepresentativeRetrievalEvalPack({
    id: "f2-pack",
    tenant: "f2",
    user: "goblin",
    otherUser: "alice",
    distractorCount: 25,
  }, cwd);
  const listed = await listRetrievalEvalCases(pack.dir, cwd);
  const ids = listed.map((listing) => listing.fixture.id).sort();

  assert.equal(pack.fixtures.length, 5);
  assert.equal(pack.memoryIds.distractors.length, 25);
  assert.deepEqual(ids, [
    "f2-pack-exact-hit",
    "f2-pack-forbidden-scope",
    "f2-pack-latency-distractors",
    "f2-pack-no-hit",
    "f2-pack-stale-hit",
  ]);
  assert.equal(listed.find((listing) => listing.fixture.id.endsWith("no-hit"))?.fixture.expectedNone, true);
  assert.equal(listed.find((listing) => listing.fixture.id.endsWith("forbidden-scope"))?.fixture.expectedNone, true);
  assert.ok(listed.find((listing) => listing.fixture.id.endsWith("stale-hit"))?.fixture.staleIds?.includes(pack.memoryIds.stale));

  const suite = await runRetrievalEvalPath(pack.dir, { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0, maxP95LatencyMs: 1000 }, cwd);
  assert.equal(suite.caseCount, 5);
  assert.equal(suite.checks.find((check) => check.label === "non_empty_suite")?.status, "passed");
  assert.equal(suite.checks.find((check) => check.label === "leakage_rate_ceiling")?.status, "passed");
});

test("seedFrappeGraphRetrievalEvalPack creates generic Frappe graph fixtures with linked expansion", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-frappe-graph-pack-"));
  const pack = await seedFrappeGraphRetrievalEvalPack({
    id: "frappe-hr-pack",
    tenant: "f2",
    user: "goblin",
    otherUser: "alice",
    app: "erpnext",
    module: "HR",
    doctype: "Employee",
    childDoctype: "Employee Detail",
    distractorCount: 20,
  }, cwd);
  const listed = await listRetrievalEvalCases(pack.dir, cwd);
  const graphFixture = listed.find((listing) => listing.fixture.id.endsWith("graph-child-table"))?.fixture;

  assert.equal(pack.fixtures.length, 7);
  assert.equal(pack.memoryIds.distractors.length, 20);
  assert.ok(pack.memoryIds.graph?.length);
  assert.equal(graphFixture?.graphExpand, true);

  const suite = await runRetrievalEvalPath(pack.dir, { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0, maxP95LatencyMs: 1000 }, cwd);
  assert.equal(suite.status, "passed");
  assert.equal(suite.caseCount, 7);
  assert.equal(suite.results.find((result) => result.id.endsWith("graph-child-table"))?.status, "passed");
});

test("retrieval eval suite reports stale-hit rate and p95 latency gates", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-stale-eval-"));
  const scopes = [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")];
  const stale = await addMemory({
    summary: "Frappe payroll destination is the retired legacy finance bench.",
    observedAt: "2025-01-01T00:00:00.000Z",
    provenance: ["retrieval-eval:stale"],
    scopes,
  }, cwd);
  const expected = await addMemory({
    summary: "Frappe payroll destination is the current finance bench.",
    observedAt: "2026-06-01T00:00:00.000Z",
    provenance: ["retrieval-eval:fresh"],
    scopes,
  }, cwd);

  const suite = await runRetrievalEvalCases([{
    schemaVersion: 1,
    kind: "retrieval",
    id: "frappe-payroll-stale",
    query: "frappe payroll finance bench",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [expected.id],
    staleIds: [stale.id],
    staleBefore: "2026-01-01T00:00:00.000Z",
    topK: 2,
  }], { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0, maxP95LatencyMs: 1000 }, cwd);

  assert.equal(suite.status, "failed");
  assert.equal(suite.caseCount, 1);
  assert.equal(suite.recallAtK, 1);
  assert.equal(suite.results[0]?.staleHitCount, 1);
  assert.equal(suite.staleHitRate, 0.5);
  assert.ok(suite.p95LatencyMs >= 0);
  assert.equal(suite.checks.find((check) => check.label === "stale_hit_rate_ceiling")?.status, "failed");
});

test("retrieval eval supports expected-none fixtures to catch false-positive recall", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-expected-none-"));
  const scopes = [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")];
  await addMemory({
    summary: "SQLite hot path target is unrelated to this no-hit query.",
    provenance: ["retrieval-eval:no-hit"],
    scopes,
  }, cwd);

  const pass = await runRetrievalEvalCase({
    schemaVersion: 1,
    kind: "retrieval",
    id: "no-hit-pass",
    query: "reply exactly ok",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [],
    expectedNone: true,
    topK: 5,
  }, cwd);

  assert.equal(pass.status, "passed");
  assert.equal(pass.recallAtK, 1);
  assert.equal(pass.mrr, 1);
  assert.deepEqual(pass.returnedIds, []);
  assert.equal(pass.checks.find((check) => check.label === "unexpected_absent")?.status, "passed");

  const fail = await runRetrievalEvalCase({
    schemaVersion: 1,
    kind: "retrieval",
    id: "no-hit-fail",
    query: "SQLite hot path target",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [],
    expectedNone: true,
    topK: 5,
  }, cwd);

  assert.equal(fail.status, "failed");
  assert.equal(fail.recallAtK, 0);
  assert.equal(fail.mrr, 0);
  assert.equal(fail.unexpectedHitCount, 1);
  assert.ok(fail.returnedIds.length > 0);
  assert.equal(fail.checks.find((check) => check.label === "unexpected_absent")?.status, "failed");
  const falsePositiveSuite = await runRetrievalEvalCases([{
    schemaVersion: 1,
    kind: "retrieval",
    id: "no-hit-suite-fail",
    query: "SQLite hot path target",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [],
    expectedNone: true,
    topK: 5,
  }], { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0 }, cwd);
  assert.equal(falsePositiveSuite.status, "failed");
  assert.equal(falsePositiveSuite.unexpectedHitRate, 1);
  assert.equal(falsePositiveSuite.checks.find((check) => check.label === "unexpected_hit_rate_ceiling")?.status, "failed");
  const falsePositiveGate = decideHybridRetrievalGate(falsePositiveSuite);
  assert.equal(falsePositiveGate.allowed, false);
  assert.match(falsePositiveGate.reason, /unexpected/);

  await assert.rejects(() => seedRetrievalEvalCase({
    id: "bad-none-combo",
    query: "x",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: ["mem_x"],
    expectedNone: true,
  }, cwd), /cannot combine/);
});

test("hybrid retrieval gate opens only when lexical recall/MRR is insufficient and safety passes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-retrieval-hybrid-gate-"));
  const scopes = [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")];
  const expected = await addMemory({
    summary: "OAuth setup requires browser auth.",
    observedAt: "2026-06-01T00:00:00.000Z",
    provenance: ["retrieval-eval:hybrid"],
    scopes,
  }, cwd);

  const recallSuite = await runRetrievalEvalCases([{
    schemaVersion: 1,
    kind: "retrieval",
    id: "paraphrase-miss",
    query: "totally unrelated needle",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: ["mem_missing_semantic_paraphrase"],
    topK: 5,
  }], { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0 }, cwd);
  const recallGate = decideHybridRetrievalGate(recallSuite);
  assert.equal(recallGate.allowed, true);
  assert.match(recallGate.reason, /hybrid experiment/);

  const stale = await addMemory({
    summary: "OAuth setup uses the retired internal portal.",
    observedAt: "2025-01-01T00:00:00.000Z",
    provenance: ["retrieval-eval:stale"],
    scopes,
  }, cwd);
  const staleSuite = await runRetrievalEvalCases([{
    schemaVersion: 1,
    kind: "retrieval",
    id: "stale-safety",
    query: "oauth setup",
    scopes: scopes.map((scope) => `${scope.kind}:${scope.id}`),
    expectedIds: [expected.id],
    staleIds: [stale.id],
    topK: 2,
  }], { minRecallAtK: 1, minMrr: 1, maxLeakageRate: 0, maxStaleHitRate: 0 }, cwd);
  const staleGate = decideHybridRetrievalGate(staleSuite);
  assert.equal(staleGate.allowed, false);
  assert.match(staleGate.reason, /stale-hit safety/);
});
