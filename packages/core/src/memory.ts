import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "./store.js";
import type { ContextObject, MemoryScope, MemoryScopeKind } from "./types.js";

export interface AddMemoryInput {
  readonly kind?: string;
  readonly summary: string;
  readonly sourceUri?: string;
  readonly confidence?: number;
  readonly provenance: string[];
  readonly scopes: MemoryScope[];
  readonly redactionState?: ContextObject["redactionState"];
  readonly links?: string[];
}

export interface SearchMemoryInput {
  readonly query?: string;
  readonly scopes: MemoryScope[];
  readonly includeGlobal?: boolean;
}

export interface PromoteMemoryInput {
  readonly id: string;
  readonly targetScopes: MemoryScope[];
  readonly allowGlobal?: boolean;
}

export function memoryPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "memory.jsonl");
}

export function memoryDbPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "memory.db");
}

export async function addMemory(input: AddMemoryInput, cwd = process.cwd()): Promise<ContextObject> {
  validateMemoryInput(input);
  const previousStats = await memorySourceStats(cwd);
  const now = new Date().toISOString();
  const object: ContextObject = {
    id: `mem_${randomUUID()}`,
    kind: input.kind ?? "note",
    summary: input.summary.trim(),
    sourceUri: input.sourceUri,
    observedAt: now,
    confidence: input.confidence ?? 0.7,
    provenance: input.provenance.map((item) => item.trim()).filter(Boolean),
    scopes: normalizeScopes(input.scopes),
    redactionState: input.redactionState ?? "none",
    links: input.links?.filter(Boolean)
  };
  await appendMemory(object, cwd);
  await indexMemoryObject(object, cwd, previousStats);
  return object;
}

export async function listMemory(cwd = process.cwd()): Promise<ContextObject[]> {
  return readJsonLines<ContextObject>(memoryPath(cwd));
}

export async function findMemory(id: string, cwd = process.cwd()): Promise<ContextObject | undefined> {
  const store = await openMemoryIndex(cwd);
  try {
    const object = store.find(id);
    if (object) return object;
  } finally {
    store.close();
  }
  const objects = await listMemory(cwd);
  return objects.find((object) => object.id === id);
}

export async function searchMemory(input: SearchMemoryInput, cwd = process.cwd()): Promise<ContextObject[]> {
  const allowedScopes = normalizeScopes(input.scopes);
  if (!allowedScopes.length) throw new Error("At least one query scope is required.");
  const effectiveScopes = input.includeGlobal
    ? [...allowedScopes, { kind: "global" as const, id: "global" }]
    : allowedScopes;
  const store = await openMemoryIndex(cwd);
  try {
    return store.search({ query: input.query, scopes: effectiveScopes });
  } finally {
    store.close();
  }
}

export async function promoteMemory(input: PromoteMemoryInput, cwd = process.cwd()): Promise<ContextObject> {
  const source = await findMemory(input.id, cwd);
  if (!source) throw new Error(`Memory not found: ${input.id}`);
  const targetScopes = normalizeScopes(input.targetScopes);
  if (!targetScopes.length) throw new Error("At least one target scope is required.");
  if (targetScopes.some((scope) => scope.kind === "global") && !input.allowGlobal) {
    throw new Error("Promoting memory to global requires allowGlobal=true.");
  }
  const promoted: ContextObject = {
    ...source,
    id: `mem_${randomUUID()}`,
    observedAt: new Date().toISOString(),
    provenance: [...source.provenance, `promoted-from:${source.id}`],
    scopes: targetScopes,
    links: [...(source.links ?? []), source.id]
  };
  await appendMemory(promoted, cwd);
  return promoted;
}

export function parseMemoryScope(value: string): MemoryScope {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if (!isScopeKind(kind) || !id.trim()) {
    throw new Error(`Invalid memory scope "${value}". Use kind:id, for example user:dhairya or tenant:oxygenhr.`);
  }
  return { kind, id: normalizeScopeId(kind, id) };
}

export function formatMemoryScope(scope: MemoryScope): string {
  return `${scope.kind}:${scope.id}`;
}

export function isVisibleInScopes(object: ContextObject, allowedScopes: readonly MemoryScope[]): boolean {
  const normalizedAllowed = normalizeScopes(allowedScopes);
  return normalizeScopes(object.scopes).every((scope) => normalizedAllowed.some((candidate) => sameScope(scope, candidate)));
}

async function appendMemory(object: ContextObject, cwd: string): Promise<void> {
  const path = memoryPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(object)}\n`, "utf8");
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

interface MemoryIndex {
  readonly backend: "sqlite-fts5" | "sqlite-like";
  find(id: string): ContextObject | undefined;
  search(input: { query?: string; scopes: readonly MemoryScope[] }): ContextObject[];
  close(): void;
}

async function indexMemoryObject(object: ContextObject, cwd: string, previousStats: MemorySourceStats): Promise<void> {
  const store = await openMemoryIndex(cwd, { skipRebuild: true, expectedSourceStats: previousStats });
  try {
    store.upsert(object);
    await store.updateSourceStats();
  } finally {
    store.close();
  }
}

interface MemorySourceStats {
  readonly size: number;
  readonly mtimeMs: number;
}

async function openMemoryIndex(cwd: string, options: { skipRebuild?: boolean; expectedSourceStats?: MemorySourceStats } = {}): Promise<MemoryIndex & { upsert(object: ContextObject): void; updateSourceStats(): Promise<void> }> {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };
  mkdirSync(dataDir(cwd), { recursive: true });
  const db = new DatabaseSync(memoryDbPath(cwd));
  let backend: MemoryIndex["backend"] = "sqlite-like";
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_uri TEXT,
      observed_at TEXT NOT NULL,
      confidence REAL NOT NULL,
      provenance_json TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      redaction_state TEXT NOT NULL,
      links_json TEXT NOT NULL,
      searchable_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_scope (
      memory_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      PRIMARY KEY (memory_id, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_observed ON memory(observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_scope_lookup ON memory_scope(scope, memory_id);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(searchable_text, content='memory', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, searchable_text) VALUES (new.rowid, new.searchable_text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, searchable_text) VALUES('delete', old.rowid, old.searchable_text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, searchable_text) VALUES('delete', old.rowid, old.searchable_text);
        INSERT INTO memory_fts(rowid, searchable_text) VALUES (new.rowid, new.searchable_text);
      END;
    `);
    backend = "sqlite-fts5";
  } catch {
    // FTS5 is optional in Node builds; LIKE still uses the scoped index.
  }

  const upsert = (object: ContextObject): void => {
    const scopes = normalizeScopes(object.scopes);
    db.prepare(`
      INSERT INTO memory (id, kind, summary, source_uri, observed_at, confidence, provenance_json, scopes_json, redaction_state, links_json, searchable_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        summary = excluded.summary,
        source_uri = excluded.source_uri,
        observed_at = excluded.observed_at,
        confidence = excluded.confidence,
        provenance_json = excluded.provenance_json,
        scopes_json = excluded.scopes_json,
        redaction_state = excluded.redaction_state,
        links_json = excluded.links_json,
        searchable_text = excluded.searchable_text
    `).run(
      object.id,
      object.kind,
      object.summary,
      object.sourceUri ?? null,
      object.observedAt,
      object.confidence,
      JSON.stringify(object.provenance),
      JSON.stringify(scopes),
      object.redactionState,
      JSON.stringify(object.links ?? []),
      searchableText({ ...object, scopes }),
    );
    db.prepare("DELETE FROM memory_scope WHERE memory_id = ?").run(object.id);
    const insertScope = db.prepare("INSERT INTO memory_scope (memory_id, scope, kind, scope_id) VALUES (?, ?, ?, ?)");
    for (const scope of scopes) insertScope.run(object.id, formatMemoryScope(scope), scope.kind, scope.id);
  };

  const updateSourceStats = async (): Promise<void> => {
    const stats = await memorySourceStats(cwd);
    const stmt = db.prepare("INSERT INTO memory_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    stmt.run("source_size", String(stats.size));
    stmt.run("source_mtime_ms", String(stats.mtimeMs));
  };

  const rebuild = async (): Promise<void> => {
    const objects = await listMemory(cwd);
    db.exec("DELETE FROM memory_scope; DELETE FROM memory;");
    for (const object of objects) upsert(object);
    await updateSourceStats();
  };

  if (options.skipRebuild) {
    if (options.expectedSourceStats && await indexStale(db, options.expectedSourceStats)) await rebuild();
  } else if (await indexStale(db, await memorySourceStats(cwd))) {
    await rebuild();
  }

  const toObject = (row: Record<string, unknown>): ContextObject => ({
    id: String(row.id),
    kind: String(row.kind),
    summary: String(row.summary),
    sourceUri: row.source_uri === null || row.source_uri === undefined ? undefined : String(row.source_uri),
    observedAt: String(row.observed_at),
    confidence: Number(row.confidence),
    provenance: parseJsonArray(String(row.provenance_json)),
    scopes: parseJsonScopes(String(row.scopes_json)),
    redactionState: String(row.redaction_state) as ContextObject["redactionState"],
    links: parseJsonArray(String(row.links_json)),
  });

  const visibleClause = (scopes: readonly MemoryScope[]): { sql: string; params: string[] } => {
    const allowed = normalizeScopes(scopes).map(formatMemoryScope);
    if (!allowed.length) throw new Error("At least one query scope is required.");
    return {
      sql: `NOT EXISTS (
        SELECT 1 FROM memory_scope ms
        WHERE ms.memory_id = m.id AND ms.scope NOT IN (${allowed.map(() => "?").join(",")})
      )`,
      params: allowed,
    };
  };

  const runLikeSearch = (query: string | undefined, scopes: readonly MemoryScope[]): ContextObject[] => {
    const visible = visibleClause(scopes);
    const trimmed = query?.trim();
    const rows = trimmed
      ? db.prepare(`SELECT m.* FROM memory m WHERE ${visible.sql} AND m.searchable_text LIKE ? ESCAPE '\\' ORDER BY m.observed_at DESC`)
          .all(...visible.params, `%${escapeLike(trimmed.toLowerCase())}%`) as Record<string, unknown>[]
      : db.prepare(`SELECT m.* FROM memory m WHERE ${visible.sql} ORDER BY m.observed_at DESC`)
          .all(...visible.params) as Record<string, unknown>[];
    return rows.map(toObject);
  };

  return {
    backend,
    upsert,
    updateSourceStats,
    find(id) {
      const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return row ? toObject(row) : undefined;
    },
    search(input) {
      const query = input.query?.trim();
      if (!query) return runLikeSearch(undefined, input.scopes);
      if (backend !== "sqlite-fts5") return runLikeSearch(query, input.scopes);
      const visible = visibleClause(input.scopes);
      try {
        const rows = db.prepare(`
          SELECT m.* FROM memory_fts f JOIN memory m ON m.rowid = f.rowid
          WHERE memory_fts MATCH ? AND ${visible.sql}
          ORDER BY rank, m.observed_at DESC
        `).all(memoryFtsQuery(query), ...visible.params) as Record<string, unknown>[];
        return rows.map(toObject);
      } catch {
        return runLikeSearch(query, input.scopes);
      }
    },
    close() {
      db.close();
    },
  };
}

async function indexStale(db: SqliteDatabase, stats: MemorySourceStats): Promise<boolean> {
  const size = db.prepare("SELECT value FROM memory_meta WHERE key = ?").get("source_size") as { value?: string } | undefined;
  const mtime = db.prepare("SELECT value FROM memory_meta WHERE key = ?").get("source_mtime_ms") as { value?: string } | undefined;
  return size?.value !== String(stats.size) || mtime?.value !== String(stats.mtimeMs);
}

async function memorySourceStats(cwd: string): Promise<MemorySourceStats> {
  const stats = await stat(memoryPath(cwd)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return stats ? { size: stats.size, mtimeMs: stats.mtimeMs } : { size: 0, mtimeMs: 0 };
}

function parseJsonArray(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  return Array.isArray(value) ? value.map(String) : [];
}

function parseJsonScopes(raw: string): MemoryScope[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) return [];
  return normalizeScopes(value.flatMap((entry): MemoryScope[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const scope = entry as Record<string, unknown>;
    return typeof scope.kind === "string" && typeof scope.id === "string" ? [{ kind: scope.kind as MemoryScopeKind, id: scope.id }] : [];
  }));
}

function memoryFtsQuery(query: string): string {
  const terms = query.split(/[^\p{L}\p{N}_:-]+/u).filter(Boolean);
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" ") || '""';
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

function validateMemoryInput(input: AddMemoryInput): void {
  if (!input.summary.trim()) throw new Error("Memory summary is required.");
  if (!input.scopes.length) throw new Error("At least one memory scope is required.");
  if (!input.provenance.length || !input.provenance.some((item) => item.trim())) {
    throw new Error("At least one provenance entry is required.");
  }
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error("Memory confidence must be between 0 and 1.");
  }
}

function normalizeScopes(scopes: readonly MemoryScope[]): MemoryScope[] {
  const seen = new Set<string>();
  const result: MemoryScope[] = [];
  for (const scope of scopes) {
    if (!isScopeKind(scope.kind)) throw new Error(`Invalid memory scope kind: ${scope.kind}`);
    const normalized: MemoryScope = { kind: scope.kind, id: normalizeScopeId(scope.kind, scope.id) };
    const key = formatMemoryScope(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeScopeId(kind: MemoryScopeKind, id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error(`Memory scope ${kind} requires an id.`);
  return kind === "global" ? "global" : trimmed;
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function searchableText(object: ContextObject): string {
  return [object.kind, object.summary, object.sourceUri, object.provenance.join(" "), object.scopes.map(formatMemoryScope).join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isScopeKind(value: string): value is MemoryScopeKind {
  return (
    value === "global" ||
    value === "tenant" ||
    value === "workspace" ||
    value === "user" ||
    value === "pairing" ||
    value === "session" ||
    value === "role" ||
    value === "persona"
  );
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const values: T[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as T);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL in ${path} at line ${index + 1}: ${detail}`);
    }
  }
  return values;
}
