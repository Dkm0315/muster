import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createStreamEventChannel, executeRun, extractMediaTags, resumeFlow, runDraftLoop, StreamRun } from "@musterhq/core";
import type { DraftSink, FlowToolRegistry, MusterConfig } from "@musterhq/core";
import { conversationSessionId, isPairingChallenge, parseSurfaceMessage } from "./envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "./envelope.js";
import { pairingScopes, requestPairing, resolvePairing } from "./pairing.js";
import type { GatewayConfig } from "./gateway-config.js";
import { surfaceReplyToTelegramSend, telegramUpdateToSurfaceMessage } from "./adapters/telegram.js";
import { slackEventToSurfaceMessage, slackSignatureIsValid, surfaceReplyToSlackPost } from "./adapters/slack.js";
import { DISCORD_PONG, discordInteractionToInbound, discordSignatureIsValid, surfaceReplyToDiscordInteractionResponse } from "./adapters/discord.js";
import { surfaceReplyToWhatsAppSend, whatsAppVerifyChallenge, whatsAppWebhookToSurfaceMessages } from "./adapters/whatsapp.js";
import { gchatEventToken, gchatEventToSurfaceMessage, surfaceReplyToGchatResponse } from "./adapters/gchat.js";
import { surfaceReplyToTeamsActivity, teamsActivityToSurfaceMessage, teamsHmacIsValid } from "./adapters/teams.js";
import { createOutboundQueue, createSlackDraftSink, createTelegramDraftSink } from "./streaming.js";
import type { OutboundQueue } from "./streaming.js";

/**
 * Slice 1 gateway: HTTP-only (node:http, no ws). Surfaces that need streaming
 * receive the buffered reply; long-poll/streaming lands in a later slice.
 */

export interface GatewayServerOptions {
  readonly config: MusterConfig;
  readonly gateway: GatewayConfig;
  readonly cwd?: string;
  /** Tool registry used when resuming gated flow runs. Defaults to `echo`. */
  readonly registry?: FlowToolRegistry;
  /** Outbound HTTP for adapter sends; injectable for tests. */
  readonly fetcher?: typeof fetch;
  readonly log?: (line: string) => void;
}

export interface RunningGateway {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

/** Error that carries an HTTP status so adapter handlers can reject with e.g. 401. */
export class GatewayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

function defaultRegistry(): FlowToolRegistry {
  return { echo: async (args) => args };
}

/** Emit an "adapter is unauthenticated" warning at most once per adapter per process. */
const unauthenticatedWarned = new Set<string>();
function warnUnauthenticatedOnce(adapter: string, log: (line: string) => void): void {
  if (unauthenticatedWarned.has(adapter)) return;
  unauthenticatedWarned.add(adapter);
  log(`WARNING: ${adapter} webhook is UNAUTHENTICATED — no secret configured. Anyone who can reach this endpoint can forge ${adapter} events. Configure it in .muster/gateway.json.`);
}

/** Test-only: reset the once-per-process warning latch so each test observes the first warning. */
export function resetAdapterAuthWarnings(): void {
  unauthenticatedWarned.clear();
}

/**
 * The single governed entry point every surface goes through:
 * pairing check -> scoped run (pairing + user + conversation-session lanes)
 * -> per-surface token accounting. Exported so adapters and tests can call
 * it without HTTP.
 */
const idempotencyCache = new Map<string, { at: number; reply: SurfaceReply | PairingChallenge }>();
const IDEMPOTENCY_TTL_MS = 10 * 60_000;

/** Duplicate deliveries (webhook retries) with the same key return the cached reply. */
export function idempotencyLookup(key: string | undefined): (SurfaceReply | PairingChallenge) | undefined {
  if (!key) return undefined;
  const hit = idempotencyCache.get(key);
  if (!hit || Date.now() - hit.at > IDEMPOTENCY_TTL_MS) return undefined;
  return hit.reply;
}

export function idempotencyStore(key: string | undefined, reply: SurfaceReply | PairingChallenge): void {
  if (!key) return;
  if (idempotencyCache.size > 1000) {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [cachedKey, value] of idempotencyCache) {
      if (value.at < cutoff) idempotencyCache.delete(cachedKey);
    }
  }
  idempotencyCache.set(key, { at: Date.now(), reply });
}

export async function handleSurfaceMessage(
  message: SurfaceMessage,
  options: Pick<GatewayServerOptions, "config" | "cwd"> & {
    /**
     * Channel draft sink. When provided AND message.stream === "draft", the
     * reply is streamed as a live-edited draft through the core draft loop;
     * the returned SurfaceReply still carries the final text so callers can
     * log it, but it has already been delivered by the sink.
     */
    readonly sink?: DraftSink;
  },
): Promise<SurfaceReply | PairingChallenge> {
  const cwd = options.cwd ?? process.cwd();
  const paired = await resolvePairing(message.surfaceId, message.senderId, cwd);
  if (!paired) {
    const pending = await requestPairing(message.surfaceId, message.senderId, cwd);
    return { status: "pairing_required", code: pending.code };
  }
  const streaming = options.sink !== undefined && message.stream === "draft";
  const channel = streaming ? createStreamEventChannel() : undefined;
  const streamRun = channel ? new StreamRun({ onEvent: channel.push }) : undefined;
  const draftLoop = streaming && channel && options.sink
    ? runDraftLoop(channel.events, options.sink)
    : undefined;
  try {
    const outcome = await executeRun(options.config, {
      prompt: message.text,
      cwd,
      surfaceId: message.surfaceId,
      scopes: [
        ...pairingScopes(paired),
        { kind: "session", id: conversationSessionId(message) },
      ],
      onDelta: streamRun ? (text) => {
        if (streamRun.state === "streaming") streamRun.pushDelta(text);
      } : undefined,
    });
    if (outcome.episode.outcome?.kind !== "completed") {
      throw new Error(outcome.episode.outcome?.detail ?? "Run failed");
    }
    const extracted = extractMediaTags(outcome.episode.responseText);
    // finalize() is the only emitter of the final event (OpenClaw #33492).
    streamRun?.finalize(extracted.text);
    return {
      text: extracted.text,
      ...(extracted.media.length
        ? { artifacts: extracted.media.map((item) => ({ name: item.name, mime: "application/octet-stream", path: item.ref })) }
        : {}),
    };
  } finally {
    channel?.close();
    if (draftLoop) await draftLoop;
  }
}

async function readBody(request: IncomingMessage, limitBytes = 1_000_000): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limitBytes) throw new Error("Request body too large.");
  }
  return body;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function bearerTokenMatches(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return headerEquals(presented, expected);
}

/** Constant-time string compare for header secrets (returns false on undefined/length mismatch). */
function headerEquals(presented: string | undefined, expected: string): boolean {
  const left = Buffer.from(presented ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

interface AdapterContext {
  readonly config: MusterConfig;
  readonly gateway: GatewayConfig;
  readonly cwd: string;
  readonly fetcher: typeof fetch;
  readonly log: (line: string) => void;
  /** Inbound request headers (lowercased), for adapters that verify signatures. */
  readonly headers: Record<string, string | string[] | undefined>;
  /** Shared per-chat outbound queue (retry_after backoff) for draft streaming. */
  readonly queue: OutboundQueue;
}

/**
 * Telegram webhook: update JSON in, sendMessage out. The adapter module is a
 * pure mapper; only this thin handler touches the network. Processing is
 * synchronous (reply is sent before the webhook is acked) — Telegram retries
 * on timeout, which is acceptable for slice 1. When telegram.secretToken is
 * configured, the X-Telegram-Bot-Api-Secret-Token header must match it
 * (constant-time) or the webhook is rejected with 401; otherwise we warn once
 * that the Telegram webhook is unauthenticated.
 */
async function handleTelegramWebhook(body: string, context: AdapterContext): Promise<unknown> {
  const botToken = context.gateway.telegram?.botToken;
  if (!botToken) throw new Error("Telegram adapter not configured. Add telegram.botToken to .muster/gateway.json.");
  const secretToken = context.gateway.telegram?.secretToken;
  if (secretToken) {
    const presented = context.headers["x-telegram-bot-api-secret-token"];
    if (!headerEquals(typeof presented === "string" ? presented : undefined, secretToken)) {
      throw new GatewayHttpError(401, "Telegram secret token mismatch.");
    }
  } else {
    warnUnauthenticatedOnce("telegram", context.log);
  }
  const mapped = telegramUpdateToSurfaceMessage(JSON.parse(body));
  if (!mapped) return { ok: true, ignored: "not a text message update" };
  if (context.gateway.telegram?.stream === "draft") {
    const message: SurfaceMessage = { ...mapped, stream: "draft" };
    const sink = createTelegramDraftSink({
      botToken,
      chatId: message.conversationId,
      fetcher: context.fetcher,
      queue: context.queue,
    });
    const reply = await handleSurfaceMessage(message, { ...context, sink });
    // A streamed reply was already delivered draft-by-draft by the sink;
    // pairing challenges fall through to the normal buffered send below.
    if (!isPairingChallenge(reply)) return { ok: true, streamed: true };
    const challengePayload = surfaceReplyToTelegramSend(reply, message.conversationId);
    const challengeResponse = await context.fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(challengePayload),
    });
    if (!challengeResponse.ok) context.log(`telegram sendMessage failed: HTTP ${challengeResponse.status}`);
    return { ok: true };
  }
  const message = mapped;
  const reply = await handleSurfaceMessage(message, context);
  const payload = surfaceReplyToTelegramSend(reply, message.conversationId);
  const response = await context.fetcher(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) context.log(`telegram sendMessage failed: HTTP ${response.status}`);
  return { ok: true };
}

/**
 * Slack Events API webhook: handles url_verification challenges, ignores bot
 * echoes, and posts replies via chat.postMessage (approval requests render as
 * Block Kit buttons). Synchronous processing; see slice-1 caveat above. When
 * slack.signingSecret is configured the X-Slack-Signature / -Request-Timestamp
 * headers are verified against the RAW body (before any JSON parsing) and a
 * mismatch (or a >5-min-old timestamp) is rejected with 401. If no signing
 * secret is configured we warn once that Slack is unauthenticated.
 */
async function handleSlackWebhook(body: string, context: AdapterContext): Promise<unknown> {
  const botToken = context.gateway.slack?.botToken;
  if (!botToken) throw new Error("Slack adapter not configured. Add slack.botToken to .muster/gateway.json.");
  const signingSecret = context.gateway.slack?.signingSecret;
  if (signingSecret) {
    const signature = context.headers["x-slack-signature"];
    const timestamp = context.headers["x-slack-request-timestamp"];
    const valid = slackSignatureIsValid(
      typeof timestamp === "string" ? timestamp : undefined,
      body,
      typeof signature === "string" ? signature : undefined,
      signingSecret,
    );
    if (!valid) throw new GatewayHttpError(401, "Slack signature verification failed.");
  } else {
    warnUnauthenticatedOnce("slack", context.log);
  }
  const inbound = slackEventToSurfaceMessage(JSON.parse(body));
  if (inbound.kind === "url_verification") return { challenge: inbound.challenge };
  if (inbound.kind === "ignored") return { ok: true, ignored: inbound.reason };
  if (context.gateway.slack?.stream === "draft") {
    const message: SurfaceMessage = { ...inbound.message, stream: "draft" };
    const sink = createSlackDraftSink({
      botToken,
      channel: message.conversationId,
      threadTs: message.replyTo,
      fetcher: context.fetcher,
      queue: context.queue,
    });
    const reply = await handleSurfaceMessage(message, { ...context, sink });
    if (!isPairingChallenge(reply)) return { ok: true, streamed: true };
    const challengePayload = surfaceReplyToSlackPost(reply, message.conversationId, message.replyTo);
    const challengeResponse = await context.fetcher("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${botToken}` },
      body: JSON.stringify(challengePayload),
    });
    if (!challengeResponse.ok) context.log(`slack chat.postMessage failed: HTTP ${challengeResponse.status}`);
    return { ok: true };
  }
  const reply = await handleSurfaceMessage(inbound.message, context);
  const payload = surfaceReplyToSlackPost(reply, inbound.message.conversationId, inbound.message.replyTo);
  const response = await context.fetcher("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${botToken}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) context.log(`slack chat.postMessage failed: HTTP ${response.status}`);
  return { ok: true };
}

/**
 * Discord interactions webhook: PING (type 1) is answered with PONG (type 1)
 * for endpoint verification; slash commands run through the governed entry
 * point and the reply goes back synchronously as the interaction response
 * (approvals render as button components). When discord.publicKey is
 * configured, the X-Signature-Ed25519/X-Signature-Timestamp headers are
 * verified against the RAW body (before any JSON parsing) and a mismatch is
 * rejected with 401, as Discord's endpoint validation requires.
 */
async function handleDiscordWebhook(body: string, context: AdapterContext): Promise<unknown> {
  if (!context.gateway.discord?.botToken) {
    throw new Error("Discord adapter not configured. Add discord.botToken to .muster/gateway.json.");
  }
  const publicKey = context.gateway.discord.publicKey;
  if (publicKey) {
    const signature = context.headers["x-signature-ed25519"];
    const timestamp = context.headers["x-signature-timestamp"];
    const valid = discordSignatureIsValid(
      body,
      typeof signature === "string" ? signature : undefined,
      typeof timestamp === "string" ? timestamp : undefined,
      publicKey,
    );
    if (!valid) throw new GatewayHttpError(401, "Discord ed25519 signature verification failed.");
  }
  const inbound = discordInteractionToInbound(JSON.parse(body));
  if (inbound.kind === "pong") return DISCORD_PONG;
  if (inbound.kind === "ignored") return { ok: true, ignored: inbound.reason };
  const reply = await handleSurfaceMessage(inbound.message, context);
  return surfaceReplyToDiscordInteractionResponse(reply);
}

/**
 * WhatsApp Cloud API webhook: notification batches in (entry[].changes[]),
 * outbound replies via POST graph.facebook.com/<ver>/<phoneNumberId>/messages.
 * The GET hub.challenge verification handshake is handled separately in route().
 */
async function handleWhatsAppWebhook(body: string, context: AdapterContext): Promise<unknown> {
  const whatsapp = context.gateway.whatsapp;
  if (!whatsapp?.accessToken || !whatsapp.phoneNumberId) {
    throw new Error("WhatsApp adapter not configured. Add whatsapp.{accessToken,verifyToken,phoneNumberId} to .muster/gateway.json.");
  }
  const messages = whatsAppWebhookToSurfaceMessages(JSON.parse(body));
  if (messages.length === 0) return { ok: true, ignored: "no text messages in notification" };
  for (const message of messages) {
    const reply = await handleSurfaceMessage(message, context);
    const payload = surfaceReplyToWhatsAppSend(reply, message.conversationId);
    const version = whatsapp.apiVersion ?? "v19.0";
    const response = await context.fetcher(`https://graph.facebook.com/${version}/${whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${whatsapp.accessToken}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) context.log(`whatsapp send failed: HTTP ${response.status}`);
  }
  return { ok: true };
}

/**
 * Google Chat webhook: MESSAGE events run through the governed entry point;
 * the reply is returned synchronously (Chat renders the response body), with
 * cardsV2 buttons for approvals. If gchat.verificationToken is configured the
 * legacy event token is checked.
 */
async function handleGchatWebhook(body: string, context: AdapterContext): Promise<unknown> {
  if (!context.gateway.gchat) {
    throw new Error("Google Chat adapter not configured. Add a gchat section to .muster/gateway.json.");
  }
  const payload = JSON.parse(body);
  const expectedToken = context.gateway.gchat.verificationToken;
  if (expectedToken && gchatEventToken(payload) !== expectedToken) {
    throw new Error("Google Chat verification token mismatch.");
  }
  const inbound = gchatEventToSurfaceMessage(payload);
  if (inbound.kind === "ignored") return { ok: true, ignored: inbound.reason };
  const reply = await handleSurfaceMessage(inbound.message, context);
  return surfaceReplyToGchatResponse(reply, inbound.message.replyTo);
}

/**
 * Teams outgoing webhook: message activities run through the governed entry
 * point; the reply is returned synchronously (text, or an Adaptive Card for
 * approvals). If teams.hmacSecret is configured the Authorization HMAC is
 * validated against the raw body.
 */
async function handleTeamsWebhook(body: string, context: AdapterContext): Promise<unknown> {
  if (!context.gateway.teams) {
    throw new Error("Teams adapter not configured. Add a teams section to .muster/gateway.json.");
  }
  const secret = context.gateway.teams.hmacSecret;
  if (secret) {
    const header = context.headers.authorization;
    if (!teamsHmacIsValid(body, typeof header === "string" ? header : undefined, secret)) {
      throw new Error("Teams HMAC signature mismatch.");
    }
  }
  const inbound = teamsActivityToSurfaceMessage(JSON.parse(body));
  if (inbound.kind === "ignored") return { ok: true, ignored: inbound.reason };
  const reply = await handleSurfaceMessage(inbound.message, context);
  return surfaceReplyToTeamsActivity(reply);
}

type AdapterHandler = (body: string, context: AdapterContext) => Promise<unknown>;

const adapterRoutes: Record<string, AdapterHandler> = {
  telegram: handleTelegramWebhook,
  slack: handleSlackWebhook,
  discord: handleDiscordWebhook,
  whatsapp: handleWhatsAppWebhook,
  gchat: handleGchatWebhook,
  teams: handleTeamsWebhook,
};

async function route(request: IncomingMessage, response: ServerResponse, options: GatewayServerOptions, queue: OutboundQueue): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const url = new URL(request.url ?? "/", "http://gateway.local");

  if (request.method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { ok: true, service: "muster-gateway" });
    return;
  }

  // WhatsApp Cloud API GET verification handshake (hub.challenge echo).
  if (request.method === "GET" && url.pathname === "/v1/adapters/whatsapp") {
    const verifyToken = options.gateway.whatsapp?.verifyToken;
    if (!verifyToken) {
      sendJson(response, 500, { error: "WhatsApp adapter not configured. Add whatsapp.verifyToken to .muster/gateway.json." });
      return;
    }
    const challenge = whatsAppVerifyChallenge({
      mode: url.searchParams.get("hub.mode") ?? undefined,
      verifyToken: url.searchParams.get("hub.verify_token") ?? undefined,
      challenge: url.searchParams.get("hub.challenge") ?? undefined,
    }, verifyToken);
    if (challenge === undefined) {
      sendJson(response, 403, { error: "WhatsApp verification failed: mode or verify token mismatch." });
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(challenge);
    return;
  }

  const adapterMatch = url.pathname.match(/^\/v1\/adapters\/([a-z0-9-]+)$/);
  if (request.method === "POST" && adapterMatch) {
    const handler = adapterRoutes[adapterMatch[1]];
    if (!handler) {
      sendJson(response, 404, { error: `Unknown adapter: ${adapterMatch[1]}` });
      return;
    }
    const body = await readBody(request);
    const result = await handler(body, {
      config: options.config,
      gateway: options.gateway,
      cwd,
      fetcher: options.fetcher ?? fetch,
      log: options.log ?? (() => {}),
      headers: request.headers,
      queue,
    });
    sendJson(response, 200, result ?? { ok: true });
    return;
  }

  // Everything below requires the gateway bearer token.
  if (!bearerTokenMatches(request, options.gateway.token)) {
    sendJson(response, 401, { error: "Unauthorized. Send Authorization: Bearer <gateway token>." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/messages") {
    const body = await readBody(request);
    let message: SurfaceMessage;
    try {
      message = parseSurfaceMessage(JSON.parse(body));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const reply = await handleSurfaceMessage(message, { config: options.config, cwd });
    sendJson(response, 200, reply);
    return;
  }

  const flowMatch = url.pathname.match(/^\/v1\/flows\/([A-Za-z0-9_-]+)\/(approve|reject)$/);
  if (request.method === "POST" && flowMatch) {
    const [, runId, action] = flowMatch;
    const result = await resumeFlow(runId, {
      approve: action === "approve",
      config: options.config,
      registry: options.registry ?? defaultRegistry(),
      cwd,
    });
    sendJson(response, 200, {
      runId: result.runId,
      flowId: result.flowId,
      status: result.status,
      gateId: result.gateId,
      show: result.show,
      error: result.error,
    });
    return;
  }

  sendJson(response, 404, { error: `No route: ${request.method} ${url.pathname}` });
}

export function startGatewayServer(options: GatewayServerOptions, port = 0): Promise<RunningGateway> {
  const log = options.log ?? (() => {});
  // One outbound queue per gateway: chat keys share retry_after backoff state.
  const queue = createOutboundQueue();
  const server = createServer((request, response) => {
    route(request, response, options, queue).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      const status = error instanceof GatewayHttpError ? error.status : 500;
      log(`error ${request.method} ${request.url}: ${detail}`);
      if (!response.headersSent) sendJson(response, status, { error: detail });
      else response.end();
    });
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      log(`muster gateway listening on http://127.0.0.1:${boundPort}`);
      resolvePromise({
        port: boundPort,
        server,
        close: () => new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}
