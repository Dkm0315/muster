import { isPairingChallenge } from "../envelope.js";
import type { PairingChallenge, SurfaceMessage, SurfaceReply } from "../envelope.js";

/**
 * Telegram Bot API adapter: PURE mappers only (no network). The gateway
 * server receives webhook updates on POST /v1/adapters/telegram and sends
 * outbound payloads to https://api.telegram.org/bot<token>/sendMessage.
 */

export const TELEGRAM_SURFACE_ID = "telegram:bot";

interface TelegramUpdate {
  readonly update_id?: number;
  readonly message?: {
    readonly message_id?: number;
    readonly from?: { readonly id?: number | string };
    readonly chat?: { readonly id?: number | string };
    readonly text?: string;
    readonly caption?: string;
    readonly reply_to_message?: { readonly message_id?: number };
  };
}

/** Map a Telegram update to the gateway envelope. Non-text updates map to undefined. */
export function telegramUpdateToSurfaceMessage(update: unknown): SurfaceMessage | undefined {
  if (typeof update !== "object" || update === null) return undefined;
  const message = (update as TelegramUpdate).message;
  if (!message?.chat?.id || !message.from?.id) return undefined;
  const text = message.text ?? message.caption;
  if (typeof text !== "string" || !text.trim()) return undefined;
  return {
    surfaceId: TELEGRAM_SURFACE_ID,
    conversationId: String(message.chat.id),
    senderId: String(message.from.id),
    text,
    replyTo: message.reply_to_message?.message_id !== undefined ? String(message.reply_to_message.message_id) : undefined,
    raw: update,
  };
}

export interface TelegramSendMessagePayload {
  readonly chat_id: string;
  readonly text: string;
  readonly reply_markup?: {
    readonly inline_keyboard: ReadonlyArray<ReadonlyArray<{ readonly text: string; readonly callback_data: string }>>;
  };
}

/** Map a gateway reply (or pairing challenge) to a Bot API sendMessage payload. */
export function surfaceReplyToTelegramSend(reply: SurfaceReply | PairingChallenge, chatId: string): TelegramSendMessagePayload {
  if (isPairingChallenge(reply)) {
    return {
      chat_id: chatId,
      text: `This chat is not paired with Muster yet. Ask an operator to run:\nmuster pairing approve ${reply.code}`,
    };
  }
  if (reply.approvalRequest) {
    const { runId, gateId, show } = reply.approvalRequest;
    const shown = typeof show === "string" ? show : JSON.stringify(show, null, 2);
    return {
      chat_id: chatId,
      text: `${reply.text ? `${reply.text}\n\n` : ""}Approval required (gate "${gateId}"):\n${shown}`,
      reply_markup: {
        inline_keyboard: [[
          { text: "Approve", callback_data: `muster:approve:${runId}` },
          { text: "Reject", callback_data: `muster:reject:${runId}` },
        ]],
      },
    };
  }
  return { chat_id: chatId, text: reply.text };
}
