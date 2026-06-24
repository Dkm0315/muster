interface ChannelContext {
  readonly config: Readonly<Record<string, string | undefined>>;
}

interface GatewayLike {
  readonly port?: number;
  readonly slack?: { readonly botToken?: string; readonly signingSecret?: string; readonly stream?: "off" | "draft" } | null;
}

const ROUTE = "/v1/adapters/slack";
const SETUP_URLS = [
  "https://api.slack.com/apps",
  "https://api.slack.com/apis/connections/events-api",
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

function hasToken(gateway: GatewayLike | undefined, context: ChannelContext): boolean {
  return Boolean(gateway?.slack?.botToken || context.config.SLACK_BOT_TOKEN);
}

function hasSigningSecret(gateway: GatewayLike | undefined, context: ChannelContext): boolean {
  return Boolean(gateway?.slack?.signingSecret || context.config.SLACK_SIGNING_SECRET);
}

export async function slack_setup_plan(args: Record<string, unknown>, context: ChannelContext) {
  const gateway = gatewayArg(args);
  const base = publicBase(args, gateway);
  return {
    channel: "slack",
    label: "Slack App",
    ready: hasToken(gateway, context) && hasSigningSecret(gateway, context),
    webhookUrl: `${base}${ROUTE}`,
    setupUrls: SETUP_URLS,
    prerequisites: [
      "Slack app with bot token scopes for posting replies.",
      "Events API enabled with message/app_mention subscriptions.",
      "Signing secret copied from Basic Information.",
      "Public HTTPS gateway URL for Slack request delivery.",
    ],
    commands: [
      "muster gateway init",
      `muster channels setup slack --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET --public-url ${base}`,
      "muster channels status slack",
      "muster gateway start --port 7460",
    ],
    notes: [
      "Muster verifies Slack signatures when the signing secret is configured.",
      "Use draft streaming only after normal replies work.",
    ],
  };
}

export async function slack_gateway_check(args: Record<string, unknown>, context: ChannelContext) {
  const gateway = gatewayArg(args);
  const token = hasToken(gateway, context);
  const signingSecret = hasSigningSecret(gateway, context);
  return {
    channel: "slack",
    ready: token && signingSecret,
    checks: [
      { id: "bot_token", ok: token, detail: token ? "bot token configured" : "Set SLACK_BOT_TOKEN and run channels setup." },
      { id: "signing_secret", ok: signingSecret, detail: signingSecret ? "signing secret configured" : "Set SLACK_SIGNING_SECRET and run channels setup." },
      { id: "public_https_url", ok: Boolean(stringArg(args, "publicUrl")?.startsWith("https://")), detail: "Slack Event Subscriptions require a public HTTPS Request URL." },
    ],
    next: token && signingSecret ? "Start the gateway and verify the Slack Request URL." : "Run muster channels setup slack with token and signing-secret env vars.",
  };
}

export async function slack_event_summary(args: Record<string, unknown>) {
  const outer = args as Record<string, unknown>;
  const event = (typeof args.event === "object" && args.event !== null ? args.event : args) as Record<string, unknown>;
  const inner = typeof event.event === "object" && event.event !== null ? event.event as Record<string, unknown> : event;
  return {
    type: typeof inner.type === "string" ? inner.type : undefined,
    team: typeof outer.team_id === "string" ? outer.team_id : typeof event.team_id === "string" ? event.team_id : typeof inner.team === "string" ? inner.team : undefined,
    channel: typeof inner.channel === "string" ? inner.channel : undefined,
    user: typeof inner.user === "string" ? inner.user : undefined,
    text: typeof inner.text === "string" ? inner.text : "",
    threadTs: typeof inner.thread_ts === "string" ? inner.thread_ts : typeof inner.ts === "string" ? inner.ts : undefined,
  };
}

export const tools = {
  slack_setup_plan,
  slack_gateway_check,
  slack_event_summary,
};
