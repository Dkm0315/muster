/**
 * @dkm0315/surface — zero-dependency, framework-agnostic browser client for
 * the Muster surface gateway. Works in React/Vue/Svelte/plain script tags;
 * everything goes through fetch against POST /v1/messages.
 *
 * Types are declared locally (not imported from @dkm0315/gateway) so the
 * package ships with zero dependencies; they mirror the gateway envelope.
 */

export interface SurfaceArtifact {
  readonly name: string;
  readonly mime: string;
  readonly path: string;
}

export interface ApprovalRequest {
  readonly runId: string;
  readonly gateId: string;
  readonly show: unknown;
  readonly options: readonly ["approve", "reject"];
}

export interface SurfaceReply {
  readonly text: string;
  readonly artifacts?: readonly SurfaceArtifact[];
  readonly approvalRequest?: ApprovalRequest;
}

export interface PairingChallenge {
  readonly status: "pairing_required";
  readonly code: string;
}

export type SendResult = SurfaceReply | PairingChallenge;

/** Structural fetch type so the package needs neither DOM lib nor node types. */
export type Fetcher = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface CreateSurfaceOptions {
  /** Gateway base URL, e.g. "http://localhost:7460" */
  readonly url: string;
  /** Gateway bearer token from .muster/gateway.json */
  readonly token: string;
  /** e.g. "web:app-7" */
  readonly surfaceId: string;
  readonly senderId: string;
  /** Default conversation lane; defaults to "default". */
  readonly conversationId?: string;
  /** Injectable for tests / non-browser runtimes; defaults to globalThis.fetch. */
  readonly fetcher?: Fetcher;
}

export interface Surface {
  send(text: string, conversationId?: string): Promise<SendResult>;
  onApproval(callback: (request: ApprovalRequest) => void): () => void;
  approve(runId: string): Promise<unknown>;
  reject(runId: string): Promise<unknown>;
}

export function isPairingRequired(result: SendResult): result is PairingChallenge {
  return (result as PairingChallenge).status === "pairing_required";
}

export function createSurface(options: CreateSurfaceOptions): Surface {
  const base = options.url.replace(/\/$/, "");
  const fetcher: Fetcher = options.fetcher ?? ((globalThis as { fetch?: Fetcher }).fetch as Fetcher);
  if (!fetcher) throw new Error("No fetch available. Pass options.fetcher or run in an environment with global fetch.");
  const approvalCallbacks = new Set<(request: ApprovalRequest) => void>();

  async function post(path: string, body?: unknown): Promise<unknown> {
    const response = await fetcher(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `HTTP ${response.status}`;
      throw new Error(`Gateway request failed: ${detail}`);
    }
    return payload;
  }

  return {
    async send(text, conversationId) {
      const result = await post("/v1/messages", {
        surfaceId: options.surfaceId,
        conversationId: conversationId ?? options.conversationId ?? "default",
        senderId: options.senderId,
        text,
      }) as SendResult;
      const approvalRequest = (result as SurfaceReply).approvalRequest;
      if (approvalRequest) for (const callback of approvalCallbacks) callback(approvalRequest);
      return result;
    },
    onApproval(callback) {
      approvalCallbacks.add(callback);
      return () => approvalCallbacks.delete(callback);
    },
    approve: (runId) => post(`/v1/flows/${encodeURIComponent(runId)}/approve`),
    reject: (runId) => post(`/v1/flows/${encodeURIComponent(runId)}/reject`),
  };
}
