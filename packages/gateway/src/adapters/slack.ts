import { isPairingChallenge } from "../envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "../envelope.js";

/**
 * Slack Events API adapter: PURE mappers only (no network). The gateway
 * server receives events on POST /v1/adapters/slack and posts replies to
 * https://slack.com/api/chat.postMessage with the bot token.
 */

export type SlackInbound =
  | { readonly kind: "url_verification"; readonly challenge: string }
  | { readonly kind: "message"; readonly message: SurfaceMessage }
  | { readonly kind: "ignored"; readonly reason: string };

interface SlackEnvelope {
  readonly type?: string;
  readonly challenge?: string;
  readonly team_id?: string;
  readonly event?: {
    readonly type?: string;
    readonly subtype?: string;
    readonly bot_id?: string;
    readonly user?: string;
    readonly text?: string;
    readonly channel?: string;
    readonly ts?: string;
    readonly thread_ts?: string;
  };
}

/** Map a Slack Events API request body to the gateway envelope. */
export function slackEventToSurfaceMessage(payload: unknown): SlackInbound {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "ignored", reason: "payload is not an object" };
  }
  const envelope = payload as SlackEnvelope;
  if (envelope.type === "url_verification") {
    if (typeof envelope.challenge !== "string") return { kind: "ignored", reason: "url_verification without challenge" };
    return { kind: "url_verification", challenge: envelope.challenge };
  }
  if (envelope.type !== "event_callback" || !envelope.event) {
    return { kind: "ignored", reason: `unsupported envelope type: ${String(envelope.type)}` };
  }
  const event = envelope.event;
  if (event.bot_id || event.subtype === "bot_message") {
    return { kind: "ignored", reason: "bot messages are not surfaced (echo guard)" };
  }
  if (event.type !== "message" && event.type !== "app_mention") {
    return { kind: "ignored", reason: `unsupported event type: ${String(event.type)}` };
  }
  if (!event.user || !event.channel || typeof event.text !== "string" || !event.text.trim()) {
    return { kind: "ignored", reason: "event is missing user, channel, or text" };
  }
  return {
    kind: "message",
    message: {
      surfaceId: `slack:${envelope.team_id ?? "unknown-team"}`,
      conversationId: event.channel,
      senderId: event.user,
      text: event.text,
      replyTo: event.thread_ts ?? event.ts,
      raw: payload,
    },
  };
}

export interface SlackPostMessagePayload {
  readonly channel: string;
  readonly text: string;
  readonly thread_ts?: string;
  readonly blocks?: readonly unknown[];
}

/** Map a gateway reply (or pairing challenge) to a chat.postMessage payload. */
export function surfaceReplyToSlackPost(
  reply: SurfaceReply | PairingChallenge,
  channel: string,
  threadTs?: string,
): SlackPostMessagePayload {
  if (isPairingChallenge(reply)) {
    return {
      channel,
      thread_ts: threadTs,
      text: `This sender is not paired with Muster yet. Ask an operator to run: \`muster pairing approve ${reply.code}\``,
    };
  }
  if (reply.approvalRequest) {
    const { runId, gateId, show } = reply.approvalRequest;
    const shown = typeof show === "string" ? show : JSON.stringify(show, null, 2);
    return {
      channel,
      thread_ts: threadTs,
      text: `Approval required (gate "${gateId}", run ${runId})`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${reply.text ? `${reply.text}\n\n` : ""}*Approval required* (gate \`${gateId}\`):\n\`\`\`${shown}\`\`\`` },
        },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "muster_approve", value: runId },
            { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "muster_reject", value: runId },
          ],
        },
      ],
    };
  }
  return { channel, thread_ts: threadTs, text: reply.text };
}
