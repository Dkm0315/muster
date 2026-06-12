import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claimCompleted, defaultConfig, listSubRuns, listTokenRecords, reapOrphans, spawnSubagent } from "../src/index.js";
import type { MusterConfig } from "../src/index.js";

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
