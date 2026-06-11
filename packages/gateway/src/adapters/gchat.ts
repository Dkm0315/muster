import { isPairingChallenge } from "../envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "../envelope.js";

/**
 * Google Chat adapter: PURE mappers only (no network). The gateway server
 * receives Chat app events on POST /v1/adapters/gchat and answers
 * synchronously — Google Chat renders the JSON body of the webhook response
 * as the app's message (text + cardsV2).
 */

export type GchatInbound =
  | { readonly kind: "message"; readonly message: SurfaceMessage }
  | { readonly kind: "ignored"; readonly reason: string };

interface GchatEvent {
  readonly type?: string;
  readonly token?: string;
  readonly space?: { readonly name?: string };
  readonly message?: {
    readonly name?: string;
    readonly text?: string;
    readonly argumentText?: string;
    readonly thread?: { readonly name?: string };
    readonly sender?: { readonly name?: string; readonly type?: string };
  };
}

/** Extract the verification token Google includes in legacy event payloads. */
export function gchatEventToken(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const token = (payload as GchatEvent).token;
  return typeof token === "string" ? token : undefined;
}

/** Map a Google Chat MESSAGE event to the gateway envelope. */
export function gchatEventToSurfaceMessage(payload: unknown): GchatInbound {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "ignored", reason: "payload is not an object" };
  }
  const event = payload as GchatEvent;
  if (event.type !== "MESSAGE" || !event.message) {
    return { kind: "ignored", reason: `unsupported event type: ${String(event.type)}` };
  }
  const sender = event.message.sender;
  if (sender?.type === "BOT") return { kind: "ignored", reason: "bot messages are not surfaced (echo guard)" };
  // argumentText is the message with the @app mention stripped; prefer it.
  const text = (event.message.argumentText ?? event.message.text ?? "").trim();
  if (!sender?.name || !event.space?.name || !text) {
    return { kind: "ignored", reason: "event is missing sender, space, or text" };
  }
  return {
    kind: "message",
    message: {
      surfaceId: "gchat:app",
      conversationId: event.space.name,
      senderId: sender.name,
      text,
      replyTo: event.message.thread?.name,
      raw: payload,
    },
  };
}

export interface GchatResponsePayload {
  readonly text: string;
  readonly thread?: { readonly name: string };
  readonly cardsV2?: ReadonlyArray<{
    readonly cardId: string;
    readonly card: {
      readonly sections: ReadonlyArray<{
        readonly widgets: ReadonlyArray<{
          readonly buttonList: {
            readonly buttons: ReadonlyArray<{
              readonly text: string;
              readonly onClick: {
                readonly action: {
                  readonly function: string;
                  readonly parameters: ReadonlyArray<{ readonly key: string; readonly value: string }>;
                };
              };
            }>;
          };
        }>;
      }>;
    };
  }>;
}

/** Map a gateway reply to the synchronous Chat response (cardsV2 buttons for approvals). */
export function surfaceReplyToGchatResponse(reply: SurfaceReply | PairingChallenge, threadName?: string): GchatResponsePayload {
  const thread = threadName ? { name: threadName } : undefined;
  if (isPairingChallenge(reply)) {
    return {
      text: `This sender is not paired with Muster yet. Ask an operator to run: muster pairing approve ${reply.code}`,
      thread,
    };
  }
  if (reply.approvalRequest) {
    const { runId, gateId, show } = reply.approvalRequest;
    const shown = typeof show === "string" ? show : JSON.stringify(show, null, 2);
    return {
      text: `${reply.text ? `${reply.text}\n\n` : ""}Approval required (gate "${gateId}"):\n${shown}`,
      thread,
      cardsV2: [{
        cardId: `muster-approval-${runId}`,
        card: {
          sections: [{
            widgets: [{
              buttonList: {
                buttons: [
                  {
                    text: "Approve",
                    onClick: { action: { function: "muster_approve", parameters: [{ key: "runId", value: runId }] } },
                  },
                  {
                    text: "Reject",
                    onClick: { action: { function: "muster_reject", parameters: [{ key: "runId", value: runId }] } },
                  },
                ],
              },
            }],
          }],
        },
      }],
    };
  }
  return { text: reply.text, thread };
}
