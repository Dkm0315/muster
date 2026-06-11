import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCoalescer,
  createStreamEventChannel,
  fenceStateAt,
  rolloverSplit,
  runDraftLoop,
  StreamRun,
  synthesizeDeltas,
} from "../src/index.js";
import type { DraftErrorClass, DraftSink, StreamEvent } from "../src/index.js";

function fenceBalanced(text: string): boolean {
  const markers = text.match(/^[ \t]{0,3}```+[^\n]*$/gm) ?? [];
  return markers.length % 2 === 0;
}

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void; sleep: (ms: number) => Promise<void> } {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    sleep: async (ms: number) => {
      at += ms;
    },
  };
}

interface SinkCall {
  readonly kind: "upsert" | "finalize";
  readonly text: string;
}

function makeSink(options: {
  editMs?: number;
  maxChars?: number;
  failOn?: (call: SinkCall, index: number) => unknown | undefined;
  classify?: (error: unknown) => DraftErrorClass;
} = {}): { sink: DraftSink; calls: SinkCall[] } {
  const calls: SinkCall[] = [];
  const sink: DraftSink = {
    caps: { editMs: options.editMs ?? 1000, maxChars: options.maxChars ?? 4096 },
    async upsert(text: string) {
      const call: SinkCall = { kind: "upsert", text };
      const failure = options.failOn?.(call, calls.length);
      calls.push(call);
      if (failure !== undefined) throw failure;
    },
    async finalize(text: string) {
      const call: SinkCall = { kind: "finalize", text };
      const failure = options.failOn?.(call, calls.length);
      calls.push(call);
      if (failure !== undefined) throw failure;
    },
    classifyError(error: unknown) {
      return options.classify ? options.classify(error) : "retry";
    },
  };
  return { sink, calls };
}

// --- coalescer ---------------------------------------------------------------

test("coalescer holds text below minChars and splits at the preferred paragraph boundary", () => {
  const coalescer = createCoalescer({ minChars: 40, maxChars: 80, breakPreference: "paragraph" });
  assert.deepEqual(coalescer.push("short text, well under the minimum"), []);
  assert.ok(coalescer.pending.length > 0);
  const events = coalescer.push(" and more filler.\n\nSecond paragraph continues with plenty of text after the break.");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "block");
  const block = events[0] as Extract<StreamEvent, { type: "block" }>;
  assert.ok(block.text.endsWith("filler."), `split must land on the paragraph boundary, got: ${JSON.stringify(block.text.slice(-30))}`);
  assert.ok(coalescer.pending.startsWith("Second paragraph"));
});

test("coalescer never splits inside a code fence even when a paragraph boundary is available there", () => {
  const coalescer = createCoalescer({ minChars: 10, maxChars: 400 });
  // The only \n\n early on is INSIDE the fence; the split must use the one after it.
  const text = "```\ncode line one\n\ncode line two\n```\nProse after the fence ends here.\n\nNext paragraph trails on.";
  const events = coalescer.push(text);
  assert.equal(events.length, 1);
  const block = (events[0] as Extract<StreamEvent, { type: "block" }>).text;
  assert.ok(block.includes("code line two"), "fence must stay whole inside one block");
  assert.ok(fenceBalanced(block), "emitted block must have balanced fences");
  assert.ok(coalescer.pending.startsWith("Next paragraph"));
});

test("coalescer waits instead of splitting when the only boundaries are inside an open fence", () => {
  const coalescer = createCoalescer({ minChars: 10, maxChars: 200 });
  assert.deepEqual(coalescer.push("```\nfirst line\n\nsecond line"), []);
  assert.ok(coalescer.pending.length > 10, "buffer above minChars but unsplittable: must wait");
});

test("forced split inside a fence closes the fence and reopens it with the same header", () => {
  const coalescer = createCoalescer({ minChars: 50, maxChars: 80 });
  const events = coalescer.push(`\`\`\`ts\n${"x".repeat(300)}\n\`\`\`\ndone.`);
  assert.ok(events.length >= 2, "oversized fence must force splits");
  for (const event of events) {
    const block = (event as Extract<StreamEvent, { type: "block" }>).text;
    assert.ok(fenceBalanced(block), `every forced block must be fence-balanced: ${JSON.stringify(block)}`);
  }
  const second = (events[1] as Extract<StreamEvent, { type: "block" }>).text;
  assert.ok(second.startsWith("```ts\n"), "remainder must reopen the fence with its original header");
});

test("idleFlush emits pending text only after idleMs of quiet", () => {
  const clock = makeClock();
  const coalescer = createCoalescer({ minChars: 800, idleMs: 1000, now: clock.now });
  coalescer.push("partial answer");
  assert.deepEqual(coalescer.idleFlush(), []);
  clock.advance(999);
  assert.deepEqual(coalescer.idleFlush(), []);
  clock.advance(1);
  const events = coalescer.idleFlush();
  assert.equal(events.length, 1);
  assert.equal((events[0] as Extract<StreamEvent, { type: "block" }>).text, "partial answer");
  assert.equal(coalescer.pending, "");
});

test("flush(tool_start) emits pending pre-tool text as a block, never drops it (OpenClaw #19275)", () => {
  const coalescer = createCoalescer({ minChars: 800 });
  coalescer.push("Let me check that file.");
  const events = coalescer.flush("tool_start");
  assert.deepEqual(events.map((event) => event.type), ["block", "flush"]);
  assert.equal((events[0] as Extract<StreamEvent, { type: "block" }>).text, "Let me check that file.");
  assert.deepEqual(coalescer.flush("message_end"), [{ type: "flush", reason: "message_end" }]);
});

test("fenceStateAt tracks open fences and their headers", () => {
  const text = "before\n```python\ncode\n";
  assert.equal(fenceStateAt(text, text.length).open, true);
  assert.equal(fenceStateAt(text, text.length).header, "```python");
  const closed = `${text}\`\`\`\nafter`;
  assert.equal(fenceStateAt(closed, closed.length).open, false);
});

// --- StreamRun FSM ------------------------------------------------------------

test("finalize is the only path emitting the final event and double-finalize is a no-op (OpenClaw #33492)", () => {
  const events: StreamEvent[] = [];
  const run = new StreamRun({ onEvent: (event) => events.push(event), messageId: "m1" });
  run.pushDelta("hello ");
  run.pushDelta("world");
  assert.equal(events.filter((event) => event.type === "final").length, 0, "no final before finalize()");
  run.finalize();
  run.finalize(); // dup-final prevention: second call must be a silent no-op
  run.finalize("even with different text");
  const finals = events.filter((event) => event.type === "final") as Array<Extract<StreamEvent, { type: "final" }>>;
  assert.equal(finals.length, 1);
  assert.equal(finals[0].messageId, "m1");
  assert.equal(finals[0].text, "hello world");
  assert.equal(run.state, "done");
});

test("events after done throw", () => {
  const run = new StreamRun({ onEvent: () => {} });
  run.pushDelta("x");
  run.finalize();
  assert.throws(() => run.pushDelta("late"), /after done/);
  assert.throws(() => run.toolStart("read"), /after done/);
});

test("toolStart flushes pending text through the coalescer before the tool event", () => {
  const events: StreamEvent[] = [];
  const run = new StreamRun({
    onEvent: (event) => events.push(event),
    coalescer: createCoalescer({ minChars: 800 }),
  });
  run.pushDelta("checking the config now");
  run.toolStart("read");
  run.toolEnd("read");
  run.finalize("checking the config now\nDone.");
  const types = events.map((event) => (event.type === "tool" ? `tool:${event.phase}` : event.type === "flush" ? `flush:${event.reason}` : event.type));
  assert.deepEqual(types, ["delta", "block", "flush:tool_start", "tool:start", "tool:end", "flush:message_end", "final"]);
});

// --- draft loop ----------------------------------------------------------------

test("runDraftLoop throttles edits (latest-wins) and finalize supersedes any pending upsert", async () => {
  const clock = makeClock();
  const { sink, calls } = makeSink({ editMs: 1000 });
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: "first " });
  channel.push({ type: "delta", text: "second " }); // arrives inside the throttle window
  channel.push({ type: "delta", text: "third" });
  channel.push({ type: "final", messageId: "m1", text: "first second third" });
  channel.close();
  const result = await runDraftLoop(channel.events, sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, "finalized");
  assert.deepEqual(calls, [
    { kind: "upsert", text: "first " }, // immediate first draft
    { kind: "finalize", text: "first second third" }, // pending edits superseded by final
  ]);
  assert.equal(result.upserts, 1);
});

test("runDraftLoop rolls over at caps.maxChars splitting at the last paragraph boundary", async () => {
  const clock = makeClock();
  const { sink, calls } = makeSink({ editMs: 0, maxChars: 60 });
  const part1 = "First paragraph of the answer.";
  const part2 = "Second paragraph keeps going well past the cap limit here.";
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: `${part1}\n\n` });
  channel.push({ type: "delta", text: part2 });
  channel.push({ type: "final", messageId: "m1", text: `${part1}\n\n${part2}` });
  channel.close();
  const result = await runDraftLoop(channel.events, sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(result.rollovers, 1);
  const finals = calls.filter((call) => call.kind === "finalize");
  assert.equal(finals.length, 2);
  assert.equal(finals[0].text, part1, "rollover prefix is the last whole paragraph before the cap");
  assert.equal(finals[1].text, part2, "remainder continues in the next message");
});

test("edit failure classified degrade-to-send never silently kills the draft (OpenClaw #92004)", async () => {
  const clock = makeClock();
  const { sink, calls } = makeSink({
    editMs: 0,
    failOn: (call) => (call.kind === "upsert" ? new Error("message can't be edited") : undefined),
    classify: () => "degrade-to-send",
  });
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: "draft text" });
  channel.push({ type: "delta", text: " more" });
  channel.push({ type: "final", messageId: "m1", text: "draft text more" });
  channel.close();
  const result = await runDraftLoop(channel.events, sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, "degraded");
  assert.equal(calls.filter((call) => call.kind === "upsert").length, 1, "no further edit attempts after degrade");
  const finals = calls.filter((call) => call.kind === "finalize");
  assert.deepEqual(finals, [{ kind: "finalize", text: "draft text more" }], "final text MUST still be delivered");
  assert.ok(result.warnings.some((warning) => /degraded to send/.test(warning)));
});

test("retry classification retries the upsert once; stop aborts the loop", async () => {
  const clock = makeClock();
  let upsertAttempts = 0;
  const retry = makeSink({
    editMs: 0,
    failOn: (call) => {
      if (call.kind !== "upsert") return undefined;
      upsertAttempts += 1;
      return upsertAttempts === 1 ? new Error("429 retry_after") : undefined;
    },
    classify: () => "retry",
  });
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: "hello" });
  channel.push({ type: "final", messageId: "m1", text: "hello" });
  channel.close();
  const result = await runDraftLoop(channel.events, retry.sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, "finalized");
  assert.equal(upsertAttempts, 2, "first failure retried once");

  const stop = makeSink({ editMs: 0, failOn: (call) => (call.kind === "upsert" ? new Error("401 unauthorized") : undefined), classify: () => "stop" });
  const channel2 = createStreamEventChannel();
  channel2.push({ type: "delta", text: "hello" });
  channel2.push({ type: "final", messageId: "m1", text: "hello" });
  channel2.close();
  const stopped = await runDraftLoop(channel2.events, stop.sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(stopped.status, "stopped");
  assert.match(stopped.error ?? "", /401/);
  assert.equal(stop.calls.filter((call) => call.kind === "finalize").length, 0, "stop is terminal");
});

test("a stream that ends without a final event still delivers pending text with a warning", async () => {
  const clock = makeClock();
  const { sink, calls } = makeSink({ editMs: 1000 });
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: "orphaned text" });
  channel.close();
  const result = await runDraftLoop(channel.events, sink, { now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, "finalized");
  assert.ok(result.warnings.some((warning) => /without a final event/.test(warning)));
  assert.deepEqual(calls[calls.length - 1], { kind: "finalize", text: "orphaned text" });
});

test("draft loop consumes one text granularity: mixed delta+block streams are not double-counted", async () => {
  const clock = makeClock();
  const { sink, calls } = makeSink({ editMs: 0 });
  const channel = createStreamEventChannel();
  channel.push({ type: "delta", text: "same text" });
  channel.push({ type: "block", text: "same text" }); // coalesced duplicate of the delta
  channel.push({ type: "final", messageId: "m1", text: "same text" });
  channel.close();
  await runDraftLoop(channel.events, sink, { now: clock.now, sleep: clock.sleep });
  assert.deepEqual(calls[calls.length - 1], { kind: "finalize", text: "same text" });
  assert.ok(calls.every((call) => !call.text.includes("same textsame text")));
});

// --- helpers ---------------------------------------------------------------------

test("rolloverSplit prefers paragraph, then newline, then a hard cut", () => {
  assert.deepEqual(rolloverSplit("aaa\n\nbbb", 6), { head: "aaa", rest: "bbb" });
  assert.deepEqual(rolloverSplit("aaa\nbbb", 6), { head: "aaa", rest: "bbb" });
  assert.deepEqual(rolloverSplit("aaaaaaaa", 4), { head: "aaaa", rest: "aaaa" });
});

test("synthesizeDeltas chunks buffered responses so non-streaming runtimes share the pipeline", () => {
  assert.deepEqual(synthesizeDeltas(""), []);
  const chunks = synthesizeDeltas("x".repeat(1000), 400);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [400, 400, 200]);
  assert.equal(chunks.join(""), "x".repeat(1000));
});
