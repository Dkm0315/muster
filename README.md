# Muster — the AI agent harness you can audit

**Open-source agent runtime with a token-waste ledger, leak-proof scoped memory, eval-gated learning, and integrity verification. Works with Claude, OpenAI, Gemini, Grok, Kimi, DeepSeek, Ollama, and 20+ providers. TypeScript, MIT, self-hosted.**

> Self-improving agents are easy. **Provably governed** agents are Muster: every memory scoped, every skill eval-gated, every token on a ledger. Does your agent *pass muster*?

```bash
pnpm dlx @musterhq/cli init && muster doctor
```

## Why Muster

Every agent framework demos beautifully. Then production happens:

- **Token burn you can't see.** Agents replay megatokens of stale context; field reports show 60–89% of spend wasted. Muster records every run in a **token ledger** (`muster tokens`) and flags replay waste with the exact ratio.
- **Memory that leaks.** Most harnesses have one memory pool. Muster memory is **scoped** — tenant / workspace / user / role / session lanes with promotion gates. Cross-user leakage is a failing CI check, not a hope.
- **Silent model drift.** Fallbacks that quietly swap your model mid-session. Muster's fallback is **governed**: recorded as evidence on the episode, verified by `muster verify`, never silent.
- **Learning on vibes.** "Self-improving" agents that promote skills nobody validated. Muster learning is **eval-gated**: feedback → adjudication against evidence → replayable fixture → promotion only when the suite passes.
- **Sessions that rot.** Corrupt transcripts, duplicate runs, poisoned context replaying old failures. `muster verify` detects all four classes; `muster evolve` re-tests the harness itself against them.

## 60-second tour

```bash
muster provider presets                 # 20 providers: openai, anthropic, xai, kimi, deepseek, groq, ollama, openrouter...
muster provider add anthropic           # or: add kimi / add ollama / add-openai-compatible <any-url>

muster memory add --summary "We deploy to uat-erp.example.com" --scope user:$USER --provenance manual
muster run "Where do we deploy?" --runtime claude-code --model haiku
#   -> recalls scoped memory, answers from it, records episode + tokens

muster tokens                           # per-run cost table, waste flags, totals by model
muster verify                           # store integrity: corruption, drift, poisoning
muster evolve evolve-suites/core-capabilities.json --runtime claude-code
#   -> recursive self-test: runs real tasks, judges, adjudicates, converges

muster profile create team-a            # fully isolated config + memory + ledger per profile
muster schedule add "0 9 * * 1-5" "summarize my open work"   # cron loops, no daemon
```

Every command renders plain-text tables in your terminal. No web dashboard required.

## Architecture

```
prompt ──> router ──> [agent rules + recalled scoped memory] ──> runtime
                                                                  ├─ Pi SDK (embedded)
  scoped memory lanes                                             ├─ Claude Code CLI
  tenant/workspace/user/role/session                              ├─ Codex CLI
        │                                                         └─ any HTTP provider
        ▼
  episode store ──> token ledger ──> feedback adjudication ──> eval fixtures
        │                 │                                         │
        └──── muster verify (integrity) ◄──── muster evolve (self-test loop)
```

Built on the [pi.dev](https://pi.dev) coding-agent SDK as bedrock — embedded sessions, tools, and TUI — with the governance layer Muster adds on top.

## How it compares

| | Muster | OpenClaw | Hermes | crewAI |
|---|---|---|---|---|
| Token ledger + waste detection | ✅ | ❌ | ❌ | ❌ |
| Scoped memory (leak = CI failure) | ✅ | partial | ❌ (single MEMORY.md) | ❌ |
| Eval-gated learning | ✅ | ❌ | ❌ (promotes on use) | ❌ |
| Governed fallback (evidence, never silent) | ✅ | ❌ ([#65646](https://github.com/openclaw/openclaw/issues/65646)) | ❌ | ❌ |
| Session integrity verification | ✅ | ❌ ([#75235](https://github.com/openclaw/openclaw/issues/75235)) | ❌ ([#5563](https://github.com/NousResearch/hermes-agent/issues/5563)) | ❌ |
| Channels (Telegram/WhatsApp/...) | 🔜 | ✅ 20+ | ✅ | ❌ |
| Maturity / ecosystem | v0 | huge | large | large |

Honest table: they have breadth and ecosystems we don't (yet). We have the governance core they demonstrably lack — each ❌ above links to their own issue tracker.

## Use cases

- **AI agents for business systems**: the Frappe/ERPNext capability pack ships permission-scoped tools where every action executes as the real user — see [`capability-packs/frappe/`](capability-packs/frappe/FRAPPE_SURFACE_SPEC.md). Built from a production deployment serving thousands of employees.
- **Cost-controlled agent fleets**: per-profile ledgers, per-flow budgets, waste alerts.
- **Regulated / BFSI / air-gapped**: local models (Ollama, vLLM, SGLang), no cloud required, full audit trail.
- **Agent CI**: `muster evolve` as a pipeline gate — your agent's behavior is regression-tested like code.

## Keywords

AI agent framework · LLM agent harness · agent memory · token cost tracking · agent observability · eval-driven development · agentic workflows · Claude agent SDK · OpenAI agents · Ollama agents · self-hosted AI agent · AI governance · agent audit trail · ERPNext AI · Frappe AI assistant · multi-provider LLM routing

## Status & roadmap

v0, moving fast with PR-sized slices and 93 tests. Shipped: run loop, scoped memory, token ledger, profiles, scheduler, eval loop, integrity verify, 20-provider catalog, agent operating rules. Next: flow engine ([spec](docs/FLOW_ENGINE_SPEC.md)), capability-pack loader, Telegram channel, MCP client, migration-with-verification from OpenClaw/Hermes. See [docs/SDLC_KANBAN.md](docs/SDLC_KANBAN.md).

## License

MIT. Built by [Hybrowlabs](https://github.com/hybrowlabs). Contributions welcome — start with `good first issue`.
