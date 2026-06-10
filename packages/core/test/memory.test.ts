import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addMemory, formatMemoryScope, parseMemoryScope, promoteMemory, searchMemory } from "../src/index.js";

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
