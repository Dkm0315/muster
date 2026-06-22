import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addMemory, formatMemoryScope, memoryDbPath, memoryPath, parseMemoryScope, promoteMemory, searchMemory } from "../src/index.js";

test("searchMemory only returns objects visible to every required scope", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-memory-"));
  await addMemory(
    {
      summary: "Dhairya prefers concise CTO-style architecture notes.",
      provenance: ["manual:test"],
      scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")]
    },
    cwd
  );
  await addMemory(
    {
      summary: "Another user prefers verbose tutorials.",
      provenance: ["manual:test"],
      scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:someone-else")]
    },
    cwd
  );

  const dhairyaVisible = await searchMemory(
    { scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")], query: "architecture" },
    cwd
  );
  const globalVisible = await searchMemory({ scopes: [parseMemoryScope("global:global")], query: "Dhairya" }, cwd);

  assert.equal(dhairyaVisible.length, 1);
  assert.match(dhairyaVisible[0]?.summary ?? "", /CTO-style/);
  assert.equal(globalVisible.length, 0);
});

test("searchMemory can include global memories without exposing private memories globally", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-memory-"));
  await addMemory(
    {
      summary: "Use evidence-aware answers by default.",
      provenance: ["manual:test"],
      scopes: [parseMemoryScope("global:global")]
    },
    cwd
  );
  await addMemory(
    {
      summary: "Session-only Redis debug context.",
      provenance: ["manual:test"],
      scopes: [parseMemoryScope("session:redis-debug")]
    },
    cwd
  );

  const scoped = await searchMemory({ scopes: [parseMemoryScope("session:redis-debug")], includeGlobal: true }, cwd);
  const globalOnly = await searchMemory({ scopes: [parseMemoryScope("global:global")] }, cwd);

  assert.equal(scoped.length, 2);
  assert.equal(globalOnly.length, 1);
  assert.match(globalOnly[0]?.summary ?? "", /evidence-aware/);
});

test("searchMemory builds and reuses a SQLite index from the JSONL memory log", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-memory-index-"));
  const legacy = {
    id: "mem_legacy",
    kind: "note",
    summary: "Legacy indexed memory contains the retrieval needle.",
    observedAt: "2026-06-22T10:00:00.000Z",
    confidence: 0.9,
    provenance: ["legacy:test"],
    scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")],
    redactionState: "none" as const,
    links: [],
  };
  await mkdir(join(cwd, ".muster", "data"), { recursive: true });
  await appendFile(memoryPath(cwd), `${JSON.stringify(legacy)}\n`, "utf8");

  const first = await searchMemory({ scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")], query: "retrieval needle" }, cwd);
  assert.deepEqual(first.map((object) => object.id), ["mem_legacy"]);
  assert.ok((await stat(memoryDbPath(cwd))).size > 0);

  const added = await addMemory({
    summary: "Fresh indexed memory contains another retrieval needle.",
    provenance: ["fresh:test"],
    scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")],
  }, cwd);
  const second = await searchMemory({ scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")], query: "retrieval needle" }, cwd);
  assert.deepEqual(second.map((object) => object.id).sort(), [added.id, "mem_legacy"].sort());
});

test("indexed memory retrieval stays scoped and accurate across larger stores", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-memory-scale-"));
  const expected: string[] = [];
  for (let index = 0; index < 500; index += 1) {
    const target = index % 97 === 0;
    const other = index % 13 === 0;
    const object = await addMemory({
      summary: target ? `retrieval benchmark target ${index} scoped answer` : `background note ${index} for plugins and sessions`,
      provenance: [`scale:${index}`],
      scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope(other ? "user:someone-else" : "user:dhairya")],
    }, cwd);
    if (target && !other) expected.push(object.id);
  }

  const results = await searchMemory({ scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")], query: "retrieval benchmark target" }, cwd);
  assert.deepEqual(results.map((object) => object.id).sort(), expected.sort());
  assert.ok(results.every((object) => object.scopes.map(formatMemoryScope).includes("user:dhairya")));
});

test("promoteMemory refuses global promotion unless explicitly allowed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-memory-"));
  const source = await addMemory(
    {
      summary: "Verified tenant runbook preference.",
      provenance: ["manual:test"],
      scopes: [parseMemoryScope("session:runbook")]
    },
    cwd
  );

  await assert.rejects(
    () => promoteMemory({ id: source.id, targetScopes: [parseMemoryScope("global:global")] }, cwd),
    /requires allowGlobal/
  );

  const promoted = await promoteMemory(
    { id: source.id, targetScopes: [parseMemoryScope("tenant:hybrow")], allowGlobal: false },
    cwd
  );

  assert.notEqual(promoted.id, source.id);
  assert.deepEqual(promoted.scopes.map(formatMemoryScope), ["tenant:hybrow"]);
  assert.ok(promoted.provenance.includes(`promoted-from:${source.id}`));
});

test("parseMemoryScope rejects malformed scopes", () => {
  assert.throws(() => parseMemoryScope("user"), /Invalid memory scope/);
  assert.throws(() => parseMemoryScope("unknown:1"), /Invalid memory scope/);
});
