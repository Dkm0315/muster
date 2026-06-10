import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addSchedule, listSchedules, parseCron, removeSchedule, runDueSchedules } from "../src/index.js";

test("parseCron matches simple and complex expressions", () => {
  const everyMinute = parseCron("* * * * *");
  assert.equal(everyMinute.matches(new Date("2026-06-10T09:41:00")), true);

  const noonDaily = parseCron("0 12 * * *");
  assert.equal(noonDaily.matches(new Date("2026-06-10T12:00:00")), true);
  assert.equal(noonDaily.matches(new Date("2026-06-10T12:01:00")), false);

  const everyFive = parseCron("*/5 * * * *");
  assert.equal(everyFive.matches(new Date("2026-06-10T09:10:00")), true);
  assert.equal(everyFive.matches(new Date("2026-06-10T09:11:00")), false);

  const weekdayMornings = parseCron("30 9 * * 1-5");
  assert.equal(weekdayMornings.matches(new Date("2026-06-10T09:30:00")), true); // a Wednesday
  assert.equal(weekdayMornings.matches(new Date("2026-06-14T09:30:00")), false); // a Sunday

  const listField = parseCron("0 9,18 * * *");
  assert.equal(listField.matches(new Date("2026-06-10T18:00:00")), true);
  assert.equal(listField.matches(new Date("2026-06-10T17:00:00")), false);
});

test("parseCron rejects malformed expressions with a clear message", () => {
  assert.throws(() => parseCron("* * * *"), /5 fields/);
  assert.throws(() => parseCron("99 * * * *"), /Invalid cron value/);
  assert.throws(() => parseCron("1-99 * * * *"), /Invalid cron range/);
  assert.throws(() => parseCron("*/0 * * * *"), /Invalid cron step/);
});

test("addSchedule validates the cron expression up front", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-sched-"));
  await assert.rejects(() => addSchedule("not a cron", "do things", { cwd }), /5 fields/);
});

test("runDueSchedules executes due jobs once per minute and records state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-sched-run-"));
  await addSchedule("* * * * *", "always due", { cwd });
  await addSchedule("0 0 1 1 *", "new year only", { cwd });

  const now = new Date("2026-06-10T09:41:30");
  const ran: string[] = [];
  const results = await runDueSchedules(async (job) => {
    ran.push(job.prompt);
    return { runId: "run_x", status: "completed" };
  }, { now, cwd });

  assert.deepEqual(ran, ["always due"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "completed");

  // Re-running in the same minute must skip, not double-fire.
  const second = await runDueSchedules(async () => {
    throw new Error("should not run again this minute");
  }, { now: new Date("2026-06-10T09:41:55"), cwd });
  assert.equal(second.length, 1);
  assert.equal(second[0].status, "skipped");

  const jobs = await listSchedules(cwd);
  const due = jobs.find((job) => job.prompt === "always due");
  assert.equal(due?.lastStatus, "completed");
  assert.equal(due?.lastRunId, "run_x");
});

test("runDueSchedules records runner failures without losing the job", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-sched-fail-"));
  await addSchedule("* * * * *", "will fail", { cwd });
  const results = await runDueSchedules(async () => {
    throw new Error("provider exploded");
  }, { now: new Date("2026-06-10T10:00:00"), cwd });
  assert.equal(results[0].status, "failed");
  assert.match(results[0].detail ?? "", /provider exploded/);
  const jobs = await listSchedules(cwd);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].lastStatus, "failed");
});

test("removeSchedule reports whether anything was removed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-sched-rm-"));
  const job = await addSchedule("* * * * *", "temp", { cwd });
  assert.equal(await removeSchedule(job.id, cwd), true);
  assert.equal(await removeSchedule(job.id, cwd), false);
});
