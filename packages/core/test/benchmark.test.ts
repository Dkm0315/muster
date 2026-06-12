import assert from "node:assert/strict";
import { test } from "node:test";
import { computeWasteIndex, renderWasteReport, runWasteBenchmark } from "../src/index.js";
import type { TranscriptMessage } from "../src/index.js";

function multiToolTask(turns: number, toolChars = 1200): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = [
    { role: "system", content: "agent" },
    { role: "user", content: "do the task" },
  ];
  for (let i = 0; i < turns; i += 1) {
    transcript.push({ role: "assistant", content: `step ${i}` });
    // realistic tool output: file reads / log pulls are typically 500-2000 chars
    transcript.push({ role: "tool", toolName: `t${i}`, content: `tool ${i} output `.repeat(Math.ceil(toolChars / 14)) });
    transcript.push({ role: "user", content: "continue" });
  }
  transcript.push({ role: "assistant", content: "done" });
  return transcript;
}

test("naive replay always costs more than the information floor (replay overhead is real)", async () => {
  const result = await computeWasteIndex(multiToolTask(20));
  assert.ok(result.naiveTokens > result.necessaryTokens);
  assert.ok(result.replayOverheadPct > 0);
});

test("Muster reduces naive cost, and the reduction grows with task length", async () => {
  const short = await computeWasteIndex(multiToolTask(20));
  const long = await computeWasteIndex(multiToolTask(50));
  assert.ok(short.optimizedTokens < short.naiveTokens, "shorter task already shows savings");
  assert.ok(short.musterReductionPct > 0);
  assert.ok(long.musterReductionPct > short.musterReductionPct, `reduction should grow: ${short.musterReductionPct}% -> ${long.musterReductionPct}%`);
});

test("optimized cost never exceeds naive cost (the renderer never adds tokens)", async () => {
  for (const turns of [5, 15, 30, 50]) {
    const result = await computeWasteIndex(multiToolTask(turns));
    assert.ok(result.optimizedTokens <= result.naiveTokens, `turns=${turns}`);
  }
});

test("aggregate sums scenarios and renders a readable report", async () => {
  const report = await runWasteBenchmark([
    { id: "a", description: "task a", transcript: multiToolTask(20) },
    { id: "b", description: "task b", transcript: multiToolTask(40) },
  ]);
  assert.equal(report.results.length, 2);
  assert.equal(report.aggregate.naiveTokens, report.results[0].naiveTokens + report.results[1].naiveTokens);
  assert.ok(report.aggregate.musterReductionPct > 0);
  const text = renderWasteReport(report);
  assert.match(text, /AGGREGATE/);
  assert.match(text, /reduction/);
});

test("degenerate transcripts do not divide by zero", async () => {
  const empty = await computeWasteIndex([]);
  assert.equal(empty.musterReductionPct, 0);
  assert.equal(empty.replayOverheadPct, 0);
});
