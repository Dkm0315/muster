import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeRun, type RunOptions } from "./run.js";
import { dataDir } from "./store.js";
import type { MusterConfig } from "./types.js";

/**
 * Pull-based subagent delegation. The spawn contract (depth caps, concurrency
 * caps, ledger folding, children-report-parents-decide) follows what both
 * upstreams proved works; result delivery deliberately does NOT use their
 * push-announce architecture — the documented zombie/lost-result factory.
 * Instead: every state change is appended to a durable run store, parents
 * PULL completed results with claimCompleted() at their next turn, and a
 * TTL reaper marks crashed children orphaned. Zombies are impossible by
 * construction: no acks, no leases, no gateway round-trips.
 */

export type SubRunStatus = "running" | "completed" | "failed" | "orphaned";

export interface SubRun {
  readonly id: string;
  readonly parentKey: string;
  readonly task: string;
  readonly status: SubRunStatus;
  readonly createdAt: string;
  readonly finishedAt?: string;
  readonly claimedAt?: string;
  readonly resultText?: string;
  readonly errorMessage?: string;
  readonly runId?: string;
}

interface SubRunEvent {
  readonly id: string;
  readonly at: string;
  readonly event: "spawned" | "completed" | "failed" | "claimed" | "orphaned";
  readonly parentKey?: string;
  readonly task?: string;
  readonly resultText?: string;
  readonly errorMessage?: string;
  readonly runId?: string;
}

export function subRunsPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "subruns.jsonl");
}

async function appendEvent(event: SubRunEvent, cwd: string): Promise<void> {
  const path = subRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export async function listSubRuns(cwd = process.cwd()): Promise<SubRun[]> {
  let raw = "";
  try {
    raw = await readFile(subRunsPath(cwd), "utf8");
  } catch {
    return [];
  }
  const runs = new Map<string, SubRun>();
  for (const line of raw.split("\n").filter(Boolean)) {
    let event: SubRunEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const existing = runs.get(event.id);
    if (event.event === "spawned") {
      runs.set(event.id, { id: event.id, parentKey: event.parentKey ?? "", task: event.task ?? "", status: "running", createdAt: event.at });
    } else if (existing) {
      if (event.event === "completed") runs.set(event.id, { ...existing, status: "completed", finishedAt: event.at, resultText: event.resultText, runId: event.runId });
      if (event.event === "failed") runs.set(event.id, { ...existing, status: "failed", finishedAt: event.at, errorMessage: event.errorMessage, runId: event.runId });
      if (event.event === "orphaned" && existing.status === "running") runs.set(event.id, { ...existing, status: "orphaned", finishedAt: event.at });
      if (event.event === "claimed") runs.set(event.id, { ...existing, claimedAt: event.at });
    }
  }
  return [...runs.values()];
}

export interface SpawnSpec {
  readonly task: string;
  readonly parentKey: string;
  readonly runOptions?: Omit<RunOptions, "prompt" | "skipMemoryWrite">;
  /** Spawn depth of the CALLER. Children get depth+1; default cap is 1. */
  readonly depth?: number;
  readonly maxDepth?: number;
}

export interface SpawnHandle {
  readonly id: string;
  /** Resolves when the child finishes; the durable store is updated regardless. */
  readonly done: Promise<SubRun>;
}

const DEFAULT_MAX_CONCURRENT = 5;
let activeCount = 0;

/**
 * Spawn an async child run. Children always run with skipMemoryWrite: they
 * REPORT findings in their result text; the parent decides what persists
 * (closes the upstream provenance blur, consistent with their #15204 lesson).
 */
export async function spawnSubagent(config: MusterConfig, spec: SpawnSpec, cwd = process.cwd()): Promise<SpawnHandle> {
  const depth = spec.depth ?? 0;
  const maxDepth = spec.maxDepth ?? 1;
  if (depth >= maxDepth) {
    throw new Error(`Spawn depth ${depth} reached the cap (${maxDepth}). Orchestrator depth must be granted explicitly.`);
  }
  if (activeCount >= DEFAULT_MAX_CONCURRENT) {
    throw new Error(`Subagent concurrency cap reached (${DEFAULT_MAX_CONCURRENT}). Drain running children first.`);
  }
  const id = `sub_${randomUUID().slice(0, 12)}`;
  await appendEvent({ id, at: new Date().toISOString(), event: "spawned", parentKey: spec.parentKey, task: spec.task }, cwd);
  activeCount += 1;

  const done = (async (): Promise<SubRun> => {
    try {
      const outcome = await executeRun(config, {
        ...spec.runOptions,
        prompt: spec.task,
        cwd,
        skipMemoryWrite: true,
        // child spend folds into the parent's ledger view via this tag
        surfaceId: spec.runOptions?.surfaceId ?? `subagent:${spec.parentKey}`,
      });
      if (outcome.episode.outcome?.kind === "completed") {
        await appendEvent({ id, at: new Date().toISOString(), event: "completed", resultText: outcome.episode.responseText, runId: outcome.plan.runId }, cwd);
      } else {
        await appendEvent({ id, at: new Date().toISOString(), event: "failed", errorMessage: outcome.episode.outcome?.detail ?? "unknown failure", runId: outcome.plan.runId }, cwd);
      }
    } catch (error) {
      await appendEvent({ id, at: new Date().toISOString(), event: "failed", errorMessage: error instanceof Error ? error.message : String(error) }, cwd);
    } finally {
      activeCount -= 1;
    }
    const runs = await listSubRuns(cwd);
    return runs.find((run) => run.id === id)!;
  })();

  return { id, done };
}

/**
 * PULL delivery: returns this parent's finished-but-unclaimed children and
 * marks them claimed. Call at the start of the parent's next turn; results
 * arrive exactly once, in completion order.
 */
export async function claimCompleted(parentKey: string, cwd = process.cwd()): Promise<SubRun[]> {
  const runs = await listSubRuns(cwd);
  const ready = runs.filter((run) => run.parentKey === parentKey && (run.status === "completed" || run.status === "failed") && !run.claimedAt);
  for (const run of ready) {
    await appendEvent({ id: run.id, at: new Date().toISOString(), event: "claimed" }, cwd);
  }
  return ready;
}

/** TTL reaper: running children older than ttlMs are marked orphaned. */
export async function reapOrphans(ttlMs: number, cwd = process.cwd(), now = new Date()): Promise<SubRun[]> {
  const runs = await listSubRuns(cwd);
  const stale = runs.filter((run) => run.status === "running" && now.getTime() - new Date(run.createdAt).getTime() > ttlMs);
  for (const run of stale) {
    await appendEvent({ id: run.id, at: now.toISOString(), event: "orphaned" }, cwd);
  }
  return stale;
}
