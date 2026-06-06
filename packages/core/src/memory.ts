import { appendFile, mkdir, readFile } from "node:fs/promises";
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

export async function addMemory(input: AddMemoryInput, cwd = process.cwd()): Promise<ContextObject> {
  validateMemoryInput(input);
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
  return object;
}

export async function listMemory(cwd = process.cwd()): Promise<ContextObject[]> {
  return readJsonLines<ContextObject>(memoryPath(cwd));
}

export async function findMemory(id: string, cwd = process.cwd()): Promise<ContextObject | undefined> {
  const objects = await listMemory(cwd);
  return objects.find((object) => object.id === id);
}

export async function searchMemory(input: SearchMemoryInput, cwd = process.cwd()): Promise<ContextObject[]> {
  const allowedScopes = normalizeScopes(input.scopes);
  if (!allowedScopes.length) throw new Error("At least one query scope is required.");
  const query = input.query?.trim().toLowerCase();
  const effectiveScopes = input.includeGlobal
    ? [...allowedScopes, { kind: "global" as const, id: "global" }]
    : allowedScopes;
  const objects = await listMemory(cwd);
  return objects
    .filter((object) => isVisibleInScopes(object, effectiveScopes))
    .filter((object) => !query || searchableText(object).includes(query))
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
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
