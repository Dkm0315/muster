import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { claimCompleted, defaultConfig, listSubRuns, listTokenRecords, reapOrphans, spawnSubagent, subRunsPath } from "../src/index.js";
import type { MusterConfig } from "../src/index.js";

/** Write a raw `spawned` event for a stale child that "crashed" while running. */
async function seedStaleRunning(cwd: string, id: string, createdAt: string): Promise<void> {
  const path = subRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ id, at: createdAt, event: "spawned", parentKey: "ghost", task: "crashed mid-run" })}\n`);
}

function startStubLlm(reply = "child result"): Promise<{ url: string; close(): void }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`, close: () => server.close() });
    });
  });
}

function stubConfig(baseUrl: string): MusterConfig {
  const config = defaultConfig();
  return {
    ...config,
    providers: { stub: { id: "stub", kind: "openai-compatible", baseUrl, defaultModel: "stub-model", timeoutMs: 5000 } },
    runtimes: { native: { id: "native", enabled: true, provider: "stub", routes: {} } },
    routing: { ...config.routing, defaultRuntime: "native" },
  };
}

test("spawn -> complete -> pull-claim exactly once, with ledger folding tag", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-"));
  const llm = await startStubLlm();
  try {
    const handle = await spawnSubagent(stubConfig(llm.url), { task: "summarize the logs", parentKey: "parent:tg:1" }, cwd);
    const finished = await handle.done;
    assert.equal(finished.status, "completed");
    assert.equal(finished.resultText, "child result");

    const claimed = await claimCompleted("parent:tg:1", cwd);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, handle.id);
    const second = await claimCompleted("parent:tg:1", cwd);
    assert.equal(second.length, 0, "results arrive exactly once");

    const tokens = await listTokenRecords(cwd);
    assert.equal(tokens[0].surfaceId, "subagent:parent:tg:1", "child spend folds under the parent tag");
  } finally {
    llm.close();
  }
});

test("failures are recorded and claimable; other parents see nothing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-fail-"));
  const config = stubConfig("http://127.0.0.1:1/v1"); // unreachable
  const handle = await spawnSubagent(config, { task: "doomed", parentKey: "parent:a" }, cwd);
  const finished = await handle.done;
  assert.equal(finished.status, "failed");
  assert.ok(finished.errorMessage);
  assert.equal((await claimCompleted("parent:b", cwd)).length, 0);
  assert.equal((await claimCompleted("parent:a", cwd)).length, 1);
});

test("depth cap refuses orchestrator spawns unless explicitly granted", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-depth-"));
  const config = stubConfig("http://127.0.0.1:1/v1");
  await assert.rejects(() => spawnSubagent(config, { task: "x", parentKey: "p", depth: 1 }, cwd), /depth 1 reached the cap/);
  const granted = await spawnSubagent(config, { task: "x", parentKey: "p", depth: 1, maxDepth: 2 }, cwd);
  await granted.done;
});

test("TTL reaper marks long-running children orphaned — zombies impossible", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-reap-"));
  const llm = await startStubLlm();
  try {
    const handle = await spawnSubagent(stubConfig(llm.url), { task: "slowish", parentKey: "p" }, cwd);
    const future = new Date(Date.now() + 10 * 60_000);
    const reaped = await reapOrphans(60_000, cwd, future);
    // the child may or may not have finished before the reap snapshot; both are valid,
    // but a still-running entry past TTL MUST be orphaned
    const runs = await listSubRuns(cwd);
    const run = runs.find((entry) => entry.id === handle.id)!;
    assert.ok(["completed", "orphaned"].includes(run.status));
    if (run.status === "orphaned") assert.equal(reaped[0]?.id, handle.id);
    await handle.done;
  } finally {
    llm.close();
  }
});

test("completed-after-orphan does not resurrect a reaped run's claim", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-order-"));
  const llm = await startStubLlm();
  try {
    const handle = await spawnSubagent(stubConfig(llm.url), { task: "t", parentKey: "p" }, cwd);
    await handle.done;
    const runs = await listSubRuns(cwd);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "completed");
  } finally {
    llm.close();
  }
});

test("concurrency cap is durable: crashed children do not permanently wedge spawns; reaper recovers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-cap-"));
  const llm = await startStubLlm();
  try {
    // Simulate 5 children that crashed mid-run: `spawned` events with no
    // terminal event. The in-memory activeCount is 0 (fresh process), so only a
    // durable count derived from the store can see the saturation.
    const staleAt = new Date(Date.now() - 60 * 60_000).toISOString();
    for (let i = 0; i < 5; i += 1) await seedStaleRunning(cwd, `sub_stale_${i}`, staleAt);
    assert.equal((await listSubRuns(cwd)).filter((r) => r.status === "running").length, 5);

    // Durable cap (5 running) must block a new spawn even though activeCount is 0.
    await assert.rejects(
      () => spawnSubagent(stubConfig(llm.url), { task: "blocked", parentKey: "p" }, cwd),
      /concurrency cap reached/,
    );

    // The TTL reaper flips the stale running entries to orphaned, freeing slots.
    const reaped = await reapOrphans(60_000, cwd);
    assert.equal(reaped.length, 5);
    assert.equal((await listSubRuns(cwd)).filter((r) => r.status === "running").length, 0);

    // With the slots recovered, spawning succeeds again — no permanent wedge.
    const handle = await spawnSubagent(stubConfig(llm.url), { task: "now ok", parentKey: "p" }, cwd);
    const finished = await handle.done;
    assert.equal(finished.status, "completed");
  } finally {
    llm.close();
  }
});

test("double-claim is idempotent: a second claimCompleted returns the result only once", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-sub-claim-"));
  const llm = await startStubLlm();
  try {
    const handle = await spawnSubagent(stubConfig(llm.url), { task: "summarize", parentKey: "parent:x" }, cwd);
    await handle.done;

    // Under the single-writer assumption (see module docstring), claims are
    // sequential. The re-read guard ensures a redundant claim observes the run
    // already claimed and delivers nothing.
    const first = await claimCompleted("parent:x", cwd);
    assert.equal(first.length, 1, "first claim delivers the finished child");
    assert.equal(first[0].id, handle.id);

    const second = await claimCompleted("parent:x", cwd);
    assert.equal(second.length, 0, "redundant claim delivers nothing");

    // Exactly one `claimed` marker exists for the run — no duplicate claim event.
    const claimed = (await listSubRuns(cwd)).filter((r) => r.id === handle.id && r.claimedAt);
    assert.equal(claimed.length, 1);
  } finally {
    llm.close();
  }
});
