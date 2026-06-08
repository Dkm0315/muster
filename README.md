# HybrowClaw

HybrowClaw is an independent universal AI harness. It uses pi.dev-style orchestration as the bedrock, borrows the useful baseline primitives from OpenClaw and Hermes, and adds evidence-aware learning on top.

This repository is the first v0 scaffold. It intentionally starts lean:

- npm/pnpm-first developer experience
- one active runtime/backend per run
- cloud and local OpenAI-compatible provider routing
- episode recording
- useful/not useful feedback with adjudication
- replayable eval fixtures seeded from episodes
- scoped memory ledger with user/tenant/session isolation
- capability-pack manifest validation
- embedded Pi SDK adapter through `@earendil-works/pi-coding-agent`
- migration/doctor surfaces reserved for OpenClaw, Hermes, and pi.dev

## Quick Start

Use `pnpm` first. `npm` works for package installation, but the v0 workspace scripts and examples are pnpm-native.

```bash
cd hybrowclaw
corepack enable
pnpm install
pnpm hc init
pnpm hc doctor
pnpm hc provider list
pnpm hc chat "Explain what HybrowClaw is in one sentence"
```

By default, `init` writes `.hybrowclaw/config.json` with a local OpenAI-compatible endpoint at `http://localhost:11434/v1` for Ollama-style local use. A red `provider:local:models` doctor check is expected if no local model server is running yet.

Add another OpenAI-compatible provider when you want cloud or gateway routing:

```bash
export OPENROUTER_API_KEY=...
pnpm hc provider add-openai-compatible openrouter https://openrouter.ai/api/v1 openai/gpt-5-mini --api-key-env OPENROUTER_API_KEY
pnpm hc provider list
```

Run a chat, record feedback against the emitted episode id, and inspect learning candidates:

```bash
pnpm hc chat "Draft a two-line migration checklist"
pnpm hc feedback <episode-id> --useful --correct --reason "Worked for the current repo"
pnpm hc candidates
```

Seed and run a deterministic eval from a recorded episode:

```bash
pnpm hc eval seed <episode-id> --expect "important phrase"
pnpm hc eval run
```

Add and search scoped memory without leaking user/session memories into global recall:

```bash
pnpm hc memory add --summary "Use terse CTO-style critique." --scope user:dhairya --provenance manual
pnpm hc memory search --scope user:dhairya --query CTO --include-global
```

Inspect a capability pack before enabling future tools or skills:

```bash
pnpm hc capability inspect /path/to/pack
```

Ask through Pi's real SDK package and record the run as a HybrowClaw episode:

```bash
pnpm hc pi models --provider anthropic
pnpm hc pi ask "Review this repo in one sentence" --provider openai --model gpt-4o-mini
pnpm hc pi ask "Review this repo with Claude" --provider anthropic --model claude-sonnet-4-5
pnpm hc pi ask "Continue the persistent investigation" --session create --session-dir .hybrowclaw/pi-sessions
pnpm hc pi ask "Pick up the same investigation" --session continue --session-dir .hybrowclaw/pi-sessions
pnpm hc tui ask --runtime pi "Review this repo in one sentence"
```

The default Pi transport is `sdk`, which creates a real Pi `AgentSession` through `createAgentSession()`. Provider/model selection is resolved through Pi's own `AuthStorage` and `ModelRegistry`, so Claude, OpenAI, Codex, Copilot, local, and custom providers use the same Pi-native path. Pi exposes Claude Pro/Max and Anthropic API-key auth under the `anthropic` provider; run `pnpm hc pi models --provider anthropic` to confirm the exact model ids available in your installed Pi version. Session mode defaults to `memory`; use `--session create` or `--session continue` with `--session-dir` when you want durable Pi session files. Use `--transport cli` only for diagnostics when comparing against the upstream `pi` command.

Migration is dry-run only in v0. The scanners inspect conventional home-directory state and do not mutate OpenClaw, Hermes, pi, or HybrowClaw data:

```bash
pnpm hc migrate openclaw --dry-run
pnpm hc migrate hermes --dry-run
pnpm hc migrate pi --dry-run
```

Export the local JSONL state snapshot for the Terminal Cockpit UI:

```bash
pnpm hc state show
pnpm hc state export
pnpm --filter @hybrowclaw/ui dev
```

See [`docs/SETUP_AND_MIGRATION.md`](docs/SETUP_AND_MIGRATION.md) for the operator runbook.
See [`docs/PRODUCT_WEDGE.md`](docs/PRODUCT_WEDGE.md) for the research-backed product wedge.
See [`docs/UPSTREAM_ALIGNMENT.md`](docs/UPSTREAM_ALIGNMENT.md) before adding runtime features so HybrowClaw stays aligned with Pi, OpenClaw, and Hermes without reimplementing them badly.

## Core Product Rule

HybrowClaw does not blindly learn from thumbs up/down. Feedback is treated as a signal and adjudicated against evidence, tool outcomes, and run context.

```text
run episode -> evidence -> feedback -> adjudication -> candidate memory/eval/policy/tool update
```
