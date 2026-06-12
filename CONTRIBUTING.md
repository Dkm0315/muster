# Contributing to Muster

Muster is a governed agent harness. Contributions are welcome — start small.

## Ground rules
- **Tests in the same PR.** `pnpm typecheck && pnpm test` must pass before review. A feature without tests is not done.
- **Small, focused PRs.** One concern per PR; merge only on green CI.
- **No new runtime dependencies** without strong justification. The core is intentionally dependency-light (node:http, node:sqlite, pure functions).
- **Everything bundled in one monorepo, one version.** No runtime plugin installation; integrations go through MCP or capability packs.
- **The token ledger touches everything new.** Skills carry receipts, schedulers carry budgets, subagent spend folds into the parent.

## Getting started
```bash
pnpm install
pnpm typecheck && pnpm test
pnpm hc demo          # provisions a throwaway workspace + stub model, runs the full pipeline
```

## Where to look
- `docs/FEATURE_PARITY_PLAN.md` — the roadmap and design rationale.
- `docs/teardowns/` — why each subsystem is built the way it is (and which upstream failure modes it avoids).
- `docs/SDLC_KANBAN.md` — what's done and what's ready.

Good first issues are labeled `good first issue`. Open an issue before large changes so we can align on approach.
