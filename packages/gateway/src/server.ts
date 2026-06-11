import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { executeRun, resumeFlow } from "@musterhq/core";
import type { FlowToolRegistry, MusterConfig } from "@musterhq/core";
import { conversationSessionId, parseSurfaceMessage } from "./envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "./envelope.js";
import { pairingScopes, requestPairing, resolvePairing } from "./pairing.js";
import type { GatewayConfig } from "./gateway-config.js";

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

function defaultRegistry(): FlowToolRegistry {
  return { echo: async (args) => args };
}

/**
 * The single governed entry point every surface goes through:
 * pairing check -> scoped run (pairing + user + conversation-session lanes)
 * -> per-surface token accounting. Exported so adapters and tests can call
 * it without HTTP.
 */
export async function handleSurfaceMessage(
  message: SurfaceMessage,
  options: Pick<GatewayServerOptions, "config" | "cwd">,
): Promise<SurfaceReply | PairingChallenge> {
  const cwd = options.cwd ?? process.cwd();
  const paired = await resolvePairing(message.surfaceId, message.senderId, cwd);
  if (!paired) {
    const pending = await requestPairing(message.surfaceId, message.senderId, cwd);
    return { status: "pairing_required", code: pending.code };
  }
  const outcome = await executeRun(options.config, {
    prompt: message.text,
    cwd,
    surfaceId: message.surfaceId,
    scopes: [
      ...pairingScopes(paired),
      { kind: "session", id: conversationSessionId(message) },
    ],
  });
  if (outcome.episode.outcome?.kind !== "completed") {
    throw new Error(outcome.episode.outcome?.detail ?? "Run failed");
  }
  return { text: outcome.episode.responseText };
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
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

type AdapterHandler = (body: string, options: Required<Pick<GatewayServerOptions, "config" | "cwd" | "gateway" | "fetcher" | "log">>) => Promise<unknown>;

/** Registered by adapters (commit 2); keyed by adapter name in the URL. */
export const adapterRoutes: Record<string, AdapterHandler> = {};

async function route(request: IncomingMessage, response: ServerResponse, options: GatewayServerOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const url = new URL(request.url ?? "/", "http://gateway.local");

  if (request.method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { ok: true, service: "muster-gateway" });
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
  const server = createServer((request, response) => {
    route(request, response, options).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      log(`error ${request.method} ${request.url}: ${detail}`);
      if (!response.headersSent) sendJson(response, 500, { error: detail });
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
