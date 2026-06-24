interface ChannelContext {
  readonly config: Readonly<Record<string, string | undefined>>;
}

interface GatewayLike {
  readonly port?: number;
  readonly telegram?: { readonly botToken?: string; readonly secretToken?: string; readonly stream?: "off" | "draft" } | null;
}

const ROUTE = "/v1/adapters/telegram";
const SETUP_URLS = [
  "https://core.telegram.org/bots/tutorial",
  "https://core.telegram.org/bots/api#setwebhook",
];

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function gatewayArg(args: Record<string, unknown>): GatewayLike | undefined {
  const value = args.gatewayConfig;
  return typeof value === "object" && value !== null ? value as GatewayLike : undefined;
}

function publicBase(args: Record<string, unknown>, gateway?: GatewayLike): string {
  const explicit = stringArg(args, "publicUrl")?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const port = typeof gateway?.port === "number" && Number.isFinite(gateway.port) ? gateway.port : 7460;
  return `http://127.0.0.1:${port}`;
}

function hasBotToken(gateway: GatewayLike | undefined, context: ChannelContext): boolean {
  return Boolean(gateway?.telegram?.botToken || context.config.TELEGRAM_BOT_TOKEN);
}

export async function telegram_setup_plan(args: Record<string, unknown>, context: ChannelContext) {
  const gateway = gatewayArg(args);
  const base = publicBase(args, gateway);
  return {
    channel: "telegram",
    label: "Telegram Bot",
    ready: hasBotToken(gateway, context),
    webhookUrl: `${base}${ROUTE}`,
    setupUrls: SETUP_URLS,
    prerequisites: [
      "Telegram Bot API reachable from your deployment region.",
      "Bot token created with BotFather.",
      "Public HTTPS gateway URL for webhook mode, or local long-poll mode for reachable development environments.",
      "Optional webhook secret token for request validation.",
    ],
    commands: [
      "muster gateway init",
      `muster channels setup telegram --bot-token-env TELEGRAM_BOT_TOKEN --public-url ${base}`,
      "muster gateway poll",
      "muster channels status telegram",
    ],
    notes: [
      "If Telegram is blocked in your region, keep this backend disabled and test Google Chat, Slack, web, or Discord instead.",
      "Long-poll mode avoids a public URL but still requires Bot API reachability.",
    ],
  };
}

export async function telegram_gateway_check(args: Record<string, unknown>, context: ChannelContext) {
  const gateway = gatewayArg(args);
  const token = hasBotToken(gateway, context);
  const secret = Boolean(gateway?.telegram?.secretToken || context.config.TELEGRAM_SECRET_TOKEN);
  return {
    channel: "telegram",
    ready: token,
    checks: [
      { id: "bot_token", ok: token, detail: token ? "bot token configured" : "Set TELEGRAM_BOT_TOKEN and run channels setup." },
      { id: "secret_token", ok: secret, optional: true, detail: secret ? "webhook secret configured" : "Optional: set TELEGRAM_SECRET_TOKEN for webhook request validation." },
      { id: "public_https_url", ok: Boolean(stringArg(args, "publicUrl")?.startsWith("https://")), optional: true, detail: "Webhook mode requires HTTPS; local poll mode does not." },
    ],
    next: token ? "Use muster gateway poll locally or configure Telegram setWebhook to the webhook URL." : "Create a BotFather token, export TELEGRAM_BOT_TOKEN, then run channels setup.",
  };
}

export async function telegram_update_summary(args: Record<string, unknown>) {
  const update = (typeof args.update === "object" && args.update !== null ? args.update : args) as Record<string, unknown>;
  const message = typeof update.message === "object" && update.message !== null ? update.message as Record<string, unknown> : {};
  const chat = typeof message.chat === "object" && message.chat !== null ? message.chat as Record<string, unknown> : {};
  const from = typeof message.from === "object" && message.from !== null ? message.from as Record<string, unknown> : {};
  return {
    updateId: typeof update.update_id === "number" ? update.update_id : undefined,
    chatId: typeof chat.id === "number" || typeof chat.id === "string" ? String(chat.id) : undefined,
    chatType: typeof chat.type === "string" ? chat.type : undefined,
    user: typeof from.username === "string" ? from.username : typeof from.first_name === "string" ? from.first_name : undefined,
    text: typeof message.text === "string" ? message.text : "",
  };
}

export const tools = {
  telegram_setup_plan,
  telegram_gateway_check,
  telegram_update_summary,
};
