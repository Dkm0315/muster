# Muster Product Wedge

Muster should not compete by claiming "agents, tools, memory, and workflows." Those are table stakes. OpenClaw, Hermes, pi.dev-style systems, Graphiti/Zep-style memory systems, and modern coding agents already make those claims credible.

The wedge is a beautifully stable, trust-first harness that knows what it is allowed to remember, what it is allowed to do, why it chose a route, and how to repair itself from evidence instead of vibes.

## Baseline We Must Match

### OpenClaw-Class Baseline

- Skills and plugins as first-class capability packages.
- Sub-agents and nested harness calls.
- Tool search instead of dumping every schema into context.
- Per-agent allowlists, gates, OAuth, pairing, and channel delivery.
- Native runtime adapters for agent runtimes such as Codex-style code mode.

### Hermes-Class Baseline

- Long-term memory and session recall.
- Self-improving skills/prompts from experience.
- Multiple providers and execution backends.
- Auxiliary routing for context compression, vision, and secondary tasks.
- Local/VPS continuous operation.

### Graphiti/Zep-Class Baseline

- Temporal context graphs, not flat memories.
- Entities, relationships, episodes, and validity windows.
- Hybrid retrieval across semantic search, keyword search, and graph traversal.
- Incremental updates without full graph recomputation.

## Muster Differentiators

### 1. Trust Kernel

Every run produces a durable episode:

```text
prompt -> route -> context objects -> tool affordances -> trace -> evidence -> outcome -> feedback -> adjudication
```

The Trust Kernel is responsible for:

- budget prediction before the run starts
- context provenance and redaction status
- tool preflight and permission checks
- model/provider/runtime route explanation
- evidence capture and outcome verification
- memory/eval/tool/policy candidate creation

This makes Muster operationally safer than a harness that only records chat logs and tool calls.

### 2. Context Objects Before Context Graphs

A full temporal graph is powerful but heavy. Muster starts with `ContextObject` as the portable primitive:

```text
id
kind
summary
source_uri
valid_from / valid_to
observed_at
confidence
provenance
permissions
redaction_state
feedback_score
links[]
```

The graph becomes an index over context objects, not the only memory backend. That keeps v0 simple while leaving a clean path to Graphiti, Neo4j, SQLite/libSQL graph tables, or a custom temporal graph.

### 2.1 Memory Isolation Lanes

Memory must never be universal by default. In enterprise systems like Oxygen HR, thousands of employees may talk to the same agent, but each employee expects the agent to remember only what is valid for them.

Every context object must carry explicit scopes:

```text
global
tenant:<company>
workspace:<app-or-project>
user:<user-id>
pairing:<device-or-oauth-pairing-id>
session:<conversation-id>
role:<role-id>
persona:<persona-id>
```

Retrieval is intersectional:

```text
allowed_context = query_scope ∩ user_permissions ∩ data_policy ∩ redaction_policy
```

Examples:

- An Oxygen HR employee preference belongs to `tenant:oxygenhr + user:<employee>`, not global memory.
- A manager escalation rule can belong to `tenant:oxygenhr + role:manager`.
- A payroll policy can belong to `tenant:oxygenhr + workspace:hrms` and still require permission checks before retrieval.
- A pairing-specific habit from a Telegram or CLI session belongs to `pairing:<id>` unless promoted after review.

Promotion is gated:

```text
session memory -> user memory -> role memory -> tenant memory -> global memory
```

Each promotion requires evidence that the memory is not user-private, not tenant-private, not stale, and not contradicted by a newer scoped fact.

### 3. Eval-Gated Learning

Thumbs up/down is a signal, not a command.

```text
feedback -> adjudicator -> candidate -> eval -> promotion
```

A candidate can become:

- memory
- regression eval
- route policy change
- prompt/skill update
- tool fix
- permission rule

Nothing high-risk is silently applied. Low-risk verified wins can be queued for auto-apply only after they become reproducible.

### 4. Harness Self-Repair

When a run fails, Muster should classify the failure:

- wrong context
- stale memory
- missing tool
- bad tool schema
- bad permission boundary
- model not suited to task
- route too cheap or too expensive
- unclear user intent
- UI/operator handoff failure

The repair proposal should target the harness structure, not merely rewrite the system prompt.

### 5. Capability Pack Hygiene

Skills/tools are supply-chain risk. Muster capability packs need:

- manifest and signed digest
- declared permissions
- local sandbox policy
- test fixtures
- eval coverage
- secret access declaration
- provenance and install source

The rare product move is to make installing a capability pack feel as easy as npm, but governed like production infrastructure.

### 6. One Runtime Per Run, Many Runtime Types

Muster can connect to Codex, Claude Code, Cursor SDK, OpenHands, OpenAI-compatible chat, Anthropic, local models, or internal gateways. But each run chooses one active runtime. This keeps traces understandable and cost/security accountable.

## Beautiful Stability Principles

- No silent fallback that looks like success.
- No memory write without provenance.
- No memory retrieval without scope intersection.
- No user or pairing memory in global recall.
- No tool activation without a permission story.
- No "self-improvement" without an eval or outcome signal.
- No graph bloat without temporal validity and confidence.
- No app-store dependency as the core wedge.
- No Frappe-specific assumptions in the universal core.

## v0 Product Shape

```text
@dkm0315/core
  config, route planning, provider calls, store, scoped memory, capability inspection,
  eval fixtures, embedded Pi SDK adapter, feedback adjudication, cockpit state

@dkm0315/cli
  init, doctor, provider, chat, tui, episodes, feedback, candidates, eval, memory,
  capability, migrate, pi inspect/ask, state

@dkm0315/ui
  Terminal Cockpit viewer for exported runs, evidence, candidates, and route state

future
  deeper Pi session/extension bridge, live provider eval replay, capability activation,
  temporal graph adapter, runtime adapters, ChatNext/Frappe adapter
```

The current implementation is deliberately small. The architecture must stay sharp enough that every future feature either improves trust, context quality, eval coverage, capability safety, or operator experience.

## Surface Priority

The terminal is the first product surface. The web cockpit is a viewer/control plane, not the harness core.

```text
CLI/TUI -> core runtime -> pi adapter / runtime adapter -> Trust Kernel -> memory/evals
Web UI  -> exported state / future local bridge
```

This keeps Muster aligned with serious harnesses: fast terminal operation first, rich observability second.
