# OpenClaw teardown — what to port, fix, and avoid (2026-06-11)

Implementation-level mining of github.com/openclaw/openclaw (MIT). Verdicts drive
docs/FEATURE_PARITY_PLAN.md. Full issue citations in the research transcript;
key ones inline.

## Verdict table

| Subsystem | Verdict | Core lesson |
|---|---|---|
| Streaming pipeline | **port-with-fixes** | Their best subsystem. Layering: typed agent events → coalescer (800–1200 chars, 1s idle, paragraph-pref breaks) → per-channel draft loop (latest-wins, single-flight, edit-throttle, 4096 rollover). ALL their bugs live at the preview→final seam (dup finals #33492/#84623, lost pre-tool text #19275, silent truncation #84563, hooks bypassed #61550). Fix: explicit `finalize()` FSM — final is an event, never inferred from content dedupe. Port Discord's Retry-After bucketed scheduler, not Telegram's kill-draft-on-error. |
| Session model | **port-with-fixes** | Keys `agent:channel:peerKind:peerId`; their default dmScope "main" is a privacy hazard — ours is per-channel-peer. JSONL transcripts good; their 40-field SessionEntry bad (<10 fields + side tables). Compaction is reactive AND requires a model call → wedge deadlocks (#15720, #699, #8077). Fix invariant: a session can ALWAYS take a turn — deterministic-first compaction (drop old tool results → chunked summaries → hard truncate), never blocks. Validate tool pairs at WRITE time, never repair at read (#75235, #12029). KEEP their memory-flush idea: silent pre-compaction turn persisting durable state. |
| Heartbeat + cron | **port-concept, redesign mechanism** | HEARTBEAT.md checklist + suppress-if-quiet UX is gold; implementation is a money pit (47.6M tokens/day #21597; 2M/day idle #64293) because every tick = full-context model call + magic string token. Re-model: unified Pulse scheduler — cheap deterministic preflight (due tasks? file mtime? queue depth?) BEFORE any LLM call, isolated light-context session, structured {surface:bool} result, daily token budget kill-switch, hard tool-allowlist. |
| Subagents | **port-contract, avoid announce** | Spawn params (task, agentId allowlist, isolated|fork context, depth≤5, concurrency caps, inherited tool-deny) are well designed. The push-based announce-back (steering queue + gateway WS + lease/ack) is their least reliable seam (dropped results #17000/#22273/#45075, 27-day zombies #88205). Re-model: durable RunStore, PULL-based — parent drains completed results at next turn start; TTL reaper marks orphans. No announce class of bugs by construction. |
| Skills (SKILL.md) | **port-concept (post-pain design)** | Metadata-only prompt injection (~100 chars/skill, read-on-demand) — they paid 166K-token tuition (#21999) to learn this; start there. Gates (bins/env/os) at load; lockfile pinning. AVOID: silent truncation (report dropped), single-line-JSON metadata (use YAML), open registry (ClawHavoc: ~1,184 trojanized skills — allowlist publishers + hash-pinned installs only). |
| Browser tool | **avoid rebuilding; port tool surface** | Don't write a CDP layer. Wrap Playwright behind their excellent agent contract: ONE flat `browser` tool (flat because provider validators reject nested unions), accessibility-tree snapshots with stable refs (act on refs, not selectors), SSRF allowlist on navigate, tab reaper (idle 120m/max 8), profile-per-workspace with pid lockfile (kills zombie-port class #41750/#75366). |
| Gateway WS protocol | **port-with-fixes** (we partly mirror) | req/res/event frames, nonce-signed device identity, operator scopes vs node claims: solid. Fixes: scopes resolve ONLY from the pairing store (their #48229 bind-mode confusion — already in our memory as the device-pairing lesson), finite jittered reconnect (#45469 infinite storms), halt-and-surface on protocol mismatch, server-side idempotency dedupe for invoke. |
| Plugin runtime | **port hook API; avoid packaging model entirely** | ~8 typed decision hooks (prompt.build, tool.before/after, outbound.before, compaction.before, session lifecycle) with priority+timeout, block-is-terminal. Their runtime-install + external-package model caused the "rough week": workspace:* tarballs (#12853), CalVer floor breakage (#77293), npm hoisting MODULE_NOT_FOUND (#61787), repair loops in startup path. **Muster: everything in-repo, one version, no runtime install — this bug class cannot exist.** |

## Monorepo ruling (Dhairya's bundling instinct: CONFIRMED)
Their channel externalization to @openclaw/* packages was directionally defensible
but execution-wise "the most damaging decision in the project's history" (their own
post-mortem). At our scale: bundle everything, single version, pnpm workspace.
Externalize never — until a publish pipeline integration-tests the actual tarball.

## Ranked build-next (value ÷ effort)
1. Streaming core (StreamEvent + DraftSink + finalize FSM) — P0 felt gap
2. Session keys + JSONL + write-validated tool pairs + never-wedge compactor
3. Hook bus (~8 typed hooks, in-repo)
4. Pull-based subagent RunStore
5. Skill index (metadata-only injection + lockfile)
6. Budget-driven compactor + memory flush turn
7. Pulse scheduler (heartbeat+cron unified, preflight-gated)
8. Gateway protocol hardening (pairing-store scopes, finite reconnect, idempotency)

Skip/buy: CDP layer (wrap Playwright), open registry, runtime plugin install.
