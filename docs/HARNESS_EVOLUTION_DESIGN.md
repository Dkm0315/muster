# Muster Harness Evolution Design

Status: active goal spec for the release-worthy harness evolution pass.

## Goal

Make Muster's tools, skills, plugins, memory, operator/channel packs, MCP setup,
and personal-agent surfaces deep enough to be trusted. The product must not grow
by adding names to a catalog. A surface is only "ready" when it can be
discovered, configured, permissioned, executed or honestly marked setup-only,
measured, tested, and explained.

This spec turns the current research pass into a concrete engineering contract.
It draws from the local teardown work on Hermes, OpenClaw, OpenHarness, and the
current harness-engineering literature: stable agent loops, app-server style
multi-surface protocols, structured permission fabric, tool UX, context
engineering, scoped memory, trace/eval improvement loops, and sensors that catch
regressions before users do.

## Non-Negotiables

- No shallow catalog inflation. A plugin count is not a product metric.
- No false positives. A green readiness check must have artifact-backed cases.
- No hidden provider lock-in. Cloud, open-source, self-hosted, CLI-auth, and
  compatible routes stay first-class provider families.
- No provider bypass around governance. Memory, tools, channels, MCP, and native
  agent routes must still produce receipts, token entries, policy decisions, and
  timing evidence.
- No secret leakage. Tokens, OAuth material, webhook secrets, and user content
  must not appear in reports, logs, fixtures, screenshots, or release notes.
- No broad memory by default. Tenant, workspace, user, role, pairing, session,
  tag, and time scopes remain the default recall boundary.
- No release claim without a local test, artifact, live Frappe-2 check, or a
  clearly marked "planned/setup-only" status.

## Product Architecture

```text
personal agent surfaces
  terminal TUI
  onboarding
  web/surface client
  gateway channels
  future desktop/mobile companion
        |
        v
trust kernel
  scope resolver
  provider/router policy
  permission fabric
  tool/MCP policy
  memory receipts
  token ledger
  evidence store
  eval gates
  integrity verifier
        |
        v
capability catalog
  tools
  skills
  plugins
  MCP servers
  operator/channel packs
  Frappe/ERPNext packs
  personal workflows
        |
        v
execution runtime
  deterministic fast paths
  provider calls
  CLI-auth runtimes
  flows
  hooks
  subagents
  browser automation
  channel webhooks
        |
        v
qa scorecard
  PTY/TUI tests
  provider latency probes
  MCP auth failure tests
  memory retrieval speed tests
  channel/plugin setup tests
  Frappe-2 real prompt regressions
  release evidence bundle
```

The Trust Kernel is the invariant layer. The catalog and personal-agent surfaces
can grow only when they preserve the Trust Kernel contract.

## Research Snapshot

This goal is grounded in the current reference set, not only old docs:

- `ai-boost/awesome-harness-engineering` at `901e763` frames the discipline:
  loop, context delivery, tool UX, permissions, memory, verification,
  observability, orchestration, human-in-loop, and shipping checklists.
- `HKUDS/OpenHarness` at `9b2efd7` reinforces static dry-runs, provider/auth
  resolution, skill/plugin breadth, and a personal-agent home workspace.
- `NousResearch/hermes-agent` at `9259d1e` reinforces the narrow-waist pattern:
  keep core small, add capabilities through commands, skills, plugins, MCP, and
  service-gated tools so every new capability does not slow every turn.
- OpenClaw's gateway/channel docs reinforce channel/session/auth separation:
  routing keys are not authorization, and context visibility must be separate
  from who can wake the agent.
- Claude/Codex harness references reinforce app-server style protocols, hooks,
  streaming, prompt-cache stability, and strict verification before claiming a
  regression is fixed.

Muster should reuse the patterns, not clone the products.

## Current Muster Audit

The codebase already has a strong skeleton:

- Capability loading, plugin policy, high-risk refusal, slot ownership, and
  permission-scoped tool context.
- Built-in catalog entries for skills, plugins, MCP servers, providers, browser,
  web search, channels, Frappe/ERPNext, and everyday workflows.
- Gateway adapters for Telegram, Slack, Discord, WhatsApp, Google Chat, Teams,
  pairing, bearer auth, signatures/challenges where supported, and streaming.
- Scoped memory with SQLite/FTS, receipts, repair, status, retrieval evals, and
  latency probes.
- QA suites for PTY/TUI, provider latency, MCP auth failure, memory retrieval,
  channel/plugin setup, and Frappe-2 real prompts.

The gap is not absence. The gap is inconsistent depth:

- Some packs are executable; others are setup plans; some are local helpers.
  The UI/catalog does not make that distinction strongly enough.
- Capability manifests do not yet declare enough readiness metadata: auth type,
  setup docs, command checks, live-check command, operations, result caps,
  mutation policy, known limitations, docs, and test artifacts.
- Declared eval paths are not yet enforced strongly enough.
- Most packs lack signed digests.
- Channel live diagnostics are uneven.
- Scorecard artifacts can still be too thin if strict suite-specific case IDs,
  freshness, and artifact validation are not enforced.

This is why readiness becomes the first implementation slice.

## Catalog Readiness Model

Every tool, skill, plugin, MCP server, channel/operator pack, and personal
workflow gets a readiness level. This replaces binary "exists/does not exist"
language.

| Level | Name | Meaning | Required evidence |
|---|---|---|---|
| L0 | listed | Exists only as metadata or research reference. | Description, owner/source, risk, reason it belongs. |
| L1 | setup-plan | Gives setup steps but does not execute runtime work. | Setup URLs, required credentials, expected auth flow, failure modes, no runtime claim. |
| L2 | installable | Can be enabled/disabled or configured locally. | Manifest, policy, secrets schema, setup checker, enable/disable test. |
| L3 | executable | Has one or more working tools/commands/adapters. | Tool schemas, success/failure tests, timeout/cap policy, receipts, token ledger path. |
| L4 | verified | Passes isolated QA plus at least one realistic scenario. | Artifact bundle with manifest, cases, logs, redacted config, timings. |
| L5 | release-ready | Works in a real surface or Frappe-2 regression where applicable. | Live transcript or fixture, failure recovery, docs, changelog claim, no secret leakage. |

Only L4/L5 entries may be marketed as "works". L0-L3 can be exposed inside the
TUI, but the UI must state what remains before execution is possible.

Initial expected labels:

- **L5/L4 candidates**: Frappe bridge, memory store, gateway pairing core,
  basic Telegram/Slack paths where credentials and live checks are available.
- **L3/L4 candidates**: GitHub, Google Workspace, Notion, Airtable,
  Hugging Face, Jupyter, vLLM, Obsidian, web-frameworks, developer-tools,
  MCP bridge, channel setup packs.
- **L2/L3 candidates**: artifact-studio, data-analytics, daily-ops,
  security-review, research-lab, web-search.
- **L1 candidates**: provider setup packs, browser provider setup,
  Codex/Claude runtime setup, external memory/search/media/channel catalog
  entries without a local runtime.
- **L0 candidates**: any static catalog entry without `packPath`, setup command,
  diagnostics, or verified operation.

## Pack Manifest v2

Current manifests validate identity, permissions, sandbox, secrets, evals, and
entrypoint. v2 should add product-readiness metadata:

```ts
interface CapabilityReadiness {
  level: "listed" | "setup_plan" | "installable" | "executable" | "verified" | "release_ready";
  status: "stable" | "beta" | "experimental" | "blocked";
  actionability: "metadata" | "setup_plan" | "local_tool" | "runtime_adapter" | "mcp_installable" | "end_to_end_workflow";
  owner: "muster" | "community" | "external";
  surfaces: ("cli" | "tui" | "gateway" | "web" | "channel" | "frappe")[];
  setup: {
    urls: string[];
    requiredEnv: string[];
    requiredAnyEnv: string[][];
    oauth?: { provider: string; setupUrl: string };
    credentialStorage: "env" | "muster-secret-ref" | "external-vault" | "none";
  };
  diagnostics: {
    doctorCommand?: string;
    smokeCommand?: string;
    latencyBudgetMs?: number;
    requiresLiveCredentials: boolean;
  };
  safety: {
    risk: "low" | "medium" | "high";
    permissionMode: "deny_by_default" | "ask" | "allow_when_scoped";
    mutationApproval: "never" | "required" | "policy";
    resultCapBytes: number;
    secretRedaction: true;
  };
  evidence: {
    unitTests: string[];
    qaSuites: string[];
    liveArtifacts: string[];
    docs: string[];
  };
}
```

v2 must be backward-compatible at first: existing manifests remain valid, but
the QA scorecard should mark missing readiness fields as warnings until the
release gate flips them to blockers.

## Deep-Pack Standard

A completed pack must include:

- Manifest v2 readiness metadata.
- Tool schemas that do one conceptual thing each.
- Setup workflow that says what credential or OAuth step is missing.
- Doctor check with actionable failure messages.
- Enable, disable, and reset behavior.
- Permission/risk policy.
- Result caps and timeout defaults.
- Token ledger and receipt attribution.
- Unit tests for schema, success, expected failure, and secret redaction.
- QA artifact bundle for release-ready claims.
- README/docs page with "what works", "what needs credentials", and "what is
  intentionally not supported".
- A dry-run/doctor path that resolves provider, auth, skills, tools, plugins,
  MCP/config, permissions, and channel bindings without model calls or external
  mutations.

For channel/operator packs, also require:

- Signature verification or explicit no-signature rationale.
- Separate trigger authorization from context visibility. Being able to wake the
  agent does not mean every quoted/thread/history item may enter context.
- Deterministic channel/account/sender/thread session keys.
- Pairing/identity mapping.
- Webhook challenge test where the platform needs it.
- Dry-run send preview.
- Approval flow for mutations.
- Transcript fixture with inbound message, governed run, and outbound response.

For skills, also require:

- Trusted roots and disable controls for project-local skills in untrusted
  repositories.
- Clear invocation metadata.
- Input assumptions and refusal conditions.
- Retrieval budget or context-injection budget.
- Skill attribution in token ledger.
- Eval or fixture proving the skill improves the target workflow.
- No hidden broad context injection.

For MCP packs, also require:

- Per-server include/exclude tool policy.
- OAuth/API-key state inspection.
- Circuit breaker and timeout.
- Result-size cap.
- Auth failure recovery test.
- Tool listing snapshot with redaction.

## Responsiveness And Latency Design

Muster must distinguish its own overhead from provider latency.

Every run should eventually report:

- queue/setup time
- memory retrieval time
- context render time
- provider connect time
- time to first token
- total provider time
- persistence/ledger time
- surface render time

Fast-path rules:

- Keep the core narrow. Prefer command, skill, plugin, MCP, or service-gated
  tool before adding a new always-visible core tool.
- Shell/file/listing tasks should run deterministic tools before model calls
  when policy allows.
- Provider/model picker should show latency/cost hints and the current selected
  route.
- Broad tool catalogs should not be injected wholesale into every prompt.
- MCP tool listings should be cached with expiry and invalidation.
- Memory recall must stay SQLite/FTS-first unless a hybrid eval beats it.
- Streaming must be first-token oriented; finalization cannot depend on content
  dedupe guesses.

Release latency gates:

- Memory recall p95 under the current scale budget.
- TUI command completion visible and stable for two seconds after `/` or `@`.
- Local deterministic commands return without provider calls.
- Provider latency suite separates Muster overhead from model/provider time.
- Frappe-2 prompts produce timing artifacts, not screenshots alone.

## Personal-Agent Surface

The personal-agent app layer is not a separate promise from the harness. It is
the user-facing way to access the harness.

Minimum release-worthy behavior:

- First run explains the product in user terms, not framework terms.
- User can pick use cases: coding, personal memory, Frappe/ERPNext, web/browser,
  channels, MCP/plugins, daily ops.
- Multiple choices are allowed.
- Each selected use case opens a setup workflow with credential/auth guidance.
- Provider/model/speed choices are interactive pickers, not memorized strings.
- `/tokens`, `/memory`, `/plugins`, `/skills`, `/mcp`, `/channels`, `/provider`,
  `/model`, `/status`, and `/doctor` are discoverable and actionable.
- Every picker supports selection, escape, history, and recovery.
- The UI distinguishes "ready", "needs auth", "setup-only", and "blocked".
- Channel setup distinguishes "can receive", "can reply", "can mutate external
  systems", and "can see prior context".

## QA Scorecard

`muster qa scorecard` should become the release gate aggregator.

Strict release mode must be separate from advisory health checks:

```bash
pnpm typecheck
pnpm test
pnpm build
node benchmark/run.mjs
muster qa run pty_tui --artifact-dir artifacts/qa/pty_tui --evidence artifacts/qa/scorecard.json
muster qa run provider_latency --runs 5 --provider-delay-ms 25 --max-overhead-p50-ms 250 --artifact-dir artifacts/qa/provider_latency --evidence artifacts/qa/scorecard.json
muster qa run mcp_auth_failure --artifact-dir artifacts/qa/mcp_auth_failure --evidence artifacts/qa/scorecard.json
muster qa run memory_retrieval_speed --max-p95-ms 75 --artifact-dir artifacts/qa/memory_retrieval_speed --evidence artifacts/qa/scorecard.json
muster qa run channel_plugin_setup --artifact-dir artifacts/qa/channel_plugin_setup --evidence artifacts/qa/scorecard.json
muster qa run frappe2_real_prompts --host Frappe-2 --artifact-dir artifacts/qa/frappe2_real_prompts --evidence artifacts/qa/scorecard.json
muster qa scorecard --evidence artifacts/qa/scorecard.json --strict-release
```

`--strict-release` fails on any warning, unknown, stale artifact, missing
required case, missing suite-specific artifact, secret leak, or manually
recorded pass that was not produced by `muster qa run`.

Required suites:

- `qa-pty-tui`: composer rails, slash/at completion, picker selection, history,
  escape, multiline input, prompt persistence after output.
- `qa-provider`: provider readiness, model inventory, selected route, latency
  split, fast deterministic path.
- `qa-mcp`: missing token, expired token, invalid token, valid token, logout
  recovery, result cap, circuit breaker.
- `qa-memory`: recall accuracy, leakage, stale/no-hit, p95 latency, repair.
- `qa-channel-plugin`: catalog coverage, setup metadata, high-risk refusal,
  enable/disable policy, channel dry-run.
- `qa-pack-readiness`: manifest v2 coverage, docs, tests, actionability honesty.
- `qa-frappe2`: real prompts, Frappe/ERPNext docs/context, channel setup where
  credentials exist, provider timings, artifact bundle.
- `qa-artifact-requirements`: report/dashboard/artifact outputs validate before
  rendering, enforce bounded snapshots, include provenance, checksum outputs,
  and fail partial/missing data honestly instead of creating fake green reports.

Each suite must write:

- `manifest.json`
- `cases.jsonl`
- redacted config snapshot
- timing summary where relevant
- command transcript or protocol snapshot
- failure log with next action
- `startedAt`, `finishedAt`, `musterVersion`, `gitSha`, `nodeVersion`,
  `platform`, `command`, and `thresholds` in the manifest
- exact required case IDs for strict-release mode
- non-empty suite-specific artifact files declared by `manifest.artifacts`

A suite that has zero cases is failed.
A passed artifact for the wrong git SHA is stale unless explicitly approved as a
remote Frappe-2 artifact for that SHA.

## Implementation Slices

### Slice 1: Spec And Scorecard Contract

- Add this design spec.
- Add readiness model types.
- Add pack-readiness inspection over current manifests.
- Add `muster qa scorecard` aggregation if missing or incomplete.
- Make missing readiness metadata visible but initially warning-level.

### Slice 2: Manifest v2 Migration

- Migrate first-party packs to readiness metadata.
- Mark setup-only entries honestly.
- Identify L4/L5 targets for this release.
- Add docs links and setup URLs.

### Slice 3: Deepen Core Packs

Prioritize:

1. memory
2. provider/model routing
3. MCP bridge
4. browser/web search
5. Frappe/ERPNext
6. Telegram
7. Slack/Google Chat/Teams/Discord/WhatsApp setup packs
8. daily ops/personal agent workflows

Each pack gets setup, doctor, failure tests, policy, docs, and artifacts.

### Slice 4: Personal-Agent Workflow

- Make onboarding multi-select and workflow-based.
- Add picker chains for provider/model/MCP/channel/plugin setup.
- Show readiness states in TUI.
- Preserve prompt history and output state.

### Slice 5: Live Break Testing

- Run local deterministic QA.
- Run Frappe-2 real prompt regression suite.
- Test Telegram if credentials and network are available.
- Save artifacts and summarize failures honestly.

### Slice 6: Release Reconciliation

- Update README, website, package metadata, docs, changelog.
- Remove or downgrade claims that are not backed by artifacts.
- Publish only after CI and live gates pass.

## Release Acceptance

The release can ship only when:

- No first-party pack is presented as ready above its verified level.
- All L4/L5 pack claims have artifacts.
- `muster qa scorecard` passes locally.
- Frappe-2 regression suite has concrete artifacts or clearly documented
  environmental blockers.
- TUI does not regress on picker/history/composer behavior.
- Provider latency split is visible for at least one real provider route.
- Memory retrieval remains scoped and fast.
- Docs, README, website, and changelog match the verified feature state.

## Open Risks

- This goal is broad. If a pack cannot become L4/L5 in the release window, it
  should be downgraded honestly rather than rushed.
- Live channels require external credentials and platform webhooks. Missing
  credentials are blockers for L5, not excuses for claiming live readiness.
- External reference repos are moving. Muster should reuse patterns, not chase
  every new catalog entry.
- Personal-agent app polish can consume unlimited time. The release gate should
  focus on correctness, recoverability, and clarity before decorative polish.

## First Engineering Decision

Adopt the readiness model before adding more packs. This prevents every future
integration from repeating the same ambiguity: "listed" is not "working",
"setup guidance" is not "installed", and "installed" is not "release-ready".
