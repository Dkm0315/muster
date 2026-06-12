import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { dataDir } from "./store.js";
import { estimateTokens } from "./tokens.js";

/**
 * Context renderer — the Hermes-#14948 design their maintainers declined:
 * the transcript is IMMUTABLE; what gets sent to the model is a pure function
 * of (messages, budget) computed per call. Older tool results collapse to
 * deterministic stubs pointing at persisted files; nothing is ever lost and
 * history is never mutated. Benchmarked upstream at 57-82% token reduction
 * on 20-50-tool-call transcripts.
 */

export interface TranscriptMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  /** Set on role:"tool" messages; used for stubbing decisions. */
  readonly toolName?: string;
  readonly resultId?: string;
}

export interface RenderedContext {
  readonly messages: TranscriptMessage[];
  readonly stubbed: number;
  readonly dropped: number;
  readonly savedTokens: number;
}

export interface RenderOptions {
  /** Most recent tool results kept verbatim. Default 5. */
  readonly keepRecentToolResults?: number;
  /** Tool results larger than this are always stub candidates. Default 8000 chars. */
  readonly oversizeChars?: number;
}

export function resultsDir(cwd = process.cwd()): string {
  return join(dataDir(cwd), "results");
}

export interface PersistedToolResult {
  readonly id: string;
  readonly stub: string;
  readonly path: string;
}

/**
 * Persist an oversized tool result to disk and return the deterministic stub
 * that replaces it in rendered context. The full payload stays fetchable via
 * resultFetch(id).
 */
export async function persistToolResult(
  input: { readonly toolName: string; readonly ok: boolean; readonly content: string },
  cwd = process.cwd(),
): Promise<PersistedToolResult> {
  const id = `res_${randomUUID().slice(0, 12)}`;
  const path = join(resultsDir(cwd), `${id}.txt`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.content);
  return { id, stub: toolResultStub(input.toolName, input.ok, input.content.length, id), path };
}

export function toolResultStub(toolName: string, ok: boolean, chars: number, id: string): string {
  return `[tool:${toolName}] ${ok ? "ok" : "err"} (${chars} chars) -> result_fetch("${id}")`;
}

export async function resultFetch(
  id: string,
  options: { readonly offset?: number; readonly limit?: number } = {},
  cwd = process.cwd(),
): Promise<{ readonly content: string; readonly totalChars: number }> {
  if (!/^res_[a-f0-9-]+$/.test(id)) throw new Error(`Invalid result id: ${id}`);
  const raw = await readFile(join(resultsDir(cwd), `${id}.txt`), "utf8");
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20_000;
  return { content: raw.slice(offset, offset + limit), totalChars: raw.length };
}

/**
 * Pure render: never mutates `messages`. Reduction order is deterministic:
 * 1. stub all but the last N tool results (oldest first),
 * 2. if still over budget, drop oldest non-system messages,
 * 3. system messages and the final message are never dropped.
 */
export function renderContext(
  messages: readonly TranscriptMessage[],
  budgetTokens: number,
  options: RenderOptions = {},
): RenderedContext {
  const keepRecent = options.keepRecentToolResults ?? 5;
  const oversize = options.oversizeChars ?? 8000;

  const toolIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.message.role === "tool");
  const protectedToolIndexes = new Set(toolIndexes.slice(-keepRecent).map((entry) => entry.index));

  let stubbed = 0;
  const working: TranscriptMessage[] = messages.map((message, index) => {
    if (message.role !== "tool" || protectedToolIndexes.has(index)) return message;
    if (message.content.length <= 200 && message.content.length <= oversize) return message;
    stubbed += 1;
    return {
      ...message,
      content: message.resultId
        ? toolResultStub(message.toolName ?? "unknown", true, message.content.length, message.resultId)
        : `[tool:${message.toolName ?? "unknown"}] ok (${message.content.length} chars) [older result elided]`,
    };
  });

  const tokensOf = (list: readonly TranscriptMessage[]) =>
    list.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);

  let dropped = 0;
  let result = working;
  let total = tokensOf(result);
  if (total > budgetTokens) {
    const omit = new Set<number>();
    for (let index = 0; index < working.length - 1 && total > budgetTokens; index += 1) {
      if (working[index].role === "system") continue;
      omit.add(index);
      dropped += 1;
      total -= estimateTokens(working[index].content) + 4;
    }
    result = working.filter((_, index) => !omit.has(index));
  }

  const savedTokens = tokensOf(messages as TranscriptMessage[]) - tokensOf(result);
  return { messages: result, stubbed, dropped, savedTokens };
}
