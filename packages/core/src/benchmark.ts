import { compact } from "./compactor.js";
import { renderContext, type TranscriptMessage } from "./context-renderer.js";
import { estimateTokens } from "./tokens.js";

/**
 * Token Waste Index — a deterministic benchmark (no LLM call) that measures
 * how many tokens a harness wastes re-sending context across a multi-turn,
 * multi-tool task. Stateless chat APIs re-send the whole transcript every
 * turn; a naive harness pays for all of it, every turn. Muster reduces that
 * with the immutable-transcript renderer (older tool results -> stubs) and
 * the never-wedge compactor.
 *
 * The metric is honest about what is and isn't reducible:
 *  - necessaryTokens: each unique message counted once (the information floor).
 *  - naiveTokens: full transcript re-sent at every turn (what replay costs).
 *  - optimizedTokens: Muster's rendered/compacted context re-sent every turn.
 *  - replayOverheadPct: how much of the naive cost is pure re-send overhead
 *    above the information floor (inherent to stateless APIs).
 *  - musterReductionPct: how much of the naive cost Muster actually removes.
 */

export interface WasteResult {
  readonly turns: number;
  readonly necessaryTokens: number;
  readonly naiveTokens: number;
  readonly optimizedTokens: number;
  readonly replayOverheadPct: number;
  readonly musterReductionPct: number;
}

export interface WasteOptions {
  /** Per-turn context budget for the optimized path. Default 4000 tokens. */
  readonly budgetTokens?: number;
  /** Recent tool results kept verbatim by the renderer. Default 5. */
  readonly keepRecentToolResults?: number;
}

const tokensOf = (messages: readonly TranscriptMessage[]) =>
  messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);

/**
 * A "turn" boundary is each assistant message — the points at which a
 * stateless API would be re-invoked with the full history so far.
 */
function turnCutpoints(transcript: readonly TranscriptMessage[]): number[] {
  const cuts: number[] = [];
  transcript.forEach((message, index) => {
    if (message.role === "assistant") cuts.push(index + 1);
  });
  if (cuts.length === 0 || cuts[cuts.length - 1] !== transcript.length) cuts.push(transcript.length);
  return cuts;
}

export async function computeWasteIndex(
  transcript: readonly TranscriptMessage[],
  options: WasteOptions = {},
): Promise<WasteResult> {
  const budget = options.budgetTokens ?? 4000;
  const keepRecent = options.keepRecentToolResults ?? 5;
  const cuts = turnCutpoints(transcript);

  const necessaryTokens = tokensOf(transcript);
  let naiveTokens = 0;
  let optimizedTokens = 0;

  for (const cut of cuts) {
    const soFar = transcript.slice(0, cut);
    naiveTokens += tokensOf(soFar);
    const rendered = renderContext(soFar, budget, { keepRecentToolResults: keepRecent });
    const fitted = tokensOf(rendered.messages) > budget
      ? (await compact(rendered.messages, budget)).messages
      : rendered.messages;
    optimizedTokens += tokensOf(fitted);
  }

  return {
    turns: cuts.length,
    necessaryTokens,
    naiveTokens,
    optimizedTokens,
    replayOverheadPct: naiveTokens > 0 ? Math.round(((naiveTokens - necessaryTokens) / naiveTokens) * 1000) / 10 : 0,
    musterReductionPct: naiveTokens > 0 ? Math.round(((naiveTokens - optimizedTokens) / naiveTokens) * 1000) / 10 : 0,
  };
}

export interface BenchmarkScenario {
  readonly id: string;
  readonly description: string;
  readonly transcript: TranscriptMessage[];
}

export interface ScenarioResult extends WasteResult {
  readonly id: string;
  readonly description: string;
}

export async function runWasteBenchmark(scenarios: readonly BenchmarkScenario[], options: WasteOptions = {}): Promise<{
  readonly results: ScenarioResult[];
  readonly aggregate: WasteResult;
}> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const result = await computeWasteIndex(scenario.transcript, options);
    results.push({ id: scenario.id, description: scenario.description, ...result });
  }
  const sum = (pick: (r: WasteResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
  const naive = sum((r) => r.naiveTokens);
  const optimized = sum((r) => r.optimizedTokens);
  const necessary = sum((r) => r.necessaryTokens);
  return {
    results,
    aggregate: {
      turns: sum((r) => r.turns),
      necessaryTokens: necessary,
      naiveTokens: naive,
      optimizedTokens: optimized,
      replayOverheadPct: naive > 0 ? Math.round(((naive - necessary) / naive) * 1000) / 10 : 0,
      musterReductionPct: naive > 0 ? Math.round(((naive - optimized) / naive) * 1000) / 10 : 0,
    },
  };
}

function k(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function renderWasteReport(report: { results: ScenarioResult[]; aggregate: WasteResult }): string {
  const lines: string[] = [];
  lines.push("scenario                          turns  naive    muster   reduction  replay-overhead");
  lines.push("-".repeat(86));
  for (const r of report.results) {
    lines.push([
      r.id.slice(0, 32).padEnd(33),
      String(r.turns).padEnd(6),
      k(r.naiveTokens).padEnd(8),
      k(r.optimizedTokens).padEnd(8),
      `${r.musterReductionPct}%`.padEnd(10),
      `${r.replayOverheadPct}%`,
    ].join(" "));
  }
  lines.push("-".repeat(86));
  const a = report.aggregate;
  lines.push([
    "AGGREGATE".padEnd(33),
    String(a.turns).padEnd(6),
    k(a.naiveTokens).padEnd(8),
    k(a.optimizedTokens).padEnd(8),
    `${a.musterReductionPct}%`.padEnd(10),
    `${a.replayOverheadPct}%`,
  ].join(" "));
  return lines.join("\n");
}
