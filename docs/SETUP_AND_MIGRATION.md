# HybrowClaw v0 Setup and Migration

This is the operator path for the current HybrowClaw v0 CLI and Terminal Cockpit. It is intentionally local-first, pnpm-native, and dry-run safe for migration.

## Install

Use `pnpm` first because the workspace scripts are pnpm-native.

```bash
cd hybrowclaw
corepack enable
pnpm install
```

The future install target is npm/pnpm/bun-friendly. Today, use pnpm because the monorepo uses `workspace:*` dependencies and `pnpm-workspace.yaml`.

## Initialize and Check Health

Create or reuse local config:

```bash
pnpm hc init
```

This writes `.hybrowclaw/config.json` if it does not already exist. The default provider is `local`, an OpenAI-compatible endpoint at `http://localhost:11434/v1` using model `llama3.1`.

Run health checks:

```bash
pnpm hc doctor
```

`doctor` verifies config shape, one-runtime-per-run routing, provider registration, and each OpenAI-compatible provider's models endpoint. If Ollama, LM Studio, vLLM, or another local server is not running, a red provider models check is acceptable in v0.

## Providers

List configured providers:

```bash
pnpm hc provider list
```

Open the terminal cockpit snapshot:

```bash
pnpm hc tui
pnpm hc tui ask "Explain the Trust Kernel in one sentence"
```

Inspect the pi.dev runtime boundary:

```bash
pnpm hc pi inspect
```

`pi inspect` does not execute pi flows yet. It tells us whether a local pi root exists and which config/workflow candidates can be mapped into a future HybrowClaw FlowSpec.

Add any OpenAI-compatible provider:

```bash
export OPENROUTER_API_KEY=...
pnpm hc provider add-openai-compatible openrouter https://openrouter.ai/api/v1 openai/gpt-5-mini --api-key-env OPENROUTER_API_KEY
pnpm hc provider list
```

Provider ids must start with a lowercase letter and may contain lowercase letters, numbers, underscores, or dashes. Secrets stay in environment variables through `--api-key-env`; do not paste keys into `.hybrowclaw/config.json`.

## Chat, Feedback, and Candidates

Run a prompt:

```bash
pnpm hc chat "Explain HybrowClaw v0 in one sentence"
```

The CLI prints route metadata, the model response, an `episode=<id>` line, and a suggested feedback command. The episode is appended to `.hybrowclaw/data/episodes.jsonl`.

Record feedback:

```bash
pnpm hc feedback <episode-id> --useful --correct --reason "Answer matched the repo evidence"
pnpm hc feedback <episode-id> --not-useful --reason "Missed the migration constraints"
```

Feedback is a signal, not an automatic memory write. HybrowClaw adjudicates it against recorded evidence and appends candidate eval, memory, policy, or tool follow-ups to `.hybrowclaw/data/feedback.jsonl`.

Inspect candidates:

```bash
pnpm hc candidates
```

Candidates are reviewable artifacts. v0 may mark low-risk verified successes as auto-applicable, but the docs should still treat them as queued candidate state rather than completed learning.

## Eval Fixtures

Feedback should become evidence, not vibes. When an episode is confirmed useful or needs regression coverage, seed a replayable eval fixture:

```bash
pnpm hc eval seed <episode-id> --expect "important phrase that must remain true"
pnpm hc eval run
```

Fixtures are stored in `.hybrowclaw/data/evals/*.json`. The v0 runner is deterministic: it checks recorded episode output against expected and forbidden text. Live provider replay comes later, after route/tool traces are stable enough to make failures meaningful.

Use forbidden checks for safety regressions:

```bash
pnpm hc eval seed <episode-id> --expect "safe answer" --forbid "private notes"
pnpm hc eval run .hybrowclaw/data/evals
```

## Scoped Memory

HybrowClaw memory is append-only `ContextObject` state stored in `.hybrowclaw/data/memory.jsonl`. Every memory requires scopes and provenance. This is the first hard boundary for enterprise use: user, tenant, session, pairing, role, persona, and global memory cannot collapse into one unsafe bucket.

Add a scoped memory:

```bash
pnpm hc memory add \
  --summary "Dhairya prefers terse CTO-style product critique." \
  --scope tenant:hybrow \
  --scope user:dhairya \
  --provenance manual
```

Search only inside the exact scopes the operator is allowed to query:

```bash
pnpm hc memory search --scope tenant:hybrow --scope user:dhairya --query CTO
pnpm hc memory search --scope session:redis-debug --include-global
```

A global-only search does not return `user`, `session`, `pairing`, or tenant-private memories. `--include-global` lets a scoped query see global memories in addition to its private lane; it does not make private memories globally visible.

Promote memory deliberately:

```bash
pnpm hc memory promote mem_xxx --to tenant:hybrow
pnpm hc memory promote mem_xxx --to global:global --allow-global
```

Global promotion is intentionally explicit because it is the highest-risk learning path.

## Capability Packs

Capability packs are the portable unit for future HybrowClaw tools, skills, agents, workflows, and channels. They are intentionally closer to npm-style installation, but the harness must inspect risk before anything becomes runnable.

Create `hybrowclaw.capability.json` in the pack root:

```json
{
  "schemaVersion": 1,
  "id": "redis-runbook",
  "name": "Redis Runbook",
  "version": "0.1.0",
  "kind": "skill",
  "entrypoint": "SKILL.md",
  "permissions": ["filesystem:read"],
  "sandbox": "read_only",
  "evals": ["evals/redis-runbook.jsonl"],
  "digest": "sha256:<signed-or-recorded-digest>"
}
```

Inspect it from the terminal:

```bash
pnpm hc capability inspect /path/to/pack
```

The inspector blocks malformed manifests, invalid permissions, unsafe shell/sandbox combinations, and secret access without declared environment variable names. Missing evals or digest are warnings today; they become install blockers before capability activation lands.

## Migration Dry-Runs

v0 migration only scans. It does not import, delete, rewrite, activate, or authenticate against external state.

```bash
pnpm hc migrate openclaw --dry-run
pnpm hc migrate hermes --dry-run
pnpm hc migrate pi --dry-run
```

Default scan roots are:

| Source | Default Root | Typical Assets |
|---|---|---|
| OpenClaw | `~/.openclaw` | config, skills, tools, memory, MCP config |
| Hermes | `~/.hermes` | config, memory, skills, providers, MCP config |
| pi | `~/.pi` | agents, workflows, historical flows, config |

Use `--home` to scan a fixture or alternate home directory:

```bash
pnpm hc migrate openclaw --dry-run --home /path/to/test-home
```

Read the report as an import plan, not an apply log. `map` means structurally mappable, `manual_review` means human review is required before enabling, and `archive_only` means preserve as history without activating.

## Terminal Cockpit State Export

The Terminal Cockpit reads a bounded local state snapshot from `packages/ui/public/hybrowclaw-state.json`.

```bash
pnpm hc state show
pnpm hc state export
pnpm --filter @hybrowclaw/ui dev
```

Use `state show` for read-only QA. Use `state export` when the browser UI needs to load the snapshot.

For static builds, export state before building because Vite copies `packages/ui/public` into `dist` during build:

```bash
pnpm hc state export
pnpm --filter @hybrowclaw/ui build
```

To write elsewhere:

```bash
pnpm hc state export --output /tmp/hybrowclaw-state.json
```

The export includes recent episodes, feedback, and learning candidates. It is a UI bridge for v0, not a sync protocol.

## Verification Pass

Before handing off docs or QA, run the docs-covered command path from `hybrowclaw/`:

```bash
pnpm hc init
pnpm hc doctor
pnpm hc provider list
pnpm hc migrate openclaw --dry-run
pnpm hc migrate hermes --dry-run
pnpm hc migrate pi --dry-run
pnpm hc capability inspect /path/to/pack
pnpm hc memory search --scope global:global
pnpm hc eval run
pnpm hc state show
pnpm hc state export
```
