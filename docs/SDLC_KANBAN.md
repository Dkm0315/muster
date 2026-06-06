# HybrowClaw Codex SDLC Kanban

Goal:
Build HybrowClaw v0 as an npm/pnpm-first, pi.dev-bedrock adaptive harness runtime with optional personas, pluggable agent runtimes, smoother auth/pairing direction, migration dry-runs, evidence-aware feedback, and a Terminal Cockpit web UI.

## Board

| ID | Status | Owner | Outcome | Scope | Dependencies | Acceptance |
|---|---|---|---|---|---|---|
| HC-001 | Done | Architect Agent | Product contract captured | `docs/ARCHITECTURE.md`, `README.md` | None | Product rules mention pi.dev bedrock, optional personas, one runtime per run, evidence-aware feedback |
| HC-002 | Done | Backend Engineer | Core config/routing/provider foundations | `packages/core/src/config.ts`, `router.ts`, `provider.ts`, `types.ts` | HC-001 | `pnpm typecheck && pnpm test` |
| HC-003 | Done | CLI Engineer | Initial CLI operator surface | `packages/cli/src/index.ts` | HC-002 | `pnpm hc init && pnpm hc doctor` |
| HC-004 | Done | Frontend Engineer | Option 1 Terminal Cockpit skeleton | `packages/ui/*` | HC-001 | `pnpm --filter @hybrowclaw/ui build` |
| HC-005 | Done | Backend Engineer | Real migration dry-run scanners | `packages/core/src/migration.ts`, `packages/cli/src/index.ts`, tests | HC-002, HC-003 | `pnpm hc migrate openclaw --dry-run`, `hermes`, and `pi` return discovered/absent state without throwing |
| HC-006 | Done | CLI Engineer | Provider add/list commands | `packages/core/src/config.ts`, `packages/cli/src/index.ts`, tests | HC-002 | Operator can add an OpenAI-compatible provider and list configured providers |
| HC-007 | Done | Test Engineer | Eval candidate artifact output | `packages/core/src/feedback.ts`, `store.ts`, CLI feedback path, tests | HC-002, HC-003 | Negative/positive feedback emits persisted learning candidates and `pnpm test` covers classifications |
| HC-008 | Done | Integrator | UI reads local runtime state | `packages/ui`, future API/static state bridge | HC-004, HC-005, HC-007 | UI renders exported recent episodes, feedback, candidates, and labels fallback/invalid state clearly |
| HC-009 | Done | Docs Engineer | Personal setup and migration docs | `README.md`, `docs/ARCHITECTURE.md`, `docs/SETUP_AND_MIGRATION.md` | HC-005, HC-006 | Docs show clean install, doctor, provider setup, migration dry-run, chat, feedback, candidates, and Terminal Cockpit state export |
| HC-010 | Done | QA Agent | Command-only QA pass | Real CLI commands only | HC-005, HC-006, HC-007, HC-009 | Typecheck, tests, build, doctor, migration dry-runs, state show/export, and served static UI state probe completed |
| HC-011 | Done | Memory Architect | Scoped memory contract | `packages/core/src/types.ts`, `docs/PRODUCT_WEDGE.md`, `docs/ARCHITECTURE.md` | HC-001, HC-007 | Memory model distinguishes tenant, user, pairing, session, role, persona, and global scopes |
| HC-012 | Ready | UI Engineer | Runtime bridge for cockpit controls | `packages/ui`, future local bridge/API | HC-008 | Stop/Steer/Modify, composer, and feedback buttons are wired or remain visibly disabled |
| HC-013 | Done | Terminal Engineer | Terminal/TUI cockpit | `packages/cli/src/index.ts` | HC-008 | `hybrowclaw tui` renders latest run, response, feedback, and candidates without the web UI; `tui ask` records prompt outcomes |
| HC-014 | Done | Runtime Engineer | pi.dev adapter boundary | `packages/core/src/pi.ts`, `packages/cli/src/index.ts` | HC-001 | `hybrowclaw pi inspect` detects pi root/workflows and states next adapter actions |
| HC-015 | Done | Trust Kernel Engineer | Trust Kernel execution envelope | `packages/core` | HC-011, HC-014 | Runs persist route, permissions, scoped context, evidence ledger, blockers, and promotion candidates |
| HC-016 | Done | QA Engineer | CLI smoke tests and CI pipeline | `packages/cli/test`, `.github/workflows` | HC-013, HC-014 | CLI has real tests and GitHub Actions validates typecheck/test/build/smoke |
| HC-017 | Ready | Runtime Engineer | Real pi.dev execution adapter | `packages/core`, `packages/cli` | HC-014, HC-015 | A pi flow can be invoked through the Trust Kernel and its outputs become scoped ContextObjects |
| HC-018 | Ready | Release Engineer | GitHub PR and release publication | GitHub remote | HC-016 | Changes are split into PRs, merged, tagged, and release workflow is run |
| HC-019 | Done | Capability Engineer | Capability pack manifest gate | `packages/core/src/capability.ts`, `packages/cli/src/index.ts`, tests | HC-015 | `hybrowclaw capability inspect <path>` validates manifest shape, permissions, sandbox, secrets, evals, and digest warnings |
| HC-020 | Done | Memory Engineer | Scoped memory ledger | `packages/core/src/memory.ts`, `packages/cli/src/index.ts`, tests | HC-011, HC-015 | `hybrowclaw memory add/search/promote` persists ContextObjects and proves global search cannot read user/session/private memory |

## Agent Assignments

### Backend Engineer: HC-005 Migration Scanners

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own only this scope: `hybrowclaw/packages/core/src/migration.ts`, `hybrowclaw/packages/core/src/index.ts`, `hybrowclaw/packages/core/test/migration.test.ts`, and the `migrate` branch inside `hybrowclaw/packages/cli/src/index.ts`.

Implement dry-run scanners for `openclaw`, `hermes`, and `pi`. They must never mutate external state. They should inspect conventional home-directory paths and return a structured report with found paths, missing paths, candidate assets, archive-only notes, and recommended next actions. Keep the scanner deterministic and testable by allowing a custom home directory.

### CLI Engineer: HC-006 Provider Commands

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own only provider config command paths in `packages/core/src/config.ts`, `packages/cli/src/index.ts`, and focused tests. Add `provider list` and `provider add-openai-compatible <id> <base-url> <model>`.

### Test Engineer: HC-007 Eval Candidate Artifacts

You are not alone in the codebase. Do not revert or overwrite unrelated changes. Own feedback/eval persistence code only. Ensure feedback candidates are persisted and can be inspected through a command. Cover disagreement episodes and verified success.

## Integration Gate

Run from `hybrowclaw/`:

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
pnpm dlx ./path-to-hybrowclaw init
hybrowclaw doctor
hybrowclaw provider list
hybrowclaw migrate openclaw --dry-run
hybrowclaw migrate hermes --dry-run
hybrowclaw migrate pi --dry-run
```

For v0, a red provider connectivity check is acceptable when no local Ollama/OpenAI-compatible server is listening; it must be reported clearly by `doctor`.
