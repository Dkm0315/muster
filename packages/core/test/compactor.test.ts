import assert from "node:assert/strict";
import { test } from "node:test";
import { compact, estimateTokens } from "../src/index.js";
import type { TranscriptMessage } from "../src/index.js";

function bigTranscript(turns: number): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [
    { role: "system", content: "You are Muster." },
    { role: "user", content: "Long running task with many tools." },
  ];
  for (let index = 0; index < turns; index += 1) {
    messages.push({ role: "assistant", content: `step ${index}: calling a tool to make progress` });
    messages.push({ role: "tool", toolName: `t${index}`, content: `tool output ${index} `.repeat(100) });
    messages.push({ role: "user", content: `feedback on step ${index}` });
  }
  return messages;
}

test("under budget: untouched, empty strategy", async () => {
  const messages = bigTranscript(2);
  const plan = await compact(messages, 1_000_000);
  assert.deepEqual(plan.strategy, []);
  assert.equal(plan.messages.length, messages.length);
  assert.equal(plan.tokensAfter, plan.tokensBefore);
});

test("INVARIANT: any transcript fits any sane budget without a model call — never wedges", async () => {
  const messages = bigTranscript(60);
  for (const budget of [200, 500, 2000, 10_000]) {
    const plan = await compact(messages, budget);
    assert.ok(plan.tokensAfter <= budget, `budget ${budget}: got ${plan.tokensAfter}`);
    assert.equal(plan.messages[0].role, "system", "head protected");
  }
});

test("reduction order: tool drops first, then summary, hard truncate only when needed", async () => {
  const messages = bigTranscript(40);
  const generous = await compact(messages, Math.floor(estimateTokens(messages.map((m) => m.content).join("")) * 0.55));
  assert.equal(generous.strategy[0], "stub_tool_results");
  assert.ok(generous.droppedToolResults > 0);

  const tight = await compact(messages, 300);
  assert.ok(tight.strategy.includes("hard_truncate"));
  assert.ok(tight.tokensAfter <= 300);
});

test("model summarizer is used when provided but its failure never blocks the turn", async () => {
  const messages = bigTranscript(30);
  const budget = 600;
  const withSummary = await compact(messages, budget, {
    keepRecent: 3,
    summarizer: async (chunk) => `condensed ${chunk.length} earlier messages about the task`,
  });
  const summaryMessage = withSummary.messages.find((message) => message.content.includes("condensed"));
  assert.ok(summaryMessage, "model summary present");
  assert.match(summaryMessage!.content, /not an instruction/, "framing never demotes memory (upstream #17251)");

  const withFailure = await compact(messages, budget, {
    keepRecent: 3,
    summarizer: async () => { throw new Error("provider down"); },
  });
  assert.ok(withFailure.tokensAfter <= budget, "deterministic fallback kept the invariant");
  assert.ok(withFailure.messages.some((message) => message.content.includes("Summary of earlier turns")));
});

test("recent tail stays verbatim", async () => {
  const messages = bigTranscript(30);
  const plan = await compact(messages, 1500, { keepRecent: 4 });
  const tail = messages.slice(-4).map((message) => message.content);
  const planTail = plan.messages.slice(-4).map((message) => message.content);
  assert.deepEqual(planTail, tail);
});
