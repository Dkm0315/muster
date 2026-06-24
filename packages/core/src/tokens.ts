import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./store.js";

export interface TokenRecord {
  readonly runId: string;
  readonly createdAt: string;
  readonly provider: string;
  readonly model: string;
  readonly plannedModel?: string;
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
  readonly promptChars: number;
  readonly recalledChars: number;
  readonly responseChars: number;
  readonly sessionMode?: string;
  readonly sessionId?: string;
  readonly durationMs: number;
  readonly wasteRatio?: number;
  readonly costUsd?: number;
  /** Surface that originated the run (gateway runs only); enables per-surface budgets. */
  readonly surfaceId?: string;
  /** `name@version` of each skill injected into this run — makes cost attributable to a skill version (#11692). */
  readonly skills?: string[];
}

// Rough public list prices per 1M tokens (input, output). Used only for the
// estimate column in `muster tokens`; absence of a match leaves cost blank.
const PRICE_PER_MTOK: Array<[RegExp, { input: number; output: number }]> = [
  [/claude.*opus/i, { input: 15, output: 75 }],
  [/claude.*sonnet/i, { input: 3, output: 15 }],
  [/claude.*haiku/i, { input: 1, output: 5 }],
  [/gpt-5/i, { input: 1.25, output: 10 }],
  [/gpt-4o|gpt-4\.1/i, { input: 2.5, output: 10 }],
];

// Threshold above which a continued session's input volume is flagged as
// replay waste: input tokens > WASTE_FACTOR x (new prompt + recalled context).
const WASTE_FACTOR = 3;

export function tokensPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "tokens.jsonl");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  for (const [pattern, price] of PRICE_PER_MTOK) {
    if (pattern.test(model)) {
      return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
    }
  }
  return undefined;
}

export interface BuildTokenRecordInput {
  readonly runId: string;
  readonly provider: string;
  readonly model: string;
  readonly plannedModel?: string;
  readonly prompt: string;
  readonly recalledContext?: string;
  readonly responseText: string;
  readonly durationMs: number;
  readonly sessionMode?: string;
  readonly sessionId?: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly surfaceId?: string;
  readonly skills?: string[];
}

export function buildTokenRecord(input: BuildTokenRecordInput): TokenRecord {
  const recalledChars = input.recalledContext?.length ?? 0;
  const estimated = input.inputTokens === undefined || input.outputTokens === undefined;
  const inputTokens = input.inputTokens ?? estimateTokens(input.prompt) + estimateTokens(input.recalledContext ?? "");
  const outputTokens = input.outputTokens ?? estimateTokens(input.responseText);
  const freshInputTokens = estimateTokens(input.prompt) + estimateTokens(input.recalledContext ?? "");
  const isContinuation = input.sessionMode === "continue";
  const wasteRatio = isContinuation && freshInputTokens > 0 && inputTokens > WASTE_FACTOR * freshInputTokens
    ? Math.round((inputTokens / freshInputTokens) * 10) / 10
    : undefined;
  return {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    plannedModel: input.plannedModel,
    inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    outputTokens,
    estimated,
    promptChars: input.prompt.length,
    recalledChars,
    responseChars: input.responseText.length,
    sessionMode: input.sessionMode,
    sessionId: input.sessionId,
    durationMs: input.durationMs,
    wasteRatio,
    costUsd: estimateCostUsd(input.model, inputTokens, outputTokens),
    surfaceId: input.surfaceId,
    skills: input.skills,
  };
}

export async function appendTokenRecord(record: TokenRecord, cwd = process.cwd()): Promise<void> {
  const path = tokensPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`);
}

export async function listTokenRecords(cwd = process.cwd()): Promise<TokenRecord[]> {
  try {
    const raw = await readFile(tokensPath(cwd), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TokenRecord);
  } catch {
    return [];
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function num(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function renderTokenTable(records: readonly TokenRecord[], limit = 20): string {
  if (!records.length) return "No token records yet. Run `muster run \"<prompt>\"` to record usage.";
  const recent = records.slice(-limit);
  const lines: string[] = [];
  const header = `${pad("run", 14)} ${pad("model", 28)} ${pad("in", 8)} ${pad("out", 8)} ${pad("est", 4)} ${pad("cost$", 8)} ${pad("waste", 7)} ${pad("session", 10)}`;
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const record of recent) {
    lines.push([
      pad(record.runId.slice(0, 14), 14),
      pad(`${record.provider}/${record.model}`.slice(0, 28), 28),
      pad(num(record.inputTokens), 8),
      pad(num(record.outputTokens), 8),
      pad(record.estimated ? "~" : "", 4),
      pad(record.costUsd !== undefined ? record.costUsd.toFixed(4) : "-", 8),
      pad(record.wasteRatio !== undefined ? `${record.wasteRatio}x !` : "-", 7),
      pad(record.sessionMode ?? "-", 10),
    ].join(" "));
  }
  lines.push("");
  const byModel = new Map<string, { input: number; output: number; cost: number; runs: number; waste: number; unpriced: number }>();
  for (const record of records) {
    const key = `${record.provider}/${record.model}`;
    const entry = byModel.get(key) ?? { input: 0, output: 0, cost: 0, runs: 0, waste: 0, unpriced: 0 };
    entry.input += record.inputTokens;
    entry.output += record.outputTokens;
    entry.cost += record.costUsd ?? 0;
    if (record.costUsd === undefined) entry.unpriced += 1;
    entry.runs += 1;
    if (record.wasteRatio !== undefined) entry.waste += 1;
    byModel.set(key, entry);
  }
  lines.push(`${pad("totals by model", 28)} ${pad("runs", 6)} ${pad("in", 10)} ${pad("out", 10)} ${pad("cost$", 10)} ${pad("waste-runs", 10)}`);
  lines.push("-".repeat(80));
  for (const [key, entry] of byModel) {
    lines.push([
      pad(key.slice(0, 28), 28),
      pad(String(entry.runs), 6),
      pad(num(entry.input), 10),
      pad(num(entry.output), 10),
      pad(entry.unpriced ? (entry.cost ? `${entry.cost.toFixed(4)}+` : "?") : (entry.cost ? entry.cost.toFixed(4) : "-"), 10),
      pad(entry.waste ? `${entry.waste} !` : "0", 10),
    ].join(" "));
  }
  const wasteRuns = records.filter((record) => record.wasteRatio !== undefined);
  if (wasteRuns.length) {
    lines.push("");
    lines.push(`replay-waste detected on ${wasteRuns.length} run(s): continued sessions whose input volume exceeded ${WASTE_FACTOR}x the fresh prompt+context. Consider branching a new session or compacting.`);
  }
  // Loud about silent undercount: unlike a stderr-only warning, surface that any
  // unpriced-model runs make the cost totals a lower bound (counted as $0).
  const unpricedRuns = records.filter((record) => record.costUsd === undefined).length;
  if (unpricedRuns) {
    lines.push("");
    lines.push(`note: ${unpricedRuns} run(s) ran on models with no price match — cost totals above are a LOWER BOUND (those runs counted as $0). "+" marks a model whose total excludes unpriced runs.`);
  }
  // Subagent spend folded by parent: child runs are tagged surfaceId
  // "subagent:<parentKey>", so their cost is attributable to the parent that
  // spawned them (the standing rule: subagent spend folds into parents).
  const SUB_PREFIX = "subagent:";
  const subByParent = new Map<string, { runs: number; input: number; output: number; cost: number }>();
  for (const record of records) {
    if (!record.surfaceId?.startsWith(SUB_PREFIX)) continue;
    const parent = record.surfaceId.slice(SUB_PREFIX.length) || "(unknown)";
    const entry = subByParent.get(parent) ?? { runs: 0, input: 0, output: 0, cost: 0 };
    entry.runs += 1;
    entry.input += record.inputTokens;
    entry.output += record.outputTokens;
    entry.cost += record.costUsd ?? 0;
    subByParent.set(parent, entry);
  }
  if (subByParent.size) {
    lines.push("");
    lines.push("subagent spend folded by parent:");
    for (const [parent, entry] of subByParent) {
      lines.push(`  ${pad(parent.slice(0, 28), 28)} ${pad(`${entry.runs} run(s)`, 9)} in ${pad(num(entry.input), 8)} out ${pad(num(entry.output), 8)} cost$ ${entry.cost ? entry.cost.toFixed(4) : "-"}`);
    }
  }
  return lines.join("\n");
}
