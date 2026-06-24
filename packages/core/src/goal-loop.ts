import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { dataDir } from "./store.js";
import { formatMemoryScope, type SearchMemoryReceiptResult } from "./memory.js";
import type { ContextObject, MemoryScope, OutcomeSignal, TaskKind } from "./types.js";

export interface GoalLoopTurnRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly runId: string;
  readonly episodeId: string;
  readonly createdAt: string;
  readonly activeGoal: string;
  readonly taskKind: TaskKind;
  readonly status: OutcomeSignal["kind"];
  readonly scopes: readonly string[];
  readonly retrieval: {
    readonly query: string;
    readonly backend: string;
    readonly requestedLimit: number;
    readonly candidateCount: number;
    readonly recalledCount: number;
    readonly fallbackUsed: boolean;
    readonly includeGlobal: boolean;
    readonly receipts: readonly GoalLoopReceipt[];
  };
  readonly memoryWrite: GoalLoopMemoryWrite;
  readonly followUpRetrieval: {
    readonly needed: boolean;
    readonly reason?: string;
    readonly query?: string;
  };
}

export interface GoalLoopReceipt {
  readonly memoryId: string;
  readonly score: number;
  readonly reason: string;
  readonly matchedTerms: readonly string[];
  readonly scopes: readonly string[];
  readonly provenance: readonly string[];
  readonly confidence: number;
}

export type GoalLoopMemoryWrite =
  | { readonly status: "remembered"; readonly memoryId: string; readonly scope: readonly string[]; readonly reason: string }
  | { readonly status: "promoted"; readonly memoryId: string; readonly sourceMemoryId: string; readonly scope: readonly string[]; readonly reason: string }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "skipped"; readonly reason: string };

export function goalLoopPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "goal-loop.jsonl");
}

export async function appendGoalLoopTurn(record: GoalLoopTurnRecord, cwd = process.cwd()): Promise<void> {
  const path = goalLoopPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function listGoalLoopTurns(cwd = process.cwd()): Promise<GoalLoopTurnRecord[]> {
  const raw = await readFile(goalLoopPath(cwd), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const records: GoalLoopTurnRecord[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as GoalLoopTurnRecord);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL in ${goalLoopPath(cwd)} at line ${index + 1}: ${detail}`);
    }
  }
  return records;
}

export async function recentGoalLoopTurns(limit = 10, cwd = process.cwd()): Promise<GoalLoopTurnRecord[]> {
  return (await listGoalLoopTurns(cwd)).slice(-Math.max(1, limit)).reverse();
}

export function buildGoalLoopTurn(input: {
  readonly runId: string;
  readonly episodeId: string;
  readonly createdAt: string;
  readonly activeGoal: string;
  readonly taskKind: TaskKind;
  readonly status: OutcomeSignal["kind"];
  readonly scopes: readonly MemoryScope[];
  readonly recallReceipt: SearchMemoryReceiptResult;
  readonly memoryWrite: GoalLoopMemoryWrite;
}): GoalLoopTurnRecord {
  const followUp = followUpRetrieval(input.recallReceipt);
  return {
    schemaVersion: 1,
    id: `goal_${input.runId}`,
    runId: input.runId,
    episodeId: input.episodeId,
    createdAt: input.createdAt,
    activeGoal: input.activeGoal,
    taskKind: input.taskKind,
    status: input.status,
    scopes: input.scopes.map(formatMemoryScope),
    retrieval: {
      query: input.recallReceipt.query,
      backend: input.recallReceipt.backend,
      requestedLimit: input.recallReceipt.requestedLimit,
      candidateCount: input.recallReceipt.candidateCount,
      recalledCount: input.recallReceipt.receipts.length,
      fallbackUsed: input.recallReceipt.fallbackUsed,
      includeGlobal: input.recallReceipt.includeGlobal,
      receipts: input.recallReceipt.receipts.map((receipt) => ({
        memoryId: receipt.memory.id,
        score: Number(receipt.score.toFixed(6)),
        reason: receipt.reason,
        matchedTerms: receipt.matchedTerms,
        scopes: receipt.memory.scopes.map(formatMemoryScope),
        provenance: receipt.memory.provenance,
        confidence: receipt.memory.confidence,
      })),
    },
    memoryWrite: input.memoryWrite,
    followUpRetrieval: followUp,
  };
}

function followUpRetrieval(receipt: SearchMemoryReceiptResult): GoalLoopTurnRecord["followUpRetrieval"] {
  if (!receipt.query.trim()) return { needed: false };
  if (!receipt.receipts.length) {
    return { needed: true, reason: "no_scoped_memory_recalled", query: receipt.query };
  }
  const top = receipt.receipts[0];
  if (top && top.score < 0.25) {
    return { needed: true, reason: "weak_top_memory_match", query: receipt.query };
  }
  return { needed: false };
}

export function rememberedMemoryWrite(memory: ContextObject): GoalLoopMemoryWrite {
  return {
    status: "remembered",
    memoryId: memory.id,
    scope: memory.scopes.map(formatMemoryScope),
    reason: "completed run wrote session-scoped episode summary",
  };
}

export function promotedMemoryWrite(memory: ContextObject, sourceMemoryId: string): GoalLoopMemoryWrite {
  return {
    status: "promoted",
    memoryId: memory.id,
    sourceMemoryId,
    scope: memory.scopes.map(formatMemoryScope),
    reason: "memory promoted to broader scoped recall",
  };
}
