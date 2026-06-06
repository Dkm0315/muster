# Upstream Alignment: Pi, OpenClaw, Hermes

HybrowClaw should be original in its trust model and operator experience, not original for the sake of reimplementing solved runtime mechanics.

This note is the guardrail before each implementation slice: check what Pi, OpenClaw, and Hermes already do well, then build the smallest HybrowClaw layer that preserves their strengths while adding our wedge.

## Pi / PyEdit.dev Bedrock

Pi is the low-level agent harness substrate.

Use these primitives directly:

- `@earendil-works/pi-coding-agent` for `createAgentSession()`, `AgentSession`, `SessionManager`, `AuthStorage`, `ModelRegistry`, `DefaultResourceLoader`, `SettingsManager`, print/RPC/interactive modes, skills, prompt templates, and extensions.
- `@earendil-works/pi-agent-core` for the agent loop, tool calling, message state, and event model.
- `@earendil-works/pi-ai` for provider/model abstraction.
- `@earendil-works/pi-tui` for terminal rendering primitives where we need real interactive TUI behavior.

Do not recreate:

- session trees, prompt expansion, slash-command prompt templates, skills loading, extension loading, tool execution, or built-in coding tools unless HybrowClaw is adding a policy wrapper.
- a fake local workflow runner and call it Pi integration.
- subprocess scraping as the default runtime. CLI/RPC modes are useful diagnostics and compatibility lanes; the product runtime should embed SDK primitives.

HybrowClaw's Pi layer should add:

- Trust Kernel envelopes around each Pi turn.
- scoped memory and eval hooks before/after `session.prompt()`.
- tool allowlists, sandbox decisions, and redaction metadata before tools reach Pi.
- event capture from `AgentSession.subscribe()` for streaming, traces, tool ledgers, and the TUI.

## OpenClaw Pattern To Match

OpenClaw is the best reference for embedding Pi inside a larger multi-surface assistant.

Match these ideas:

- Direct session embedding via a session factory instead of spawning the `pi` command.
- custom tool injection for messaging, sandbox, channel, browser, task, and artifact tools.
- dynamic system prompt construction per channel/session/context.
- session persistence outside default Pi paths when the host app owns identity and state.
- event subscription for streaming text, reasoning, tool starts/updates/results, turn lifecycle, and errors.
- model/auth profile resolution with provider failover instead of a single global API key assumption.
- TUI reuse from Pi where terminal behavior already exists.
- transcript repair, prewarm, write locks, resource-loader setup, compaction checks, and guarded session managers before execution.
- exact tool allowlists projected from capability policy; never expose the whole harness tool universe by default.
- a stable event bus that normalizes provider chunks, assistant text, reasoning, tool progress, and finalization.

OpenClaw source and docs move quickly. Current public docs still explain Pi package embedding, while recent source has internalized parts of the session runtime. The durable lesson is the lifecycle pattern, not a specific package name:

```text
prepared runtime plan
  -> session factory
  -> guarded transcript/session manager
  -> model/auth registry
  -> resource loader
  -> exact allowlisted tools/custom tools
  -> event subscription adapter
  -> prompt
  -> trace/evidence/finalization
```

Avoid copying these problems:

- too much auth/pairing friction for local-first personal use.
- channel-specific behavior bleeding into the core harness.
- silent fallback paths that make a failed agent look successful.

## Hermes Pattern To Borrow

Hermes is the best reference for long-running agent operations beyond coding.

Borrow these ideas:

- bounded curated memory plus full session search. Small memory is injected; complete history stays searchable through SQLite/FTS-style retrieval.
- skills as progressive-disclosure procedural memory and slash commands.
- skill bundles for loading task-specific operating modes.
- MCP as a first-class external tool bridge with per-server filtering.
- profiles with isolated config, sessions, skills, and memory.
- scheduler/cron as agent jobs, not shell-only jobs.
- channel gateway architecture where CLI, messaging, webhooks, and API server share the same core loop.
- terminal backends and remote execution as explicit, policy-governed runtime choices.
- delegation through isolated child agents with restricted toolsets and parent-visible summaries.
- installer, doctor, update, backup, profile, and migration flows that are operational products, not afterthought scripts.

Do not copy blindly:

- Python-only assumptions. HybrowClaw is npm/pnpm/bun-first unless a backend earns its place.
- global memory behavior. HybrowClaw memory must be scoped by tenant, user, pairing, session, role, persona, and workspace.
- unmanaged skill mutation. Agent-created or modified skills must pass manifest, permission, and eval gates before promotion.
- markdown-only memory as the final architecture. HybrowClaw memory should be typed, scoped, provenance-scored, contradiction-aware, and reviewable.

## Pi Agents And Flow Graphs

Pi's agent/workflow model is stronger than a hand-rolled local sequence runner. Treat inspectable flow graphs as an upstream baseline:

- agents as markdown/configurable operating units.
- durable workflow graph concepts such as sequence, spawn, fork, join, and loop.
- `/flows`-style inspection and persistence.
- slash commands, prompt templates, skills, and ResourceLoader-managed extension surfaces.

HybrowClaw should not invent a parallel flow language unless it is a policy layer over these primitives. If a local flow runner exists for tests, label it as a local fixture runner, not Pi integration.

## HybrowClaw Wedge

The wedge is not "we have agents/tools/memory." That is baseline.

The wedge is:

- one-command install and migration from OpenClaw/Hermes/Pi state where possible.
- embedded Pi runtime, not a fake runner.
- strict one-active-runtime-per-run traceability.
- scoped memory lanes with promotion gates.
- feedback adjudication that treats thumbs up/down as evidence, not truth.
- eval-gated self-improvement for memory, skills, prompts, routes, and tools.
- capability packs that feel as easy as npm but are governed like production infrastructure.
- terminal/TUI-first operation with web as observability/control plane, not the core.

## Next Implementation Order

1. Keep the Pi SDK adapter real: session creation, auth/model injection, event subscription, session persistence, and custom tool hooks.
2. Add guarded session files, transcript repair, resource-loader phases, and exact tool allowlists before expanding tools.
3. Add a real TUI loop on top of Pi/HybrowClaw events; do not treat a static state box as the final TUI.
4. Add profile-scoped memory/session search inspired by Hermes, but with HybrowClaw scope isolation.
5. Add capability-pack activation and skill loading through Pi `ResourceLoader` instead of inventing a parallel skill runtime.
6. Add OpenClaw/Hermes/Pi migration verifiers that prove what migrated and what remained archive-only.
7. Add release packaging only after the CLI can run a real embedded Pi session with a configured provider.

## Current Source Anchors

- Pi repo: https://github.com/earendil-works/pi
- Pi SDK docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- OpenClaw Pi architecture: https://docs.openclaw.ai/pi
- Hermes docs: https://hermes-agent.nousresearch.com/docs/
- Hermes memory: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Hermes skills: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Hermes architecture: https://hermes-agent.nousresearch.com/docs/developer-guide/architecture
