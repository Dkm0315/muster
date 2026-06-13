# OpenClaw vs. muster — Profile Model, Concept Gap, and Migration Defects

> Verified against source: `packages/core/src/{profiles.ts, migration.ts, types.ts}`,
> `packages/cli/src/index.ts` (migrate handler ~1054–1083, `profileCommand` ~1318–1341),
> `packages/gateway/src/{adapters/*, gateway-config.ts, pairing.ts}`, and `capability-packs/frappe`.
> No secret values appear in this document. Where code references a secret, the literal
> placeholder `${TELEGRAM_BOT_TOKEN}` is used.

---

## 1. Executive summary

**Can muster have multiple profiles? Yes — and its profile model is stronger and more
isolation-correct than OpenClaw's.** The catch is that the two systems are *not* 1:1, so the
mapping has to be stated precisely. A muster **Profile** (`packages/core/src/profiles.ts`)
equals an OpenClaw **instance / per-tenant home** (each `~/.openclaw`, e.g. `ossmgr_support`,
`nischay`, `oxygenhr`): a named, totally-isolated workspace at `.muster/profiles/<name>/`
owning its own `config.json`, `data/` (memory, sessions, episodes, token ledger), a per-profile
`home/` for subprocess credential isolation, `skills/`, and an `AGENTS.md` overlay. OpenClaw's
*channels* (telegram, …) and *agents.defaults* are **not** profiles — they are config
sub-concepts that live *inside* one profile, and they map to muster's gateway **adapters** and
**runtimes/routing** respectively. So muster multiplies **tenants** (Profiles), **surfaces**
(adapters under one envelope), and **runtimes** (routes) as three orthogonal, individually
multiplied axes, where OpenClaw splits the same expressiveness across instances + channels +
agents — with weaker isolation (its runtime config showed a single `main` agent in a single
per-home config).

The work splits into two honest buckets:

- **(A) Migration-correctness defects to fix now** — all confirmed in `migration.ts`. The OpenClaw
  rule maps `openclaw.json` as one opaque `config` blob that is *never parsed* (line 45), so
  channels / agents / plugins / tools / session are silently dropped; there is **no per-field
  secret redaction**, so `channels.telegram.botToken` and `gateway.auth` would be copied verbatim
  once apply exists; **four phantom rules** (`config.json`:46, `skills`:47, `tools`:48,
  `mcp.json`:50) probe paths OpenClaw never had and generate false `missing:` noise; and **four
  real on-disk dirs** (`agents/`, `flows/`, `extensions/`, `devices/`) have no rule and are
  dropped — `devices/` is security-relevant (it grants `operator.write` scope). The scanner
  (lines 98–116) is stat-only and never opens a file, which is structurally wrong for OpenClaw,
  where almost all state lives *inside* `openclaw.json`.

- **(B) Missing-but-necessary profile features (proposed, not auto-implemented)** — the biggest
  gap is **per-surface/per-tenant → profile binding in a single gateway process** (today
  `activeProfile()` is one pointer per checkout, so one gateway cannot concurrently route
  different surfaces to different profiles); `cloneProfile` exists but is **not exposed in the
  CLI**; and **migration apply is entirely unbuilt** (dry-run only, blocked at `index.ts:1061`).

Every proposed change is checked against muster's must-preserve invariants (profile isolation,
per-profile HOME, leak-proof scoped memory, one-gateway/one-envelope contract, pairing identity,
eval-gated skills, governed/never-silent routing, capability-pack security, zero-new-dependency
discipline). **None requires a new npm dependency.**

---

## 2. "Can muster have multiple profiles?" — the precise answer

**YES — fully, and more strongly than OpenClaw.** The answer is "yes" at three independent layers,
which is why it is stronger than OpenClaw's single-instance/single-agent runtime config:

### 2.1 Tenant / instance layer — **Profiles** (the real equivalent of an OpenClaw instance)

A muster Profile is the correct analogue of an OpenClaw instance / per-tenant home:

| Property | muster Profile | OpenClaw instance |
| --- | --- | --- |
| Root | `.muster/profiles/<name>/` | `~/.openclaw` (per home) |
| Config | own `config.json` (`MusterConfig`) | `openclaw.json` |
| Data | `data/` — `memory.jsonl`, sessions, episodes, token ledger | per-home state |
| Credential isolation | per-profile `home/` (`profileHomeDir` / `subprocessEnvForProfile`) for git/ssh/npm subprocesses | none equivalent |
| Skills / overlay | `skills/` + `AGENTS.md` overlay | inside `openclaw.json` |
| Active selection | single pointer file `.muster/profile` | one home per process |
| Legacy mode | `"default"` keeps the flat `.muster/data` layout | — |

- **API:** `createProfile` / `listProfiles` / `useProfile` / `activeProfile` / `cloneProfile`.
- **CLI:** `muster profile create | list | use | current`.
- **Isolation is a *passing test*** — profile B cannot read profile A's memory — and the guarantee
  extends to subprocess credentials via `profileHomeDir` / `subprocessEnvForProfile`. This is a
  **harder** guarantee than OpenClaw, whose runtime config showed a single `main` agent in a
  single per-home config.

### 2.2 Surface / channel layer — **adapters** under one envelope

OpenClaw's `channels.telegram` (one channel) maps to **one muster gateway adapter** plus a
`gateway-config.json` entry (surface id `telegram:bot`). OpenClaw supporting multiple channel keys
maps to muster's **single-envelope** `SurfaceMessage` / `SurfaceReply` contract with thin, pure,
network-free mapper adapters (telegram / slack / discord / whatsapp / gchat / teams). These are
config sub-concepts *inside* a profile, **not** profiles.

### 2.3 Runtime layer — **runtimes + routing**

OpenClaw's `agents.defaults` (default model + per-model runtime mapping to `claude-cli` / `codex`)
maps to muster's `MusterConfig` **runtimes + routing**: `RuntimeKind`, per-`TaskKind` `ModelRoute`,
`oneRuntimePerRun`. Again — inside a profile, not a profile.

### 2.4 The one real gap

muster's multi-profile is **per-checkout** (`.muster/`-rooted) with a single active pointer and
**no per-surface → profile binding**. A single gateway process therefore **cannot yet route
different surfaces/tenants to different profiles concurrently** — it resolves all paths through one
`activeProfile()`. For the federated multi-tenant direction this is the key missing capability
(see Section 5.1).

---

## 3. Concept-by-concept gap table

| OpenClaw concept | muster has | Necessary | Risk | Recommendation |
| --- | :---: | :---: | --- | --- |
| **OpenClaw instance / per-tenant home** (`~/.openclaw`, e.g. `ossmgr_support`, `nischay`) | **yes** | yes | Already implemented as muster Profile (`.muster/profiles/<name>/`) with total isolation, per-profile HOME, and history-free `cloneProfile`. No risk — this is the load-bearing must-preserve invariant. Do not regress the isolation test or the legacy `default` flat layout. | Keep as-is. muster's strongest concept and the correct target for `migration.ts` to write OpenClaw instances into. |
| **`channels.*` profile** (telegram: enabled, `dmPolicy=pairing`, `botToken`, `customCommands[4]`) | **partial** | yes | muster has the telegram adapter + gateway-config (`botToken`/`secretToken`) and pairing-based `dmPolicy`, but does **not** model per-channel `customCommands` (`/start`,`/pair`,`/sop`,`/todo`) or OpenClaw's `allowFrom`/`groupPolicy`/`textChunkLimit`/streaming. Adding command registration risks colliding with the single-envelope contract if commands become channel-bespoke logic. | Add a **declarative** per-surface command registry in `gateway-config.json` (name + description + intent), resolved centrally so all surfaces share behavior. Migrate `channels.telegram.customCommands` into it. Keep adapters network-free. |
| **`agents.defaults`** (workspace, default model `claude-opus-4-8`, model→runtime map: `claude-cli`/`codex`) | **yes** | yes | Maps cleanly to `MusterConfig` runtimes (`RuntimeKind` native\|codex\|claude-code) + `ModelRoute` + `routing.defaultRuntime`. **Model-id mismatch:** OpenClaw default is `anthropic/claude-opus-4-8`; muster's anthropic preset defaults to `claude-fable-5`. Migration must preserve the user's chosen model (violates the never-silent-model-drift invariant otherwise). | In `migration.ts`, parse `agents.defaults.model` and the per-model `agentRuntime` map into providers + runtimes + routes, **preserving exact model ids** (`opus-4-8`/`sonnet-4-6`/`gpt-5.4`). Record as map-mode assets, not an opaque blob. |
| **session** (`dmScope=per-channel-peer`) | **yes** | yes | muster's gateway already scopes runs by `pairing:<surfaceId>:<senderId>` + a conversation session lane — this *is* per-channel-peer. No risk; only gap is naming/parsing during migration. | Map `openclaw.json.session.dmScope` to the existing pairing + session lane scoping. No code change beyond surfacing it in the migration report. |
| **gateway** (local/loopback `:18789`, token auth; `operator.write` granted by device-pairing) | **yes** | yes | muster's gateway (bearer token in `gateway.json`) + `pairing.ts` (operator scope via `muster pairing approve`, not a bare token) is a direct match and must-preserve invariant. Risk is only in migration: `gateway.auth` is secret-bearing and must never be copied verbatim. | Preserve. During migration, surface `gateway.bind`/`port`/`mode` as config but **redact** `gateway.auth` to a placeholder/env reference. |
| **`plugins.entries`** (8 enabled incl. `frappe2-openclaw-gateway` → `uat-erp.pwhr.in`; `allow[10]`; bundledDiscovery) | **partial** | yes | The frappe gateway maps to `capability-packs/frappe` (production federated bridge, signed manifest, runs as a paired Frappe user) — strong. But generic plugins (lobster/brave/codex/diffs/anthropic/openai) have no 1:1 muster pack, and `migration.ts` never enumerates `plugins.entries` (it probes a non-existent `tools/` dir). Auto-importing arbitrary plugins as packs risks the capability-pack security model (permissions/sandbox tiers/evals). | Replace the phantom `tools/` rule with a parse of `openclaw.json.plugins.entries` → per-plugin capability-pack **candidates** (`kind=tool`, `importMode=manual_review`). Map `frappe2-openclaw-gateway` onto `capability-packs/frappe`; everything else stays quarantined pending eval. |
| **`tools.alsoAllow`** (28 `frappe_*` domain/RBAC/records tools + lobster) | **partial** | yes | The `frappe_*` tools already live inside the `capability-packs/frappe` manifest, so this is mostly covered by one pack — good. Risk: migration treats tools as a missing *directory* (false `missing`) instead of reading the in-config allowlist, so a user appears to lose tool grants. | Parse `openclaw.json.tools.alsoAllow` and reconcile against `capability-packs/frappe`'s declared tools; report extras (e.g. lobster) as `manual_review`. Remove the phantom `tools/` dir rule. |
| **`models.providers`** (global provider registry, currently empty) | **yes** | yes | muster's providers (`providers-catalog.ts`, 20+ presets) covers this. OpenClaw's registry is empty here (definitions live in `agents.defaults.models` + per-agent `models.json`), so migration must source provider config from `agents.defaults`, not from `models.providers`. Low risk. | Derive providers from `agents.defaults.models` / `agents/main/agent/models.json`. Do not rely on the empty `models.providers`. |
| **on-disk `agents/` dir** (single agent `main` + 47 session transcripts, `models.json`, `auth-profiles.json`) | **partial** | yes | muster Profile owns `data/sessions` + agent overlay, but there is **no** migration rule for OpenClaw's `agents/` dir, so the agent identity, `models.json`, and 47 transcripts are silently dropped. `auth-profiles.json` is secret-bearing. Bulk-importing 47 transcripts could pollute episodes/ledger (clone deliberately excludes history). | Add an openclaw rule for `agents/` (`kind=agent`; `importMode=map` for definitions, `archive_only` for sessions/transcripts) mirroring the `pi` rule. Redact `auth-profiles.json`. Import sessions as archived evidence, NOT live episodes. |
| **`flows/` dir** (SQLite flow registry, migrated) | **yes** | yes | muster has `flow.ts` (durable flows, gate-approval cards) — a real target. But `migration.ts` has **no** openclaw flows rule, so the user's entire flow library is invisible. Importing a foreign SQLite registry directly is risky (schema mismatch); archive-only first is safer. | Add an openclaw `flows/` rule (`kind=workflow`, `importMode=archive_only` initially, `map` once a SQLite→`flow.ts` translator exists), mirroring the `pi` flows rule at `migration.ts:68`. |
| **`extensions/` dir** (`frappe2-openclaw-gateway` v0.2.0 + `openclaw-erpnext-bridge`; `mcpServers`/`configSchema`/contracts) | **partial** | yes | `frappe2-openclaw-gateway` maps to `capability-packs/frappe` and its `mcpServers` map to muster's `mcp.ts` (per-server isolation, breakers, no SDK). But migration ignores `extensions/` entirely, and extensions carry **executable capability** — auto-loading would bypass the capability-pack sandbox model. | Add an `extensions/` rule (`kind=tool`, `importMode=manual_review`, recursive). Parse each manifest's `mcpServers` into `McpServerConfig` candidates (`manual_review`). Never auto-activate. |
| **`devices/` dir** (device-pairing state: 1 paired, 1 pending; grants `operator.write` scope) | **partial** | yes | muster's `pairing.ts` is the conceptual equivalent (operator scope via pairing), but there is **no** migration rule for `devices/`, so paired-device authorization context is lost. `paired.json`/`pending.json` are security-sensitive. Importing pairings blindly grants `operator.write` to devices the new admin has not re-approved — a **privilege-escalation** risk. | Add a `devices/` rule (`kind=config`, `importMode=manual_review`/`archive_only`, treated as secret-bearing). Surface paired/pending counts for review but require explicit re-approval via `muster pairing approve` — never auto-grant scope. |
| **`memory/` dir** (memory-core SQLite, ~90 KB) | **yes** | yes | This is the **one** real dir the existing openclaw rules catch (`migration.ts:49`), mapping to muster's leak-proof scoped memory (`memory.ts`). Risk: imported memory must preserve provenance/confidence/`redactionState` and land in the correct profile/tenant scope, or it breaks the cross-user-leak-is-a-failing-test invariant. It is **SQLite here, not a recursive dir**, so the recursive stat mis-handles it. | Keep importing memory, but parse `main.sqlite` into `ContextObject`s with explicit scopes/provenance/`redactionState=redacted-by-default`, into the target profile's memory only. Do not flatten cross-tenant. |
| **commands / customCommands** (native/`nativeSkills`; `/start` `/pair` `/sop` `/todo`) | **no** | nice-to-have | muster has no slash-command registry; commands would be re-expressed as intents/skills. Low risk to add (declarative), but mis-modeling them as per-adapter logic violates the pure-mapper rule. | Optional: add a declarative command registry resolved in the gateway. Until then, surface commands in the migration report as informational, mapped onto skills/intents. |
| **wizard / meta** (provenance: `lastRunAt`, `lastTouchedVersion`) | **no** | no | Pure bookkeeping; no behavioral value. Importing it adds noise. | Ignore during migration (do not emit as `missing`). Optionally record source version in the report for traceability. |

---

## 4. Significant migration defects to fix now

All line references confirmed against `packages/core/src/migration.ts` and
`packages/cli/src/index.ts` at time of writing.

### 4.1 CRITICAL — `openclaw.json` mapped as one opaque `config` blob; channels/agents/plugins/tools/session never parsed (`migration.ts:45`)

Replace the single map-mode rule with a JSON-parsing pass that reads `openclaw.json` and emits
distinct typed assets per top-level key:

- `channels` (telegram adapter + commands, `botToken` redacted),
- `agents.defaults` (model + runtime map, **exact** model ids preserved),
- `plugins.entries` (8 capability candidates),
- `tools.alsoAllow` (reconcile vs `capability-packs/frappe`),
- `session`,
- `gateway` (`auth` redacted).

Without this, a user migrating off OpenClaw silently loses their Telegram channel, agent model,
and every plugin/tool grant. The scanner (`migration.ts:98–116`) is stat-only and opens no
file — add a parse branch for the openclaw source.

### 4.2 CRITICAL — no per-field secret redaction for `openclaw.json`; `channels.telegram.botToken` and `gateway.auth` would be copied verbatim once apply exists (`migration.ts:45`)

Add a field-level redaction obligation to the openclaw rules/parse: surface only the **key name**
and replace any value whose key matches `/token|secret|key|password|auth|bearer|credential/i` with
the placeholder `${TELEGRAM_BOT_TOKEN}` (or an env reference). `channels.telegram.botToken`,
`gateway.auth.token`, and `agents/main/agent/auth-profiles.json` are live secrets. The current
opaque-blob map-mode has zero secret handling (unlike the Hermes `providers.json` note). This
**must land before any apply step is built** — apply is currently blocked at `index.ts:1061`,
which is the safe window to fix it.

### 4.3 HIGH — phantom rule for `config.json` that never existed in OpenClaw; always reported as false `missing` (`migration.ts:46`)

Delete the `config.json` rule. OpenClaw's only config is `openclaw.json`; there is no legacy
`config.json`. The phantom rule pushes `~/.openclaw/config.json` onto `missingPaths`
(`migration.ts:100–102`) and the CLI prints it under a scary `missing:` header
(`index.ts:1073–1076`), implying lost data the user never had.

### 4.4 HIGH — phantom rule for `skills/` dir not part of OpenClaw; false `missing` (`migration.ts:47`)

Delete the `skills/` rule. OpenClaw has no top-level `skills` directory (verified absent);
skill/command behavior lives inside `openclaw.json`. If skills are wanted, parse
`openclaw.json.commands.nativeSkills` instead of stat-ing a non-existent directory.

### 4.5 HIGH — phantom rule for `tools/` dir not part of OpenClaw; real tools live in plugins/`alsoAllow` (`migration.ts:48`)

Delete the `tools/` rule. Real tools are `openclaw.json.plugins.entries` (8 entries) and
`tools.alsoAllow` (28 entries). Enumerate those keys as tool/capability candidates
(`manual_review`) instead of stat-ing an absent directory.

### 4.6 HIGH — phantom rule for `mcp.json` not part of OpenClaw; MCP is plugin/extension-embedded (`migration.ts:50`)

Delete the `mcp.json` rule. There is no top-level `mcp.json` (that is a Hermes/Pi shape). Derive
MCP servers from the `frappe2-openclaw-gateway` extension manifest's `mcpServers` (`extensions/`)
into `McpServerConfig` candidates (`manual_review`).

### 4.7 HIGH — real `agents/` dir ignored; single agent `main`, `models.json`, 47 transcripts, secret `auth-profiles.json` all dropped (`migration.ts:44–51`)

Add an openclaw rule for `agents/` (`kind=agent`, recursive): map agent definitions/`models.json`
into the profile runtime config; `archive_only` the 47 session transcripts (do **not** import as
live episodes — respect the history-free clone invariant); redact `auth-profiles.json`. Mirror the
`pi` agents rule at `migration.ts:66`.

### 4.8 HIGH — real `flows/` dir (SQLite flow registry) ignored; entire flow library invisible (`migration.ts:44–51`)

Add an openclaw `flows/` rule (`kind=workflow`, `importMode=archive_only` initially; `map` once a
SQLite→`flow.ts` translator exists), mirroring the `pi` flows rule at `migration.ts:68`. Currently
the user's flows are silently dropped.

### 4.9 MEDIUM — real `extensions/` dir ignored; frappe gateway + erpnext bridge + their `mcpServers` not surfaced (`migration.ts:44–51`)

Add an `extensions/` rule (`kind=tool`, `importMode=manual_review`, recursive). Map
`frappe2-openclaw-gateway` onto `capability-packs/frappe`; parse each manifest's `mcpServers` into
MCP candidates. Extensions carry executable capability, so never auto-activate — surface for risk
review only.

### 4.10 MEDIUM — real `devices/` dir (pairing/operator-scope grants) ignored; paired-device authorization context lost (`migration.ts:44–51`)

Add a `devices/` rule (`kind=config`, `importMode=manual_review`/`archive_only`, treated as
secret-bearing). Surface paired (1) and pending (1) counts for review, but require explicit
re-approval via `muster pairing approve` — never auto-grant `operator.write` scope
(privilege-escalation risk).

### 4.11 MEDIUM — scanner never parses JSON; classification is purely path/stat-shaped, so content-derived OpenClaw assets are structurally impossible (`migration.ts:98–116`)

`scanMigrationSource` only does `pathExists`/`isDirectory`/`listChildren`, and `assetFromRule`
copies a static note. For OpenClaw, nearly all meaningful state is **inside** `openclaw.json`. Add
a JSON-parsing expansion pass for the openclaw source that turns top-level keys into typed assets
with secret-key redaction, rather than emitting one opaque config asset. Also handle `memory/` as
a SQLite **file**, not a recursive dir.

### 4.12 LOW — misleading `missing:` output frames never-present OpenClaw files as data loss (`cli/src/index.ts:1073–1076`)

Once the four phantom rules are removed this self-corrects. Alternatively, distinguish
`expected-but-absent` from `not-applicable-to-this-source` in the report so users are not told
they lost `config.json`/`skills`/`tools`/`mcp.json` that were never part of OpenClaw. Also revisit
the empty-dir branch (`migration.ts:106–107`) and the "no known importable assets" next-action
(`migration.ts:144–145`).

---

## 5. Missing-but-necessary profile features (proposed, NOT auto-implemented)

Each item below is a *proposal* with explicit risk and effort. None is implemented in this
analysis, and none requires a new npm dependency.

### 5.1 Per-surface / per-tenant → profile binding in a single gateway process

- **Why:** OpenClaw runs multiple per-tenant instances; muster Profiles isolate tenants but the
  active profile is a single `.muster/profile` pointer per checkout. A single gateway (`server.ts`)
  currently cannot concurrently route surface id `telegram:bot` to profile A and `slack:T…` to
  profile B — it resolves paths through one `activeProfile()`. For the federated multi-tenant
  runtime direction this is the key missing capability.
- **Risk: HIGH if done wrong.** `activeProfile()` and all path resolvers (`config.ts`, `store.ts`,
  `memory.ts`) read a single pointer; threading a per-request profile through every core call
  could break the profile-isolation test and the per-profile HOME subprocess guarantee if any
  shared path leaks. **Safe approach:** add an explicit profile parameter to the gateway run path
  (pairing → profile mapping in `gateway-config.json`), resolve
  `profileDataDir`/`profileHomeDir`/`profileConfigPath` per-request, and add a test that two
  concurrent surfaces never cross memory scopes. **Do NOT** make `activeProfile()` mutate global
  state per request.
- **Effort: Medium-High.** Localized to gateway `server.ts`/`pairing.ts` + threading an explicit
  profile through `run.ts` entry points; core path functions already accept a profile arg, so the
  plumbing exists. Add a concurrency isolation test.

### 5.2 `cloneProfile` exposed via CLI (`muster profile clone <from> <to>`)

- **Why:** `cloneProfile` (history-free clone of config + memory + skills) is implemented in
  `profiles.ts` but **not** wired into `profileCommand` (`cli/src/index.ts:1318–1341` only has
  create/list/use/current). Cloning a tenant baseline (a must-preserve invariant) is impossible
  from the CLI, which directly hurts the multi-instance onboarding story OpenClaw users expect.
- **Risk: LOW.** Pure additive CLI wiring to an already-tested core function. Only risk is
  forgetting that clone must refuse the `default` target and must NOT copy
  sessions/episodes/ledgers — already enforced in `cloneProfile`. Add a CLI test asserting history
  is excluded.
- **Effort: Low.** ~10 lines in `profileCommand` + usage string + one test.

### 5.3 Migration apply that writes an OpenClaw instance into a muster Profile (currently dry-run only)

- **Why:** `migration.ts`/CLI are dry-run only (apply blocked at `index.ts:1061`). The entire
  value of "migrate off OpenClaw" is unrealized until apply maps `openclaw.json` → a target
  profile's `config.json` (providers/runtimes/routing), memory → scoped memory,
  plugins/extensions → capability candidates. This is the concrete bridge from the 5 live OpenClaw
  instances to muster.
- **Risk: MEDIUM-HIGH.** Apply touches secrets (`botToken`/`gateway.auth`/`auth-profiles.json`)
  and could auto-grant capabilities or pairings. Must be built **after** the parse/redaction
  defects above (Section 4) land. Gate every capability/plugin/device import behind
  `manual_review`; preserve exact model ids (**no silent `claude-fable-5` snap**); write into a
  **named** target profile (never overwrite `default`); back up before apply.
- **Effort: High.** New `applyMigration()` in `migration.ts` + CLI flag + secret redaction +
  per-asset import handlers + tests. Sequence after the scanner fixes.

### 5.4 Declarative per-surface command registry (`customCommands` / `nativeSkills` equivalent)

- **Why:** OpenClaw channels carry `customCommands` (`/start`,`/pair`,`/sop`,`/todo`) and
  `commands.nativeSkills`; muster has no slash-command concept, so migrated command UX is lost and
  there is nowhere to land it.
- **Risk: MEDIUM.** Must be resolved **centrally** in the gateway, not in adapters (adapters must
  stay network-free pure mappers — a must-preserve invariant). If command logic leaks into adapters
  it breaks the one-envelope contract. Model commands as declarative descriptors
  (name/description/intent) in `gateway-config.json` resolved before run-planning.
- **Effort: Medium.** Add a command registry to gateway-config + resolution in `server.ts`; map
  `channels.telegram.customCommands` during migration.

### 5.5 Per-channel policy fields: `allowFrom` / `groupPolicy` / `textChunkLimit` / streaming-per-surface

- **Why:** OpenClaw's telegram profile (and `dmPolicy=pairing`) carries access and chunking policy
  per channel. muster has pairing + streaming but no per-surface
  `allowFrom`/`groupPolicy`/`textChunkLimit`, so migrated access controls and chunking behavior are
  dropped.
- **Risk: LOW-MEDIUM.** Additive to gateway-config + surface envelope handling. Must keep
  approvals/streaming identical across surfaces (must-preserve) — implement as shared gateway
  policy, not per-adapter. Constant-time signature verification on webhooks must remain.
- **Effort: Low-Medium.** Extend gateway-config schema + enforcement in `server.ts`/`streaming.ts`;
  populate from `channels.*` during migration.

---

## Appendix — must-preserve invariants referenced above

Profile isolation (passing test) · per-profile HOME (`profileHomeDir`/`subprocessEnvForProfile`) ·
leak-proof scoped memory (cross-user-leak is a failing test) · one-gateway / one-envelope
(`SurfaceMessage`/`SurfaceReply`, pure-mapper adapters) · pairing identity (`operator.write` via
`muster pairing approve`, never a bare token) · eval-gated skills · governed / never-silent
routing (no silent model drift) · capability-pack security (permissions/sandbox tiers/evals) ·
zero-new-dependency discipline.
