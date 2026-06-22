import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { dataDir } from "./store.js";

/**
 * A native provider session handle (codex thread_id, claude session id, …) kept
 * per conversation so multi-turn chats RESUME the provider's own session instead
 * of cold-starting every turn. Keyed by (backendId, conversationKey). Reusable
 * across backends so the future provider-agnostic runtime shares one store.
 */
export interface SessionHandleRecord {
  readonly conversationKey: string;
  readonly backendId: string;
  readonly handle: string;
  /** The execution workspace the handle was minted under — reuse only if unchanged. */
  readonly cwd: string;
  /** The model the handle was minted under — reuse only if unchanged. */
  readonly model: string;
  readonly updatedAt: string;
}

export function sessionHandlesPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "session-handles.json");
}

type Store = Record<string, SessionHandleRecord>;
const recordKey = (backendId: string, conversationKey: string): string => `${backendId}:${conversationKey}`;
const KNOWN_BACKENDS = ["codex", "claude"] as const;

async function load(cwd: string): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(sessionHandlesPath(cwd), "utf8")) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function persist(store: Store, cwd: string): Promise<void> {
  const path = sessionHandlesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  // Atomic write: unique temp then rename (mirrors acpx's file-session-store),
  // so a crash mid-write can never corrupt the handle map.
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function loadSessionHandle(conversationKey: string, backendId: string, cwd = process.cwd()): Promise<SessionHandleRecord | undefined> {
  return (await load(cwd))[recordKey(backendId, conversationKey)];
}

export async function saveSessionHandle(record: SessionHandleRecord, cwd = process.cwd()): Promise<void> {
  const store = await load(cwd);
  store[recordKey(record.backendId, record.conversationKey)] = record;
  await persist(store, cwd);
}

export async function clearSessionHandle(conversationKey: string, backendId: string, cwd = process.cwd()): Promise<void> {
  const store = await load(cwd);
  const key = recordKey(backendId, conversationKey);
  if (!(key in store)) return;
  delete store[key];
  await persist(store, cwd);
}

export async function clearConversationSessionHandles(
  conversationKey: string,
  cwd = process.cwd(),
  backendIds: readonly string[] = KNOWN_BACKENDS,
): Promise<number> {
  const store = await load(cwd);
  let removed = 0;
  for (const backendId of backendIds) {
    const key = recordKey(backendId, conversationKey);
    if (key in store) {
      delete store[key];
      removed += 1;
    }
  }
  if (removed > 0) await persist(store, cwd);
  return removed;
}

/**
 * A stored handle is safe to resume ONLY when the stable config it was minted
 * under is unchanged: the workspace cwd and the model. Per-turn memory/skills are
 * re-injected each invocation (codex re-reads experimental_instructions_file every
 * exec), so they deliberately do NOT invalidate the thread — but a changed
 * profile/model/workspace must, or the resumed thread carries foreign context.
 */
export function canReuseHandle(record: SessionHandleRecord | undefined, cwd: string, model: string): record is SessionHandleRecord {
  return Boolean(record) && record!.cwd === cwd && record!.model === model;
}
