import type { DraftErrorClass, DraftSink } from "@dkm0315/core";

/**
 * Gateway draft streaming (docs/teardowns/OPENCLAW_TEARDOWN.md): per-channel
 * DraftSinks (Telegram sendMessage/editMessageText, Slack chat.postMessage/
 * chat.update) built from PURE payload builders plus an injected fetch
 * executor, fed by the core runDraftLoop. Outbound traffic runs through a
 * per-chat queue with retry_after/Retry-After backoff (the Discord-scheduler
 * shape: token bucket per chat key) — never Telegram's kill-draft-on-error.
 */

/** Error carrying enough HTTP context for classification and backoff. */
export class OutboundHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed from Telegram parameters.retry_after or a Retry-After header (ms). */
    readonly retryAfterMs?: number,
    /** Channel-level error code/description (e.g. Slack "cant_update_message"). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "OutboundHttpError";
  }
}

export interface OutboundQueue {
  /** Run a task serialized per chat key, honoring the per-key token bucket and retry_after backoff. */
  enqueue<T>(chatKey: string, task: () => Promise<T>): Promise<T>;
}

export interface OutboundQueueOptions {
  /** Minimum interval between sends per chat key (token refill). Default 0. */
  readonly minIntervalMs?: number;
  /** Automatic re-attempts when a task throws with retryAfterMs. Default 2. */
  readonly maxRetries?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/**
 * Per-chat-key FIFO with a simple token bucket: each key may send at most once
 * per minIntervalMs; a 429-style failure pushes the key's next-allowed time
 * out by retryAfterMs and the task is retried (up to maxRetries) instead of
 * being dropped.
 */
export function createOutboundQueue(options: OutboundQueueOptions = {}): OutboundQueue {
  const minIntervalMs = options.minIntervalMs ?? 0;
  const maxRetries = options.maxRetries ?? 2;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const tails = new Map<string, Promise<unknown>>();
  const nextAllowedAt = new Map<string, number>();

  return {
    enqueue<T>(chatKey: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(chatKey) ?? Promise.resolve();
      const run = previous.then(async () => {
        for (let attempt = 0; ; attempt += 1) {
          const wait = (nextAllowedAt.get(chatKey) ?? 0) - now();
          if (wait > 0) await sleep(wait);
          try {
            const result = await task();
            nextAllowedAt.set(chatKey, now() + minIntervalMs);
            return result;
          } catch (error) {
            const retryAfterMs = error instanceof OutboundHttpError ? error.retryAfterMs : undefined;
            if (retryAfterMs === undefined || attempt >= maxRetries) throw error;
            nextAllowedAt.set(chatKey, now() + retryAfterMs);
          }
        }
      });
      // The tail must survive task failures or the key's queue would wedge.
      tails.set(chatKey, run.catch(() => undefined));
      return run;
    },
  };
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const header = headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

// --- Telegram ----------------------------------------------------------------

export interface TelegramDraftSendPayload {
  readonly chat_id: string;
  readonly text: string;
}

export interface TelegramDraftEditPayload {
  readonly chat_id: string;
  readonly message_id: number;
  readonly text: string;
}

/** Pure payload builder: first draft -> sendMessage. */
export function telegramDraftSendPayload(chatId: string, text: string): TelegramDraftSendPayload {
  return { chat_id: chatId, text };
}

/** Pure payload builder: subsequent edits -> editMessageText. */
export function telegramDraftEditPayload(chatId: string, messageId: number, text: string): TelegramDraftEditPayload {
  return { chat_id: chatId, message_id: messageId, text };
}

export const TELEGRAM_DRAFT_CAPS = { editMs: 1000, maxChars: 4096 } as const;

export interface TelegramDraftSinkOptions {
  readonly botToken: string;
  readonly chatId: string;
  readonly fetcher: typeof fetch;
  readonly queue?: OutboundQueue;
  readonly apiBase?: string;
  readonly editMs?: number;
  readonly maxChars?: number;
}

interface TelegramApiResult {
  readonly ok?: boolean;
  readonly description?: string;
  readonly parameters?: { readonly retry_after?: number };
  readonly result?: { readonly message_id?: number };
}

/** Telegram Bot API errors that mean the draft message can no longer be edited. */
const TELEGRAM_UNEDITABLE = /can't be edited|message to edit not found|message_id_invalid/i;

export function classifyTelegramError(error: unknown): DraftErrorClass {
  if (!(error instanceof OutboundHttpError)) return "retry";
  if (error.status === 401 || error.status === 403) return "stop";
  if (error.status === 429 || error.status >= 500) return "retry";
  if (/not modified/i.test(error.message)) return "retry"; // harmless no-op edit
  if (TELEGRAM_UNEDITABLE.test(error.message)) return "degrade-to-send";
  return "degrade-to-send";
}

/**
 * Telegram DraftSink: sendMessage creates the draft, editMessageText updates
 * it (runDraftLoop enforces the 1000ms edit throttle and the 4096 rollover).
 * A generation counter guards against late sendMessage responses adopting a
 * message_id after the draft has already been finalized or rolled over.
 */
export function createTelegramDraftSink(options: TelegramDraftSinkOptions): DraftSink {
  const apiBase = options.apiBase ?? "https://api.telegram.org";
  const queue = options.queue ?? createOutboundQueue();
  const chatKey = `telegram:${options.chatId}`;
  let messageId: number | undefined;
  let generation = 0;

  const call = async (method: string, payload: unknown): Promise<TelegramApiResult> => {
    const response = await options.fetcher(`${apiBase}/bot${options.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as TelegramApiResult;
    if (!response.ok || body.ok === false) {
      const retryAfterMs = body.parameters?.retry_after !== undefined
        ? body.parameters.retry_after * 1000
        : retryAfterFromHeaders(response.headers);
      throw new OutboundHttpError(
        `telegram ${method} failed: HTTP ${response.status}${body.description ? ` ${body.description}` : ""}`,
        response.status,
        retryAfterMs,
        body.description,
      );
    }
    return body;
  };

  const sendNew = async (text: string, adoptAsDraft: boolean): Promise<void> => {
    const requestGeneration = generation;
    const result = await call("sendMessage", telegramDraftSendPayload(options.chatId, text));
    // Late-response guard: if the draft generation moved on (finalize or
    // rollover happened) this message_id belongs to a dead draft — drop it.
    if (adoptAsDraft && requestGeneration === generation && messageId === undefined) {
      messageId = result.result?.message_id;
    }
  };

  return {
    caps: { editMs: options.editMs ?? TELEGRAM_DRAFT_CAPS.editMs, maxChars: options.maxChars ?? TELEGRAM_DRAFT_CAPS.maxChars },
    async upsert(text: string): Promise<void> {
      await queue.enqueue(chatKey, async () => {
        if (messageId === undefined) await sendNew(text, true);
        else await call("editMessageText", telegramDraftEditPayload(options.chatId, messageId, text));
      });
    },
    async finalize(text: string): Promise<void> {
      await queue.enqueue(chatKey, async () => {
        const finalId = messageId;
        messageId = undefined;
        generation += 1; // invalidate any late draft responses
        if (finalId === undefined) {
          await sendNew(text, false);
          return;
        }
        try {
          await call("editMessageText", telegramDraftEditPayload(options.chatId, finalId, text));
        } catch (error) {
          // OpenClaw #92004: a failed final edit must never kill the text —
          // degrade to a fresh sendMessage unless the error is terminal.
          if (classifyTelegramError(error) === "stop") throw error;
          await sendNew(text, false);
        }
      });
    },
    classifyError: classifyTelegramError,
  };
}

// --- Slack ---------------------------------------------------------------------

export interface SlackDraftPostPayload {
  readonly channel: string;
  readonly text: string;
  readonly thread_ts?: string;
}

export interface SlackDraftUpdatePayload {
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
}

/** Pure payload builder: first draft -> chat.postMessage. */
export function slackDraftPostPayload(channel: string, text: string, threadTs?: string): SlackDraftPostPayload {
  return { channel, text, thread_ts: threadTs };
}

/** Pure payload builder: subsequent edits -> chat.update. */
export function slackDraftUpdatePayload(channel: string, ts: string, text: string): SlackDraftUpdatePayload {
  return { channel, ts, text };
}

export const SLACK_DRAFT_CAPS = { editMs: 1000, maxChars: 4000 } as const;

const SLACK_STOP_ERRORS = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked"]);
const SLACK_UNEDITABLE = new Set(["message_not_found", "cant_update_message", "edit_window_closed", "is_inactive"]);

export function classifySlackError(error: unknown): DraftErrorClass {
  if (!(error instanceof OutboundHttpError)) return "retry";
  if (error.code && SLACK_STOP_ERRORS.has(error.code)) return "stop";
  if (error.status === 429 || error.status >= 500 || error.code === "ratelimited") return "retry";
  if (error.code && SLACK_UNEDITABLE.has(error.code)) return "degrade-to-send";
  return error.status >= 400 && error.status < 500 ? "degrade-to-send" : "retry";
}

export interface SlackDraftSinkOptions {
  readonly botToken: string;
  readonly channel: string;
  readonly threadTs?: string;
  readonly fetcher: typeof fetch;
  readonly queue?: OutboundQueue;
  readonly apiBase?: string;
  readonly editMs?: number;
  readonly maxChars?: number;
}

interface SlackApiResult {
  readonly ok?: boolean;
  readonly error?: string;
  readonly ts?: string;
}

/** Slack DraftSink: chat.postMessage creates the draft, chat.update edits it. */
export function createSlackDraftSink(options: SlackDraftSinkOptions): DraftSink {
  const apiBase = options.apiBase ?? "https://slack.com/api";
  const queue = options.queue ?? createOutboundQueue();
  const chatKey = `slack:${options.channel}`;
  let draftTs: string | undefined;
  let generation = 0;

  const call = async (method: string, payload: unknown): Promise<SlackApiResult> => {
    const response = await options.fetcher(`${apiBase}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.botToken}` },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as SlackApiResult;
    if (!response.ok || body.ok === false) {
      throw new OutboundHttpError(
        `slack ${method} failed: HTTP ${response.status}${body.error ? ` ${body.error}` : ""}`,
        response.status,
        retryAfterFromHeaders(response.headers),
        body.error,
      );
    }
    return body;
  };

  const postNew = async (text: string, adoptAsDraft: boolean): Promise<void> => {
    const requestGeneration = generation;
    const result = await call("chat.postMessage", slackDraftPostPayload(options.channel, text, options.threadTs));
    if (adoptAsDraft && requestGeneration === generation && draftTs === undefined) draftTs = result.ts;
  };

  return {
    caps: { editMs: options.editMs ?? SLACK_DRAFT_CAPS.editMs, maxChars: options.maxChars ?? SLACK_DRAFT_CAPS.maxChars },
    async upsert(text: string): Promise<void> {
      await queue.enqueue(chatKey, async () => {
        if (draftTs === undefined) await postNew(text, true);
        else await call("chat.update", slackDraftUpdatePayload(options.channel, draftTs, text));
      });
    },
    async finalize(text: string): Promise<void> {
      await queue.enqueue(chatKey, async () => {
        const finalTs = draftTs;
        draftTs = undefined;
        generation += 1;
        if (finalTs === undefined) {
          await postNew(text, false);
          return;
        }
        try {
          await call("chat.update", slackDraftUpdatePayload(options.channel, finalTs, text));
        } catch (error) {
          if (classifySlackError(error) === "stop") throw error;
          await postNew(text, false); // #92004: never silently kill the draft
        }
      });
    },
    classifyError: classifySlackError,
  };
}
