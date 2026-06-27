# Changelog

All notable changes to Muster are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
semantic versioning.

## [0.1.7] - 2026-06-27

Muster 0.1.7 is the public demo and positioning release. It makes the first
GitHub/npm experience clearer, safer to try, and easier to share.

### Added
- README and website positioning around Muster as an open-source governed agent
  harness for production AI systems.
- Public demo assets, social preview assets, and a terminal demo GIF for the
  README and website.
- Channel/plugin readiness diagnostics in the CLI so integration setup can
  report concrete missing prerequisites.

### Changed
- README quick start now starts with the deterministic no-key demo:
  `pnpm --package=@musterhq/cli dlx muster demo`.
- Website hero now leads with the governed-agent wedge, a "Run the demo" CTA,
  and concise proof instead of a dense capability list.
- Website SEO/social metadata now includes clearer descriptions and preview
  imagery for shared links.
- Package versions are aligned for the next npm publication.

### Fixed
- Replaced the broken `pnpm dlx @musterhq/cli demo` command form with the
  verified pnpm syntax for packages that expose multiple binaries.
- Restored near-top Token Waste Index proof in the README so visitors see
  deterministic token-savings evidence before long explanations.

## [0.1.6] - 2026-06-23

Muster 0.1.6 is the integration and CLI usability release. It moves Muster
closer to being a practical agent harness people can run directly from the
terminal or connect behind product/chat surfaces.

### Added
- **Interactive terminal chat overhaul**: `muster` now opens a focused TUI chat
  surface with slash-command and `@agent` completion, command pickers, session
  naming/resume, provider/model selection flows, token/status commands, and a
  cleaner site-aligned palette.
- **Capability-pack catalog expansion**: all built-in plugin rows now resolve to
  real capability packs instead of policy-only placeholders. The catalog covers
  developer tools, browser QA, web frameworks, research, artifacts, data,
  security, daily ops, channels, providers, Codex, Claude Code, and MCP bridge
  workflows.
- **Provider setup packs** for OpenAI, Anthropic/Claude, vLLM, and
  Codex/Claude CLI runtimes with setup guidance, readiness checks, model-policy
  hints, and latency triage.
- **Auth-heavy MCP setup workflows** for GitHub, Notion, Linear, Google Drive,
  Firecrawl, Postgres, and n8n, including env readiness, OAuth setup/import
  paths, installability checks, and safe default tool policies.
- **Built-in channel packs** for Slack, Google Chat, Discord, WhatsApp, Teams,
  and Telegram. Telegram remains optional for regions where it is unavailable.
- **Web framework pack** for Frappe/ERPNext, React, Vue, Vite, Nuxt, and common
  web stacks, with local/dev/build/deploy/integration runbooks and production
  readiness checks.
- **Indexed scoped memory retrieval** using SQLite/FTS so long-running personal
  and project memory stays fast as conversations grow.
- **Token ledger visibility** in CLI flows so model spend, replay waste, and
  skill attribution are inspectable instead of hidden.
- **Latency probe command**: `muster latency "prompt" --runs 3` separates
  provider time from Muster overhead, reports p50/p95, and flags whether a slow
  turn is provider-bound or caused by recall/prompt/persistence overhead.
- **Local workspace-read fast path**: trivial prompts that only ask to list the
  current folder are answered by Muster directly with an audited
  `muster-local/workspace-read` episode, avoiding unnecessary Codex round trips.
- **Source-backed integration catalog expansion**: `muster plugins catalog` now
  exposes 116 built-in entries after checking current Hermes and OpenClaw
  source trees. New setup-plan surfaces cover additional providers, channels,
  voice, document extraction, file transfer, webhooks, policy, token/cost
  governance, diagnostics, QA, migration, and memory backends without
  overclaiming execution before a pack/MCP is wired.

### Changed
- `muster plugins setup/check/enable` now reports concrete prerequisites:
  missing env vars, setup URLs, MCP/channel availability, configured defaults,
  capability-pack readiness, and next commands.
- Runtime/provider UX is now picker-oriented: users can switch provider, model,
  runtime, MCPs, plugins, and skills from inside chat instead of memorizing
  exact IDs.
- Chat `fast` mode now means a warm native session with lighter Muster context
  rather than a cold one-shot Codex exec path, so repeat Codex turns can reuse
  app-server state while skipping recall, ambient skill scoring, and memory
  writes.
- Codex and Claude Code are modeled as first-class runtime capability packs,
  matching the way Hermes treats autonomous agent CLIs while preserving Muster's
  own session, memory, and token accounting.
- Browser and web-search workflows now prefer explicit MCP setup and cited
  source paths over hidden provider behavior.
- Default runtime guidance now uses Codex CLI instead of accidental localhost
  endpoints, keeping fast self-hosted providers opt-in rather than accidental.

### Fixed
- Serialized warm Codex app-server turns per session and added injected-context
  hashes to native session handles, preventing concurrent turn event mixing and
  stale memory/skill/rule reuse across resumed provider sessions.
- Native session reuse now hashes stable instructions separately from volatile
  per-turn recall/skill context, preventing ordinary memory changes from
  cold-starting a fresh Codex app-server session.
- Native Codex and Claude Code attempts now stamp actual `create`/`continue`
  session mode and session id into the token ledger, so replay-waste warnings
  catch bloated continued Codex sessions instead of only Pi/API paths.
- Removed the “pack=no” gap from the built-in plugin catalog.
- Fixed CLI setup output so release-critical integrations show real setup links
  and readiness state rather than vague availability text.
- Hardened OAuth/MCP setup paths so credentials are checked and never printed in
  CLI output.

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
