# Muster — the AI agent harness you can audit

**Open-source agent runtime with a token-waste ledger, leak-proof scoped memory, eval-gated learning, and integrity verification. Works with Claude, OpenAI, Gemini, Grok, Kimi, DeepSeek, Ollama, and 20+ providers. TypeScript, MIT, self-hosted.**

> Self-improving agents are easy. **Provably governed** agents are Muster: every memory scoped, every skill eval-gated, every token on a ledger. Does your agent *pass muster*?

```bash
pnpm dlx @musterhq/cli init && muster demo
```

## See it work — `muster demo`

One command provisions a throwaway workspace and a local model service, then runs the full governed pipeline: scoped-memory recall → token ledger → integrity check.

```text
muster demo — provisioned an isolated workspace and a live stub model service.

> Where do we deploy?
  (recalled 1 scoped memory)
  Muster deploys to uat-erp.example.com (recalled from scoped memory).

run            model                        in       out      est  cost$    waste   session
----------------------------------------------------------------------------------------------
287bde9c-eb19- demo/demo-model              38       17       ~    -        -       -
653b434a-0924- demo/demo-model              7        18       ~    -        -       -

totals by model              runs   in         out        cost$      waste-runs
--------------------------------------------------------------------------------
demo/demo-model              2      45         35         -          0

integrity check at 2026-06-12: OK
store      lines    corrupt
episodes   2        0
memory     3        0
tokens     2        0
```

## Proof, not promises — `muster benchmark`

The **Token Waste Index** measures what Muster's immutable-transcript renderer and never-wedge compactor actually save versus a naive replay-everything harness. Deterministic — no model calls, fully reproducible.

```text
scenario                          turns  naive    muster   reduction  replay-overhead
--------------------------------------------------------------------------------------
codebase-refactor-20              21     82.6k    40.7k    50.7%      90.5%
incident-triage-30                31     140.4k   56.2k    59.9%      93.6%
erp-data-audit-40                 41     197.8k   72.4k    63.4%      95.1%
research-synthesis-25             26     156.8k   64.6k    58.8%      92.3%
long-support-thread-50            51     268.8k   93.8k    65.1%      96.1%
--------------------------------------------------------------------------------------
AGGREGATE                         170    846.4k   327.9k   61.3%      94.2%
```

**~61% fewer tokens on long agent sessions**, and the saving grows with session length. Full methodology + table: [benchmark/RESULTS.md](benchmark/RESULTS.md).

## Features

| | |
|---|---|
| 🪙 **Token ledger** | Every run recorded; replay-waste flagged with the exact ratio. `muster tokens` |
| 🔒 **Scoped memory** | Tenant / workspace / user / role / session lanes. Cross-user leakage is a failing test, not a hope. |
| 🎓 **Eval-gated skills** | Skills promote only after an eval suite converges — no self-certified learning. |
| 🛡️ **Integrity verify** | Corruption, duplicate runs, silent model drift, stale-narrative poisoning. `muster verify` |
| ♻️ **Never-wedge compactor** | A session can always take a turn — no compaction deadlock. |
| 🔁 **Recursive self-test** | `muster evolve` runs real tasks, adjudicates against evidence, converges. |
| 🌊 **Flow engine** | Tool/agent/gate steps, preflight, durable runs, replay/diff, `flow loop --cron`. |
| 📡 **One gateway, every chat app** | Telegram · Slack · Discord · WhatsApp · Google Chat · Teams + a zero-dep web client. |
| 🔌 **MCP client** | Per-server isolation, circuit breakers, capped results. |
| 🧰 **20+ providers** | Claude (Fable 5), OpenAI, Gemini, Grok, Kimi, DeepSeek, Groq, Ollama, vLLM… zero lock-in. |
| 💓 **Pulse scheduler** | Heartbeat that feels alive at ~5% of the token cost — zero-LLM preflight + daily budget. |
| 👥 **Pull-based subagents** | Durable run store, exactly-once results, no zombie processes. |

## Everyday commands

```bash
muster provider add anthropic                 # or kimi / ollama / add-openai-compatible <any-url>
muster run "where do we deploy?"              # governed run: memory recall + ledger + evidence
muster tokens                                 # per-run cost table, replay-waste flags
muster verify                                 # store integrity
muster sessions search "leave balance"        # FTS search across past sessions
muster evolve evolve-suites/core-capabilities.json   # recursive self-test
muster pulse add "0 9 * * 1-5" --kind task --prompt "summarize open work"
muster benchmark                              # the Token Waste Index, live
```

Everything renders plain-text tables in your terminal. No web dashboard required.

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
| Channels & web embeds (one governed envelope) | ✅ Slack, Discord, Telegram, WhatsApp, GChat, Teams, any web app | ✅ 20+ bespoke | ✅ | ❌ |
| Maturity / ecosystem | v0 | huge | large | large |

Honest table: they have breadth and ecosystems we don't (yet). We have the governance core they demonstrably lack — each ❌ above links to their own issue tracker.

## Use cases

- **AI agents for business systems**: the Frappe/ERPNext capability pack ships permission-scoped tools where every action executes as the real user — see [`capability-packs/frappe/`](capability-packs/frappe/FRAPPE_SURFACE_SPEC.md). Built from a production deployment serving thousands of employees.
- **Cost-controlled agent fleets**: per-profile ledgers, per-flow budgets, waste alerts.
- **Regulated / BFSI / air-gapped**: local models (Ollama, vLLM, SGLang), no cloud required, full audit trail.
- **Agent CI**: `muster evolve` as a pipeline gate — your agent's behavior is regression-tested like code.

## Keywords

AI agent framework · LLM agent harness · agent memory · token cost tracking · agent observability · eval-driven development · agentic workflows · Claude agent SDK · OpenAI agents · Ollama agents · self-hosted AI agent · AI governance · agent audit trail · ERPNext AI · Frappe AI assistant · multi-provider LLM routing

## Maturity — v0.1, feature-complete core

Muster is **v0.1**: the governed core is feature-complete and test-covered, the public API may still shift before 1.0. (For reference, the largest open agent frameworks still version in the v0.x / date-based range — v0.x here means "pre-1.0 stability," not "incomplete.")

Mapped against the mid-2026 production bar for agent harnesses:

| Production-bar capability | Muster |
|---|---|
| MCP client | ✅ per-server isolation, circuit breakers, capped results |
| Eval-gated learning | ✅ skills promote only through a converged suite |
| Per-run cost / token tracking | ✅ token ledger with replay-waste detection |
| Layered, deterministic permissions | ✅ scoped-memory lanes + hook bus, leak = failing test |
| Memory: working / episodic / scoped | ✅ scoped lanes + SQLite session store (FTS5) |
| Strategic (not reactive) compaction | ✅ immutable transcript renderer + never-wedge compactor |
| One protocol for CLI / desktop / web | ✅ JSON-RPC gateway with `ledger.tick` live cost |
| OpenTelemetry tracing | 🔜 planned |
| Desktop apps | 🔜 Tauri over the RPC protocol |

**Claude Fable 5 ready:** the Anthropic preset defaults to `claude-fable-5` (1M context, adaptive thinking via `effort`). The token ledger and scoped tool exposure align with Fable 5's deferred-tool-loading and task-budget direction. First-class `stop_reason: "refusal"` handling is on the roadmap.

**Independence:** Muster is operator-governed and MIT — no foundation, no single-vendor entanglement. You run it, you audit it.

Next: OTEL tracing, Tauri desktop apps, channel approval round-trips, npm publish, and a Token Waste Index benchmark. See [docs/SDLC_KANBAN.md](docs/SDLC_KANBAN.md) and [docs/FEATURE_PARITY_PLAN.md](docs/FEATURE_PARITY_PLAN.md).

## License

MIT. Open source, community-driven. Contributions welcome — start with `good first issue`.
