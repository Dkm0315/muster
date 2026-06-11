import { createHmac, timingSafeEqual } from "node:crypto";
import { isPairingChallenge } from "../envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "../envelope.js";

/**
 * Microsoft Teams outgoing-webhook adapter: PURE mappers only (no network).
 * Teams posts a message activity to POST /v1/adapters/teams (signed with an
 * HMAC security token) and renders the JSON body of the webhook response as
 * the bot's reply (plain text or an Adaptive Card for approvals).
 */

export type TeamsInbound =
  | { readonly kind: "message"; readonly message: SurfaceMessage }
  | { readonly kind: "ignored"; readonly reason: string };

interface TeamsActivity {
  readonly type?: string;
  readonly id?: string;
  readonly text?: string;
  readonly from?: { readonly id?: string; readonly name?: string };
  readonly conversation?: { readonly id?: string };
  readonly channelData?: { readonly tenant?: { readonly id?: string } };
}

/** Strip the <at>Bot</at> mention markup Teams prefixes onto outgoing-webhook text. */
function stripMentions(text: string): string {
  return text.replace(/<at>.*?<\/at>/g, "").trim();
}

/** Map a Teams message activity to the gateway envelope. */
export function teamsActivityToSurfaceMessage(payload: unknown): TeamsInbound {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "ignored", reason: "payload is not an object" };
  }
  const activity = payload as TeamsActivity;
  if (activity.type !== "message") {
    return { kind: "ignored", reason: `unsupported activity type: ${String(activity.type)}` };
  }
  const text = typeof activity.text === "string" ? stripMentions(activity.text) : "";
  if (!activity.from?.id || !activity.conversation?.id || !text) {
    return { kind: "ignored", reason: "activity is missing from.id, conversation.id, or text" };
  }
  return {
    kind: "message",
    message: {
      surfaceId: `teams:${activity.channelData?.tenant?.id ?? "tenant"}`,
      conversationId: activity.conversation.id,
      senderId: activity.from.id,
      text,
      replyTo: activity.id,
      raw: payload,
    },
  };
}

/**
 * Validate the outgoing-webhook HMAC: Authorization header carries
 * "HMAC <base64(hmac-sha256(rawBody, base64-decoded secret))>".
 */
export function teamsHmacIsValid(rawBody: string, authorizationHeader: string | undefined, secretBase64: string): boolean {
  const presented = authorizationHeader?.startsWith("HMAC ") ? authorizationHeader.slice("HMAC ".length) : "";
  const expected = createHmac("sha256", Buffer.from(secretBase64, "base64")).update(rawBody, "utf8").digest("base64");
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface TeamsResponseActivity {
  readonly type: "message";
  readonly text?: string;
  readonly attachments?: ReadonlyArray<{
    readonly contentType: "application/vnd.microsoft.card.adaptive";
    readonly content: {
      readonly type: "AdaptiveCard";
      readonly version: string;
      readonly body: ReadonlyArray<{ readonly type: "TextBlock"; readonly text: string; readonly wrap: boolean }>;
      readonly actions: ReadonlyArray<{ readonly type: "Action.Submit"; readonly title: string; readonly data: { readonly musterAction: string } }>;
    };
  }>;
}

/** Map a gateway reply to the synchronous Teams response (Adaptive Card for approvals). */
export function surfaceReplyToTeamsActivity(reply: SurfaceReply | PairingChallenge): TeamsResponseActivity {
  if (isPairingChallenge(reply)) {
    return {
      type: "message",
      text: `This sender is not paired with Muster yet. Ask an operator to run: muster pairing approve ${reply.code}`,
    };
  }
  if (reply.approvalRequest) {
    const { runId, gateId, show } = reply.approvalRequest;
    const shown = typeof show === "string" ? show : JSON.stringify(show, null, 2);
    return {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.5",
          body: [
            { type: "TextBlock", text: `${reply.text ? `${reply.text}\n\n` : ""}Approval required (gate "${gateId}")`, wrap: true },
            { type: "TextBlock", text: shown, wrap: true },
          ],
          actions: [
            { type: "Action.Submit", title: "Approve", data: { musterAction: `muster:approve:${runId}` } },
            { type: "Action.Submit", title: "Reject", data: { musterAction: `muster:reject:${runId}` } },
          ],
        },
      }],
    };
  }
  return { type: "message", text: reply.text };
}
