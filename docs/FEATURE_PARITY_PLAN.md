# Feature Parity Plan — reuse the battle-tested, re-model it leaner

Source: docs/teardowns/OPENCLAW_TEARDOWN.md + HERMES_TEARDOWN.md. Strategy per
Dhairya: their open-source history is reusable knowledge; we bundle everything in
ONE monorepo (their externalization post-mortems confirm this), re-modeled without
their scar tissue. Every item names its tuition (the issues we don't have to repay).

## Wave 1 — foundation (do first; everything else gets cheaper)
| # | Feature | Source | Re-model fix | Tuition prepaid |
|---|---|---|---|---|
| 1 | Context renderer: immutable transcript + progressive tool-result stubbing + result_fetch(id) | Hermes #14948 (they refused it) | Pure render(transcript, budget) per call; never mutate history; summary below memory blocks | 57-82% token cut; #17251 memory demotion |
| 2 | Streaming core: StreamEvent → coalescer → DraftSink per channel, explicit finalize() FSM | OpenClaw (their best subsystem) | Final is an event, never content-dedupe inference; Retry-After queue from day 1 | dup-finals/lost-text/truncation family |
| 3 | SQLite session store + FTS5 session_search (one tool, 4 shapes) + async titles | Hermes (cleanest subsystem) | Single-writer via gateway; token_count per message; merge with token ledger | #5563 corruption + replay waste |
| 4 | Hook bus: ~8 typed decision hooks, in-repo only | OpenClaw hook API | No runtime installs, one version | the whole "rough week" class |

## Wave 2 — capability (the compete-features)
| # | Feature | Source | Re-model fix |
|---|---|---|---|
| 5 | Eval-gated skill loop: SKILL.md + quarantine CandidateSkill → eval-gate promotion → top-K budgeted injection + telemetry sidecar + curator | Hermes marquee | Fixes their #25833 (no correctness mechanism) with OUR gate; #22620 (index bloat) with top-K; extractor = tool-whitelisted child |
| 6 | MCP client: per-server isolated supervision, circuit breaker, namespaced tools, results through the same cap/ledger pipeline | Hermes | #34443/#44172/#14113 fixed by construction |
| 7 | Subagents: spawn contract + CHILD_BLOCKED + depth caps (OpenClaw params) + PULL-based RunStore result delivery + async fan-out + ledger folding | both | kills OpenClaw's announce zombie family |
| 8 | Pulse scheduler: unify heartbeat + cron — deterministic preflight BEFORE any LLM call, LLM-emits-grammar parsing, at-most-once + fast-forward, per-job USD budget, [SILENT]/MEDIA: conventions | both | OpenClaw 47M-tokens/day heartbeat; alive-feel at ~5% cost |
| 9 | Compactor + memory-flush turn: deterministic-first, never-wedge ("a session can always take a turn") | OpenClaw concept | #15720/#699 deadlocks impossible |

## Wave 3 — distribution & polish
| # | Feature | Source |
|---|---|---|
| 10 | JSON-RPC gateway protocol: ONE protocol over stdio+WS, integer contract version, 30s single-use WS tickets, event vocab incl. ledger.tick (live cost in UI) | Hermes desktop — prereq for Tauri apps |
| 11 | Tool registry v2: declarative ToolEntry + toolsets + ~14 first-party tools; integrations via MCP only | Hermes |
| 12 | Browser tool: wrap Playwright behind flat one-tool contract, ref-based a11y snapshots, SSRF gate, tab reaper | OpenClaw contract; never build CDP |
| 13 | Skill index injection (metadata-only ~100 chars/skill) + publisher-allowlisted, hash-pinned distribution | OpenClaw post-ClawHavoc design |
| 14 | Profiles v2: home/ subprocess-credential isolation; clone-without-sessions | Hermes |
| 15 | MEDIA: tags + sentence-buffered streaming TTS (2 providers max) | Hermes |
| 16 | Gateway protocol hardening: pairing-store-only scopes, finite jittered reconnect, invoke idempotency dedupe | OpenClaw |

## Standing rules for every port
- Bundle in-monorepo; single version; no runtime installation of anything.
- Their issue list is our regression test plan — encode each cited failure as a test.
- Token ledger touches everything: skills get receipts, schedulers get budgets,
  subagent spend folds into parents, UI gets ledger.tick. Optimize first.
