# Muster v0 Architecture

Muster is a new independent harness. It is not a fork or wrapper around OpenClaw or Hermes.

## Product Commitments

- pi.dev-style orchestration is the bedrock.
- Personas are optional overlays, not mandatory architecture.
- OpenClaw/Hermes primitives are baseline expectations: tools, skills, OAuth, pairing, memory, migration, artifacts, and runtime control.
- Context graph systems such as Graphiti/Zep are baseline memory inspiration, not the whole product.
- Codex, Claude Code, Cursor SDK, OpenHands, and similar systems are external agent runtimes, not only coding backends.
- One active runtime is selected per run.
- Providers and models can route dynamically by task and policy.
- User feedback is a signal, not ground truth.
- The differentiator is the Trust Kernel: provenance, permission, trace, evidence, outcome, feedback adjudication, eval-gated learning, and harness self-repair.
- Memory is scoped by tenant, workspace, user, pairing, session, role, and persona; global recall is opt-in and promotion-gated.

## v0 Runtime Loop

```text
request
  -> classify task
  -> select one runtime
  -> select provider/model/reasoning route
  -> call provider
  -> record episode
  -> collect useful/not useful feedback
  -> adjudicate feedback against evidence
  -> emit learning candidates
```

## v0 Package Boundaries

```text
packages/core
  config, routing, provider calls, episode store, feedback adjudication

packages/cli
  init, doctor, chat, episodes, feedback, candidates, provider setup,
  state export, migration dry-run surface

packages/ui
  Terminal Cockpit viewer for exported episodes, evidence, route state,
  and learning candidates
```

Future packages:

```text
packages/pi
packages/migration-openclaw
packages/migration-hermes
packages/memory
packages/evals
packages/backends
```

## Why JSONL First

v0 uses JSONL for episode and feedback records because it is inspectable, append-only, git-friendly for examples, and easy to migrate to SQLite/libSQL. The write path uses append-only writes, not full-file rewrites.

## Why OpenAI-Compatible First

OpenAI-compatible endpoints cover OpenAI, Ollama, LM Studio, vLLM, LocalAI, OpenRouter-style gateways, and many private deployments. Provider-specific SDKs can be added only after the routing contract stabilizes.

## v0 Operator Surfaces

The CLI is the source of truth for current setup and migration behavior:

- `init` creates local config without overwriting an existing config.
- `doctor` checks config, one-runtime-per-run routing, provider registration, and OpenAI-compatible model endpoints.
- `provider list` and `provider add-openai-compatible` manage provider entries while keeping secrets in environment variables.
- `chat` records episodes as append-only local state.
- `feedback` adjudicates useful/not useful signals against episode evidence.
- `candidates` lists reviewable learning candidates produced by feedback.
- `migrate openclaw|hermes|pi --dry-run` scans known local roots without mutating source state.
- `state export` writes a bounded local snapshot for the Terminal Cockpit.

See `docs/SETUP_AND_MIGRATION.md` for command-level usage.
See `docs/PRODUCT_WEDGE.md` for the research-informed product wedge and stability principles.
