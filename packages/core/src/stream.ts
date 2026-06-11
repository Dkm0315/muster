/**
 * Streaming core (docs/teardowns/OPENCLAW_TEARDOWN.md, "Streaming pipeline"):
 * typed StreamEvent union -> fence-aware coalescer -> StreamRun finalize FSM
 * -> DraftSink draft loop. OpenClaw's whole streaming bug family (dup finals
 * #33492/#84623, lost pre-tool text #19275, silent truncation #84563) lives at
 * the preview->final seam, so the invariant here is explicit: FINAL IS AN
 * EVENT, emitted by finalize() and by nothing else — never inferred from
 * content dedupe.
 */

export type StreamFlushReason = "tool_start" | "message_end";

export type StreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "block"; readonly text: string }
  | { readonly type: "flush"; readonly reason: StreamFlushReason }
  | { readonly type: "tool"; readonly phase: "start" | "end"; readonly name?: string }
  | { readonly type: "final"; readonly messageId: string; readonly text: string };

export type BreakPreference = "paragraph" | "newline" | "sentence";

export interface CoalescerOptions {
  /** Do not emit a block below this size unless flushed. Default 800. */
  readonly minChars?: number;
  /** Force a split (fence-aware) above this size. Default 1200. */
  readonly maxChars?: number;
  /** idleFlush() emits the pending buffer after this much quiet. Default 1000. */
  readonly idleMs?: number;
  /** Preferred boundary when choosing a split point. Default "paragraph". */
  readonly breakPreference?: BreakPreference;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export interface Coalescer {
  /** Feed a delta; returns zero or more block events when thresholds are crossed. */
  push(delta: string): StreamEvent[];
  /** Emit any pending text as a block plus the flush marker (tool_start | message_end). */
  flush(reason: StreamFlushReason): StreamEvent[];
  /** Emit pending text as a block if idleMs has elapsed since the last push. */
  idleFlush(): StreamEvent[];
  readonly pending: string;
}

/**
 * Scan markdown for triple-backtick fences. Returns whether `index` falls
 * inside an open fence and the fence's opening marker line (e.g. "```ts") so
 * a forced split can close and reopen it.
 */
export function fenceStateAt(text: string, index: number): { readonly open: boolean; readonly header: string } {
  let open = false;
  let header = "";
  const slice = text.slice(0, index);
  const marker = /^[ \t]{0,3}(```+)[^\n]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(slice)) !== null) {
    open = !open;
    header = open ? match[0].trim() : "";
  }
  return { open, header };
}

function boundaryOrder(preference: BreakPreference): ReadonlyArray<"paragraph" | "newline" | "sentence"> {
  if (preference === "paragraph") return ["paragraph", "newline", "sentence"];
  if (preference === "newline") return ["newline", "paragraph", "sentence"];
  return ["sentence", "newline", "paragraph"];
}

function lastBoundaryIn(text: string, kind: "paragraph" | "newline" | "sentence", min: number, max: number): number {
  const window = text.slice(0, max);
  if (kind === "paragraph") {
    const at = window.lastIndexOf("\n\n");
    return at >= min ? at : -1;
  }
  if (kind === "newline") {
    const at = window.lastIndexOf("\n");
    return at >= min ? at : -1;
  }
  let best = -1;
  const sentence = /[.!?][)"'\]]?\s/g;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(window)) !== null) {
    const end = match.index + match[0].length;
    if (end >= min && end <= max) best = end;
  }
  return best;
}

export function createCoalescer(options: CoalescerOptions = {}): Coalescer {
  const minChars = options.minChars ?? 800;
  const maxChars = Math.max(options.maxChars ?? 1200, minChars);
  const idleMs = options.idleMs ?? 1000;
  const preference = options.breakPreference ?? "paragraph";
  const now = options.now ?? Date.now;
  let buffer = "";
  let lastPushAt = now();

  const takeBlock = (): StreamEvent | undefined => {
    if (buffer.length < minChars) return undefined;
    // Prefer the largest clean boundary inside [minChars, maxChars] that is
    // NOT inside a code fence (the teardown's hard rule: never split fences).
    for (const kind of boundaryOrder(preference)) {
      const at = lastBoundaryIn(buffer, kind, minChars, Math.min(buffer.length, maxChars));
      if (at > 0 && !fenceStateAt(buffer, at).open) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at).replace(/^\n+/, "");
        return { type: "block", text: block };
      }
    }
    if (buffer.length <= maxChars) return undefined; // wait for more text
    // Forced split at maxChars. If we are inside a fence, close it in the
    // emitted block and reopen it (same header) at the start of the remainder.
    const fence = fenceStateAt(buffer, maxChars);
    const head = buffer.slice(0, maxChars);
    const rest = buffer.slice(maxChars);
    if (fence.open) {
      buffer = `${fence.header}\n${rest}`;
      return { type: "block", text: `${head}\n\`\`\`` };
    }
    buffer = rest;
    return { type: "block", text: head };
  };

  return {
    get pending() {
      return buffer;
    },
    push(delta: string): StreamEvent[] {
      lastPushAt = now();
      buffer += delta;
      const events: StreamEvent[] = [];
      let block: StreamEvent | undefined;
      while ((block = takeBlock()) !== undefined) events.push(block);
      return events;
    },
    flush(reason: StreamFlushReason): StreamEvent[] {
      const events: StreamEvent[] = [];
      if (buffer.length > 0) {
        // #19275 regression guard: pre-tool text must never be dropped.
        events.push({ type: "block", text: buffer });
        buffer = "";
      }
      events.push({ type: "flush", reason });
      return events;
    },
    idleFlush(): StreamEvent[] {
      if (!buffer.length || now() - lastPushAt < idleMs) return [];
      const block = buffer;
      buffer = "";
      lastPushAt = now();
      return [{ type: "block", text: block }];
    },
  };
}

export type StreamRunState = "streaming" | "finalizing" | "done";

export interface StreamRunOptions {
  readonly onEvent: (event: StreamEvent) => void;
  readonly messageId?: string;
  readonly coalescer?: Coalescer;
}

/**
 * FSM: streaming -> finalizing -> done. finalize() is THE ONLY path that emits
 * the final event (OpenClaw #33492: dup finals came from inferring "final"
 * from content). Double-finalize is a no-op; events after done throw.
 */
export class StreamRun {
  readonly messageId: string;
  #state: StreamRunState = "streaming";
  #accumulated = "";
  readonly #coalescer: Coalescer;
  readonly #onEvent: (event: StreamEvent) => void;

  constructor(options: StreamRunOptions) {
    this.messageId = options.messageId ?? `msg_${Math.random().toString(36).slice(2, 10)}`;
    this.#coalescer = options.coalescer ?? createCoalescer();
    this.#onEvent = options.onEvent;
  }

  get state(): StreamRunState {
    return this.#state;
  }

  #assertStreaming(action: string): void {
    if (this.#state !== "streaming") {
      throw new Error(`StreamRun.${action} after ${this.#state === "done" ? "done" : "finalize"} — events after the final are forbidden.`);
    }
  }

  pushDelta(text: string): void {
    this.#assertStreaming("pushDelta");
    if (!text) return;
    this.#accumulated += text;
    this.#onEvent({ type: "delta", text });
    for (const event of this.#coalescer.push(text)) this.#onEvent(event);
  }

  toolStart(name?: string): void {
    this.#assertStreaming("toolStart");
    for (const event of this.#coalescer.flush("tool_start")) this.#onEvent(event);
    this.#onEvent({ type: "tool", phase: "start", name });
  }

  toolEnd(name?: string): void {
    this.#assertStreaming("toolEnd");
    this.#onEvent({ type: "tool", phase: "end", name });
  }

  idleFlush(): void {
    this.#assertStreaming("idleFlush");
    for (const event of this.#coalescer.idleFlush()) this.#onEvent(event);
  }

  /** Idempotent; the only emitter of the final event. */
  finalize(fullText?: string): void {
    if (this.#state !== "streaming") return; // double-finalize is a no-op (#33492)
    this.#state = "finalizing";
    for (const event of this.#coalescer.flush("message_end")) this.#onEvent(event);
    this.#onEvent({ type: "final", messageId: this.messageId, text: fullText ?? this.#accumulated });
    this.#state = "done";
  }
}

export type DraftErrorClass = "retry" | "degrade-to-send" | "stop";

export interface DraftSinkCaps {
  /** Minimum interval between draft edits for this channel (ms). */
  readonly editMs: number;
  /** Per-message character cap; the draft loop rolls over above this. */
  readonly maxChars: number;
}

export interface DraftSink {
  readonly caps: DraftSinkCaps;
  /** Create or update the current draft message with the full latest text. */
  upsert(text: string): Promise<void>;
  /** Complete the current draft message with its final text. */
  finalize(text: string): Promise<void>;
  classifyError(error: unknown): DraftErrorClass;
}

export interface DraftLoopOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface DraftLoopResult {
  readonly status: "finalized" | "degraded" | "stopped";
  readonly upserts: number;
  readonly rollovers: number;
  readonly finalText: string;
  readonly warnings: string[];
  readonly error?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Rollover split: last paragraph boundary before the cap, then newline, then hard. */
export function rolloverSplit(text: string, maxChars: number): { readonly head: string; readonly rest: string } {
  const window = text.slice(0, maxChars);
  let at = window.lastIndexOf("\n\n");
  if (at <= 0) at = window.lastIndexOf("\n");
  if (at <= 0) at = maxChars;
  return { head: text.slice(0, at), rest: text.slice(at).replace(/^\n+/, "") };
}

/**
 * Latest-wins, single-flight, throttled draft loop. The final event supersedes
 * any pending upsert. Errors run through sink.classifyError: "retry" retries
 * once and otherwise leaves the text pending, "degrade-to-send" stops editing
 * but ALWAYS still delivers the final via sink.finalize (OpenClaw #92004: an
 * edit failure must never silently kill the draft), "stop" aborts.
 */
export async function runDraftLoop(
  events: AsyncIterable<StreamEvent> | Iterable<StreamEvent>,
  sink: DraftSink,
  options: DraftLoopOptions = {},
): Promise<DraftLoopResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const warnings: string[] = [];
  let buffer = "";
  let accumulated = "";
  let consumed = 0; // chars of `accumulated` already finalized via rollover
  let lastEditAt = Number.NEGATIVE_INFINITY;
  let dirty = false;
  let degraded = false;
  let stopped = false;
  let upserts = 0;
  let rollovers = 0;
  let sawFinal = false;
  let finalText = "";
  let error: string | undefined;

  const classify = (failure: unknown): DraftErrorClass => sink.classifyError(failure);

  const handleFailure = (failure: unknown, action: string): DraftErrorClass => {
    const kind = classify(failure);
    const detail = failure instanceof Error ? failure.message : String(failure);
    if (kind === "degrade-to-send") {
      degraded = true;
      warnings.push(`${action} failed (${detail}); degraded to send — draft kept, final still delivered.`);
    } else if (kind === "stop") {
      stopped = true;
      error = detail;
    } else {
      warnings.push(`${action} failed (${detail}); will retry.`);
    }
    return kind;
  };

  const tryUpsert = async (): Promise<void> => {
    if (degraded || stopped || !buffer) return;
    try {
      const text = buffer; // latest-wins: snapshot the newest text
      await sink.upsert(text);
      upserts += 1;
      dirty = buffer !== text;
      lastEditAt = now();
    } catch (failure) {
      const kind = handleFailure(failure, "draft upsert");
      if (kind === "retry") {
        try {
          await sink.upsert(buffer);
          upserts += 1;
          dirty = false;
          lastEditAt = now();
        } catch (secondFailure) {
          if (handleFailure(secondFailure, "draft upsert retry") === "retry") dirty = true;
        }
      }
    }
  };

  const upsertIfAllowed = async (): Promise<void> => {
    if (degraded || stopped) return;
    if (now() - lastEditAt >= sink.caps.editMs) await tryUpsert();
    else dirty = true;
  };

  const drainPending = async (): Promise<void> => {
    if (!dirty || degraded || stopped) return;
    const wait = sink.caps.editMs - (now() - lastEditAt);
    if (wait > 0) await sleep(wait);
    await tryUpsert();
  };

  const rolloverIfNeeded = async (): Promise<void> => {
    while (buffer.length > sink.caps.maxChars && !stopped) {
      const { head, rest } = rolloverSplit(buffer, sink.caps.maxChars);
      try {
        await sink.finalize(head);
      } catch (failure) {
        handleFailure(failure, "rollover finalize");
        if (stopped) return;
      }
      consumed += buffer.length - rest.length;
      buffer = rest;
      rollovers += 1;
      lastEditAt = Number.NEGATIVE_INFINITY; // fresh message: next upsert is immediate
      degraded = false; // a new message gets a fresh chance at draft edits
    }
  };

  // A StreamRun emits the same text as BOTH raw deltas and coalesced blocks;
  // a draft loop must consume exactly one granularity or it doubles the text.
  // Lock onto whichever text-event type arrives first and ignore the other.
  let textEventType: "delta" | "block" | undefined;

  for await (const event of events) {
    if (stopped) break;
    if (event.type === "delta" || event.type === "block") {
      textEventType ??= event.type;
      if (event.type !== textEventType) continue;
      accumulated += event.text;
      buffer += event.text;
      await rolloverIfNeeded();
      await upsertIfAllowed();
      continue;
    }
    if (event.type === "flush") {
      await drainPending(); // pre-tool / pre-final text always lands (#19275)
      continue;
    }
    if (event.type === "final") {
      sawFinal = true;
      finalText = event.text;
      // finalize supersedes any pending upsert — do not drain dirty first.
      const remainder = consumed > 0
        ? (event.text === accumulated ? buffer : event.text.slice(Math.min(consumed, event.text.length)))
        : event.text;
      try {
        await sink.finalize(remainder);
      } catch (failure) {
        const kind = handleFailure(failure, "finalize");
        if (kind === "retry") {
          try {
            await sink.finalize(remainder);
          } catch (secondFailure) {
            handleFailure(secondFailure, "finalize retry");
          }
        }
      }
      break;
    }
    // tool events: no sink action; channel-specific typing indicators may hook here later.
  }

  if (!sawFinal && !stopped) {
    warnings.push("stream ended without a final event; delivering pending text anyway.");
    try {
      await sink.finalize(buffer);
    } catch (failure) {
      handleFailure(failure, "fallback finalize");
    }
    finalText = accumulated;
  }

  return {
    status: stopped ? "stopped" : degraded ? "degraded" : "finalized",
    upserts,
    rollovers,
    finalText,
    warnings,
    error,
  };
}

export interface StreamEventChannel {
  readonly events: AsyncIterable<StreamEvent>;
  push(event: StreamEvent): void;
  close(): void;
}

/** Simple unbounded async channel to connect a StreamRun to runDraftLoop. */
export function createStreamEventChannel(): StreamEventChannel {
  const queue: StreamEvent[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  return {
    push(event: StreamEvent): void {
      if (closed) return;
      queue.push(event);
      wake?.();
    },
    close(): void {
      closed = true;
      wake?.();
    },
    events: {
      async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        for (;;) {
          while (queue.length) yield queue.shift()!;
          if (closed) return;
          await new Promise<void>((resolveWake) => {
            wake = resolveWake;
          });
          wake = undefined;
        }
      },
    },
  };
}

/**
 * Chunk a buffered response into synthetic deltas so non-streaming runtimes
 * (claude-code, native HTTP providers) run through the exact same
 * coalescer/draft pipeline as live Pi streaming.
 */
export function synthesizeDeltas(text: string, chunkChars = 400): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += chunkChars) chunks.push(text.slice(at, at + chunkChars));
  return chunks;
}
