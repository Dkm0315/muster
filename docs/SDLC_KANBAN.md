# Muster Codex SDLC Kanban

Goal:
Build Muster v0 as an npm/pnpm-first, pi.dev-bedrock adaptive harness runtime with optional personas, pluggable agent runtimes, smoother auth/pairing direction, migration dry-runs, evidence-aware feedback, and a Terminal Cockpit web UI.

## Board

| ID | Status | Owner | Outcome | Scope | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| HC-001 | Done | Architect Agent | Product contract captured | `docs/ARCHITECTURE.md`, `README.md` | None | Product rules mention pi.dev bedrock, optional personas, one runtime per run, evidence-aware feedback |
| HC-002 | Done | Backend Engineer | Core config/routing/provider foundations | `packages/core/src/config.ts`, `router.ts`, `provider.ts`, `types.ts` | HC-001 | `pnpm typecheck && pnpm test` |
| HC-003 | Done | CLI Engineer | Initial CLI operator surface | `packages/cli/src/index.ts` | HC-002 | `pnpm hc init && pnpm hc doctor` |
| HC-004 | Done | Frontend Engineer | Option 1 Terminal Cockpit skeleton | `packages/ui/*` | HC-001 | `pnpm --filter @musterhq/ui build` |
| HC-005 | Done | Backend Engineer | Real migration dry-run scanners | `packages/core/src/migration.ts`, `packages/cli/src/index.ts`, tests | HC-002, HC-003 | `pnpm hc migrate openclaw --dry-run`, `hermes`, and `pi` return discovered/absent state without throwing |
| HC-006 | Done | CLI Engineer | Provider add/list commands | `packages/core/src/config.ts`, `packages/cli/src/index.ts`, tests | HC-002 | Operator can add an OpenAI-compatible provider and list configured providers |
| HC-007 | Done | Test Engineer | Eval candidate artifact output | `packages/core/src/feedback.ts`, `store.ts`, CLI feedback path, tests | HC-002, HC-003 | Negative/positive feedback emits persisted learning candidates and `pnpm test` covers classifications |
| HC-008 | Done | Integrator | UI reads local runtime state | `packages/ui`, future API/static state bridge | HC-004, HC-005, HC-007 | UI renders exported recent episodes, feedback, candidates, and labels fallback/invalid state clearly |
| HC-009 | Done | Docs Engineer | Personal setup and migration docs | `README.md`, `docs/ARCHITECTURE.md`, `docs/SETUP_AND_MIGRATION.md` | HC-005, HC-006 | Docs show clean install, doctor, provider setup, migration dry-run, chat, feedback, candidates, and Terminal Cockpit state export |
| HC-010 | Done | QA Agent | Command-only QA pass | Real CLI commands only | HC-005, HC-006, HC-007, HC-009 | Typecheck, tests, build, doctor, migration dry-runs, state show/export, and served static UI state probe completed |
| HC-011 | Done | Memory Architect | Scoped memory contract | `packages/core/src/types.ts`, `docs/PRODUCT_WEDGE.md`, `docs/ARCHITECTURE.md` | HC-001, HC-007 | Memory model distinguishes tenant, user, pairing, session, role, persona, and global scopes |
| HC-012 | Ready | UI Engineer | Runtime bridge for cockpit controls | `packages/ui`, future local bridge/API | HC-008 | Stop/Steer/Modify, composer, and feedback buttons are wired or remain visibly disabled |
| HC-013 | Done | Terminal Engineer | Terminal/TUI cockpit | `packages/cli/src/index.ts` | HC-008 | `muster tui` renders latest run, response, feedback, and candidates without the web UI; `tui ask` records prompt outcomes |
| HC-014 | Done | Runtime Engineer | pi.dev embedded SDK boundary | `packages/core/src/pi.ts`, `packages/cli/src/index.ts` | HC-001 | `muster pi inspect` verifies the installed Pi SDK exports and detects pi root/workflows |
| HC-015 | Done | Trust Kernel Engineer | Trust Kernel execution envelope | `packages/core` | HC-011, HC-014 | Runs persist route, permissions, scoped context, evidence ledger, blockers, and promotion candidates |
| HC-016 | Done | QA Engineer | CLI smoke tests and CI pipeline | `packages/cli/test`, `.github/workflows` | HC-013, HC-014 | CLI has real tests and GitHub Actions validates typecheck/test/build/smoke |
| HC-017 | Done | Runtime Engineer | Real Pi embedded SDK adapter | `packages/core/src/pi.ts`, `packages/cli/src/index.ts`, tests | HC-014, HC-015 | `muster pi ask` creates a Pi `AgentSession` through the published SDK and records the result as a Muster episode; CLI transport is diagnostic only |
| HC-018 | Ready | Release Engineer | GitHub PR and release publication | GitHub remote | HC-016 | Changes are split into PRs, merged, tagged, and release workflow is run |
| HC-019 | Done | Capability Engineer | Capability pack manifest gate | `packages/core/src/capability.ts`, `packages/cli/src/index.ts`, tests | HC-015 | `muster capability inspect <path>` validates manifest shape, permissions, sandbox, secrets, evals, and digest warnings |
| HC-020 | Done | Memory Engineer | Scoped memory ledger | `packages/core/src/memory.ts`, `packages/cli/src/index.ts`, tests | HC-011, HC-015 | `muster memory add/search/promote` persists ContextObjects and proves global search cannot read user/session/private memory |
| HC-021 | Done | Eval Engineer | Replayable eval fixture runner | `packages/core/src/eval.ts`, `packages/cli/src/index.ts`, tests | HC-007, HC-015 | `muster eval seed <episode>` writes a fixture and `muster eval run` reports pass/fail checks |
| HC-022 | Ready | Runtime Engineer | Deeper Pi session and extension bridge | `packages/core/src/pi.ts`, future adapter | HC-017 | Muster can configure Pi sessions/extensions/tools directly without hiding Pi's native runtime |

## Agent Assignments

### Backend Engineer: HC-005 Migration Scanners

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own only this scope: `muster/packages/core/src/migration.ts`, `muster/packages/core/src/index.ts`, `muster/packages/core/test/migration.test.ts`, and the `migrate` branch inside `muster/packages/cli/src/index.ts`.

Implement dry-run scanners for `openclaw`, `hermes`, and `pi`. They must never mutate external state. They should inspect conventional home-directory paths and return a structured report with found paths, missing paths, candidate assets, archive-only notes, and recommended next actions. Keep the scanner deterministic and testable by allowing a custom home directory.

### CLI Engineer: HC-006 Provider Commands

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own only provider config command paths in `packages/core/src/config.ts`, `packages/cli/src/index.ts`, and focused tests. Add `provider list` and `provider add-openai-compatible <id> <base-url> <model>`.

### Test Engineer: HC-007 Eval Candidate Artifacts

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own feedback/eval persistence code only. Ensure feedback candidates are persisted and can be inspected through a command. Cover disagreement episodes and verified success.

## Integration Gate

Run from `muster/`:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm hc init
pnpm hc doctor
pnpm hc migrate openclaw --dry-run
pnpm hc migrate hermes --dry-run
pnpm hc migrate pi --dry-run
```

## QA Gate

Use only real user/operator commands in a fresh temporary directory:

```bash
pnpm dlx ./path-to-muster init
muster doctor
muster provider list
muster migrate openclaw --dry-run
muster migrate hermes --dry-run
muster migrate pi --dry-run
```

For v0, a red provider connectivity check is acceptable when no local Ollama/OpenAI-compatible server is listening; it must be reported clearly by `doctor`.


## 2026-06-10 beast sprint (feature/phase123-beast)

| Card | Outcome | Status |
| --- | --- | --- |
| HC-023 | Pi SDK 0.79.1 bump (Fable 5 adaptive thinking, project trust) | Done |
| HC-024 | `hc run`: real run loop with scoped-memory recall injection, episode + token recording | Done |
| HC-025 | Token ledger: `hc tokens` + `tui /tokens` CLI tables, replay-waste detection, cost estimates | Done |
| HC-026 | Profiles: isolated config + data stores (`hc profile create/use/list`) | Done |
| HC-027 | Scheduler: cron jobs via `hc schedule add/list/remove/run-due` (external cron, no daemon) | Done |
| HC-028 | Governed model fallback: `routing.fallbacks`, recorded as evidence, never silent | Done |
| HC-029 | `hc verify`: store integrity, duplicate run ids, silent model drift, stale-narrative poisoning | Done |
| HC-030 | `hc evolve`: recursive suite runner + harness self-checks from OpenClaw/Hermes failure modes; live-converged 6/6 with Claude (haiku) | Done |
| HC-031 | Provider preset catalog (20 presets: OpenAI, Anthropic API, xAI, Kimi, DeepSeek, Groq, Ollama, OpenRouter, vLLM, ...) + native Anthropic Messages API + claude-code runtime | Done |
| HC-032 | Frappe capability pack v0: identity/data/create tools, loader-enforced permissions | Done |

Quality gate at sprint close: 74 core tests + 15 CLI tests green; live smoke (init -> profile -> provider add -> run via claude-code with memory recall -> tokens -> verify -> evolve) all passing.

## 2026-06-11 flow engine (feature/flow-engine)

| Card | Outcome | Status |
| --- | --- | --- |
| HC-033 | Flow engine slice 1: `packages/core/src/flow.ts` (tool/agent/gate steps, parse + preflight validation, `{{stepId.field}}` templates, durable JSONL run store at `.muster/data/flows/<runId>.jsonl`, resumable gates with expiry, `budgetTokens` ceiling) + `muster flow save/list/check/run/runs/show/approve/reject` CLI with built-in `echo` tool | Done |
| HC-034 | Flow replay & diff (`flow replay <run> --against <run>`) | Done |
| HC-035 | Scheduler binding (`flow loop <id> --cron`) | Done |
| HC-036 | Channel approvals (Telegram/CLI parity) and dry-run previews in gate payloads | Ready |

| HC-037 | Surface gateway slice 1: envelope, pairing lane, governed dispatch, per-surface tokens | Done |
| HC-038 | Telegram + Slack adapters (pure mappers + webhook routes) | Done |
| HC-039 | @musterhq/surface zero-dep web client + HTML demo | Done |
| HC-040 | Capability-pack loader with contractual permission enforcement | Done |
| HC-041 | Discord + WhatsApp + Google Chat + Teams adapters (pure mappers, verification handshakes, webhook routes) | Done |
| HC-042 | `muster status` mission-control overview + `muster doctor --fix` workspace bootstrap | Done |
| HC-043 | Discord ed25519 interaction signature verification (X-Signature-Ed25519/X-Signature-Timestamp over raw body, `discord.publicKey` config, 401 on mismatch; zero-dep via SPKI DER wrap + node:crypto) | Done |

| HC-046 | Streaming core: StreamEvent, fence-aware coalescer, finalize FSM | Done |
| HC-047 | Gateway draft streaming (Telegram/Slack) + retry_after queues | Done |
| HC-048 | Typed hook bus (8 hooks, block-terminal, timeout-pass) wired into run loop | Done |

| HC-044 | Context renderer: immutable transcript, progressive tool-result stubbing, result_fetch | Done |
| HC-045 | SQLite session store + 4-shape session_search (FTS5, single-writer) | Done |
| HC-049 | Eval-gated skill loop: quarantined candidates, gate promotion, top-K injection, telemetry, curator | Done |
| HC-050 | MCP client: zero-dep JSON-RPC (stdio+HTTP), per-server isolation, circuit breaker, capped results | Done |
| HC-051 | Pull-based subagents: durable run store, claim-exactly-once, depth/concurrency caps, TTL reaper, ledger folding | Done |
| HC-052 | Pulse scheduler: zero-LLM preflight, daily budget kill-switch, deterministic quiet-suppression | Done |
| HC-053 | Never-wedge compactor: deterministic-first, model-optional, hard-truncate guarantee | Done |
| HC-054 | JSON-RPC gateway protocol: stdio+event transport, contract versioning, single-use tickets, ledger.tick | Done |
| HC-055 | Profiles v2 (home/ credential isolation, clone-without-sessions), MEDIA: tags, gateway idempotency | Done |
| HC-056 | Tool registry v2: declarative entries, composable toolsets, SSRF/allowlist gates, result caps, flow bridge | Done |
| HC-057 | Browser tool (Playwright-backed, flat contract, a11y snapshots) | Ready — deferred to browser milestone |
| HC-058 | CLI surface for sessions/skills/pulse/subagents + muster demo (provisioned stub service); CLI run persists sessions | Done |
| HC-059 | Production setup: npm publish config (files/publishConfig/prepublishOnly), pnpm-publish release workflow, LICENSE/CONTRIBUTING/CHANGELOG, v0.1.0, Fable 5 default | Done |
