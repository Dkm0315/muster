import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  curateSkills,
  listSkills,
  promoteSkill,
  recordSkillUse,
  selectSkills,
  viewSkill,
  writeCandidateSkill,
} from "../src/index.js";
import type { EvolveReport } from "../src/index.js";

function report(converged: boolean, tasks = 3): EvolveReport {
  return {
    startedAt: new Date().toISOString(),
    iterations: [{ iteration: 1, passed: converged ? tasks : 0, failed: converged ? 0 : tasks, results: Array.from({ length: tasks }, (_, index) => ({ taskId: `t${index}`, status: converged ? "passed" as const : "failed" as const, durationMs: 1 })) }],
    harnessChecks: [],
    converged,
  };
}

test("candidates are quarantined and invisible to injection until promoted", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-skills-"));
  await writeCandidateSkill({ name: "deploy-frappe", description: "Deploy a Frappe bench safely", body: "1. backup 2. migrate", sourceRunId: "run_1" }, cwd);
  const candidate = await viewSkill("deploy-frappe", cwd);
  assert.equal(candidate.status, "candidate");
  const selection = await selectSkills("how do I deploy the frappe bench", 500, cwd);
  assert.equal(selection.included.length, 0, "candidates must never inject");
});

test("THE GATE: promotion requires a converged, non-empty eval report", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-skills-gate-"));
  await writeCandidateSkill({ name: "payroll-report", description: "Generate payroll summaries", body: "..." }, cwd);
  await assert.rejects(() => promoteSkill("payroll-report", report(false), cwd), /did not converge/);
  await assert.rejects(() => promoteSkill("payroll-report", report(true, 0), cwd), /empty suite/);
  const promoted = await promoteSkill("payroll-report", report(true), cwd);
  assert.equal(promoted.status, "active");
  assert.equal(promoted.gate?.suiteTasks, 3);
  await assert.rejects(() => promoteSkill("payroll-report", report(true), cwd), /Only candidates/);
  const all = await listSkills(cwd);
  assert.equal(all.length, 1, "promotion moves, not copies");
});

test("top-K injection respects the budget and reports dropped skills", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-skills-topk-"));
  for (let index = 0; index < 12; index += 1) {
    await writeCandidateSkill({ name: `frappe-skill-${index}`, description: `Frappe workflow recipe number ${index} for deployments`, body: "x" }, cwd);
    await promoteSkill(`frappe-skill-${index}`, report(true), cwd);
  }
  const selection = await selectSkills("frappe deployments workflow", 60, cwd);
  assert.ok(selection.included.length >= 1);
  assert.ok(selection.dropped.length >= 1, "over-budget skills are reported, never silent");
  assert.ok(selection.block.includes("[skill:"));
  const unrelated = await selectSkills("completely unrelated cooking question zzz", 500, cwd);
  assert.equal(unrelated.block, "", "no zero-score injection");
});

test("telemetry accumulates and the curator transitions stale and archived without deleting", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-skills-curate-"));
  await writeCandidateSkill({ name: "old-skill", description: "Rarely used", body: "x" }, cwd);
  await promoteSkill("old-skill", report(true), cwd);
  await recordSkillUse(["old-skill"], cwd);

  const in40Days = new Date(Date.now() + 40 * 86_400_000);
  const first = await curateSkills(cwd, in40Days);
  assert.deepEqual(first.staled, ["old-skill"]);
  const in200Days = new Date(Date.now() + 200 * 86_400_000);
  const second = await curateSkills(cwd, in200Days);
  assert.deepEqual(second.archived, ["old-skill"]);
  const archived = await viewSkill("old-skill", cwd);
  assert.equal(archived.status, "archived", "archived, never deleted");
});

test("skill names are validated and oversized bodies refused", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-skills-validate-"));
  await assert.rejects(() => writeCandidateSkill({ name: "Bad Name!", description: "x", body: "x" }, cwd), /Invalid skill name/);
  await assert.rejects(() => writeCandidateSkill({ name: "ok-name", description: "x", body: "y".repeat(100_001) }, cwd), /100K/);
});
