# Harness Readiness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first release gate for the harness evolution goal: typed readiness metadata, pack-readiness QA, and strict-release scorecard validation that blocks shallow integrations from being called ready.

**Architecture:** Keep the core narrow by adding one readiness module in `packages/core`, one QA suite, and minimal CLI wiring. Existing pack manifests remain valid, but missing readiness metadata becomes visible; strict-release mode turns the evidence contract into a hard gate.

**Tech Stack:** TypeScript, Node.js 24, built-in `node:test`, existing Muster CLI/core package layout.

---

## File Map

- Modify `packages/core/src/capability.ts`: add readiness types and manifest parsing.
- Create `packages/core/src/qa-pack-readiness.ts`: inspect bundled packs and emit artifact-backed cases.
- Modify `packages/core/src/runtime-doctor.ts`: add `pack_readiness` suite and strict-release validation path.
- Modify `packages/core/src/index.ts`: export the new QA function/types.
- Modify `packages/cli/src/index.ts`: add `pack_readiness` to `muster qa suites`, `muster qa run`, and `muster qa scorecard --strict-release`.
- Modify `packages/core/test/capability.test.ts`: cover readiness parsing.
- Create `packages/core/test/qa-pack-readiness.test.ts`: cover pack readiness QA artifacts.
- Modify `packages/cli/test/cli.test.ts`: cover CLI strict-release behavior and suite listing.
- Modify `docs/RELEASE_TRAIN.md`: document strict-release command.

## Readiness Contract

Use these exact readiness names in code:

```ts
export type CapabilityReadinessLevel =
  | "listed"
  | "setup_plan"
  | "installable"
  | "executable"
  | "verified"
  | "release_ready";

export type CapabilityReadinessStatus = "stable" | "beta" | "experimental" | "blocked";
export type CapabilityActionability =
  | "metadata"
  | "setup_plan"
  | "local_tool"
  | "runtime_adapter"
  | "mcp_installable"
  | "end_to_end_workflow";
```

---

### Task 1: Add Backward-Compatible Readiness Types

**Files:**
- Modify: `packages/core/src/capability.ts`
- Test: `packages/core/test/capability.test.ts`

- [ ] **Step 1: Write failing tests for readiness parsing**

Append these tests to `packages/core/test/capability.test.ts`:

```ts
test("capability manifest accepts readiness metadata", () => {
  const inspection = inspectCapabilityManifest("/packs/demo", {
    schemaVersion: 1,
    id: "demo-pack",
    name: "Demo Pack",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "src/index.ts",
    permissions: ["network"],
    sandbox: "network_limited",
    readiness: {
      level: "executable",
      status: "beta",
      actionability: "local_tool",
      owner: "muster",
      surfaces: ["cli", "tui"],
      setup: {
        urls: ["https://example.test/setup"],
        requiredEnv: ["DEMO_TOKEN"],
        requiredAnyEnv: [],
        credentialStorage: "env",
      },
      diagnostics: {
        doctorCommand: "muster plugins check demo-pack",
        smokeCommand: "muster plugins test demo-pack",
        latencyBudgetMs: 500,
        requiresLiveCredentials: true,
      },
      safety: {
        risk: "medium",
        permissionMode: "ask",
        mutationApproval: "required",
        resultCapBytes: 65536,
        secretRedaction: true,
      },
      evidence: {
        unitTests: ["packages/core/test/demo.test.ts"],
        qaSuites: ["pack_readiness"],
        liveArtifacts: [],
        docs: ["docs/demo.md"],
      },
    },
  });

  assert.equal(inspection.status, "ready");
  assert.equal(inspection.manifest?.readiness?.level, "executable");
  assert.equal(inspection.manifest?.readiness?.setup.requiredEnv[0], "DEMO_TOKEN");
});

test("capability readiness rejects unknown levels and unsafe secret redaction", () => {
  const inspection = inspectCapabilityManifest("/packs/demo", {
    schemaVersion: 1,
    id: "demo-pack",
    name: "Demo Pack",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "src/index.ts",
    permissions: ["network"],
    sandbox: "network_limited",
    readiness: {
      level: "pretend_ready",
      status: "stable",
      actionability: "local_tool",
      owner: "muster",
      surfaces: ["cli"],
      setup: { urls: [], requiredEnv: [], requiredAnyEnv: [], credentialStorage: "env" },
      diagnostics: { requiresLiveCredentials: false },
      safety: {
        risk: "low",
        permissionMode: "ask",
        mutationApproval: "never",
        resultCapBytes: 1000,
        secretRedaction: false,
      },
      evidence: { unitTests: [], qaSuites: [], liveArtifacts: [], docs: [] },
    },
  });

  assert.equal(inspection.status, "blocked");
  assert.match(inspection.blockers.join("\\n"), /readiness.level/);
  assert.match(inspection.blockers.join("\\n"), /secretRedaction/);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
pnpm --filter @musterhq/core test -- capability.test.ts
```

Expected: FAIL because `CapabilityPackManifest` has no `readiness` property and validation does not inspect it.

- [ ] **Step 3: Implement readiness types and validation**

In `packages/core/src/capability.ts`, add the readiness types near the existing manifest types, add `readonly readiness?: CapabilityReadiness;` to `CapabilityPackManifest`, validate `value.readiness` if present, and include it in the returned manifest.

Use helper validators with exact names:

```ts
function isReadinessLevel(value: unknown): value is CapabilityReadinessLevel
function isReadinessStatus(value: unknown): value is CapabilityReadinessStatus
function isActionability(value: unknown): value is CapabilityActionability
function isReadinessSurface(value: unknown): value is CapabilityReadinessSurface
function isCredentialStorage(value: unknown): value is CapabilityCredentialStorage
function isPermissionMode(value: unknown): value is CapabilityPermissionMode
function isMutationApproval(value: unknown): value is CapabilityMutationApproval
function inspectReadiness(value: unknown, blockers: string[]): CapabilityReadiness | undefined
```

Validation rules:

- `readiness` must be an object when present.
- `level`, `status`, `actionability`, `owner`, `surfaces`, `setup`, `diagnostics`, `safety`, and `evidence` are required inside readiness.
- `setup.requiredEnv` values must be env var names.
- `setup.requiredAnyEnv` must be an array of env var arrays.
- `diagnostics.latencyBudgetMs` must be a positive finite number when present.
- `safety.resultCapBytes` must be a positive finite number.
- `safety.secretRedaction` must be exactly `true`.
- `evidence.unitTests`, `evidence.qaSuites`, `evidence.liveArtifacts`, and `evidence.docs` must be arrays of non-empty strings.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
pnpm --filter @musterhq/core test -- capability.test.ts
```

Expected: PASS.

---

### Task 2: Add Pack-Readiness QA Suite

**Files:**
- Create: `packages/core/src/qa-pack-readiness.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/qa-pack-readiness.test.ts`

- [ ] **Step 1: Write failing test for pack-readiness artifacts**

Create `packages/core/test/qa-pack-readiness.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPackReadinessQa } from "../src/qa-pack-readiness.js";

test("pack readiness QA writes artifact-backed cases", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "muster-pack-readiness-"));
  const result = await runPackReadinessQa({ artifactDir, packsDir: "capability-packs" });

  assert.equal(result.suite, "pack_readiness");
  assert.ok(result.cases.length > 0);
  assert.ok(result.cases.some((item) => item.id === "all_manifests_parse"));
  assert.ok(result.cases.some((item) => item.id === "readiness_metadata_visible"));
  assert.ok(result.manifestPath.endsWith("manifest.json"));
  assert.ok(result.casesPath.endsWith("cases.jsonl"));

  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
    suite: string;
    status: string;
    caseCount: number;
    artifacts: { cases: string; catalog: string };
  };
  assert.equal(manifest.suite, "pack_readiness");
  assert.equal(manifest.caseCount, result.cases.length);
  assert.equal(manifest.artifacts.cases, "cases.jsonl");
  assert.equal(manifest.artifacts.catalog, "catalog.json");

  const cases = (await readFile(result.casesPath, "utf8")).trim().split("\\n").map((line) => JSON.parse(line) as { id: string; status: string });
  assert.equal(cases.length, result.cases.length);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
pnpm --filter @musterhq/core test -- qa-pack-readiness.test.ts
```

Expected: FAIL because `qa-pack-readiness.ts` does not exist.

- [ ] **Step 3: Implement `runPackReadinessQa`**

Create `packages/core/src/qa-pack-readiness.ts` with:

```ts
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectCapabilityPack, type CapabilityPackInspection } from "./capability.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaPackReadinessCase {
  readonly id: string;
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
}

export interface QaPackReadinessResult {
  readonly suite: "pack_readiness";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly catalogPath: string;
  readonly cases: readonly QaPackReadinessCase[];
  readonly summary: string;
}

export async function runPackReadinessQa(input: {
  readonly artifactDir: string;
  readonly packsDir?: string;
}): Promise<QaPackReadinessResult> {
  const artifactDir = input.artifactDir;
  const packsDir = input.packsDir ?? "capability-packs";
  await mkdir(artifactDir, { recursive: true });

  const inspections = await inspectBundledPacks(packsDir);
  const cases: QaPackReadinessCase[] = [
    caseAllManifestsParse(inspections),
    caseReadinessMetadataVisible(inspections),
    caseNoReleaseReadyWithoutEvidence(inspections),
    caseHighRiskHasSecretsAndPolicy(inspections),
    caseDeclaredEvalsAreVisible(inspections),
  ];

  const status: RuntimeDoctorStatus = cases.some((item) => item.status === "failed")
    ? "failed"
    : cases.some((item) => item.status === "warning")
      ? "warning"
      : "passed";
  const summary = status === "passed"
    ? "Capability pack readiness metadata and release claims are consistent"
    : "Capability pack readiness needs metadata or evidence hardening";
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const catalogPath = join(artifactDir, "catalog.json");

  await writeFile(casesPath, `${cases.map((item) => JSON.stringify(item)).join("\\n")}\\n`, "utf8");
  await writeFile(catalogPath, `${JSON.stringify(inspections.map(snapshotInspection), null, 2)}\\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "pack_readiness",
    status,
    summary,
    caseCount: cases.length,
    artifacts: { cases: "cases.jsonl", catalog: "catalog.json" },
  }, null, 2)}\\n`, "utf8");

  return { suite: "pack_readiness", status, artifactDir, manifestPath, casesPath, catalogPath, cases, summary };
}

async function inspectBundledPacks(packsDir: string): Promise<CapabilityPackInspection[]> {
  const entries = await readdir(packsDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(packsDir, entry.name)).sort();
  const inspections: CapabilityPackInspection[] = [];
  for (const dir of dirs) {
    if (!existsSync(join(dir, "manifest.json")) && !existsSync(join(dir, "muster.capability.json"))) continue;
    inspections.push(await inspectCapabilityPack(dir));
  }
  return inspections;
}

function caseAllManifestsParse(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const blocked = inspections.filter((item) => item.status === "blocked");
  return {
    id: "all_manifests_parse",
    status: blocked.length ? "failed" : "passed",
    summary: blocked.length ? "one or more bundled capability manifests are blocked" : "all bundled capability manifests parse",
    evidence: { packCount: inspections.length, blocked: blocked.map((item) => ({ path: item.path, blockers: item.blockers })) },
  };
}

function caseReadinessMetadataVisible(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const missing = inspections.filter((item) => item.manifest && !item.manifest.readiness).map((item) => item.manifest!.id);
  return {
    id: "readiness_metadata_visible",
    status: missing.length ? "warning" : "passed",
    summary: missing.length ? "some packs still rely on legacy manifests without readiness metadata" : "all packs expose readiness metadata",
    evidence: { missing },
  };
}

function caseNoReleaseReadyWithoutEvidence(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const offenders = inspections
    .filter((item) => item.manifest?.readiness?.level === "release_ready")
    .filter((item) => !(item.manifest?.readiness?.evidence.qaSuites.length && item.manifest.readiness.evidence.docs.length))
    .map((item) => item.manifest!.id);
  return {
    id: "no_release_ready_without_evidence",
    status: offenders.length ? "failed" : "passed",
    summary: offenders.length ? "release-ready packs are missing QA/doc evidence" : "no pack claims release-ready without evidence",
    evidence: { offenders },
  };
}

function caseHighRiskHasSecretsAndPolicy(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const offenders = inspections
    .filter((item) => item.risk === "high")
    .filter((item) => item.manifest && item.manifest.permissions.includes("secrets") && !(item.manifest.secrets?.length))
    .map((item) => item.manifest!.id);
  return {
    id: "high_risk_has_secrets_and_policy",
    status: offenders.length ? "failed" : "passed",
    summary: offenders.length ? "high-risk secret-using packs are missing declared secrets" : "high-risk secret-using packs declare secrets",
    evidence: { offenders },
  };
}

function caseDeclaredEvalsAreVisible(inspections: readonly CapabilityPackInspection[]): QaPackReadinessCase {
  const missing = inspections
    .filter((item) => item.manifest?.evals?.length)
    .flatMap((item) => item.manifest!.evals!.filter((evalPath) => !existsSync(join(item.path, evalPath))).map((evalPath) => `${item.manifest!.id}:${evalPath}`));
  return {
    id: "declared_evals_are_visible",
    status: missing.length ? "warning" : "passed",
    summary: missing.length ? "some declared eval paths are not present yet" : "declared eval paths are present",
    evidence: { missing },
  };
}

function snapshotInspection(item: CapabilityPackInspection): Record<string, unknown> {
  return {
    path: item.path,
    status: item.status,
    risk: item.risk,
    blockers: item.blockers,
    warnings: item.warnings,
    manifest: item.manifest ? {
      id: item.manifest.id,
      kind: item.manifest.kind,
      permissions: item.manifest.permissions,
      sandbox: item.manifest.sandbox,
      readiness: item.manifest.readiness ?? null,
    } : null,
  };
}
```

- [ ] **Step 4: Export the QA suite**

Add this export to `packages/core/src/index.ts`:

```ts
export * from "./qa-pack-readiness.js";
```

- [ ] **Step 5: Run the targeted test**

Run:

```bash
pnpm --filter @musterhq/core test -- qa-pack-readiness.test.ts
```

Expected: PASS, with status likely `warning` until manifests receive readiness metadata.

---

### Task 3: Wire Pack Readiness Into QA CLI

**Files:**
- Modify: `packages/core/src/runtime-doctor.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI assertions**

In `packages/cli/test/cli.test.ts`, update the QA scorecard test so the required suite line includes `pack_readiness`, and add a run assertion:

```ts
assert.match(scorecard.stdout, /required_suites=pty_tui,provider_latency,mcp_auth_failure,memory_retrieval_speed,channel_plugin_setup,frappe2_real_prompts,pack_readiness/);

const packRunArtifact = join(cwd, "qa-artifacts", "pack-readiness-run");
const packRun = await runCli(["qa", "run", "pack_readiness", "--artifact-dir", packRunArtifact, "--evidence", join(cwd, "pack-evidence.json")], cwd);
assert.equal(packRun.code, 0);
assert.match(packRun.stdout, /suite=pack_readiness/);
assert.match(packRun.stdout, /artifact=.*pack-readiness-run/);
```

- [ ] **Step 2: Run the CLI test to verify it fails**

Run:

```bash
pnpm --filter @musterhq/cli test -- cli.test.ts
```

Expected: FAIL because `pack_readiness` is not a required suite or CLI command.

- [ ] **Step 3: Add the required suite**

In `packages/core/src/runtime-doctor.ts`, add `"pack_readiness"` to `REQUIRED_QA_SUITES`.

Update `qaSuiteFix` with:

```ts
case "pack_readiness":
  return "Run pack-readiness QA to prove capability manifests, readiness levels, eval paths, and release-ready claims are honest.";
```

- [ ] **Step 4: Wire CLI imports and run command**

In `packages/cli/src/index.ts`, import:

```ts
runPackReadinessQa,
```

from `@musterhq/core`, update usage strings to include `pack_readiness`, update `printQaSuites`, and add this branch in `runQaSuite` before the MCP fallback:

```ts
if (suite === "pack_readiness") {
  await runPackReadinessQaSuite(args, stamp);
  return;
}
```

Add the helper:

```ts
async function runPackReadinessQaSuite(args: string[], stamp: string): Promise<void> {
  const artifactDir = optionValue(args, "--artifact-dir") ?? join(process.cwd(), ".muster", "qa", `pack-readiness-${stamp}`);
  const result = await runPackReadinessQa({ artifactDir });
  const evidencePath = optionValue(args, "--evidence");
  await recordRuntimeQaSuiteEvidence({
    suite: "pack_readiness",
    status: result.status,
    artifactDir: result.artifactDir,
    summary: result.summary,
    evidencePath,
  });
  console.log(`suite=${result.suite} status=${result.status} artifact=${result.artifactDir}`);
  for (const testCase of result.cases) {
    console.log(`case=${testCase.id} status=${testCase.status} ${testCase.summary}`);
  }
}
```

- [ ] **Step 5: Run the CLI test**

Run:

```bash
pnpm --filter @musterhq/cli test -- cli.test.ts
```

Expected: PASS after updating existing full-scorecard fixture code to create a `pack_readiness` artifact where needed.

---

### Task 4: Add Strict Release Scorecard Mode

**Files:**
- Modify: `packages/core/src/runtime-doctor.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing strict-release tests**

Add a CLI test case that builds a thin passed artifact with only one case and verifies strict mode rejects it:

```ts
const thinEvidencePath = join(cwd, "thin-evidence.json");
const thinArtifact = join(cwd, "qa-artifacts", "thin-provider");
await mkdir(thinArtifact, { recursive: true });
await writeFile(join(thinArtifact, "manifest.json"), JSON.stringify({
  schemaVersion: 1,
  kind: "muster-qa",
  suite: "provider_latency",
  status: "passed",
  caseCount: 1,
  artifacts: { cases: "cases.jsonl" },
}, null, 2));
await writeFile(join(thinArtifact, "cases.jsonl"), JSON.stringify({ id: "stub_provider_overhead", status: "passed" }) + "\\n");
await writeFile(thinEvidencePath, JSON.stringify({
  suites: { provider_latency: { status: "passed", artifactDir: thinArtifact, summary: "thin pass" } },
}, null, 2));

const strictThin = await runCliAllowFailure(["qa", "scorecard", "--strict-release", "--codex-command", codex, "--latest-version", "0.1.0", "--evidence", thinEvidencePath], cwd);
assert.equal(strictThin.code, 1);
assert.match(strictThin.stdout, /strict_release status=failed/);
assert.match(strictThin.stdout, /provider_latency/);
assert.match(strictThin.stdout, /missing required case/);
```

- [ ] **Step 2: Run the CLI test to verify it fails**

Run:

```bash
pnpm --filter @musterhq/cli test -- cli.test.ts
```

Expected: FAIL because `--strict-release` is not implemented.

- [ ] **Step 3: Implement strict validation in core**

In `packages/core/src/runtime-doctor.ts`, add:

```ts
export interface StrictReleaseValidation {
  readonly status: RuntimeDoctorStatus;
  readonly checks: readonly RuntimeDoctorCheck[];
}

export function validateStrictReleaseEvidence(evidence: RuntimeQaEvidence | undefined): StrictReleaseValidation
```

Use a `REQUIRED_QA_CASES` map:

```ts
const REQUIRED_QA_CASES: Readonly<Record<RequiredQaSuiteId, readonly string[]>> = {
  pty_tui: ["slash_overlay_stable", "escape_closes_bare_completion", "history_navigation", "prompt_visible_after_output", "agent_overlay_navigation", "large_overlay_scroll_window", "selected_row_contrast", "provider_model_speed_workflow", "cramped_transcript_receipts", "key_classifier", "responsive_widths"],
  provider_latency: ["stub_provider_overhead", "provider_time_split", "muster_overhead_budget", "timeout_bounded_failure"],
  mcp_auth_failure: ["missing_token", "expired_token", "invalid_token", "valid_token", "logout_recovery"],
  memory_retrieval_speed: ["scoped_exact_recall", "forbidden_scope_leakage", "stale_hit_guard", "latency_budget", "index_health"],
  channel_plugin_setup: ["catalog_core_surfaces", "high_risk_refusal", "enable_disable_policy", "mcp_install_guidance"],
  frappe2_real_prompts: ["remote_identity", "global_help_exposes_qa", "memory_status_probe", "trivial_prompt_exact", "retrieval_artifact_gate", "timing_split_present"],
  pack_readiness: ["all_manifests_parse", "readiness_metadata_visible", "no_release_ready_without_evidence", "high_risk_has_secrets_and_policy", "declared_evals_are_visible"],
};
```

For each suite:

- Missing evidence is failed.
- Non-passed effective status is failed.
- Missing artifact dir is failed.
- Missing case ID is failed.
- Any warning from `validatePassedQaArtifact` is failed.

- [ ] **Step 4: Render strict validation in CLI**

In `packages/cli/src/index.ts`, parse `--strict-release` in `handleQaCommand`. After rendering normal scorecard, if strict mode is set:

```ts
const strict = validateStrictReleaseEvidence(storedEvidence);
console.log(renderStrictReleaseValidation(strict));
if (strict.status !== "passed") process.exitCode = 1;
```

Export/render helper in core or render locally with lines:

```text
strict_release status=failed
failed  strict.provider_latency missing required case provider_time_split
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @musterhq/cli test -- cli.test.ts
pnpm --filter @musterhq/core test -- capability.test.ts qa-pack-readiness.test.ts
```

Expected: PASS.

---

### Task 5: Document And Commit The Foundation

**Files:**
- Modify: `docs/RELEASE_TRAIN.md`
- Modify: `docs/HARNESS_EVOLUTION_DESIGN.md` only if implementation changes the contract

- [ ] **Step 1: Update release train**

Add this acceptance command to `docs/RELEASE_TRAIN.md`:

```bash
muster qa run pack_readiness --artifact-dir artifacts/qa/pack_readiness --evidence artifacts/qa/scorecard.json
muster qa scorecard --evidence artifacts/qa/scorecard.json --strict-release
```

Add this gate:

```md
- No release-ready pack claim without `pack_readiness` evidence and strict-release validation.
```

- [ ] **Step 2: Run verification**

Run:

```bash
pnpm typecheck
pnpm --filter @musterhq/core test -- capability.test.ts qa-pack-readiness.test.ts
pnpm --filter @musterhq/cli test -- cli.test.ts
git diff --check
```

Expected: all pass, no whitespace errors.

- [ ] **Step 3: Commit**

Run:

```bash
git add packages/core/src/capability.ts packages/core/src/qa-pack-readiness.ts packages/core/src/runtime-doctor.ts packages/core/src/index.ts packages/cli/src/index.ts packages/core/test/capability.test.ts packages/core/test/qa-pack-readiness.test.ts packages/cli/test/cli.test.ts docs/RELEASE_TRAIN.md docs/superpowers/plans/2026-06-27-harness-readiness-foundation.md
git commit -m "Add harness readiness release gates"
```

Expected: one focused commit that makes shallow pack readiness visible and strict release validation enforceable.

## Self-Review

- Spec coverage: implements the first slice from `docs/HARNESS_EVOLUTION_DESIGN.md`: readiness model, pack-readiness QA, strict scorecard gate.
- Known gap: this plan does not migrate every pack to readiness metadata. That is the next plan after the validator exists.
- Known gap: this plan does not live-test Frappe-2. It makes Frappe-2 evidence stricter once present.
- No placeholders: all tasks name exact files, command lines, case IDs, and expected outcomes.
