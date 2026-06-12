import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  persistToolResult,
  renderContext,
  resultFetch,
  toolResultStub,
  type TranscriptMessage,
} from "../src/index.js";

function transcript(toolCalls: number): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [
    { role: "system", content: "You are Muster." },
    { role: "user", content: "Do a long multi-tool task." },
  ];
  for (let index = 0; index < toolCalls; index += 1) {
    messages.push({ role: "assistant", content: `Calling tool ${index}` });
    messages.push({ role: "tool", toolName: `tool_${index}`, content: `RESULT ${index} `.repeat(120) });
  }
  messages.push({ role: "assistant", content: "Done." });
  return messages;
}

test("savings grow monotonically with transcript length (20/30/50 tool calls)", () => {
  const savings = [20, 30, 50].map((calls) => renderContext(transcript(calls), 1_000_000).savedTokens);
  assert.ok(savings[0] > 0, "even 20 calls produce savings");
  assert.ok(savings[1] > savings[0] && savings[2] > savings[1], `monotonic: ${savings.join(",")}`);
});

test("the most recent N tool results stay verbatim; older ones are stubbed; input is not mutated", () => {
  const original = transcript(10);
  const snapshot = JSON.stringify(original);
  const rendered = renderContext(original, 1_000_000, { keepRecentToolResults: 3 });
  const tools = rendered.messages.filter((message) => message.role === "tool");
  const verbatim = tools.filter((message) => message.content.startsWith("RESULT"));
  const stubs = tools.filter((message) => message.content.includes("[older result elided]") || message.content.includes("result_fetch"));
  assert.equal(verbatim.length, 3);
  assert.equal(stubs.length, 7);
  assert.equal(rendered.stubbed, 7);
  assert.equal(JSON.stringify(original), snapshot, "renderContext must never mutate its input");
});

test("budget enforcement stubs before dropping, never drops system or final message", () => {
  const messages = transcript(8);
  const rendered = renderContext(messages, 300, { keepRecentToolResults: 2 });
  assert.ok(rendered.stubbed > 0);
  assert.ok(rendered.dropped > 0, "tight budget forces drops after stubbing");
  assert.equal(rendered.messages[0].role, "system");
  assert.equal(rendered.messages.at(-1)?.content, "Done.");
});

test("persisted results round-trip via resultFetch with offset/limit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-renderer-"));
  const content = "x".repeat(10_000) + "TAIL";
  const persisted = await persistToolResult({ toolName: "read_file", ok: true, content }, cwd);
  assert.equal(persisted.stub, toolResultStub("read_file", true, content.length, persisted.id));
  const head = await resultFetch(persisted.id, { limit: 100 }, cwd);
  assert.equal(head.content.length, 100);
  assert.equal(head.totalChars, content.length);
  const tail = await resultFetch(persisted.id, { offset: content.length - 4 }, cwd);
  assert.equal(tail.content, "TAIL");
  await assert.rejects(() => resultFetch("../etc/passwd", {}, cwd), /Invalid result id/);
});

test("stubs are deterministic for identical inputs", () => {
  const a = renderContext(transcript(12), 1_000_000);
  const b = renderContext(transcript(12), 1_000_000);
  assert.deepEqual(a, b);
});

test("older tool results are kept verbatim only when trivially small (<=200 chars)", () => {
  const messages: TranscriptMessage[] = [
    { role: "system", content: "You are Muster." },
    { role: "user", content: "task" },
    // Oldest tool result: trivially small, must stay verbatim even though it is older.
    { role: "assistant", content: "call small" },
    { role: "tool", toolName: "tiny", content: "x".repeat(200) },
    // Second tool result: just over the trivial threshold, must be stubbed.
    { role: "assistant", content: "call large" },
    { role: "tool", toolName: "big", content: "y".repeat(201) },
    // Recent tool results that stay verbatim purely by recency.
    { role: "assistant", content: "call recent" },
    { role: "tool", toolName: "recent", content: "z".repeat(5000) },
    { role: "assistant", content: "Done." },
  ];
  const rendered = renderContext(messages, 1_000_000, { keepRecentToolResults: 1 });
  const tools = rendered.messages.filter((message) => message.role === "tool");
  const tiny = tools.find((message) => message.toolName === "tiny");
  const big = tools.find((message) => message.toolName === "big");
  assert.equal(tiny?.content, "x".repeat(200), "<=200 char older result must remain verbatim");
  assert.ok(big?.content.includes("[older result elided]"), "201 char older result must be stubbed");
  assert.equal(rendered.stubbed, 1, "only the over-threshold older result is stubbed");
});
