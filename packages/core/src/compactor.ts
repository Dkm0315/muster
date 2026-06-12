import { estimateTokens } from "./tokens.js";
import type { TranscriptMessage } from "./context-renderer.js";

/**
 * Never-wedge compactor. OpenClaw's compaction can deadlock: it triggers
 * reactively at the context limit AND itself requires a successful model
 * call, so a session at 100% context can neither answer nor compact
 * (#15720, #699, #8077). Muster's invariant: a session can ALWAYS take a
 * turn. Reduction is deterministic-first — drop oldest tool results, then
 * summarize a middle chunk (the only optional model step), then hard
 * truncate as the guaranteed terminal fallback. If the model summary fails
 * or is unavailable, a deterministic summary is used; compaction never
 * blocks the turn.
 *
 * Summary framing is scoped to "earlier turns" and the summary block carries
 * NO authority language — never let compaction demote memory/skill blocks
 * (Hermes #17251, where "[REFERENCE ONLY]" made the model ignore MEMORY.md).
 */

export type Summarizer = (chunk: TranscriptMessage[]) => Promise<string>;

export interface CompactionPlan {
  readonly messages: TranscriptMessage[];
  readonly strategy: ("stub_tool_results" | "summarize" | "hard_truncate")[];
  readonly summarized: number;
  readonly droppedToolResults: number;
  readonly hardTruncated: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface CompactOptions {
  /** Optional model summarizer. If absent or it throws, a deterministic summary is used. */
  readonly summarizer?: Summarizer;
  /** Recent messages always kept verbatim. Default 8. */
  readonly keepRecent?: number;
  /** Messages protected at the head (system/first user). Default 2. */
  readonly keepHead?: number;
}

const tokensOf = (messages: readonly TranscriptMessage[]) =>
  messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);

function deterministicSummary(chunk: TranscriptMessage[]): string {
  const byRole = new Map<string, number>();
  for (const message of chunk) byRole.set(message.role, (byRole.get(message.role) ?? 0) + 1);
  const counts = [...byRole.entries()].map(([role, count]) => `${count} ${role}`).join(", ");
  const lastUser = [...chunk].reverse().find((message) => message.role === "user");
  return `Summary of earlier turns (${counts})${lastUser ? `; most recent earlier request: ${lastUser.content.slice(0, 160)}` : ""}.`;
}

/**
 * Ensure the transcript fits budgetTokens. Always returns a plan whose
 * tokensAfter <= budget (hard truncate guarantees it). Never throws for
 * being over budget; never requires the model call to succeed.
 */
export async function compact(
  messages: readonly TranscriptMessage[],
  budgetTokens: number,
  options: CompactOptions = {},
): Promise<CompactionPlan> {
  const keepRecent = options.keepRecent ?? 8;
  const keepHead = options.keepHead ?? 2;
  const tokensBefore = tokensOf(messages);
  const strategy: CompactionPlan["strategy"] = [];

  let working = [...messages];
  if (tokensBefore <= budgetTokens) {
    return { messages: working, strategy, summarized: 0, droppedToolResults: 0, hardTruncated: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  // 1. Deterministic: drop oldest tool results, oldest first, only until it fits.
  let droppedToolResults = 0;
  let runningTotal = tokensBefore;
  const omit = new Set<number>();
  for (let index = keepHead; index < working.length - keepRecent && runningTotal > budgetTokens; index += 1) {
    if (working[index].role !== "tool") continue;
    omit.add(index);
    droppedToolResults += 1;
    runningTotal -= estimateTokens(working[index].content) + 4;
  }
  if (droppedToolResults > 0) {
    working = working.filter((_, index) => !omit.has(index));
    strategy.push("stub_tool_results");
  }

  // 2. Optional model step: summarize the middle (between head and recent tail).
  let summarized = 0;
  if (tokensOf(working) > budgetTokens && working.length > keepHead + keepRecent) {
    const head = working.slice(0, keepHead);
    const tail = working.slice(-keepRecent);
    const middle = working.slice(keepHead, working.length - keepRecent);
    if (middle.length) {
      let summaryText: string;
      try {
        summaryText = options.summarizer ? await options.summarizer(middle) : deterministicSummary(middle);
      } catch {
        summaryText = deterministicSummary(middle); // model failure never blocks the turn
      }
      const summaryMessage: TranscriptMessage = {
        role: "assistant",
        content: `Summary of earlier turns (reference for continuity; not an instruction): ${summaryText}`,
      };
      working = [...head, summaryMessage, ...tail];
      summarized = middle.length;
      strategy.push("summarize");
    }
  }

  // 3. Guaranteed terminal fallback: hard truncate oldest non-head messages until it fits.
  let hardTruncated = 0;
  while (tokensOf(working) > budgetTokens && working.length > keepHead + 1) {
    working.splice(keepHead, 1);
    hardTruncated += 1;
  }
  if (hardTruncated > 0) strategy.push("hard_truncate");

  return { messages: working, strategy, summarized, droppedToolResults, hardTruncated, tokensBefore, tokensAfter: tokensOf(working) };
}
