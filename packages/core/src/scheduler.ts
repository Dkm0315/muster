import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir, readJsonFile } from "./store.js";

export interface ScheduleJob {
  readonly id: string;
  readonly cron: string;
  readonly prompt: string;
  /** When set, run-due executes runFlow on this saved flow instead of executeRun on the prompt. */
  readonly flowId?: string;
  readonly profile?: string;
  readonly createdAt: string;
  readonly lastRunAt?: string;
  readonly lastRunId?: string;
  readonly lastStatus?: "completed" | "failed";
  readonly disabled?: boolean;
  /**
   * The next occurrence this job is due, ISO. Due detection compares this to
   * now (not "does the current minute match"), so a missed tick is not a lost
   * occurrence — it's caught the next time run-due fires. Advanced to the next
   * FUTURE occurrence before running, so a backlog never bursts (at-most-once).
   */
  readonly nextRunAt?: string;
}

export function schedulesPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "schedules.json");
}

function parseField(field: string, min: number, max: number): Set<number> | "any" {
  if (field === "*") return "any";
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);
    let start = min;
    let end = max;
    if (rangePart !== "*" && rangePart !== "") {
      if (rangePart.includes("-")) {
        const [low, high] = rangePart.split("-").map((value) => Number.parseInt(value, 10));
        if (!Number.isFinite(low) || !Number.isFinite(high) || low < min || high > max || low > high) {
          throw new Error(`Invalid cron range: ${part}`);
        }
        start = low;
        end = high;
      } else {
        const value = Number.parseInt(rangePart, 10);
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid cron value: ${part}`);
        if (!stepPart) {
          values.add(value);
          continue;
        }
        start = value;
      }
    }
    for (let current = start; current <= end; current += step) values.add(current);
  }
  return values;
}

export function parseCron(expression: string): { matches(date: Date): boolean } {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron expression must have 5 fields (minute hour day-of-month month day-of-week): "${expression}"`);
  const [minute, hour, dom, month, dow] = [
    parseField(fields[0], 0, 59),
    parseField(fields[1], 0, 23),
    parseField(fields[2], 1, 31),
    parseField(fields[3], 1, 12),
    parseField(fields[4], 0, 6),
  ];
  return {
    matches(date: Date): boolean {
      const check = (field: Set<number> | "any", value: number) => field === "any" || field.has(value);
      return check(minute, date.getMinutes())
        && check(hour, date.getHours())
        && check(dom, date.getDate())
        && check(month, date.getMonth() + 1)
        && check(dow, date.getDay());
    },
  };
}

/**
 * The first minute STRICTLY AFTER `from` that satisfies the cron. Forward-scans
 * minute by minute (bounded to a year so an unsatisfiable expression throws
 * instead of looping forever). This is the at-most-once / no-lost-occurrence
 * primitive: advance to this before running and a backlog of missed ticks
 * collapses to a single next occurrence rather than bursting.
 */
export function computeNextRun(cron: string, from: Date): Date {
  const parsed = parseCron(cron);
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (parsed.matches(next)) return new Date(next);
    next.setMinutes(next.getMinutes() + 1);
  }
  throw new Error(`Cron "${cron}" has no matching time within a year.`);
}

async function readJobs(cwd: string): Promise<ScheduleJob[]> {
  // Missing file -> no jobs yet; corrupt file -> throw so the corruption is
  // visible instead of silently dropping every schedule.
  return readJsonFile<ScheduleJob[]>(schedulesPath(cwd), []);
}

async function writeJobs(jobs: ScheduleJob[], cwd: string): Promise<void> {
  const path = schedulesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(jobs, null, 2));
}

export async function addSchedule(cron: string, prompt: string, options: { profile?: string; cwd?: string; flowId?: string; now?: Date } = {}): Promise<ScheduleJob> {
  parseCron(cron);
  const cwd = options.cwd ?? process.cwd();
  const createdAt = options.now ?? new Date();
  const job: ScheduleJob = {
    id: `sched_${randomUUID().slice(0, 8)}`,
    cron,
    prompt,
    flowId: options.flowId,
    profile: options.profile,
    createdAt: createdAt.toISOString(),
    nextRunAt: computeNextRun(cron, createdAt).toISOString(),
  };
  const jobs = await readJobs(cwd);
  jobs.push(job);
  await writeJobs(jobs, cwd);
  return job;
}

export async function listSchedules(cwd = process.cwd()): Promise<ScheduleJob[]> {
  return readJobs(cwd);
}

export async function removeSchedule(id: string, cwd = process.cwd()): Promise<boolean> {
  const jobs = await readJobs(cwd);
  const next = jobs.filter((job) => job.id !== id);
  if (next.length === jobs.length) return false;
  await writeJobs(next, cwd);
  return true;
}

export interface DueJobRun {
  readonly job: ScheduleJob;
  readonly runId?: string;
  readonly status: "completed" | "failed" | "skipped";
  readonly detail?: string;
}

/**
 * Executes every job that is DUE (nextRunAt <= now) — not merely "the current
 * minute matches" — so a missed tick (host asleep, a skipped cron minute, a
 * restart) is caught the next time this runs rather than lost. Each due job's
 * nextRunAt is advanced to its next FUTURE occurrence and PERSISTED before any
 * runner executes: that gives at-most-once (a crash or an overlapping run-due
 * invocation can't double-fire) and collapses a backlog to one occurrence (no
 * burst). There is no daemon: invoke from external cron
 * (e.g. `* * * * * cd <repo> && pnpm hc schedule run-due`).
 */
export async function runDueSchedules(
  runner: (job: ScheduleJob) => Promise<{ runId: string; status: "completed" | "failed" }>,
  options: { now?: Date; cwd?: string } = {},
): Promise<DueJobRun[]> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const jobs = await readJobs(cwd);
  const results: DueJobRun[] = [];

  // Phase 1: select due jobs and advance their nextRunAt past `now`, then
  // persist BEFORE running anything (the at-most-once barrier).
  const due: number[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (job.disabled) {
      results.push({ job, status: "skipped", detail: "disabled" });
      continue;
    }
    // Legacy jobs (created before nextRunAt) derive it from their last run/creation.
    const nextRunAt = job.nextRunAt
      ? new Date(job.nextRunAt)
      : computeNextRun(job.cron, new Date(job.lastRunAt ?? job.createdAt));
    if (nextRunAt > now) continue; // not due yet
    jobs[index] = { ...job, nextRunAt: computeNextRun(job.cron, now).toISOString() };
    due.push(index);
  }
  if (due.length) await writeJobs(jobs, cwd);

  // Phase 2: run each due job (advance already persisted, so no double-fire).
  for (const index of due) {
    const job = jobs[index];
    try {
      const result = await runner(job);
      jobs[index] = { ...job, lastRunAt: now.toISOString(), lastRunId: result.runId, lastStatus: result.status };
      results.push({ job: jobs[index], runId: result.runId, status: result.status });
    } catch (error) {
      jobs[index] = { ...job, lastRunAt: now.toISOString(), lastStatus: "failed" };
      results.push({ job: jobs[index], status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  if (due.length) await writeJobs(jobs, cwd);
  return results;
}
