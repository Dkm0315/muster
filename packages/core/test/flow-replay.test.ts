import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultConfig,
  diffFlowRuns,
  executeScheduledJob,
  getFlowRun,
  listSchedules,
  parseFlow,
  replayFlowRun,
  resumeFlow,
  runDueSchedules,
  runFlow,
  saveFlow,
  scheduleFlowLoop,
} from "../src/index.js";
import type { FlowToolRegistry, MusterConfig } from "../src/index.js";

const offlineConfig = defaultConfig();

function stubConfig(baseUrl: string): MusterConfig {
  const config = defaultConfig();
  return {
    ...config,
    providers: {
      ...config.providers,
      stub: { id: "stub", kind: "openai-compatible", baseUrl, defaultModel: "stub-model", timeoutMs: 5000 },
    },
    runtimes: {
      native: { id: "native", enabled: true, provider: "stub", routes: {} },
    },
    routing: { ...config.routing, defaultRuntime: "native" },
  };
}

function startStubServer(handler: (body: string) => { status: number; payload: unknown }): Promise<{ url: string; close: () => void }> {
  return import("node:http").then(({ createServer }) => new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const result = handler(body);
        response.writeHead(result.status, { "content-type": "application/json" });
        response.end(JSON.stringify(result.payload));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
    });
  }));
}

test("replayFlowRun re-runs tool steps and links the new run via replayOf", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-replay-"));
  let fetchCalls = 0;
  const registry: FlowToolRegistry = {
    fetch: async () => { fetchCalls += 1; return { rows: ["T-1", "T-2"], call: "deterministic" }; },
  };
  const flow = parseFlow({ id: "replayable", steps: [{ id: "fetch", kind: "tool", tool: "fetch" }] });
  const original = await runFlow(flow, { config: offlineConfig, registry, cwd });
  assert.equal(original.status, "completed");
  assert.equal(fetchCalls, 1);

  const replayed = await replayFlowRun(original.runId, { config: offlineConfig, registry, cwd });
  assert.equal(replayed.status, "completed");
  assert.equal(fetchCalls, 2, "tool steps re-execute on replay");
  assert.notEqual(replayed.runId, original.runId, "replay produces a new run file");
  assert.deepEqual(replayed.outputs.fetch, { rows: ["T-1", "T-2"], call: "deterministic" });

  const state = await getFlowRun(replayed.runId, cwd);
  assert.equal(state.replayOf, original.runId, "the run record links back to the source run");
  assert.equal((await getFlowRun(original.runId, cwd)).replayOf, undefined);
});

test("replay reuses recorded agent output by default and never hits the model", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-replay-agent-"));
  const server = await startStubServer(() => ({
    status: 200,
    payload: { choices: [{ message: { content: "summary from the live model" } }] },
  }));
  const registry: FlowToolRegistry = { fetch: async () => ({ rows: "T-1, T-2" }) };
  const flow = parseFlow({
    id: "agent-replay",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "summarize", kind: "agent", prompt: "Summarize: {{fetch.rows}}" },
    ],
  });
  const original = await runFlow(flow, { config: stubConfig(server.url), registry, cwd });
  assert.equal(original.status, "completed");
  server.close(); // the model is now unreachable; deterministic replay must not care

  const replayed = await replayFlowRun(original.runId, { config: stubConfig(server.url), registry, cwd });
  assert.equal(replayed.status, "completed");
  const replayState = await getFlowRun(replayed.runId, cwd);
  assert.equal(
    (replayState.outputs.summarize as { text: string }).text,
    "summary from the live model",
    "agent step output is reused verbatim from the source run",
  );
  assert.equal(replayState.tokensUsed, 0, "replayed agent steps consume no tokens");
});

test("replay replays recorded gate decisions instead of pausing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-replay-gate-"));
  const posted: unknown[] = [];
  const registry: FlowToolRegistry = {
    fetch: async () => ({ summary: "3 tickets" }),
    post: async (args) => { posted.push(args); return { ok: true }; },
  };
  const flow = parseFlow({
    id: "gated-replay",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "approve", kind: "gate", show: "fetch.summary" },
      { id: "post", kind: "tool", tool: "post", args: { body: "{{fetch.summary}}" }, when: "approve.granted" },
    ],
  });
  const paused = await runFlow(flow, { config: offlineConfig, registry, cwd });

  // Unresolved gate: nothing deterministic to replay yet.
  const unresolved = await replayFlowRun(paused.runId, { config: offlineConfig, registry, cwd });
  assert.equal(unresolved.status, "failed");
  assert.match(unresolved.error ?? "", /never resolved gate "approve"/);

  await resumeFlow(paused.runId, { approve: true, config: offlineConfig, registry, cwd });
  posted.length = 0;
  const replayed = await replayFlowRun(paused.runId, { config: offlineConfig, registry, cwd });
  assert.equal(replayed.status, "completed");
  assert.deepEqual(posted, [{ body: "3 tickets" }], "post-gate steps re-run because the recorded approval is replayed");
});

test("diffFlowRuns reports identical runs and catches a changed tool output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-diff-"));
  let registryVersion = "v1";
  const registry: FlowToolRegistry = {
    fetch: async () => ({ rows: ["T-1"], version: registryVersion }),
    post: async () => ({ ok: true }),
  };
  const flow = parseFlow({
    id: "diffable",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "post", kind: "tool", tool: "post" },
    ],
  });
  const first = await runFlow(flow, { config: offlineConfig, registry, cwd });
  const replaySame = await replayFlowRun(first.runId, { config: offlineConfig, registry, cwd });
  const same = await diffFlowRuns(first.runId, replaySame.runId, cwd);
  assert.equal(same.identical, true);
  assert.deepEqual(same.differences, []);

  registryVersion = "v2"; // the tool now behaves differently (e.g. site upgrade)
  const replayChanged = await replayFlowRun(first.runId, { config: offlineConfig, registry, cwd });
  const changed = await diffFlowRuns(first.runId, replayChanged.runId, cwd);
  assert.equal(changed.identical, false);
  assert.equal(changed.differences.length, 1);
  assert.equal(changed.differences[0].stepId, "fetch");
  assert.equal(changed.differences[0].field, "output");
  assert.deepEqual(changed.differences[0].a, { rows: ["T-1"], version: "v1" });
  assert.deepEqual(changed.differences[0].b, { rows: ["T-1"], version: "v2" });
});

test("diffFlowRuns flags step presence and status changes across flows", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-diff-shape-"));
  const registry: FlowToolRegistry = {
    ok: async () => ({ fine: true }),
    boom: async () => { throw new Error("exploded"); },
  };
  const a = await runFlow(parseFlow({ id: "shape", steps: [{ id: "first", kind: "tool", tool: "ok" }, { id: "second", kind: "tool", tool: "ok" }] }), { config: offlineConfig, registry, cwd });
  const b = await runFlow(parseFlow({ id: "shape", steps: [{ id: "first", kind: "tool", tool: "boom" }] }), { config: offlineConfig, registry, cwd });
  const diff = await diffFlowRuns(a.runId, b.runId, cwd);
  assert.equal(diff.identical, false);
  const byStep = new Map(diff.differences.map((difference) => [`${difference.stepId}:${difference.field}`, difference]));
  assert.equal(byStep.get("first:status")?.a, "completed");
  assert.equal(byStep.get("first:status")?.b, "failed");
  assert.deepEqual(byStep.get("second:presence")?.b, "absent");
});

test("flow loop schedules a cron job and run-due executes the flow via the registry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-loop-"));
  await assert.rejects(scheduleFlowLoop("ghost-flow", "0 9 * * 1", { cwd }), /Flow not found: ghost-flow/);

  const ran: unknown[] = [];
  const registry: FlowToolRegistry = { digest: async (args) => { ran.push(args); return { sent: true }; } };
  await saveFlow(parseFlow({ id: "weekly-digest", steps: [{ id: "digest", kind: "tool", tool: "digest" }] }), cwd);

  const job = await scheduleFlowLoop("weekly-digest", "0 9 * * 1", { cwd });
  assert.equal(job.flowId, "weekly-digest");
  assert.equal(job.cron, "0 9 * * 1");
  assert.deepEqual((await listSchedules(cwd)).map((item) => item.flowId), ["weekly-digest"]);

  // Monday 09:00 — due. The runner is the same executor the CLI uses.
  const results = await runDueSchedules(
    (due) => executeScheduledJob(due, { config: offlineConfig, registry, cwd }),
    { now: new Date("2026-06-15T09:00:10"), cwd },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "completed");
  assert.equal(ran.length, 1, "the flow's tool step actually executed");
  const runState = await getFlowRun(results[0].runId ?? "", cwd);
  assert.equal(runState.flowId, "weekly-digest");
  assert.equal(runState.status, "completed");

  // Tuesday 09:00 — not due.
  const notDue = await runDueSchedules(
    () => { throw new Error("must not run"); },
    { now: new Date("2026-06-16T09:00:10"), cwd },
  );
  assert.equal(notDue.length, 0);
});
