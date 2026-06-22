# OpenClaw → muster Parity Checklist

> Single trackable checklist so **muster matches OpenClaw's feature list EXACTLY**.
> OpenClaw is public (`github.com/openclaw/openclaw`, MIT, TS, 30 repos). This file is the
> one place to verify "did we cover it?" across the docs (`docs.openclaw.ai`), the repos,
> and muster's current code.

## Purpose & Thesis

muster is a faithful, hardened re-implementation of OpenClaw's surface area with one hard
constraint that fixes an entire bug class.

- **Thesis** — Run the **user's own provider subscription at full native power**
  (Codex / Claude Code / Pi / others via ACP) and **layer muster skills, plugins, and
  memory alongside**. Never force Claude. Never downgrade the model. The migration is
  **"openclaw → muster as-is"**: every `openclaw.json` field, every skill, command,
  identity file, tool, and plugin carries across faithfully.
- **muster RULE (the wedge)** — **Everything in-repo, one version, NO runtime install.**
  No npm-plugin tarballs, no CalVer, no hoisting, no live network registry (ClawHub).
  This single rule kills OpenClaw's npm-plugin tarball / CalVer / hoisting / supply-chain
  bug class (ClawHub was trojanized — ~1,184 bad skills). Where OpenClaw installs from a
  network, muster ships an in-repo, hash-pinned manifest instead.
- **"Better than OpenClaw"** — Each section cites the teardown lesson
  (`docs/teardowns/OPENCLAW_TEARDOWN.md`, `docs/teardowns/HERMES_TEARDOWN.md`) and the
  upstream issue number muster prepays as tuition. Parity does not mean "same bugs."

## Legend

| Mark | Meaning |
|------|---------|
| `- [x]` … **HAVE ✅** | Implemented and test-covered in muster today. |
| `- [ ]` … **PARTIAL 🟡** | Partially implemented; a concrete gap remains. |
| `- [ ]` … **MISSING ⬜** | Not yet built; tracked work item. |

**Effort:** `S` (≤½ day) · `M` (1–2 days) · `L` (3–5 days) · `XL` (>1 week / multi-PR).

**Status snapshot:** 386 tests passing (core 281 + gateway 78 + cli 22 + surface 5).
Cross-references: `docs/OPENCLAW_VS_MUSTER_GAP.md`, `docs/FEATURE_PARITY_PLAN.md`,
`docs/teardowns/OPENCLAW_TEARDOWN.md`, `docs/teardowns/HERMES_TEARDOWN.md`.

---

## A) Runtime & ACP

> **The heart of the project.** OpenClaw's `acpx` is a headless ACP multiplexer wrapping
> codex/claude/pi/gemini/cursor/copilot/droid/custom. muster must become a faithful
> acpx-equivalent: run the user's own provider at native power, named persistent per-repo
> sessions, prompt queueing, ACP-typed output, `fs/*`+`terminal/*` permission handlers,
> compare/exec/flow, custom-agent escape hatch.
> Docs: `concepts/agent-runtimes`, `gateway/cli-backends`. Repo: `acpx`.

- [x] Two runtime families (embedded harness vs CLI backend) — muster: **HAVE ✅** — `packages/core/src/{pi.ts (embedded), codex.ts, claude.ts (CLI backends)}` — effort M
- [x] Codex backend — full-power `codex exec --json`, native shell/apply_patch/web_search — muster: **HAVE ✅** — `packages/core/src/codex.ts` (`runCodex()`, events + final from `-o` file) — effort M
- [x] Codex `thread_id` resume (native session continuity) — muster: **HAVE ✅** — `packages/core/src/codex.ts:70` + `run.ts:49-50` — effort S
- [x] Codex `experimental_instructions_file` injection (memory/skills at SYSTEM level, not user msg) — muster: **HAVE ✅** — `packages/core/src/codex.ts:29,79` — effort S
- [x] Claude Code backend — `claude -p`, `--append-system-prompt`, model/effort/tool allowlist — muster: **HAVE ✅** — `packages/core/src/claude.ts` (`runClaudeCode()` via execFile) — effort M
- [x] Pi embedded runtime — live delta streaming, thinking levels, session persistence — muster: **HAVE ✅** — `packages/core/src/pi.ts` (`createAgentSession`, line 488) — effort M
- [x] `agentRuntime.id` per-model runtime binding (canonical `provider/model` ref preserved) — muster: **HAVE ✅** — `packages/core/src/types.ts:42-47` (RuntimeConfig) + `provider.ts` (exact model id, never forced) — effort S
- [x] Provider abstraction (openai/anthropic/openai-compatible/codex-cli, API-key env fallback) — muster: **HAVE ✅** — `packages/core/src/provider.ts` (`completeChat()`) — effort M
- [x] Session reseeding / history cap with context-tier awareness — muster: **HAVE ✅** — `packages/core/src/compactor.ts` (deterministic, runs first, never wedges) — effort M
- [x] `resolveTarget` maps `codex` task → runtime `"codex"` (migration targets the full-power Codex CLI runtime, never a phantom runtime or Claude remap) — muster: **HAVE ✅** — `packages/core/src/migration.ts` + `packages/core/test/migration.test.ts` — effort S
- [ ] `claude-cli` `liveSession: "claude-stdio"` — warm stdio process per session, follow-ups reuse it — muster: **PARTIAL 🟡** — `packages/core/src/claude.ts` (currently one-shot execFile; needs persistent stdio session + resume) — effort L
- [ ] `sessionMode` (`always`/`existing`/`none`) + `sessionArg`/`resumeArgs`/`resumeOutput` placeholder map — muster: **MISSING ⬜** — `packages/core/src/claude.ts` session-arg layer — effort M
- [ ] `bundleMcp: true` — loopback HTTP MCP server exposing gateway tools to the CLI, per-session `OPENCLAW_MCP_TOKEN` scoped to session/account/channel — muster: **MISSING ⬜** — new `packages/core/src/mcp-loopback.ts` + `mcp.ts` wiring — effort L
- [ ] `ownsNativeCompaction: true` — skip muster summarizer when claude-cli owns compaction — muster: **MISSING ⬜** — `packages/core/src/{claude.ts,compactor.ts}` flag — effort S
- [x] `--plugin-dir` skill snapshot — temp Claude plugin dir with `skills/<name>/SKILL.md`, duplicate skill catalog omitted from system prompt, cleaned after run — muster: **HAVE ✅** — `packages/core/src/{skills.ts,claude.ts,run.ts}` + `packages/core/test/{skills.test.ts,claude.test.ts}` — effort M
- [ ] Flag map — `systemPromptArg`/`modelArg`+`modelAliases`/`imageArg`(`imageMode:"repeat"`)/`--permission-mode`/`--effort`(from `/think`) — muster: **PARTIAL 🟡** — `packages/core/src/claude.ts` (model+effort+system done; image/permission-mode/aliases TODO) — effort M
- [ ] Runtime selection precedence — model-scoped → provider-scoped → plugin auto-claim → `openclaw` fallback runtime — muster: **PARTIAL 🟡** — `packages/core/src/router.ts` (`classifyTask`+`planRun`; needs explicit 4-tier precedence) — effort M

### ACP emphasis — adopt acpx-style per-provider native ACP/exec

The single most important parity target. Run the user's OWN provider at native power.

- [x] codex backend at native power (own shell/apply_patch/web_search, thread resume) — muster: **HAVE ✅** — `packages/core/src/codex.ts` — effort M
- [x] claude-code backend at native power (own tools, append-system-prompt) — muster: **HAVE ✅** — `packages/core/src/claude.ts` — effort M
- [ ] ACP-typed output stream (thinking / tool-calls / diffs as typed messages, `text|json(NDJSON)|quiet`) — muster: **PARTIAL 🟡** — `packages/core/src/stream.ts` (StreamEvent union has delta/block/flush/tool/final; map codex/claude JSON → typed ACP events) — effort M
- [ ] `fs/*` + `terminal/*` client permission handlers (`--approve-all|--approve-reads|--deny-all`) — muster: **PARTIAL 🟡** — `packages/core/src/tool-registry.ts` allowlists + `profiles.ts` workspace; needs explicit fs/terminal handler surface backed by an fs-safe-equiv (see I) — effort L
- [ ] Named persistent per-repo sessions (parallel named sessions, soft-close keeps history) — muster: **PARTIAL 🟡** — `packages/cli/src/index.ts` + `packages/core/src/sessions.ts` (`muster chat --session <name>`, `/resume`, `/history`, `/new`, durable `cli-chat:<name>` conversation keys; soft-close/queue-owner semantics still pending) — effort M
- [ ] Prompt queueing (submit while one runs, `--no-wait` fire-and-forget, queue-owner TTL) — muster: **MISSING ⬜** — new queue layer over `run.ts` — effort M
- [ ] `compare <a> <b> <c> '<prompt>'` — run same prompt across multiple backends — muster: **MISSING ⬜** — new `packages/cli` `compare` command over runtimes — effort M
- [ ] `exec` one-shot stateless — muster: **PARTIAL 🟡** — `packages/core/src/run.ts` (single-turn supported; expose as explicit stateless `exec`) — effort S
- [ ] Custom agent escape hatch (`--agent ./path` → any ACP server) — muster: **MISSING ⬜** — generic ACP-stdio adapter in `packages/core` — effort L
- [ ] Additional backends (pi/gemini/cursor/copilot/droid/iflow/fast-agent) — muster: **PARTIAL 🟡** — pi ✅; others ⬜ (`packages/core/src/*.ts` per backend) — effort XL

---

## B) Channels / Surfaces

> OpenClaw ships **24–27 live channel transports in-repo** (the `*crawl` repos are
> read-only archive/search tools, NOT transports). muster ships 6 adapters today through
> one gateway envelope. Docs: `channels`, `concepts/multi-agent`. Repo: `openclaw` (core).

- [x] One gateway, one envelope (single `handleSurfaceMessage()` entry, all adapters route through it) — muster: **HAVE ✅** — `packages/gateway/src/server.ts` + `envelope.ts` — effort M
- [x] Telegram adapter (webhook + long-poll, draft streaming via `editMessageText` throttle, retry_after backoff) — muster: **HAVE ✅** — `packages/gateway/src/adapters/telegram.ts` (fixes OpenClaw #92004 late-send silencing) — effort M
- [x] Slack adapter (signature validation, `chat.postMessage`→`chat.update` draft edits, thread scoping) — muster: **HAVE ✅** — `packages/gateway/src/adapters/slack.ts` — effort M
- [x] Discord adapter (interaction token, ephemeral, deferred updates) — muster: **HAVE ✅** — `packages/gateway/src/adapters/discord.ts` — effort M
- [x] WhatsApp adapter (webhook verify challenge, image media) — muster: **HAVE ✅** — `packages/gateway/src/adapters/whatsapp.ts` — effort M
- [x] Google Chat adapter (event token, message updates) — muster: **HAVE ✅** — `packages/gateway/src/adapters/gchat.ts` — effort M
- [x] Teams adapter (HMAC validation, activity model, threaded replies) — muster: **HAVE ✅** — `packages/gateway/src/adapters/teams.ts` — effort M
- [x] Per-surface token accounting (`surfaceId` through run context, ledger folding) — muster: **HAVE ✅** — `packages/gateway/src/server.ts:97` + `packages/core/src/tokens.ts` — effort S
- [x] Per-surface idempotency dedup (webhook retries return cached reply/challenge, 10-min TTL) — muster: **HAVE ✅** — `packages/gateway/src/server.ts:72-92` — effort S
- [ ] `dmPolicy` (`pairing` default / `allowlist` / `open` / `disabled`) + `groupPolicy`/`allowFrom`/`groupAllowFrom` — muster: **PARTIAL 🟡** — `packages/gateway/src/pairing.ts` (pairing lane exists; needs full per-channel policy keys) — effort M
- [ ] Multi-account per channel (`accountId`, `channels.<ch>.defaultAccount`) — muster: **MISSING ⬜** — `packages/gateway/src/envelope.ts` + adapter config — effort M
- [ ] Per-channel `textChunkLimit` + streaming config keys — muster: **PARTIAL 🟡** — `packages/gateway/src/streaming.ts` (chunking exists; expose per-channel config) — effort S
- [ ] Channel health monitor (`healthMonitor.enabled`, stale-event/restart thresholds) — muster: **MISSING ⬜** — `packages/gateway/src/server.ts` health loop — effort M
- [ ] Channel CLI (`channels login --channel --account`, `channels status --probe`) — muster: **MISSING ⬜** — `packages/cli` channels command — effort M
- [ ] Remaining transports to reach 24+ (Signal/iMessage/IRC/Matrix/Feishu/LINE/Mattermost/Nextcloud/Nostr/Synology/Tlon/Twitch/QQ/WeChat/SMS/Voice/WebChat/Zalo/…) — muster: **MISSING ⬜** — `packages/gateway/src/adapters/*` — effort XL
- [ ] Channel-specific features (group mention activation, iMessage tapbacks/effects, voice notes, ambient room events, Telegram markdown-image→media) — muster: **PARTIAL 🟡** — `packages/gateway/src/adapters/*` (Telegram media ✅; rest per-channel) — effort L

---

## C) Skills

> OpenClaw skill = directory with `SKILL.md` (YAML frontmatter + markdown body). Discovery
> across 6 sources; distributed via ClawHub (network registry — **muster rejects this**).
> Docs: `tools/skills`. Repos: `agent-skills` (format), `clawhub` (registry, rejected).

- [x] `SKILL.md` format — frontmatter `name`/`description` + raw markdown body — muster: **HAVE ✅** — `packages/core/src/skills.ts:44-68` (atomic-rename safe serialization) — effort M
- [x] Skill quarantine → candidates (new skills born as CANDIDATES, never active until gate passes) — muster: **HAVE ✅** — `packages/core/src/skills.ts:80-97` (closes OpenClaw #25833: no correctness mechanism) — effort M
- [x] Evolve-report gate for promotion (converged `EvolveReport` + suiteTasks + passedAt required) — muster: **HAVE ✅** — `packages/core/src/skills.ts:131-148` (`promoteSkill()`) — effort M
- [x] Top-K budgeted injection (hard token budget per skill, dropped skills reported) — muster: **HAVE ✅** — `packages/core/src/run.ts:240+` (fixes OpenClaw #22620 system-prompt bloat) — effort M
- [x] Skill telemetry / usage (lastUsedAt, curator GC hints) — muster: **HAVE ✅** — `packages/core/src/skills.ts:150+` — effort S
- [x] Extended frontmatter (`user-invocable`/`disable-model-invocation`/`command-dispatch`/`command-tool`/`command-arg-mode`/`homepage`) — muster: **HAVE ✅** — `packages/core/src/skills.ts` + `packages/core/test/skills.test.ts` — effort M
- [x] Gating via `metadata.openclaw` (`requires.{bins,anyBins,env,config}`, `primaryEnv`, `os`, `always`, `install`) — muster: **HAVE ✅** — `packages/core/src/skills.ts` filters model injection by OS/env/config/binary gates — effort M
- [x] Layered local skill discovery (profile-pinned skills first, grouped workspace/project skills, explicit extra dirs, opt-in home/shared dirs; duplicate names resolve deterministically) — muster: **HAVE ✅** — `packages/core/src/skills.ts` (`skillDiscoveryRoots`, recursive `SKILL.md` scan, hash verification only for profile-managed skills) + runtime/gateway wiring; tests in `packages/core/test/skills.test.ts` — effort M
- [x] Profile-scoped skill visibility (accepts `agents.defaults.skills` baseline + profile/agent explicit lists for migration; explicit `[]` means no skills) — muster: **HAVE ✅** — `packages/core/src/skills.ts` (`resolveAgentSkillAllowlist`) filters prompt injection + slash-command resolution; gateway passes active profile as agent id; tests in `packages/core/test/skills.test.ts` — effort S
- [x] `skills.entries.<name>` env/API-key injection into host `process.env` for the run then restored (not into sandboxes) — muster: **HAVE ✅** — `packages/core/src/skills.ts` (`applySkillEnvForRun`) + `packages/core/src/run.ts` wraps provider/native attempts; tests in `packages/core/test/{skills.test.ts,run-integrity.test.ts}` — effort S
- [x] Skill catalog snapshots + refresh on `SKILL.md`/index change — muster: **HAVE ✅** — `packages/core/src/skills.ts` uses content-signature in-process snapshots (`skillCatalogCache`) refreshed on the next turn; managed skill writes/promotions invalidate immediately; no watcher daemon or network node dependency — effort M

### Skills emphasis — SKILL.md metadata index, hash-pinned, NO ClawHub registry

> **Better than OpenClaw:** ClawHub was a live network registry that got trojanized
> (~1,184 bad skills) via npm-tarball install + unchecked frontmatter declarations.
> muster ships skills **in-repo, one version, hash-pinned** — there is no install-from-network
> path to poison.

- [x] In-repo vendored skill model (no runtime install) — muster: **HAVE ✅** — `packages/core/src/skills.ts` (the muster RULE) — effort M
- [x] Hash-pinned skill index (digest per skill, verified at load) — muster: **HAVE ✅** — `packages/core/src/skills.ts` + `packages/core/test/skills.test.ts` — effort S
- [x] SKILL.md metadata index file (single in-repo manifest enumerating name/description/digest/provenance/gate) — muster: **HAVE ✅** — `.muster/skills/.index.json` + `muster skills index` — effort S
- [ ] Replicate ClawHub *capabilities* as in-repo manifests (trust/capability metadata, env/binary declarations, security analysis, version/changelog) — muster: **PARTIAL 🟡** — `packages/core/src/capability.ts` (capability manifest + risk analysis); wire to skills — effort M
- [ ] Explicitly DO NOT replicate install-from-network model — muster: **HAVE ✅** (by design) — the muster RULE — effort —

---

## D) Plugins & Hooks

> OpenClaw plugins span channels/providers/harnesses/tools/skills/speech/media; native
> (`openclaw.plugin.json`) vs compatible bundles; installed from `clawhub:`/`npm:`/`git:`/local.
> 18 typed hooks. Docs: `tools/plugin`, `concepts/agent-loop`. **muster: in-repo hooks +
> capability-packs, NO npm install.**

### Typed plugin hooks (the 18 named hooks)

- [x] Typed hook bus (priority/merge/block, timeouts, in-repo one-version) — muster: **HAVE ✅** — `packages/core/src/hooks.ts` (8 decision hooks today; `emit()` lines 79-98) — effort M
- [x] `before_prompt_build` (inject context/systemPrompt) — muster: **HAVE ✅** — `hooks.ts` `prompt.build` — effort S
- [x] `before_agent_reply` / `turn.start` (claim turn before LLM) — muster: **HAVE ✅** — `hooks.ts` `turn.start` — effort S
- [x] `before_tool_call` (`{block:true}` terminal) / `after_tool_call` — muster: **HAVE ✅** — `hooks.ts` `tool.before`/`tool.after` — effort S
- [x] `message_sending` (`{cancel:true}` terminal) / outbound — muster: **HAVE ✅** — `hooks.ts` `outbound.before` — effort S
- [x] `before_compaction` / `after_compaction` — muster: **PARTIAL 🟡** — `hooks.ts` `compaction.before` (add `after`) — effort S
- [x] `session_start` / `session_end` — muster: **HAVE ✅** — `hooks.ts` `session.start`/`session.end` — effort S
- [ ] `before_model_resolve` (override provider/model pre-session) — muster: **MISSING ⬜** — `hooks.ts` add hook + `router.ts` call site — effort S
- [ ] `agent_end` (inspect final messages + run metadata) — muster: **MISSING ⬜** — `hooks.ts` + `run.ts` post-run — effort S
- [ ] `before_install` (inspect staged skill/plugin material) — muster: **MISSING ⬜** — `hooks.ts` + `migration.ts`/`capability.ts` — effort S
- [ ] `tool_result_persist` (transform results before transcript write) — muster: **PARTIAL 🟡** — `packages/core/src/context-renderer.ts` (`persistToolResult()` exists; expose as hook) — effort S
- [ ] `message_received` / `message_sent` (observe inbound/outbound) — muster: **MISSING ⬜** — `hooks.ts` + gateway entry/exit — effort S
- [ ] `gateway_start` / `gateway_stop` lifecycle — muster: **MISSING ⬜** — `hooks.ts` + `packages/gateway/src/server.ts` — effort S
- [ ] Internal hooks `api.registerHook(...)`: `agent:bootstrap`, `command:new`/`command:reset`/`command:stop` — muster: **PARTIAL 🟡** — see M (slash-commands); add registerHook coarse side-effects — effort M

### Plugins emphasis — in-repo hooks + capability-packs, NO npm install

> **Better than OpenClaw:** muster replaces `clawhub:`/`npm:`/`git:` install sources with
> a single in-repo capability-pack manifest. No tarball, no CalVer, no hoisting bug class.

- [x] Capability-pack manifest (`muster.capability.json` + sandbox tiers + permission gates + eval fixtures + enforced entrypoint digest) — muster: **HAVE ✅** — `packages/core/src/capability.ts` + `packages/core/test/capability.test.ts` — effort M
- [x] Capability risk analysis (blockers/warnings, status ready|blocked, risk low|med|high) — muster: **HAVE ✅** — `packages/core/src/capability.ts:95-99` — effort S
- [ ] Plugin scope coverage (channels/providers/harnesses/tools/skills/speech/media/web) as capability-pack categories — muster: **PARTIAL 🟡** — `packages/core/src/capability.ts` (generic `slot` exists; map full slot taxonomy) — effort M
- [x] `plugins.slots.<slot>` exclusive categories (e.g. `memory:"memory-core"`) — muster: **HAVE ✅** — `packages/core/src/capability.ts` + `packages/core/test/capability-load.test.ts` — effort S
- [x] `plugins.allow`/`deny`/`load.paths`/`entries.<id>.{enabled,config}` — muster: **HAVE ✅** — `packages/core/src/capability.ts` + `packages/core/src/types.ts` + `packages/cli/src/index.ts` + tests — effort S
- [ ] Compatible-bundle import (Codex/Claude/Cursor plugin layouts → muster inventory) — muster: **PARTIAL 🟡** — `packages/core/src/migration.ts` (asset mapping; add bundle layout parsers) — effort M
- [ ] DO NOT replicate install-from-network — muster: **HAVE ✅** (by design) — effort —

---

## E) Tools (browser / web-search / artifacts / documents / memory-recall)

> OpenClaw tool catalog ~30 tools across runtime/files/web/browser/messaging/sessions/
> automation/gateway/media/discovery/memory. Docs: `tools`, `gateway/security`.
> Repos: `Peekaboo` (macOS vision), `gogcli` (Workspace MCP), `gitcrawl`/`discrawl`/`slacrawl`.

- [x] Tool registry v2 (declarative `ToolEntry`, toolsets, availability gates, per-tool result caps) — muster: **HAVE ✅** — `packages/core/src/tool-registry.ts` (`DEFAULT_MAX_RESULT_CHARS=8000`) — effort M
- [x] Result persistence (large results → disk, stub inline, fetch on demand) — muster: **HAVE ✅** — `packages/core/src/context-renderer.ts` + `tool-registry.ts:94-99` (saves 57–82% tokens, Hermes telemetry) — effort M
- [x] First-party tools (small dependency-free set: shell/file/network behind allowlists) — muster: **HAVE ✅** — `packages/core/src/tool-registry.ts` (integrations via MCP only, no sprawl) — effort M
- [x] Files: read / write / edit / apply_patch — muster: **HAVE ✅** — native to codex/claude backends + `tool-registry.ts` — effort S
- [x] Runtime: exec / process / code_execution — muster: **HAVE ✅** — native to backends + registry — effort S
- [x] Memory tools: `memory_search` / `memory_get` (scoped recall) — muster: **HAVE ✅** — `packages/core/src/memory.ts` + `packages/core/src/tool-registry.ts` (read-only registry tools, explicit scopes, optional global memory, backed by SQLite/FTS index; run recall remains injected) — effort M
- [ ] Browser tool (`browser` automation/sessions) — muster: **PARTIAL 🟡** — Playwright available; expose as registry tool + MCP for backends — effort M
- [ ] Web: `web_search` / `x_search` / `web_fetch` (browser/web-search packs) — muster: **PARTIAL 🟡** — `web_fetch` + `web_search` are in `packages/core/src/tool-registry.ts` with shared SSRF guard, host allowlists, result bounds, and cache; `x_search` + browser automation remain — effort M
- [ ] Web-search providers (Brave/DDG/Exa/Firecrawl/Gemini/Grok/Kimi/MiniMax/Ollama/Perplexity/SearXNG/Tavily) — muster: **PARTIAL 🟡** — Brave + DuckDuckGo are implemented in `packages/core/src/tool-registry.ts`; provider-pack expansion remains — effort L
- [ ] Media tools: `image`/`image_generate`/`music_generate`/`video_generate`/`tts` — muster: **PARTIAL 🟡** — `packages/core/src/media.ts` (MEDIA tags + TTS hook; generation ⬜) — effort L
- [x] Tool discovery: `tool_search`/`tool_describe`/`tool_call` — muster: **HAVE ✅** — `packages/core/src/tool-registry.ts` compact local catalog search, schema-on-demand, and guarded call-through honoring availability/env/allowlist; code-mode bridge remains unnecessary for current registry size — effort M
- [ ] Sessions/agents tools: `session_search`/`session_status`/`sessions_*`/`subagents`/`agents_list`/`goal` — muster: **PARTIAL 🟡** — `session_search` + read-only `session_status` are exposed as DB-backed registry tools; mutating/cross-session send, spawn, agents list, and goal still need visibility scopes — effort M
- [ ] Automation tools: `cron`/`heartbeat_respond` — muster: **PARTIAL 🟡** — `pulse.ts`+`scheduler.ts` (engine ✅; expose as tools) — effort S
- [ ] Gateway/nodes tools: `gateway`/`nodes` — muster: **MISSING ⬜** — gateway tool + nodes surface (see I, K) — effort M
- [ ] Peekaboo-equivalent macOS vision+GUI automation (screenshot/OCR/click/type) as MCP server — muster: **MISSING ⬜** — `packages/core/src/mcp.ts` mount + external server — effort L
- [ ] gogcli-equivalent Google Workspace MCP (allowlist/denylist safety) — muster: **MISSING ⬜** — MCP server mount (relevant to Frappe/Workspace) — effort L
- [ ] Tool policy keys (`tools.allow`/`deny`/`alsoAllow`/`elevated.{enabled,allowFrom}`/`fs.workspaceOnly`/`exec.{security,ask}`/`agentToAgent`) — muster: **PARTIAL 🟡** — `tool-registry.ts` allowlists; add full policy surface (ties to I) — effort M

---

## F) Sessions / Streaming / Compaction

> Docs: `concepts/agent-loop`, `web/control-ui`. Hermes teardown drove the immutable-render
> + progressive-stub design (`docs/teardowns/HERMES_TEARDOWN.md`).

- [x] SQLite session store (`node:sqlite`, FTS5 when available, LIKE fallback, single-writer) — muster: **HAVE ✅** — `packages/core/src/sessions.ts` — effort M
- [x] Interactive terminal chat shell (`muster chat`) with named sessions, history, slash-command control lane, multiline continuation, colored TTY output, and `@agent` routing hint — muster: **HAVE ✅** — `packages/cli/src/index.ts` + `packages/cli/test/cli.test.ts` — effort M
- [x] Session messages w/ per-message `tokenCount` (fixes replay waste) — muster: **HAVE ✅** — `packages/core/src/sessions.ts:96-98` — effort S
- [x] Session search (4 shapes: discover/scroll/read/browse) — muster: **HAVE ✅** — `packages/core/src/sessions.ts:40-59` — effort M
- [x] Single-writer guarantee (one store per process, all writes via gateway) — muster: **HAVE ✅** — `packages/core/src/sessions.ts:14-16` (corruption impossible by construction; hermes-agent #5563) — effort S
- [x] StreamEvent union — delta/block/flush/tool/**final** (FINAL IS AN EVENT, never inferred) — muster: **HAVE ✅** — `packages/core/src/stream.ts:13-18` (fixes #33492/#84623 dup-finals, #19275 lost pre-tool text, #84563 silent truncation) — effort M
- [x] Fence-aware coalescer (markdown code-block aware, min/max chars, idle flush, break preference) — muster: **HAVE ✅** — `packages/core/src/stream.ts:89-157` — effort M
- [x] Per-adapter draft sink (Telegram editMessageText throttle, Slack chat.update; never silents on error) — muster: **HAVE ✅** — `packages/gateway/src/streaming.ts` — effort M
- [x] Synthetic deltas (buffered responses chunked through same pipeline for codex/claude) — muster: **HAVE ✅** — `packages/core/src/run.ts` + `packages/gateway/src/streaming.ts` — effort M
- [x] Deterministic compaction (runs FIRST before any LLM call, never wedges) — muster: **HAVE ✅** — `packages/core/src/compactor.ts` (fixes #15720/#699 deadlock family) — effort M
- [x] Immutable transcript render + progressive tool-result stubbing — muster: **HAVE ✅** — `packages/core/src/context-renderer.ts` (fixes upstream #14948 refusal to do immutable render) — effort M
- [ ] Per-session overrides (model/thinking/fast/verbose/trace via `sessions.patch`) — muster: **PARTIAL 🟡** — `sessions.ts` + `router.ts` (back-end routing; expose patch surface) — effort M
- [ ] Context indicator / `/context list` truncation monitor — muster: **PARTIAL 🟡** — `compactor.ts`+`tokens.ts` (ledger exists; surface indicator) — effort S
- [ ] `session.dmScope` (`main`/`per-peer`/`per-channel-peer`/`per-account-channel-peer`) + `threadBindings` + `reset` — muster: **PARTIAL 🟡** — `sessions.ts` + `envelope.ts` `conversationSessionId()` (per-conversation; add full scope matrix) — effort M

---

## G) Heartbeat / Cron / Scheduling

> Docs: `automation`, `gateway/configuration`. muster's pulse unifies heartbeat + cron with
> a deterministic preflight (no API call when not due) and a hard daily token budget.

- [x] Pulse scheduler unifying heartbeat + cron (deterministic preflight before any model call, at-most-once + fast-forward) — muster: **HAVE ✅** — `packages/core/src/pulse.ts:93` — effort M
- [x] Per-pulse daily token budget (hard stop, never silent burn) — muster: **HAVE ✅** — `packages/core/src/pulse.ts:74` — effort S
- [x] Silent-reply suppression via structured decision (surfacing not inferred) — muster: **HAVE ✅** — `packages/core/src/pulse.ts` — effort S
- [x] Cron parsing/validation (validates expressions, does not execute) — muster: **HAVE ✅** — `packages/core/src/scheduler.ts` (`parseCron()`) — effort S
- [x] Schedule job interface (cron-based execution metadata) — muster: **HAVE ✅** — `packages/core/src/scheduler.ts` (`ScheduleJob`) — effort S
- [ ] Cron config keys (`maxConcurrentRuns(8)`/`sessionRetention("24h")`/`runLog.{maxBytes,keepLines(2000)}`) + multi-delivery + one-shots — muster: **PARTIAL 🟡** — `scheduler.ts`+`pulse.ts` (engine; add config keys + one-shot) — effort M
- [ ] Heartbeat reads `HEARTBEAT.md` checklist, responds `HEARTBEAT_OK` or messages you; defers while cron active — muster: **PARTIAL 🟡** — `pulse.ts` (heartbeat turn; add HEARTBEAT.md read + defer logic) — effort M
- [ ] Background Tasks ledger (`tasks list|audit`: ACP runs, subagent spawns, CLI ops) — muster: **PARTIAL 🟡** — `subagents.ts` (subrun ledger; unify into tasks ledger + CLI) — effort M
- [ ] Inferred Commitments (opt-in short-lived follow-up memories via heartbeat) — muster: **MISSING ⬜** — `pulse.ts` + `memory.ts` — effort M
- [ ] Hooks/webhooks (`hooks.{enabled,token,path("/hooks"),mappings[]…}` event-driven) — muster: **MISSING ⬜** — `packages/gateway/src/server.ts` webhook route — effort M
- [ ] Standing Orders (permanent authority in `AGENTS.md`, injected every session) — muster: **HAVE ✅** — `packages/core/src/agent-rules.ts` (`loadAgentRules()`) — effort S
- [ ] Task Flow (durable multi-step flow w/ revisions, `tasks flow list|show|cancel`) — muster: **PARTIAL 🟡** — `flow.ts` (durable runs ✅; add revisions + tasks-flow CLI) — effort M

---

## H) Subagents

> Docs: `concepts/multi-agent`, `tools`. muster uses pull-based result delivery so zombies
> are impossible.

- [x] SubRun store (append-only JSONL event log, state derived from events) — muster: **HAVE ✅** — `packages/core/src/subagents.ts` (spawned/completed/failed/claimed/orphaned, line 47-56) — effort M
- [x] Spawn contract (task + parentKey + runOptions, depth caps inherited) — muster: **HAVE ✅** — `packages/core/src/subagents.ts:96-99` — effort S
- [x] Pull-based result claims (`claimCompleted()` re-reads store before append; double-claim window narrowed) — muster: **HAVE ✅** — `packages/core/src/subagents.ts:132+` (zombies impossible) — effort M
- [x] Depth caps (children get depth+1, default cap 1; prevents infinite recursion) — muster: **HAVE ✅** — `packages/core/src/subagents.ts:103` — effort S
- [x] Concurrency caps (derived durably; crashed child can't permanently leak a slot, TTL reaper) — muster: **HAVE ✅** — `packages/core/src/subagents.ts` — effort S
- [x] Ledger folding (subagent spend folds into parent token ledger, no double-count) — muster: **HAVE ✅** — `packages/core/src/subagents.ts` + `tokens.ts` — effort S
- [ ] Tool surface `session_search`/`session_status`/`sessions_spawn`/`sessions_list`/`sessions_history`/`sessions_send` — muster: **PARTIAL 🟡** — `session_search` + read-only `session_status` are exposed via `tool-registry.ts`; remaining mutating/cross-session controls need visibility scopes (`self`/`tree`/`agent`/`all`) before exposure — effort M
- [ ] Agent-to-agent off by default (`tools.agentToAgent.{enabled,allow}`) — muster: **MISSING ⬜** — `tool-registry.ts` policy — effort S
- [ ] Cross-agent memory search (`memorySearch.qmd.extraCollections`) — muster: **PARTIAL 🟡** — `memory.ts` scopes (add cross-agent collection allowlist) — effort M

---

## I) Gateway / Pairing / Operator-scopes / Security

> Docs: `gateway/configuration`, `gateway/security`, `gateway/remote`, `nodes`.
> Repo backing: `fs-safe` (root-bounded FS). muster pairing is device-less today and must
> grow toward OpenClaw's device-pairing + 6 operator scopes.

- [x] HTTP gateway (single control plane, all adapters, pairing lane) — muster: **HAVE ✅** — `packages/gateway/src/server.ts` (`node:http`) — effort M
- [x] Surface message envelope (`parseSurfaceMessage()`, `conversationSessionId()`, `isPairingChallenge()`) — muster: **HAVE ✅** — `packages/gateway/src/envelope.ts` — effort M
- [x] Pairing challenge + store (`requestPairing()` idempotent unique code, `approvePairing()` mints pairingId, `pairings.json` pending/paired) — muster: **HAVE ✅** — `packages/gateway/src/pairing.ts:77-100` — effort M
- [x] Scope resolution per `surface:sender` (re-approval required for privilege escalation) — muster: **HAVE ✅** — `packages/gateway/src/pairing.ts:92-99` — effort S
- [x] Profile workspace isolation (`profileDataDir`/`profileConfigPath`/`profileHomeDir`) — muster: **HAVE ✅** — `packages/core/src/profiles.ts:35-38` — effort M
- [x] Per-profile HOME (subprocess env isolation for git/ssh/npm; closes credential/key bleed) — muster: **HAVE ✅** — `packages/core/src/profiles.ts:96-99` — effort M
- [x] `profileWorkspaceDir` sandbox root (carries `-C` for codex; prevents install-root bleed) — muster: **HAVE ✅** — `packages/core/src/profiles.ts:9` — effort M
- [x] Workspace integrity check (`checkIntegrity()` verifies .muster structure/config/schema) — muster: **HAVE ✅** — `packages/core/src/integrity.ts` — effort S
- [ ] Six operator scopes (`operator.admin`/`approvals`/`pairing`/`read`/`write`/`talk.secrets`) — muster: **PARTIAL 🟡** — `packages/gateway/src/pairing.ts` (binary paired/scope today; map the 6 named scopes) — effort M
- [ ] Device pairing (loopback auto-approve; remote requires `devices approve <requestId>`; durable record; grants operator scope; loopback-proxy bypass prevented) — muster: **PARTIAL 🟡** — `pairing.ts` (sender pairing; add device records + approve CLI + loopback rules) — effort L
- [ ] Auth modes (`gateway.auth.mode`: `token`/`password`/`trusted-proxy`; `allowTailscale`) — muster: **MISSING ⬜** — `packages/gateway/src/server.ts` auth layer — effort M
- [ ] Sandbox modes (`mode`: off/non-main/all Docker; `scope`: session/agent/shared; workspace access none/ro/rw; `tools.elevated` escape hatch) — muster: **PARTIAL 🟡** — `profiles.ts` workspace isolation (host-run; add Docker/SSH/shell backends + scope matrix) — effort L
- [ ] fs-safe-equivalent root-bounded FS (traversal/symlink/TOCTOU-safe; atomic write+identity-verify; ZIP/TAR traversal checks) backing `fs/*` handlers — muster: **PARTIAL 🟡** — `profiles.ts` workspace boundary; add hardened fs-safe layer — effort L
- [ ] Remote (bind loopback/lan/tailnet/custom/auto; SSH tunnel; Tailscale Serve; `wss://`; token precedence) — muster: **MISSING ⬜** — `packages/gateway/src/server.ts` remote/bind config — effort L
- [ ] Config infra (`$schema`/`$include`/`env.vars`/`env.shellEnv`/`${VAR}` substitution/SecretRef `env|file|exec`; `OPENCLAW_HOME`/`STATE_DIR`/`CONFIG_PATH`) — muster: **PARTIAL 🟡** — `types.ts` MusterConfig + `profiles.ts` paths; add include/secretref — effort M
- [ ] Nodes companion surface (iOS/Android/macOS: canvas.*/camera.*/screen.*/location.*; `node.invoke`; Android sms/device/notifications/contacts/calendar; command policy allow/deny) — muster: **MISSING ⬜** — `packages/gateway` nodes WebSocket + node protocol — effort XL
- [ ] Web Control UI / Talk-mode / streaming panels (Vite+Lit SPA, chat streaming, channels/cron/skills/nodes panels, MCP mgmt, PWA push) — muster: **PARTIAL 🟡** — `packages/surface`/`packages/ui` (streaming pipeline ✅; build out panels) — effort XL

---

## J) Memory

> Docs: `concepts/memory`. muster memory is scoped + governed: cross-tenant leak impossible
> by design.

- [x] Scoped memory JSONL ledger (per-`ContextObject`: id/kind/summary/sourceUri/observedAt/confidence/provenance/scopes/redactionState/links) — muster: **HAVE ✅** — `packages/core/src/memory.ts:37-48` (append-only) — effort M
- [x] Indexed memory retrieval (derived `memory.db`, SQLite scope table + FTS5 when available, LIKE fallback, JSONL rebuild on stale index) — muster: **HAVE ✅** — `packages/core/src/memory.ts` + `packages/core/test/memory.test.ts` (bench: p95 `0.446ms` on 1,200 seeded memories, no cross-scope leaks) — effort M
- [x] Memory scope types (`user:id`/`tenant:id`/`global`, visibility filtering) — muster: **HAVE ✅** — `packages/core/src/memory.ts:62-74` (cross-tenant leak impossible by design) — effort M
- [x] Memory promotion (`promoteMemory()` tracks provenance chain, requires allowGlobal) — muster: **HAVE ✅** — `packages/core/src/memory.ts:76-94` (guards silent scope elevation) — effort M
- [x] Redaction state (per-object none/partial/redacted-by-default; imports default redacted) — muster: **HAVE ✅** — `packages/core/src/memory.ts:46` — effort S
- [x] Memory recall (`recallMemory()` token-scored, recall limit, visible-in-scopes filter) — muster: **HAVE ✅** — `packages/core/src/run.ts:103-112` — effort M
- [x] Summary-below-memory-blocks render (kind+summary list, full provenance visible) — muster: **HAVE ✅** — `packages/core/src/memory.ts:116-118` — effort S
- [x] Context graph export (episodes + scoped memory as audit-able graph JSON) — muster: **HAVE ✅** — `packages/core/src/context-graph.ts` — effort M
- [ ] Markdown memory files (`MEMORY.md`, `memory/YYYY-MM-DD.md`, `DREAMS.md` + `AGENTS.md`/`SOUL.md`/`IDENTITY.md`/`USER.md`/`HEARTBEAT.md`) auto-load — muster: **PARTIAL 🟡** — `agent-rules.ts` loads AGENTS.md; add the full file set + daily-note auto-load — effort M
- [ ] Hybrid vector+keyword memory search w/ provider (`memorySearch.provider`: OpenAI/Gemini/Voyage/Mistral/local/Ollama/Bedrock) — muster: **PARTIAL 🟡** — SQLite/FTS keyword index ✅; add vector backend + provider config — effort L
- [ ] Backends (SQLite default / QMD sidecar / Honcho / LanceDB) + plugins (`memory-core` slot, `memory-wiki`) — muster: **PARTIAL 🟡** — JSONL+SQLite default ✅ (`memory.ts`); add QMD/Honcho/LanceDB + pluggable memory slot — effort L
- [ ] Budget monitor (oversized MEMORY.md stays on disk, truncates in context) — muster: **HAVE ✅** — `context-renderer.ts` progressive stubbing — effort S

---

## K) Migration fidelity (openclaw → muster as-is)

> **Faithful migration is a first-class requirement.** Every `openclaw.json` field must map
> to muster; carry skills, commands, identity files, tools, plugins; preserve the user's exact
> provider/model; create an isolated profile workspace. Docs: `docs/SETUP_AND_MIGRATION.md`,
> defects in `docs/OPENCLAW_VS_MUSTER_GAP.md`.

- [x] Dry-run scanner (`scanMigrationSource()` → MigrationDryRunReport, stat-only, never reads files defensively) — muster: **HAVE ✅** — `packages/core/src/migration.ts:85-107` — effort M
- [x] Asset classification (9 kinds: config/memory/skill/tool/workflow/agent/channel/provider/mcp + importMode map/archive_only/manual_review) — muster: **HAVE ✅** — `packages/core/src/migration.ts:10-21` — effort M
- [x] Profile creation on migrate (`createProfile()` → data + workspace + home, isolated; migration applies into profile) — muster: **HAVE ✅** — `packages/core/src/migration.ts` + `profiles.ts:61-67` — effort M
- [x] Clone without sessions (history-free fork: config+skills, excludes episodes/sessions) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`cloneProfile()`) — effort S
- [x] Faithful provider/model (preserve exact model id, never muster-force a model) — muster: **HAVE ✅** — `packages/core/src/provider.ts` + `providers-catalog.ts` — effort M
- [x] **Parse `openclaw.json` per-field** (channels/agents/skills/tools/MCP/plugins/devices; no opaque config blob) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`carryOpenclaw*` helpers + apply result counts) — effort M
- [x] **Field-level secret redaction** (secret-keyed config values become env placeholders; parser errors never echo JSON snippets) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`sanitizeRecord`, `stringRecord`, parser guards) + `packages/core/test/migration.test.ts` — effort S
- [ ] Carry channels (parse `channels.*` from openclaw.json → muster adapter config) — muster: **MISSING ⬜** — `packages/core/src/migration.ts` channel rule — effort M
- [x] Carry agents (parse `agents.defaults.skills` + selected `agents.list[]` skill visibility into profile config) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`carryOpenclawAgentSkillVisibility`) — effort M
- [x] Carry plugins (parse `plugins.allow/deny/load/slots/entries` → disabled local capability-pack policy; per-field, not blob) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`carryOpenclawPlugins`) + `packages/core/src/capability.ts` policy enforcement — effort M
- [x] Carry skills (`skills.load` + `skills.entries` → local runtime config; secret refs preserved as env refs, plaintext not copied) — muster: **HAVE ✅** — `packages/core/src/migration.ts` (`carryOpenclawSkills`) + tests — effort M
- [x] Carry commands (custom slash-commands / `customCommands` → muster command registry — see M) — muster: **HAVE ✅** — `packages/core/src/migration.ts` extracts redacted channel commands into `.muster/gateway.json` `commands.entries` — effort M
- [ ] Carry identity files (`AGENTS.md`/`SOUL.md`/`IDENTITY.md`/`USER.md`/`HEARTBEAT.md`/`MEMORY.md`) — muster: **PARTIAL 🟡** — `migration.ts` memory rule (line 49; extend to full identity set) — effort S
- [x] Carry tools/MCP (`tools.*` policy + `mcp.servers` → typed local tool/MCP config, no server process started during migration) — muster: **HAVE ✅** — `packages/core/src/types.ts` `ToolRuntimeConfig` + `packages/core/src/migration.ts` (`carryOpenclawTools`, `extractMcpServers`) — effort M
- [ ] Carry flows (`tasks flow` / workflow defs → muster flow store) — muster: **MISSING ⬜** — `packages/core/src/migration.ts` flow rule — effort M
- [x] Carry devices (source device/account/scope metadata → gateway device records, imported unapproved so pairings are visible but not trusted silently) — muster: **HAVE ✅** — `packages/gateway/src/gateway-config.ts` + `packages/core/src/migration.ts` (`carryOpenclawDevices`) — effort M
- [ ] Remove 4 phantom rules probing non-existent paths; add the 4 real missing dirs (agents/flows/extensions/devices) — muster: **PARTIAL 🟡** — `packages/core/src/migration.ts` (see `docs/OPENCLAW_VS_MUSTER_GAP.md`) — effort S

> **Better than OpenClaw:** OpenClaw has no faithful export/import — config drift and secret
> leakage are routine. muster's migration is dry-run-first (stat-only, never reads
> defensively), redacts secrets at field level, and lands every asset into an isolated profile
> workspace so a migration can never poison the active profile.

---

## L) MCP

> Docs: `gateway/cli-backends` (bundleMcp), `web/control-ui` (MCP server management).
> Known scar: OpenClaw issue #70909 (claude-cli dropped user `mcp.servers`). muster routes
> MCP results through the same size-cap + persistence pipeline as built-in tools.

- [x] MCP client (minimal JSON-RPC 2.0 over stdio, no SDK dependency) — muster: **HAVE ✅** — `packages/core/src/mcp.ts` (newline-delimited JSON, line 60) — effort M
- [x] Per-server circuit breaker (`BREAKER_THRESHOLD=3`, one bad server isolated) — muster: **HAVE ✅** — `packages/core/src/mcp.ts:30-39` (fixes #34443) — effort S
- [x] MCP server supervision (StdioTransport spawns process, graceful exit) — muster: **HAVE ✅** — `packages/core/src/mcp.ts:30-68` — effort M
- [x] MCP results through size-cap + persistence (same pipeline as built-in tools) — muster: **HAVE ✅** — `packages/core/src/mcp.ts` + `context-renderer.ts` (fixes #44172) — effort S
- [ ] Preserve user `mcp.servers` across CLI backends (the #70909 scar — do NOT drop them) — muster: **PARTIAL 🟡** — `packages/core/src/{mcp.ts,claude.ts}` (ensure user servers survive into claude-cli config) — effort M
- [ ] `bundleMcp` loopback HTTP MCP server (gateway tools → CLI backend, per-session token) — muster: **MISSING ⬜** — see A `bundleMcp` item — effort L
- [ ] MCP transport/auth/filters/OAuth + Control-UI management panel — muster: **PARTIAL 🟡** — `mcp.ts` stdio (add HTTP transport, auth, filters; UI later) — effort L
- [ ] Mount Peekaboo / gogcli as MCP servers — muster: **MISSING ⬜** — `mcp.ts` config entries (see E) — effort L

---

## M) Custom slash-commands

> OpenClaw exposes `user-invocable` skills as slash commands, plus per-channel
> `customCommands` and built-in `/new`/`/reset`/`/stop`. Docs: `tools/skills`,
> `concepts/agent-loop` (command hooks). muster needs the dispatcher + workspace wiring.

- [x] Gateway `/command` dispatcher (parse leading-slash, route to handler, per-surface) — muster: **HAVE ✅** — `packages/gateway/src/commands.ts` + `packages/gateway/src/server.ts` (builtins first, skills second, native CLI passthrough third) — effort M
- [x] Built-in commands `/new` / `/reset` / `/stop` (command hooks `command:new`/`reset`/`stop`) — muster: **HAVE ✅** — `packages/gateway/src/commands.ts` handles lifecycle commands before the model; `/new` + `/reset` clear provider session handles only, `/stop` is a no-op acknowledgement until active-run cancellation lands — effort S
- [x] `user-invocable` skills as slash commands (default true; `disable-model-invocation`) — muster: **HAVE ✅** — `resolveSkillCommand()` + `handleSurfaceMessage()`; prompt-dispatch rewrites the model prompt, command-only skills stay out of ambient model injection — effort M
- [x] `command-dispatch:"tool"` / `command-tool` / `command-arg-mode:"raw"` skill command routing — muster: **HAVE ✅** — Hermes-fast path: gateway calls the registry tool directly and test asserts `modelCalls === 0` — effort M
- [x] Per-channel `customCommands` registry — muster: **HAVE ✅** — `packages/gateway/src/gateway-config.ts` + `commands.ts` resolve declarative `commands.entries` by exact surface or prefix before skill/native passthrough — effort M
- [x] Workspace wiring for command runs (dispatcher resolves profile workspace + runtime before exec) — muster: **HAVE ✅** — `handleSurfaceMessage()` resolves `activeProfile()` + `profileWorkspaceDir()` before `executeRun()` — effort M

---

## Prioritized BUILD ORDER

> Ordered by dependency + leverage. DONE items are checked; NEXT items unblock the most
> downstream parity. Each step lists the gating file(s).

### DONE (verified, 386 tests green)

- [x] **Codex runtime** — full-power `codex exec --json`, native tools, events+final parse — `packages/core/src/codex.ts`
- [x] **Codex thread_id resume + instructions-file injection** (memory/skills at system level) — `packages/core/src/codex.ts:29,70,79` + `run.ts:49-50`
- [x] **`profileWorkspaceDir` sandbox** — per-profile workspace isolation, prevents install-root bleed — `packages/core/src/profiles.ts:9`
- [x] **`run.ts` codex branch** — memory→system instructions, thread_id persistence, resume contract — `packages/core/src/run.ts:1-150`
- [x] **`resolveTarget` codex → runtime `"codex"`** — faithful migration: a codex source maps to the full-power codex runtime (gpt-5.5 stays codex, never remapped to Claude) — `packages/core/src/migration.ts:323` (15 migration tests green)
- [x] **Claude Code runtime (one-shot)** — `claude -p`, append-system-prompt, model/effort/tools — `packages/core/src/claude.ts`
- [x] **Pi embedded runtime** — live delta streaming, session persistence — `packages/core/src/pi.ts`
- [x] **Streaming / compaction / sessions / memory / subagents / hooks cores** — all HAVE ✅ (sections F/H/J)
- [x] **Interactive terminal chat** — `muster chat`, named `--session`, `/resume`, `/history`, `/memory`, `/tokens`, `/new`, `/reset`, `@agent` route hint; non-TTY-safe one-shot path remains — `packages/cli/src/index.ts`

### NEXT (in order)

1. [x] **`resolveTarget` codex → runtime `"codex"`** — DONE (migration.ts:323, 15 tests green).
2. [x] **Gateway `/command` dispatcher + workspace wiring** — DONE: `packages/gateway/src/commands.ts` (builtins `/start /pair /status /help /new /reset /stop`, path-safe parser, skill-command resolver, native passthrough) wired into `handleSurfaceMessage` before the model; runs in `profileWorkspaceDir` (cwd-escape closed); optional `MUSTER_CODEX_HOME`. 78 gateway tests green incl. integration proof the model is not called for builtins, lifecycle commands, or tool-dispatch skills. — `packages/gateway/src/server.ts` + `profiles.ts` + `run.ts` + `packages/core/src/{skills.ts,session-handle.ts}` — effort M
3. [x] **Migration carry (as-is)** — DONE for config-level carry: identity, workspace, channel custom commands, agent skill visibility, skills runtime config, tools/MCP policy, disabled plugin policy, and visible unapproved device records. Remaining migration work is now narrower: channel adapter policy, identity-file import, and flow import. — `packages/core/src/migration.ts` + `packages/core/src/types.ts` + `packages/gateway/src/gateway-config.ts`
4. [ ] **ACP claude-code persistent session** — `liveSession:"claude-stdio"` warm process, `sessionMode`, `sessionArg`/`resumeArgs`, follow-up reuse — `packages/core/src/claude.ts` — effort L
5. [ ] **Loopback MCP (`bundleMcp`)** — per-session HTTP MCP server exposing gateway tools to CLI backends, scoped `OPENCLAW_MCP_TOKEN`; preserve user `mcp.servers` (#70909 scar) — `packages/core/src/mcp-loopback.ts` + `mcp.ts` + `claude.ts` — effort L
6. [x] **Skills snapshot for claude-cli (`--plugin-dir`)** — DONE: eligible active skills export to a per-run Claude plugin dir, Claude receives `--plugin-dir`, duplicate skill catalog is omitted from the system prompt, and the temp plugin is cleaned after the run. — `packages/core/src/{skills.ts,claude.ts,run.ts}` + focused fake-Claude tests — effort M
7. [ ] **Browser + web-search packs** — PARTIAL: `web_search` now covers DuckDuckGo HTML + Brave JSON with 15-minute cache, bounded results, injected fetch, and the same SSRF/allowlist guard as `web_fetch`; `tool_search`/`tool_describe`/`tool_call` now cover compact catalog discovery and guarded call-through; remaining work is Playwright browser automation, `x_search`, and broader provider packs (Tavily/Exa/Firecrawl/…) — `packages/core/src/tool-registry.ts` — effort L
8. [ ] **Remaining ACP backends + `compare`/custom-agent** — gemini/cursor/copilot/droid + generic `--agent` ACP-stdio adapter; `compare` across backends — `packages/core/src/*.ts` + `packages/cli` — effort XL
9. [ ] **Operator scopes + device pairing** — map the 6 named scopes; device records + `devices approve`; loopback auto-approve vs remote explicit — `packages/gateway/src/pairing.ts` — effort L
10. [ ] **Channel expansion + nodes + Control UI panels** — additional transports toward 24+, nodes companion protocol, web Control-UI management panels — `packages/gateway/src/adapters/*` + `packages/{surface,ui}` — effort XL

---

*muster IS feature-parity with OpenClaw at the code level for the core runtime/streaming/
sessions/memory/subagents/migration-scaffolding tiers (386 tests green). The open items above
are the explicit, file-pinned remainder — and OpenClaw's scars (issue numbers cited inline)
are prepaid tuition, not bugs we re-inherit.*
