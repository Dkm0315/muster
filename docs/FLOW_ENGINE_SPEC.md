# hc flow — universal workflow engine (Lobster, done right)

Not Frappe-specific. Flows are a core harness primitive; the Frappe Workflow
Loop Studio is one consumer of it.

## What Lobster got right (keep)
- Pipelines are data, not prompts: deterministic tool composition saves tokens
  vs the agent re-planning every step.
- Typed JSON envelopes between steps.
- Approval gates that halt execution and resume later via a token.

## Where Lobster is rough (observed in production on Frappe-2 + issue tracker)
- Coupled to the OpenClaw plugin runtime: plugin dependency repair loops,
  version skew after updates, opaque "something went wrong" failures.
- Validation happens at runtime, mid-pipeline — you discover a broken step
  after earlier steps already executed.
- A resumeToken is a magic string; if it's lost or the gateway restarts wrong,
  the approval context is gone.
- No cost budget, no evidence trail, no replay/diff, no tests for a pipeline.
- Approvals show you the step name, not what will actually happen.

## hc flow design

Flow definition = validated JSON/YAML (zod schema, errors at define time):
```yaml
id: weekly-ticket-digest
budgetTokens: 50000          # hard ceiling, run aborts cleanly past it
steps:
  - id: fetch
    kind: tool               # deterministic tool call, no model
    tool: frappe_dataset_fetch_for_artifact
    args: { doctype: HD Ticket, filters: { status: Open } }
  - id: summarize
    kind: agent              # model step, routed via normal run loop
    prompt: "Summarize these tickets per team: {{fetch.rows}}"
    taskKind: artifact
  - id: approve
    kind: gate               # halts; resumable
    show: summarize.text     # approver sees the ACTUAL output, not a step name
    expiresHours: 48
  - id: post
    kind: tool
    tool: frappe_records_create
    when: approve.granted
```

Core properties (each one a Lobster pain inverted):
1. **Preflight** (`hc flow check <id>`): schema validation, tool existence,
   template-variable resolution, permission requirements — before anything runs.
2. **Durable runs as data**: every step result appends to
   `.hybrowclaw/data/flows/<run>.jsonl`. Resume = re-run the file; the gate
   state lives in the run record, not a magic token. Survives restarts.
3. **Replay & diff** (`hc flow replay <run> --against <run>`): re-execute
   deterministically and diff step outputs — regression detection for
   automations (nobody has this).
4. **Budgeted**: per-flow token ceiling, enforced by the ledger; cost reported
   per step in `hc tokens`.
5. **Evidence-first**: each step emits EvidenceRecords; the whole run is an
   episode, so feedback/adjudication/eval seeding work on flows for free.
6. **Eval-gated flows**: `hc flow seed-eval <run>` turns a good run into a
   fixture; `hc evolve` re-runs flow fixtures so a site/tool change that
   breaks an automation fails CI, not production.
7. **Approval gates with truth**: the gate payload contains the dry-run
   preview/diff of what the next steps WILL do. CLI approval now
   (`hc flow approve <run>`), channel approvals (Telegram) when channels land.
8. **Loops**: `hc flow loop <id> --cron "0 9 * * 1"` binds a flow to the
   scheduler — pause/resume/list/kill per loop, each iteration budgeted.
9. **Self-repair hook**: failed steps are classified (tool_missing, schema,
   permission, budget, model) and produce repair candidates through the
   existing adjudicator — the evolve loop closes over automations too.

## Build order (PR slices)
1. Schema + preflight + tool/agent/gate step kinds + durable run store + tests
2. `hc flow run/check/list/approve/resume` CLI
3. Replay/diff + eval seeding
4. Scheduler binding (`flow loop`) + budgets in ledger
5. Frappe Workflow Loop Studio consumes this engine (capability pack)
