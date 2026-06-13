import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addSpanEvent,
  endSpan,
  genAiAttributes,
  listSpans,
  renderTracesTable,
  spansToOtlp,
  startSpan,
  tracesPath,
  withSpan,
} from "../src/index.js";
import type { Span } from "../src/index.js";

// Run a body with MUSTER_TRACE forced on (and any ambient OTLP endpoint cleared,
// so an enabled test never fires a real network export), restoring both env vars
// afterwards so tests stay deterministic regardless of the ambient environment.
async function withTracing<T>(fn: () => Promise<T>): Promise<T> {
  const prevTrace = process.env.MUSTER_TRACE;
  const prevOtlp = process.env.MUSTER_OTLP_ENDPOINT;
  process.env.MUSTER_TRACE = "1";
  delete process.env.MUSTER_OTLP_ENDPOINT;
  try {
    return await fn();
  } finally {
    if (prevTrace === undefined) delete process.env.MUSTER_TRACE;
    else process.env.MUSTER_TRACE = prevTrace;
    if (prevOtlp === undefined) delete process.env.MUSTER_OTLP_ENDPOINT;
    else process.env.MUSTER_OTLP_ENDPOINT = prevOtlp;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("tracing is disabled by default: no span, no traces.jsonl", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  const prev = process.env.MUSTER_TRACE;
  delete process.env.MUSTER_TRACE;
  try {
    const span = startSpan("root");
    assert.equal(span, null, "startSpan returns null when tracing is off");
    await endSpan(span, { cwd });
    assert.equal(await exists(tracesPath(cwd)), false, "no traces file is written");
    assert.deepEqual(await listSpans(cwd), []);
  } finally {
    if (prev === undefined) delete process.env.MUSTER_TRACE;
    else process.env.MUSTER_TRACE = prev;
  }
});

test("enabled tracing yields 32-char traceId, 16-char spanId, and parent linkage", async () => {
  await withTracing(async () => {
    const parent = startSpan("parent");
    assert.ok(parent, "startSpan returns a span when tracing is on");
    assert.equal(parent.traceId.length, 32);
    assert.equal(parent.spanId.length, 16);
    assert.match(parent.traceId, /^[0-9a-f]{32}$/);
    assert.match(parent.spanId, /^[0-9a-f]{16}$/);
    assert.equal(parent.parentSpanId, undefined);

    const child = startSpan("child", { parent });
    assert.ok(child);
    assert.equal(child.traceId, parent.traceId, "child shares the parent traceId");
    assert.equal(child.parentSpanId, parent.spanId, "child links to the parent spanId");
    assert.notEqual(child.spanId, parent.spanId);
  });
});

test("endSpan writes a JSONL line that listSpans round-trips", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  await withTracing(async () => {
    const span = startSpan("llm.call", { kind: "client", attributes: { foo: "bar" } });
    assert.ok(span);
    await endSpan(span, { status: "ok", attributes: { extra: 7 }, cwd });

    const spans = await listSpans(cwd);
    assert.equal(spans.length, 1);
    const [stored] = spans;
    assert.equal(stored.spanId, span.spanId);
    assert.equal(stored.traceId, span.traceId);
    assert.equal(stored.name, "llm.call");
    assert.equal(stored.kind, "client");
    assert.equal(stored.status.code, "ok");
    assert.equal(stored.attributes.foo, "bar");
    assert.equal(stored.attributes.extra, 7);
    assert.ok(stored.endTimeUnixNano, "the span is closed before persisting");
  });
});

test("genAiAttributes maps the gen_ai.* semantic-convention keys", () => {
  const full = genAiAttributes({
    operation: "chat",
    system: "anthropic",
    requestModel: "claude-opus-4-8",
    responseModel: "claude-opus-4-8-20260101",
    inputTokens: 1200,
    outputTokens: 340,
  });
  assert.deepEqual(full, {
    "gen_ai.operation.name": "chat",
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": "claude-opus-4-8",
    "gen_ai.response.model": "claude-opus-4-8-20260101",
    "gen_ai.usage.input_tokens": 1200,
    "gen_ai.usage.output_tokens": 340,
  });

  const minimal = genAiAttributes({ operation: "chat", system: "openai", requestModel: "gpt-x" });
  assert.deepEqual(minimal, {
    "gen_ai.operation.name": "chat",
    "gen_ai.system": "openai",
    "gen_ai.request.model": "gpt-x",
  });
  assert.equal("gen_ai.response.model" in minimal, false, "optional keys are omitted, not nulled");
});

test("withSpan records ok on success and error (and rethrows) on failure", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  await withTracing(async () => {
    const value = await withSpan("ok.work", async (span) => {
      assert.ok(span, "the span is passed into the body when tracing is on");
      return 42;
    }, { cwd });
    assert.equal(value, 42);

    await assert.rejects(
      () => withSpan("bad.work", async () => {
        throw new Error("boom");
      }, { cwd }),
      /boom/,
    );

    const spans = await listSpans(cwd);
    assert.equal(spans.length, 2);
    const ok = spans.find((s) => s.name === "ok.work");
    const bad = spans.find((s) => s.name === "bad.work");
    assert.ok(ok && bad);
    assert.equal(ok.status.code, "ok");
    assert.equal(bad.status.code, "error");
    assert.equal(bad.status.message, "boom");
  });
});

test("spansToOtlp nests resourceSpans -> scopeSpans -> spans with int kind/status and kv attributes", () => {
  const span: Span = {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    parentSpanId: "c".repeat(16),
    name: "llm.call",
    kind: "client",
    startTimeUnixNano: "1000",
    endTimeUnixNano: "2000",
    attributes: { "gen_ai.system": "anthropic", "gen_ai.usage.input_tokens": 5, streaming: true },
    status: { code: "error", message: "nope" },
    events: [{ name: "first_token", timeUnixNano: "1500", attributes: { ms: 12 } }],
  };

  const otlp = spansToOtlp([span]) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
      scopeSpans: Array<{ scope: { name: string }; spans: Array<Record<string, unknown>> }>;
    }>;
  };

  assert.equal(otlp.resourceSpans.length, 1);
  const [resourceSpan] = otlp.resourceSpans;
  assert.deepEqual(resourceSpan.resource.attributes, [
    { key: "service.name", value: { stringValue: "muster" } },
  ]);
  assert.equal(resourceSpan.scopeSpans.length, 1);
  const [scopeSpan] = resourceSpan.scopeSpans;
  assert.equal(scopeSpan.scope.name, "muster");
  assert.equal(scopeSpan.spans.length, 1);

  const out = scopeSpan.spans[0] as {
    traceId: string;
    spanId: string;
    parentSpanId: string;
    kind: number;
    status: { code: number; message: string };
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
  };
  assert.equal(out.kind, 3, "client kind maps to integer 3");
  assert.equal(out.status.code, 2, "error status maps to integer 2");
  assert.equal(out.status.message, "nope");

  // trace_id/span_id are proto3 `bytes` -> base64 of the raw bytes, not hex.
  assert.equal(out.traceId, Buffer.from("a".repeat(32), "hex").toString("base64"));
  assert.equal(out.spanId, Buffer.from("b".repeat(16), "hex").toString("base64"));
  assert.equal(out.parentSpanId, Buffer.from("c".repeat(16), "hex").toString("base64"));

  const attrs = new Map(out.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(attrs.get("gen_ai.system"), { stringValue: "anthropic" });
  assert.deepEqual(attrs.get("gen_ai.usage.input_tokens"), { intValue: "5" }, "int64 is a string per proto3 JSON");
  assert.deepEqual(attrs.get("streaming"), { boolValue: true });
});

test("a default span maps to OTLP internal kind (1) and unset status (0)", () => {
  const span: Span = {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    name: "muster.run",
    kind: "internal",
    startTimeUnixNano: "1000",
    attributes: {},
    status: { code: "unset" },
    events: [],
  };
  const out = (spansToOtlp([span]) as {
    resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ kind: number; status: { code: number } }> }> }>;
  }).resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(out.kind, 1, "internal kind maps to integer 1");
  assert.equal(out.status.code, 0, "unset status maps to integer 0");
});

test("OTLP export POSTs base64 ids + string int64 to <endpoint>/v1/traces", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  const prevTrace = process.env.MUSTER_TRACE;
  const prevOtlp = process.env.MUSTER_OTLP_ENDPOINT;
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.MUSTER_TRACE = "1";
  process.env.MUSTER_OTLP_ENDPOINT = "http://collector.local:4318/"; // trailing slash on purpose
  globalThis.fetch = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const span = startSpan("chat m", { kind: "client", attributes: { "gen_ai.usage.input_tokens": 5 } });
    assert.ok(span);
    await endSpan(span, { status: "ok", cwd });

    assert.equal(calls.length, 1, "exactly one OTLP POST per exported span");
    assert.equal(calls[0].url, "http://collector.local:4318/v1/traces", "trailing slash normalized, /v1/traces appended");
    const otlpSpan = ((calls[0].body as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string; spanId: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }> }> }> })
      .resourceSpans[0].scopeSpans[0].spans[0]);
    assert.equal(otlpSpan.traceId, Buffer.from(span.traceId, "hex").toString("base64"));
    assert.equal(otlpSpan.spanId, Buffer.from(span.spanId, "hex").toString("base64"));
    const tok = otlpSpan.attributes.find((a) => a.key === "gen_ai.usage.input_tokens");
    assert.deepEqual(tok?.value, { intValue: "5" });
  } finally {
    globalThis.fetch = realFetch;
    if (prevTrace === undefined) delete process.env.MUSTER_TRACE;
    else process.env.MUSTER_TRACE = prevTrace;
    if (prevOtlp === undefined) delete process.env.MUSTER_OTLP_ENDPOINT;
    else process.env.MUSTER_OTLP_ENDPOINT = prevOtlp;
  }
});

test("addSpanEvent records events that serialize into the OTLP payload", async () => {
  await withTracing(async () => {
    const span = startSpan("op");
    assert.ok(span);
    addSpanEvent(span, "first_token", { ms: 12 });
    assert.equal(span.events.length, 1);
    assert.equal(span.events[0].name, "first_token");
    const out = (spansToOtlp([span]) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ events: Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }> }> }> }>;
    }).resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(out.events[0].name, "first_token");
    assert.deepEqual(out.events[0].attributes.find((a) => a.key === "ms")?.value, { intValue: "12" });
  });
});

test("endSpan is idempotent: ending twice writes one line and the first end wins", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  await withTracing(async () => {
    const span = startSpan("once");
    assert.ok(span);
    await endSpan(span, { status: "ok", cwd });
    await endSpan(span, { status: "error", statusMessage: "ignored", cwd });
    const spans = await listSpans(cwd);
    assert.equal(spans.length, 1, "the second endSpan is a no-op");
    assert.equal(spans[0].status.code, "ok", "the first end wins");
  });
});

test("status messages are capped so a provider error body cannot leak in full", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  await withTracing(async () => {
    const span = startSpan("op");
    assert.ok(span);
    await endSpan(span, { status: "error", statusMessage: "x".repeat(1000), cwd });
    const [stored] = await listSpans(cwd);
    assert.ok((stored.status.message ?? "").length <= 256, "status message is truncated to the cap");
  });
});

test("a persisted parent+child trace round-trips through listSpans and renders", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-trace-"));
  await withTracing(async () => {
    const root = startSpan("muster.run", { attributes: { "muster.run_id": "r1" } });
    assert.ok(root);
    const child = startSpan("chat claude-opus-4-8", {
      kind: "client",
      parent: root,
      attributes: genAiAttributes({ operation: "chat", system: "anthropic", requestModel: "claude-opus-4-8", inputTokens: 11 }),
    });
    await endSpan(child, { status: "ok", cwd });
    await endSpan(root, { status: "ok", cwd });

    const spans = await listSpans(cwd);
    assert.equal(spans.length, 2);
    const storedRoot = spans.find((s) => s.name === "muster.run");
    const storedChild = spans.find((s) => s.name.startsWith("chat "));
    assert.ok(storedRoot && storedChild);
    assert.equal(storedChild.traceId, storedRoot.traceId, "child and root share a trace");
    assert.equal(storedChild.parentSpanId, storedRoot.spanId, "child links to the root");

    const table = renderTracesTable(spans);
    assert.match(table, /trace/);
    assert.match(table, new RegExp(root.traceId.slice(0, 8)), "the trace id appears in the table");

    const tree = renderTracesTable(spans, { traceId: root.traceId });
    assert.match(tree, /muster\.run/);
    assert.match(tree, /chat claude-opus-4-8/);
    assert.match(tree, /gen_ai\.request\.model=claude-opus-4-8/);
  });
});
