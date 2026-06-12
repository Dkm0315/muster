# Changelog

All notable changes to Muster are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
semantic versioning.

## [0.1.0] - 2026-06-12

First feature-complete core. Not yet 1.0: APIs may shift before stabilization.

### Added
- **Run loop** with scoped-memory recall, agent operating rules, and governed
  model fallback recorded as evidence (never silent drift).
- **Scoped memory** lanes (tenant/workspace/user/pairing/session/role/persona)
  with leak-prevention enforced by tests.
- **Token ledger** with replay-waste detection and CLI tables (`muster tokens`).
- **`muster verify`** — store integrity: corruption, duplicate run ids, silent
  model drift, stale-narrative poisoning.
- **`muster evolve`** — recursive eval loop with evidence-aware adjudication.
- **Flow engine** — tool/agent/gate steps, preflight, durable runs, replay/diff,
  `flow loop --cron`.
- **Eval-gated skill loop** — candidates promote only through a converged suite.
- **Context renderer** — immutable transcripts with progressive tool-result
  stubbing (large token savings on long sessions).
- **SQLite session store** + four-shape `session_search` (FTS5).
- **Never-wedge compactor** — a session can always take a turn.
- **Pulse scheduler** — preflight-gated heartbeat with a daily token budget.
- **Pull-based subagents** — durable run store, exactly-once result claims.
- **MCP client** — per-server isolation, circuit breakers, capped results.
- **Surface gateway** — one governed envelope for Telegram, Slack, Discord,
  WhatsApp, Google Chat, and Teams, plus a zero-dependency web client.
- **JSON-RPC gateway protocol** — one transport for CLI/desktop/web.
- **Tool registry v2**, **profiles v2**, **typed hook bus**, **capability-pack
  loader**, and a **20-provider preset catalog**.
- **`muster demo`** — provisions a throwaway workspace and stub model service.
