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
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-tokens-"));
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
