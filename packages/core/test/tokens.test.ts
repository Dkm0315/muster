import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendTokenRecord, buildTokenRecord, estimateCostUsd, estimateTokens, listTokenRecords, renderTokenTable } from "../src/index.js";

test("buildTokenRecord estimates tokens and marks them as estimated", () => {
  const record = buildTokenRecord({
    runId: "run_1",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "a".repeat(400),
    responseText: "b".repeat(800),
    durationMs: 1200,
  });
  assert.equal(record.estimated, true);
  assert.equal(record.inputTokens, 100);
  assert.equal(record.outputTokens, 200);
  assert.ok(record.costUsd !== undefined && record.costUsd > 0);
});

test("buildTokenRecord prefers exact usage when provided", () => {
  const record = buildTokenRecord({
    runId: "run_2",
    provider: "anthropic",
    model: "claude-opus-4-8",
    prompt: "short",
    responseText: "short",
    durationMs: 10,
    inputTokens: 5000,
    outputTokens: 250,
  });
  assert.equal(record.estimated, false);
  assert.equal(record.inputTokens, 5000);
  assert.equal(record.outputTokens, 250);
});

test("replay waste is flagged only for continued sessions with bloated input", () => {
  const wasted = buildTokenRecord({
    runId: "run_3",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "tiny prompt",
    responseText: "ok",
    durationMs: 10,
    sessionMode: "continue",
    inputTokens: 50_000,
    outputTokens: 10,
  });
  assert.ok(wasted.wasteRatio !== undefined && wasted.wasteRatio > 3);

  const freshLarge = buildTokenRecord({
    runId: "run_4",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "tiny prompt",
    responseText: "ok",
    durationMs: 10,
    sessionMode: "create",
    inputTokens: 50_000,
    outputTokens: 10,
  });
  assert.equal(freshLarge.wasteRatio, undefined, "fresh sessions are never flagged as replay waste");

  const efficientContinue = buildTokenRecord({
    runId: "run_5",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "a".repeat(4000),
    responseText: "ok",
    durationMs: 10,
    sessionMode: "continue",
    inputTokens: 1100,
    outputTokens: 10,
  });
  assert.equal(efficientContinue.wasteRatio, undefined, "efficient continuations are not flagged");
});

test("estimateCostUsd returns undefined for unknown models instead of guessing", () => {
  assert.equal(estimateCostUsd("totally-unknown-model", 1000, 1000), undefined);
  assert.ok(estimateCostUsd("claude-opus-4-8", 1_000_000, 0)! > 10);
});

test("token ledger persists records and renders an aligned table with totals", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tokens-"));
  await appendTokenRecord(buildTokenRecord({
    runId: "run_table_1",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "hello",
    responseText: "world",
    durationMs: 5,
  }), cwd);
  await appendTokenRecord(buildTokenRecord({
    runId: "run_table_2",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "again",
    responseText: "ok",
    durationMs: 5,
    sessionMode: "continue",
    inputTokens: 90_000,
    outputTokens: 5,
  }), cwd);

  const records = await listTokenRecords(cwd);
  assert.equal(records.length, 2);
  const table = renderTokenTable(records);
  assert.match(table, /run_table_1/);
  assert.match(table, /totals by model/);
  assert.match(table, /replay-waste detected on 1 run/);
});

test("renderTokenTable handles the empty ledger gracefully", () => {
  assert.match(renderTokenTable([]), /No token records yet/);
});

test("estimateTokens rounds up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("buildTokenRecord stamps skill@version receipts for cost attribution (#11692)", () => {
  const record = buildTokenRecord({
    runId: "run_sk",
    provider: "anthropic",
    model: "claude-opus-4-8",
    prompt: "do the thing",
    responseText: "done",
    durationMs: 5,
    skills: ["pdf-generator@0.2.0", "spreadsheet@1.0.0"],
  });
  assert.deepEqual(record.skills, ["pdf-generator@0.2.0", "spreadsheet@1.0.0"]);
});

test("renderTokenTable folds subagent spend by parent (attributable child cost)", () => {
  const base = { model: "claude-opus-4-8", prompt: "x", responseText: "y", durationMs: 1, inputTokens: 100, outputTokens: 50, provider: "anthropic" };
  const parent = buildTokenRecord({ ...base, runId: "r_parent", surfaceId: "telegram:bot" });
  const child1 = buildTokenRecord({ ...base, runId: "r_c1", surfaceId: "subagent:r_parent" });
  const child2 = buildTokenRecord({ ...base, runId: "r_c2", surfaceId: "subagent:r_parent" });
  const table = renderTokenTable([parent, child1, child2]);
  assert.match(table, /subagent spend folded by parent/);
  assert.match(table, /r_parent\s+2 run\(s\)/);
});

test("renderTokenTable is LOUD that unpriced-model totals are a lower bound (not silently $0)", () => {
  const base = { provider: "local", model: "mystery-model-9000", prompt: "x", responseText: "y", durationMs: 1, inputTokens: 100, outputTokens: 50 };
  const priced = buildTokenRecord({ ...base, runId: "r_priced", model: "claude-opus-4-8" });
  const unpriced = buildTokenRecord({ ...base, runId: "r_unpriced" });
  assert.equal(unpriced.costUsd, undefined, "an unknown model has no price match");
  const table = renderTokenTable([priced, unpriced]);
  assert.match(table, /LOWER BOUND/);
  assert.match(table, /1 run\(s\)/);
});
