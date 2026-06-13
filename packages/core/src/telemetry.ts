import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./store.js";

// Opt-in tracing: zero allocation and zero I/O unless MUSTER_TRACE is set to a
// truthy value. Mirrors the OpenTelemetry GenAI semantic conventions without
// pulling in the OTel SDK — spans are plain JSON we persist to JSONL and can
// best-effort POST to any OTLP/HTTP collector.
export function tracingEnabled(): boolean {
  return Boolean(process.env.MUSTER_TRACE) && process.env.MUSTER_TRACE !== "0" && process.env.MUSTER_TRACE !== "false";
}

export type SpanKind = "internal" | "client" | "server" | "producer" | "consumer";
export type SpanStatusCode = "unset" | "ok" | "error";

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface SpanEvent {
  readonly name: string;
  readonly timeUnixNano: string;
  readonly attributes?: SpanAttributes;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: SpanAttributes;
  status: { code: SpanStatusCode; message?: string };
  events: SpanEvent[];
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function nowUnixNano(): string {
  return (BigInt(Date.now()) * 1000000n).toString();
}

export interface StartSpanOptions {
  kind?: SpanKind;
  parent?: { traceId: string; spanId: string } | null;
  attributes?: SpanAttributes;
}

export function startSpan(name: string, options?: StartSpanOptions): Span | null {
  if (!tracingEnabled()) return null;
  const traceId = options?.parent?.traceId ?? hex(16);
  const spanId = hex(8);
  const parentSpanId = options?.parent?.spanId;
  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind: options?.kind ?? "internal",
    startTimeUnixNano: nowUnixNano(),
    attributes: { ...options?.attributes },
    status: { code: "unset" },
    events: [],
  };
}

export interface EndSpanOptions {
  status?: SpanStatusCode;
  statusMessage?: string;
  attributes?: SpanAttributes;
  cwd?: string;
}

// Cap status messages so a provider error body (which can echo prompt text)
// cannot bloat a span or leak a large payload to an OTLP collector. Traces carry
// metadata, not content.
const MAX_STATUS_MESSAGE_CHARS = 256;

export async function endSpan(span: Span | null, options?: EndSpanOptions): Promise<void> {
  // No-op on a disabled span (null) or one already ended. Idempotency lets a
  // caller end a root span on both the success path and an outer catch without
  // double-writing the JSONL line or re-exporting.
  if (!span || span.endTimeUnixNano) return;
  span.endTimeUnixNano = nowUnixNano();
  if (options?.attributes) Object.assign(span.attributes, options.attributes);
  if (options?.status) {
    const message = options.statusMessage === undefined
      ? undefined
      : options.statusMessage.slice(0, MAX_STATUS_MESSAGE_CHARS);
    span.status = { code: options.status, message };
  }
  await exportSpan(span, options?.cwd ?? process.cwd());
}

export function addSpanEvent(span: Span | null, name: string, attributes?: SpanAttributes): void {
  if (!span) return;
  span.events.push({ name, timeUnixNano: nowUnixNano(), attributes });
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span | null) => Promise<T>,
  options?: StartSpanOptions & { cwd?: string },
): Promise<T> {
  const span = startSpan(name, options);
  try {
    const result = await fn(span);
    await endSpan(span, { status: "ok", cwd: options?.cwd });
    return result;
  } catch (error) {
    await endSpan(span, {
      status: "error",
      statusMessage: String((error as { message?: unknown } | undefined)?.message ?? error),
      cwd: options?.cwd,
    });
    throw error;
  }
}

export interface GenAiSpanInput {
  operation: string;
  system: string;
  requestModel: string;
  responseModel?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function genAiAttributes(input: GenAiSpanInput): SpanAttributes {
  const attributes: SpanAttributes = {
    "gen_ai.operation.name": input.operation,
    "gen_ai.system": input.system,
    "gen_ai.request.model": input.requestModel,
  };
  if (input.responseModel !== undefined) attributes["gen_ai.response.model"] = input.responseModel;
  if (input.inputTokens !== undefined) attributes["gen_ai.usage.input_tokens"] = input.inputTokens;
  if (input.outputTokens !== undefined) attributes["gen_ai.usage.output_tokens"] = input.outputTokens;
  return attributes;
}

export function tracesPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "traces.jsonl");
}

export async function listSpans(cwd = process.cwd()): Promise<Span[]> {
  try {
    const raw = await readFile(tracesPath(cwd), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Span);
  } catch {
    return [];
  }
}

async function appendSpanLine(span: Span, cwd: string): Promise<void> {
  const path = tracesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(span)}\n`);
}

export function otlpEndpoint(): string | undefined {
  return process.env.MUSTER_OTLP_ENDPOINT || undefined;
}

const KIND_TO_INT: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};

const STATUS_TO_INT: Record<SpanStatusCode, number> = {
  unset: 0,
  ok: 1,
  error: 2,
};

function kv(key: string, value: string | number | boolean): unknown {
  if (typeof value === "number") {
    // proto3 JSON encodes int64 as a string (to avoid precision loss); only
    // non-integers use doubleValue. Token counts etc. are integers.
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: value } };
}

// OTLP/JSON encodes the trace_id/span_id `bytes` fields as base64 of the raw
// bytes (proto3 JSON mapping), not the hex strings we store internally. Sending
// hex makes standard collectors (Jaeger, Tempo, the OTel Collector) reject the
// payload.
function hexToBase64(hexValue: string): string {
  return Buffer.from(hexValue, "hex").toString("base64");
}

function toOtlpSpan(span: Span): unknown {
  return {
    traceId: hexToBase64(span.traceId),
    spanId: hexToBase64(span.spanId),
    parentSpanId: span.parentSpanId ? hexToBase64(span.parentSpanId) : undefined,
    name: span.name,
    kind: KIND_TO_INT[span.kind],
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: Object.entries(span.attributes).map(([key, value]) => kv(key, value)),
    status: { code: STATUS_TO_INT[span.status.code], message: span.status.message },
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: event.timeUnixNano,
      attributes: event.attributes
        ? Object.entries(event.attributes).map(([key, value]) => kv(key, value))
        : [],
    })),
  };
}

export function spansToOtlp(spans: readonly Span[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [kv("service.name", "muster")] },
        scopeSpans: [
          {
            scope: { name: "muster" },
            spans: spans.map(toOtlpSpan),
          },
        ],
      },
    ],
  };
}

async function postOtlp(spans: readonly Span[], endpoint: string): Promise<void> {
  try {
    await fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spansToOtlp(spans)),
    });
  } catch {
    /* observability is best-effort; swallow */
  }
}

async function exportSpan(span: Span, cwd: string): Promise<void> {
  try {
    await appendSpanLine(span, cwd);
  } catch {
    /* a failed trace write must never break the run it is observing */
  }
  const ep = otlpEndpoint();
  if (ep) await postOtlp([span], ep);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function durationMs(spans: readonly Span[]): number {
  const ends = spans.map((span) => span.endTimeUnixNano).filter((value): value is string => Boolean(value));
  if (!spans.length || !ends.length) return 0;
  const start = spans.map((span) => BigInt(span.startTimeUnixNano)).reduce((a, b) => (a < b ? a : b));
  const end = ends.map((value) => BigInt(value)).reduce((a, b) => (a > b ? a : b));
  return Number(end - start) / 1e6;
}

function rootSpan(spans: readonly Span[]): Span | undefined {
  return spans.find((span) => !span.parentSpanId) ?? spans[0];
}

function traceModel(spans: readonly Span[]): string {
  const root = rootSpan(spans);
  const rootModel = root?.attributes["gen_ai.request.model"];
  if (typeof rootModel === "string") return rootModel;
  for (const span of spans) {
    const model = span.attributes["gen_ai.request.model"];
    if (typeof model === "string") return model;
  }
  return "-";
}

export function renderTracesTable(spans: readonly Span[], options?: { limit?: number; traceId?: string }): string {
  if (options?.traceId) return renderTraceTree(spans, options.traceId);
  if (!spans.length) return "No traces yet. Set MUSTER_TRACE=1 and run `muster run \"<prompt>\"` to record spans.";
  const byTrace = new Map<string, Span[]>();
  for (const span of spans) {
    const group = byTrace.get(span.traceId) ?? [];
    group.push(span);
    byTrace.set(span.traceId, group);
  }
  const traces = [...byTrace.entries()].map(([traceId, group]) => {
    const root = rootSpan(group);
    const startNano = group.map((span) => BigInt(span.startTimeUnixNano)).reduce((a, b) => (a < b ? a : b));
    return {
      traceId,
      name: root?.name ?? "-",
      count: group.length,
      durationMs: durationMs(group),
      model: traceModel(group),
      status: group.some((span) => span.status.code === "error") ? "error" : "ok",
      startNano,
    };
  });
  traces.sort((a, b) => (a.startNano < b.startNano ? 1 : a.startNano > b.startNano ? -1 : 0));
  const recent = traces.slice(0, options?.limit ?? 20);
  const lines: string[] = [];
  const header = `${pad("trace", 10)} ${pad("root", 28)} ${pad("spans", 6)} ${pad("ms", 10)} ${pad("model", 24)} ${pad("status", 7)}`;
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const trace of recent) {
    lines.push([
      pad(trace.traceId.slice(0, 8), 10),
      pad(trace.name.slice(0, 28), 28),
      pad(String(trace.count), 6),
      pad(trace.durationMs.toFixed(1), 10),
      pad(trace.model.slice(0, 24), 24),
      pad(trace.status, 7),
    ].join(" "));
  }
  return lines.join("\n");
}

export function renderTraceTree(spans: readonly Span[], traceId: string): string {
  const group = spans
    .filter((span) => span.traceId === traceId)
    .sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1));
  if (!group.length) return `No spans for trace ${traceId.slice(0, 8)}.`;
  const byId = new Map<string, Span>();
  for (const span of group) byId.set(span.spanId, span);
  const depthOf = (span: Span): number => {
    let depth = 0;
    let parentId = span.parentSpanId;
    while (parentId && byId.has(parentId) && depth < group.length) {
      depth += 1;
      parentId = byId.get(parentId)?.parentSpanId;
    }
    return depth;
  };
  const lines: string[] = [`trace ${traceId} (${group.length} span(s))`];
  for (const span of group) {
    const indent = "  ".repeat(depthOf(span));
    const ms = span.endTimeUnixNano ? (Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1e6).toFixed(1) : "-";
    const genAi = ["gen_ai.operation.name", "gen_ai.request.model", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"]
      .filter((key) => span.attributes[key] !== undefined)
      .map((key) => `${key}=${span.attributes[key]}`)
      .join(" ");
    lines.push(`${indent}${span.name} [${span.kind}] ${ms}ms ${span.status.code}${genAi ? ` ${genAi}` : ""}`);
  }
  return lines.join("\n");
}
