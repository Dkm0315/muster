import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "./store.js";

export interface ScheduleJob {
  readonly id: string;
  readonly cron: string;
  readonly prompt: string;
  readonly profile?: string;
  readonly createdAt: string;
  readonly lastRunAt?: string;
  readonly lastRunId?: string;
  readonly lastStatus?: "completed" | "failed";
  readonly disabled?: boolean;
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

async function readJobs(cwd: string): Promise<ScheduleJob[]> {
  try {
    return JSON.parse(await readFile(schedulesPath(cwd), "utf8")) as ScheduleJob[];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: ScheduleJob[], cwd: string): Promise<void> {
  const path = schedulesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(jobs, null, 2));
}

export async function addSchedule(cron: string, prompt: string, options: { profile?: string; cwd?: string } = {}): Promise<ScheduleJob> {
  parseCron(cron);
  const cwd = options.cwd ?? process.cwd();
  const job: ScheduleJob = {
    id: `sched_${randomUUID().slice(0, 8)}`,
    cron,
    prompt,
    profile: options.profile,
    createdAt: new Date().toISOString(),
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
 * Executes all jobs whose cron matches the current minute and which have not
 * already run in this minute. There is no daemon: invoke this from external
 * cron (e.g. `* * * * * cd <repo> && pnpm hc schedule run-due`).
 */
export async function runDueSchedules(
  runner: (job: ScheduleJob) => Promise<{ runId: string; status: "completed" | "failed" }>,
  options: { now?: Date; cwd?: string } = {},
): Promise<DueJobRun[]> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const currentMinute = new Date(now);
  currentMinute.setSeconds(0, 0);
  const jobs = await readJobs(cwd);
  const results: DueJobRun[] = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (job.disabled) {
      results.push({ job, status: "skipped", detail: "disabled" });
      continue;
    }
    if (!parseCron(job.cron).matches(now)) continue;
    if (job.lastRunAt && new Date(job.lastRunAt) >= currentMinute) {
      results.push({ job, status: "skipped", detail: "already ran this minute" });
      continue;
    }
    try {
      const result = await runner(job);
      jobs[index] = { ...job, lastRunAt: now.toISOString(), lastRunId: result.runId, lastStatus: result.status };
      results.push({ job: jobs[index], runId: result.runId, status: result.status });
    } catch (error) {
      jobs[index] = { ...job, lastRunAt: now.toISOString(), lastStatus: "failed" };
      results.push({ job: jobs[index], status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  await writeJobs(jobs, cwd);
  return results;
}
