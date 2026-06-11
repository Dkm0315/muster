import { isPairingChallenge } from "../envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "../envelope.js";

/**
 * Discord Interactions adapter: PURE mappers only (no network). The gateway
 * server receives interaction webhooks on POST /v1/adapters/discord and
 * answers synchronously with an interaction response (Discord delivers the
 * response body of the webhook back to the channel). PING (type 1) must be
 * answered with PONG (type 1) for endpoint verification.
 */

// Interaction types (https://discord.com/developers/docs/interactions)
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const INTERACTION_MESSAGE_COMPONENT = 3;

// Interaction response types
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE = 4;

export type DiscordInbound =
  | { readonly kind: "pong" }
  | { readonly kind: "message"; readonly message: SurfaceMessage }
  | { readonly kind: "ignored"; readonly reason: string };

interface DiscordInteraction {
  readonly type?: number;
  readonly id?: string;
  readonly guild_id?: string;
  readonly channel_id?: string;
  readonly member?: { readonly user?: { readonly id?: string; readonly bot?: boolean } };
  readonly user?: { readonly id?: string; readonly bot?: boolean };
  readonly message?: { readonly id?: string };
  readonly data?: {
    readonly name?: string;
    readonly custom_id?: string;
    readonly options?: ReadonlyArray<{ readonly name?: string; readonly type?: number; readonly value?: unknown }>;
  };
}

/** Map a Discord interaction to the gateway envelope. PING maps to "pong". */
export function discordInteractionToInbound(payload: unknown): DiscordInbound {
  if (typeof payload !== "object" || payload === null) {
    return { kind: "ignored", reason: "payload is not an object" };
  }
  const interaction = payload as DiscordInteraction;
  if (interaction.type === INTERACTION_PING) return { kind: "pong" };
  if (interaction.type === INTERACTION_MESSAGE_COMPONENT) {
    return { kind: "ignored", reason: "component interactions are resumed via the flows API, not as messages" };
  }
  if (interaction.type !== INTERACTION_APPLICATION_COMMAND || !interaction.data) {
    return { kind: "ignored", reason: `unsupported interaction type: ${String(interaction.type)}` };
  }
  const sender = interaction.member?.user ?? interaction.user;
  if (sender?.bot) return { kind: "ignored", reason: "bot interactions are not surfaced (echo guard)" };
  if (!sender?.id || !interaction.channel_id) {
    return { kind: "ignored", reason: "interaction is missing sender or channel" };
  }
  const text = (interaction.data.options ?? [])
    .map((option) => option.value)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim();
  if (!text) return { kind: "ignored", reason: "command carries no text option" };
  return {
    kind: "message",
    message: {
      surfaceId: `discord:${interaction.guild_id ?? "dm"}`,
      conversationId: interaction.channel_id,
      senderId: sender.id,
      text,
      replyTo: interaction.message?.id,
      raw: payload,
    },
  };
}

interface DiscordComponentRow {
  readonly type: 1;
  readonly components: ReadonlyArray<{
    readonly type: 2;
    readonly style: number;
    readonly label: string;
    readonly custom_id: string;
  }>;
}

export interface DiscordInteractionResponse {
  readonly type: number;
  readonly data?: { readonly content: string; readonly components?: readonly DiscordComponentRow[] };
}

export const DISCORD_PONG: DiscordInteractionResponse = { type: RESPONSE_PONG };

function approvalComponents(runId: string): readonly DiscordComponentRow[] {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Approve", custom_id: `muster:approve:${runId}` },
      { type: 2, style: 4, label: "Reject", custom_id: `muster:reject:${runId}` },
    ],
  }];
}

function replyContent(reply: SurfaceReply | PairingChallenge): { content: string; components?: readonly DiscordComponentRow[] } {
  if (isPairingChallenge(reply)) {
    return { content: `This sender is not paired with Muster yet. Ask an operator to run: \`muster pairing approve ${reply.code}\`` };
  }
  if (reply.approvalRequest) {
    const { runId, gateId, show } = reply.approvalRequest;
    const shown = typeof show === "string" ? show : JSON.stringify(show, null, 2);
    return {
      content: `${reply.text ? `${reply.text}\n\n` : ""}Approval required (gate \`${gateId}\`):\n\`\`\`${shown}\`\`\``,
      components: approvalComponents(runId),
    };
  }
  return { content: reply.text };
}

/** Map a gateway reply (or pairing challenge) to a synchronous interaction response. */
export function surfaceReplyToDiscordInteractionResponse(reply: SurfaceReply | PairingChallenge): DiscordInteractionResponse {
  return { type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE, data: replyContent(reply) };
}

export interface DiscordChannelMessagePayload {
  readonly content: string;
  readonly components?: readonly DiscordComponentRow[];
}

/** Map a gateway reply to a REST channel-message payload (POST /channels/{id}/messages). */
export function surfaceReplyToDiscordChannelMessage(reply: SurfaceReply | PairingChallenge): DiscordChannelMessagePayload {
  return replyContent(reply);
}
