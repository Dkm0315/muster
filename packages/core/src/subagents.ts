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
 *
 * SINGLE-WRITER ASSUMPTION (v0.1): the run store (subruns.jsonl) is designed
 * for a single writer process per `cwd` — the sessions design guarantees one
 * parent orchestrator owns a workspace. We deliberately avoid a full file lock
 * (overkill, and a crash-prone dependency for a single-writer system). The
 * concurrency cap is derived durably from the store so a crashed child cannot
 * permanently leak a slot, and claimCompleted re-reads immediately before each
 * append to narrow the double-claim window to a single fs round-trip. This is
 * NOT safe for concurrent multi-process parents sharing one `cwd`: such a
 * deployment MUST add external locking (e.g. flock on subruns.jsonl) around
 * spawnSubagent/claimCompleted. The append-only event log keeps corruption
 * impossible even then, but interleaved appends could double-spawn past the
 * cap or double-deliver a result.
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
/**
 * In-memory fast path only. NOT authoritative: a crashed child never runs its
 * `finally` decrement, so this counter can drift high and would otherwise wedge
 * spawns forever. The authoritative cap check counts durable `running` entries
 * in the store (see runningCount), which the TTL reaper can recover.
 */
let activeCount = 0;

/** Durable count of children still marked `running` in the store. */
async function runningCount(cwd: string): Promise<number> {
  return (await listSubRuns(cwd)).filter((run) => run.status === "running").length;
}

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
  // Authoritative, crash-durable cap: count `running` entries in the store so a
  // crashed child (which never ran its `finally` to decrement activeCount)
  // cannot wedge spawns forever. The TTL reaper flips stale `running` entries to
  // `orphaned`, which frees the slot here. activeCount remains only a debug hint.
  if ((await runningCount(cwd)) >= DEFAULT_MAX_CONCURRENT) {
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
 *
 * Idempotency: before appending each claim we re-read the store and skip any
 * run already claimed in the meantime. Under the single-writer assumption this
 * makes overlapping claimCompleted calls (e.g. an accidental double-invoke)
 * deliver each result exactly once. It is NOT a substitute for external locking
 * across concurrent processes — see the module docstring.
 */
export async function claimCompleted(parentKey: string, cwd = process.cwd()): Promise<SubRun[]> {
  const snapshot = await listSubRuns(cwd);
  const candidates = snapshot.filter(
    (run) => run.parentKey === parentKey && (run.status === "completed" || run.status === "failed") && !run.claimedAt,
  );
  const claimed: SubRun[] = [];
  for (const run of candidates) {
    // Re-read immediately before the append to narrow the double-claim window:
    // if another claim landed since the snapshot, skip this run rather than
    // emitting a second claim event for it.
    const current = (await listSubRuns(cwd)).find((entry) => entry.id === run.id);
    if (!current || current.claimedAt) continue;
    await appendEvent({ id: run.id, at: new Date().toISOString(), event: "claimed" }, cwd);
    claimed.push(current);
  }
  return claimed;
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
