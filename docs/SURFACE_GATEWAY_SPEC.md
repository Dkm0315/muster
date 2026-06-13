# Muster Surface Gateway — every chat app, every frontend, one contract

Channels are not features to hand-build one by one (OpenClaw has 20+ bespoke
channel integrations and a plugin-repair reputation to show for it). Muster
ships ONE governed gateway contract; surfaces are thin adapters over it.

## Design principle

A surface is anything that can deliver a message and render a reply:
Telegram, WhatsApp, Discord, Slack, MS Teams, Google Chat, Signal, iMessage,
email, a React/Vue/Svelte web widget, a Frappe SPA, a CLI, a kiosk.

The harness must not know channel APIs. It knows one envelope:

```ts
interface SurfaceMessage {
  surfaceId: string;        // "slack:T024…", "discord:guild/123", "web:app-7"
  conversationId: string;   // channel/thread/DM id
  senderId: string;         // surface-native sender id
  pairingId?: string;       // resolved Muster identity (after pairing)
  text: string;
  attachments?: { name: string; mime: string; url or bytes }[];
  replyTo?: string;
  raw?: unknown;            // original payload, never parsed by core
}

interface SurfaceReply {
  text: string;
  artifacts?: { name: string; mime: string; path }[];
  streaming?: AsyncIterable<string>;   // surfaces that can't stream buffer it
  approvalRequest?: { runId, gateId, show, options: ["approve","reject"] };
}
```

## The gateway (packages/gateway)

- HTTP + WebSocket server (`muster gateway start --port 7460`).
- **Inbound**: POST /v1/messages (webhook-style surfaces: Slack events,
  Teams bot framework, GChat, WhatsApp Cloud API) and WS /v1/stream
  (socket surfaces: Discord gateway, Telegram long-poll bridge, web widgets).
- **Identity & pairing**: surface sender → Muster pairing via the existing
  scoped-memory pairing lane (`pairing:<surfaceId>:<senderId>`); unpaired
  senders get a pairing challenge, approval via `muster pairing approve` —
  the OAuth-federation pattern proven on the Frappe gateway plugs in here.
- **Every message becomes a governed run**: scoped memory (user + conversation
  session lanes), agent rules, token ledger per surface, episode + evidence.
  A surface gets NOTHING the trust kernel doesn't grant.
- **Flow approvals on any surface**: a gate_pending flow run renders as an
  approval card (Slack blocks / Discord buttons / Teams adaptive card / plain
  text "reply APPROVE") — `resumeFlow` is the single backend for all of them.
- **Per-surface budgets**: `muster tokens --by-surface`; a runaway Discord
  guild can't drain the org budget.

## Adapter tiers

Tier 1 (built-in, thin — webhook/REST only, no heavy SDKs):
- **Slack** (Events API + chat.postMessage; blocks for approvals)
- **Discord** (interactions webhook + REST; buttons for approvals)
- **Telegram** (Bot API long-poll/webhook — patterns already proven)
- **WhatsApp Cloud API** (Meta webhook; template messages for approvals)
- **Google Chat** (apps webhook), **MS Teams** (incoming webhook v1;
  full Bot Framework adapter later)

Tier 2 (npm package `@dkm0315/surface`):
- Framework-agnostic web client (~3KB, zero deps): `createSurface({url, token})`
  → `send()`, `onReply()`, `onStream()`, `onApproval()`. Headless — works in
  React, Vue, Svelte, plain script tags, Frappe Desk/SPAs (the Frappe screen
  context protocol rides this same client).

Tier 3 (community): the adapter contract is ~40 lines — publish
`muster-surface-<name>` packages; capability-pack manifest validation applies.

## Why this beats per-channel integrations
1. One security/identity/budget model audited once, not 20 times.
2. New surface = small adapter, not a fork of the runtime.
3. Approvals, streaming, artifacts, pairing behave identically everywhere.
4. Web-widget tier means ANY product can embed Muster — the usability
   multiplier for non-technical users.

## Build order
1. Gateway core: envelope types, HTTP/WS server, pairing lane, run dispatch (slice 1)
2. Telegram + Slack adapters (most demand, simplest APIs)
3. `@dkm0315/surface` web client + a 20-line HTML demo page
4. Discord, WhatsApp Cloud, GChat, Teams webhook adapters
5. Approval cards per surface; `tokens --by-surface`
