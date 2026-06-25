# Muster — the AI agent harness you can audit

**Open-source agent runtime with a real terminal chat UI, token-waste ledger, leak-proof scoped memory, eval-gated learning, MCP/plugin induction, and integrity verification. Works with Codex, Claude Code, Claude, OpenAI-compatible providers, vLLM, and 100+ discoverable integration surfaces. TypeScript, MIT, self-hosted.**

> Self-improving agents are easy. **Provably governed** agents are Muster: every memory scoped, every skill eval-gated, every token on a ledger. Does your agent *pass muster*?

```bash
pnpm dlx @musterhq/cli
```

Run `muster` to start the interactive chat surface. First run opens onboarding; after setup, it opens a named chat with slash commands, `@agent` routing, provider/model pickers, memory controls, plugin/MCP setup, and a token ledger.

For a deterministic no-model tour:

```bash
pnpm dlx @musterhq/cli demo
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
| 💬 **Interactive terminal chat** | `muster` opens a TUI with slash commands, `@agent` routing, history, named sessions, provider/model pickers, and warm Codex fast mode. |
| 🪙 **Token ledger** | Every run recorded; replay-waste flagged with the exact ratio. `muster tokens` |
| 🔒 **Indexed scoped memory** | Tenant / workspace / user / role / session lanes backed by SQLite/FTS. Cross-user leakage is a failing test, not a hope. |
| 🎓 **Eval-gated skills** | Skills promote only after an eval suite converges — no self-certified learning. |
| 🛡️ **Integrity verify** | Corruption, duplicate runs, silent model drift, stale-narrative poisoning. `muster verify` |
| ♻️ **Never-wedge compactor** | A session can always take a turn — no compaction deadlock. |
| 🔁 **Recursive self-test** | `muster evolve` runs real tasks, adjudicates against evidence, converges. |
| 🌊 **Flow engine** | Tool/agent/gate steps, preflight, durable runs, replay/diff, `flow loop --cron`. |
| 📡 **One gateway, many chat apps** | Slack · Discord · Telegram · WhatsApp · Google Chat · Teams + a zero-dep web client, with setup packs and readiness checks. |
| 🔌 **MCP client + OAuth setup** | Per-server isolation, circuit breakers, capped results, PKCE/OAuth helpers, curated install policies. |
| 🧩 **31 in-repo capability packs** | Frappe/ERPNext, browser, web search, GitHub, Google Workspace, Notion, Jupyter, vLLM, Codex, Claude Code, channels, and more. |
| 🧰 **116-entry integration catalog** | Source-backed Hermes/OpenClaw-inspired catalog with honest `setup_plan` vs executable-pack actionability. |
| 💓 **Pulse scheduler** | Heartbeat that feels alive at ~5% of the token cost — zero-LLM preflight + daily budget. |
| 👥 **Pull-based subagents** | Durable run store, exactly-once results, no zombie processes. |

## Implementation status — v0.1.6

This is where Muster stands today from an implementation point of view:

| Area | Current state |
|---|---|
| CLI/TUI | Implemented. `muster` opens the chat UI after onboarding, with slash-command completion, `@agent` completion, history navigation, named sessions, provider/model/runtime pickers, speed mode, status, token, plugin, skill, MCP, and memory commands. |
| Provider/runtime path | Implemented for Codex CLI, Claude Code CLI, Pi, and OpenAI-compatible HTTP providers. Codex app-server warm-session reuse is supported; `fast` mode keeps the warm native session but skips recall, ambient skill scoring, and memory writes for quick turns. |
| Memory | Implemented. Scoped memory is indexed through SQLite/FTS with tenant/workspace/user/session lanes, receipt reporting, graph-linked expansion for Frappe-style contexts, latency probes, rebuild/doctor commands, and leakage tests. |
| Token/cost | Implemented. Per-run ledger, cost estimates where pricing is known, replay-waste detection, session mode/id tracking, skill attribution, and token tables. |
| Plugins/skills | Implemented base system. 31 executable capability packs are in-repo; 116 catalog entries are discoverable with actionability levels so setup-plan entries do not pretend to be fully wired tools. |
| MCP | Implemented client, stdio/http registration, include/exclude policy, result caps, circuit breakers, OAuth/PKCE setup/import, and curated install catalog. |
| Frappe/ERPNext | Implemented as a capability pack with docs/live-context setup, module/doc resources, Frappe tools, generic graph-retrieval eval fixtures, and web-framework checks. |
| Onboarding | Implemented in CLI and prototype web preview. First run can guide purpose, style, provider, integrations, channels, memory policy, and profiles. |
| Gateway/channels | Implemented framework and channel setup packs. Production hardening still depends on each real provider credential/webhook setup. |
| Dashboard/web UI | Basic status/export/start surfaces exist. Full desktop app is not done. |
| Release state | `v0.1.6` is published as the latest GitHub release with changelog notes. |

Near-term gaps are clear: deeper real-provider end-to-end tests for every channel/MCP pack, stronger provider/model resolver parity with Hermes, more polished desktop/dashboard surfaces, and more live latency baselines across Codex/Claude/provider-direct paths.

## Everyday commands
<img width="3288" height="1740" alt="image" src="https://github.com/user-attachments/assets/8186bd41-3e18-4511-8566-d756c195d57f" />


```bash
muster                                      # interactive chat; first run opens onboarding
muster onboard                              # rerun guided setup
muster provider presets                     # browse cloud/CLI/self-hosted provider presets
muster provider add anthropic               # or openai / xai / kimi / deepseek / groq / openrouter / vllm
muster runtime use-provider native codex    # switch runtime/provider mapping
muster run "where do we deploy?"              # governed run: memory recall + ledger + evidence
muster chat --session work "summarize this repo"
muster latency "Say hi in one sentence" --runs 3 --runtime codex --model gpt-5.5
muster tokens                                 # per-run cost table, replay-waste flags
muster verify                                 # store integrity
muster sessions search "leave balance"        # FTS search across past sessions
muster plugins catalog                        # 116 discoverable integration entries
muster plugins setup provider-perplexity       # setup URLs, env vars, next actions
muster capability load capability-packs/frappe --allow-high-risk
muster mcp catalog                            # curated MCP setup catalog
muster mcp install github                     # install a curated MCP entry when configured
muster plugins context frappe setup --site https://example.com --user Administrator
muster evolve evolve-suites/core-capabilities.json   # recursive self-test
muster pulse add "0 9 * * 1-5" --kind task --prompt "summarize open work"
muster benchmark                              # the Token Waste Index, live
```

Everything critical renders in the terminal. The dashboard is optional.

## Observability — OpenTelemetry

Opt in with `MUSTER_TRACE=1`. When it's unset there is zero overhead: `startSpan` returns `null`, nothing is allocated, and no file is touched.

Spans follow the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens` — and are written as JSONL to `.muster/traces.jsonl`.

```bash
MUSTER_TRACE=1 muster run "where do we deploy?"   # record spans for the run
muster traces                                     # plain-text trace table
muster traces <traceId>                           # one trace as a span tree
```

To ship spans to any OTLP/HTTP collector — **Jaeger**, **Grafana Tempo**, **Honeycomb**, or anything that speaks OTLP — set `MUSTER_OTLP_ENDPOINT`; each span is best-effort `POST`ed to `<endpoint>/v1/traces` alongside the local JSONL.

```bash
MUSTER_TRACE=1 MUSTER_OTLP_ENDPOINT=http://localhost:4318 muster run "audit last deploy"
```

Zero dependencies — no OTel SDK, just Node builtins — and zero overhead when disabled.

## Architecture

```
terminal / gateway / channel
        │
        ▼
  router + profile + provider resolver
        │
        ├── stable instructions ───────────────┐
        ├── volatile recall / skill context ──►│ runtime
        │                                      ├─ Codex CLI / app-server
        │                                      ├─ Claude Code CLI
        │                                      ├─ Pi SDK / CLI
        │                                      └─ OpenAI-compatible HTTP providers
        ▼
  scoped memory lanes ── SQLite/FTS ── receipts / graph expansion
        │
        ▼
  episode store ── token ledger ── goal-loop ledger ── eval fixtures
        │                 │             │
        └──── muster verify ◄───────────┴──── muster evolve / retrieval evals
```

Muster uses native agent CLIs where they are strongest, and keeps governance outside the provider: scoped memory, token accounting, evidence, eval gates, MCP policy, and integrity verification remain Muster-owned.

## How it compares

| | Muster | OpenClaw | Hermes | crewAI |
|---|---|---|---|---|
| Token ledger + waste detection | ✅ | ❌ | ❌ | ❌ |
| Scoped memory (leak = CI failure) | ✅ | partial | ❌ (single MEMORY.md) | ❌ |
| Eval-gated learning | ✅ | ❌ | ❌ (promotes on use) | ❌ |
| Governed fallback (evidence, never silent) | ✅ | ❌ ([#65646](https://github.com/openclaw/openclaw/issues/65646)) | ❌ | ❌ |
| Session integrity verification | ✅ | ❌ ([#75235](https://github.com/openclaw/openclaw/issues/75235)) | ❌ ([#5563](https://github.com/NousResearch/hermes-agent/issues/5563)) | ❌ |
| Channels & web embeds (one governed envelope) | ✅ Slack, Discord, Telegram, WhatsApp, GChat, Teams, web apps | ✅ 20+ bespoke | ✅ | ❌ |
| Interactive terminal with provider/model pickers | ✅ | partial | ✅ | ❌ |
| MCP/OAuth setup workflows | ✅ | partial | ✅ | ❌ |
| Maturity / ecosystem | v0 | huge | large | large |

Honest table: OpenClaw and Hermes still have broader battle-tested ecosystems. Muster's current edge is governance, auditability, scoped memory, token accounting, and a growing integration induction layer.

## Use cases

- **AI agents for business systems**: the Frappe/ERPNext capability pack ships permission-scoped tools where every action executes as the real user — see [`capability-packs/frappe/`](capability-packs/frappe/FRAPPE_SURFACE_SPEC.md). Built from a production deployment serving thousands of employees.
- **Cost-controlled agent fleets**: per-profile ledgers, per-flow budgets, waste alerts.
- **Regulated / BFSI / air-gapped**: local models (vLLM, SGLang), no cloud required, full audit trail.
- **Agent CI**: `muster evolve` as a pipeline gate — your agent's behavior is regression-tested like code.

## Keywords

AI agent framework · LLM agent harness · agent memory · token cost tracking · agent observability · eval-driven development · agentic workflows · Claude agent SDK · OpenAI agents · self-hosted AI agent · AI governance · agent audit trail · ERPNext AI · Frappe AI assistant · multi-provider LLM routing

## Maturity — v0.1, feature-complete core

Muster is **v0.1**: the governed core is feature-complete and test-covered, the public API may still shift before 1.0. (For reference, the largest open agent frameworks still version in the v0.x / date-based range — v0.x here means "pre-1.0 stability," not "incomplete.")

Mapped against the mid-2026 production bar for agent harnesses:

| Production-bar capability | Muster |
|---|---|
| MCP client | ✅ per-server isolation, OAuth/PKCE helpers, circuit breakers, capped results |
| Eval-gated learning | ✅ skills promote only through a converged suite |
| Per-run cost / token tracking | ✅ token ledger with replay-waste detection |
| Layered, deterministic permissions | ✅ scoped-memory lanes + hook bus, leak = failing test |
| Memory: working / episodic / scoped | ✅ scoped lanes + SQLite/FTS indexes + retrieval evals |
| Strategic (not reactive) compaction | ✅ immutable transcript renderer + never-wedge compactor |
| One protocol for CLI / desktop / web | ✅ JSON-RPC gateway with `ledger.tick` live cost |
| OpenTelemetry tracing | ✅ GenAI-semconv spans, JSONL + OTLP/HTTP export, opt-in `MUSTER_TRACE=1` |
| Desktop apps | planned |

**Claude Fable 5 ready:** the Anthropic preset defaults to `claude-fable-5` (1M context, adaptive thinking via `effort`). The token ledger and scoped tool exposure align with Fable 5's deferred-tool-loading and task-budget direction. First-class `stop_reason: "refusal"` handling is on the roadmap.

**Independence:** Muster is operator-governed and MIT — no foundation, no single-vendor entanglement. You run it, you audit it.

Next: real-provider channel hardening, richer desktop/dashboard surfaces, more end-to-end MCP OAuth packs, and continued latency parity work against Hermes/Codex/Claude live paths. See [docs/SDLC_KANBAN.md](docs/SDLC_KANBAN.md), [docs/OPENCLAW_PARITY_CHECKLIST.md](docs/OPENCLAW_PARITY_CHECKLIST.md), and [docs/RETRIEVAL_GOAL_LOOP_DESIGN.md](docs/RETRIEVAL_GOAL_LOOP_DESIGN.md).

## License

MIT. Open source, community-driven. Contributions welcome — start with `good first issue`.
