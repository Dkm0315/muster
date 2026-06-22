import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultConfig,
  flowRunPath,
  getFlowRun,
  listFlowRuns,
  listFlows,
  loadFlow,
  parseFlow,
  preflightFlow,
  resumeFlow,
  runFlow,
  saveFlow,
} from "../src/index.js";
import type { FlowDefinition, FlowRunEvent, FlowToolRegistry, MusterConfig } from "../src/index.js";

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

function echoRegistry(): FlowToolRegistry {
  return { echo: async (args) => args };
}

const offlineConfig = defaultConfig();

test("parseFlow rejects each malformed definition with a precise message", () => {
  const cases: Array<{ flow: unknown; message: RegExp }> = [
    { flow: { id: "Bad Id!", steps: [{ id: "a", kind: "tool", tool: "echo" }] }, message: /Flow id must be lowercase/ },
    { flow: { id: "f", steps: [] }, message: /non-empty steps array/ },
    { flow: { id: "f", budgetTokens: -5, steps: [{ id: "a", kind: "tool", tool: "echo" }] }, message: /budgetTokens must be a positive number/ },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo" }, { id: "a", kind: "tool", tool: "echo" }] },
      message: /Duplicate step id "a"/,
    },
    { flow: { id: "f", steps: [{ id: "a", kind: "shell", command: "rm" }] }, message: /unknown step kind "shell"/ },
    { flow: { id: "f", steps: [{ id: "a", kind: "tool" }] }, message: /requires a non-empty "tool" name/ },
    { flow: { id: "f", steps: [{ id: "a", kind: "agent", prompt: " " }] }, message: /requires a non-empty "prompt"/ },
    { flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo" }, { id: "g", kind: "gate" }] }, message: /Gate step "g" requires "show"/ },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo" }, { id: "g", kind: "gate", show: "missing.text" }] },
      message: /"show" references nonexistent step "missing"/,
    },
    {
      flow: { id: "f", steps: [{ id: "g", kind: "gate", show: "later.text" }, { id: "later", kind: "tool", tool: "echo" }] },
      message: /"show" references a later step "later"/,
    },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", when: "ghost.granted" }] },
      message: /"when" references nonexistent step "ghost"/,
    },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", when: "not-a-reference" }] },
      message: /"when" must be a "<stepId>\.<field>" reference/,
    },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "agent", prompt: "Summarize {{ghost.rows}}" }] },
      message: /template reference "\{\{ghost\.rows\}\}" points to unknown step "ghost"/,
    },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", args: { value: "{{b.out}}" } }, { id: "b", kind: "tool", tool: "echo" }] },
      message: /template reference "\{\{b\.out\}\}" points to a later step "b"/,
    },
    {
      flow: { id: "f", steps: [{ id: "a", kind: "tool", tool: "echo" }, { id: "g", kind: "gate", show: "a.value", expiresHours: 0 }] },
      message: /"expiresHours" must be a positive number/,
    },
  ];
  for (const item of cases) {
    assert.throws(() => parseFlow(item.flow), item.message, `expected ${item.message} for ${JSON.stringify(item.flow)}`);
  }
  assert.throws(() => parseFlow("{not json"), /not valid JSON/);
});

test("preflightFlow reports unregistered tools and missing default runtime for agent steps", () => {
  const flow = parseFlow({
    id: "pf",
    steps: [
      { id: "fetch", kind: "tool", tool: "frappe_fetch" },
      { id: "summarize", kind: "agent", prompt: "Summarize {{fetch.rows}}" },
    ],
  });
  const report = preflightFlow(flow, echoRegistry(), { ...offlineConfig, routing: { ...offlineConfig.routing, defaultRuntime: "missing" } });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => /tool "frappe_fetch" is not registered/.test(issue.message)));
  assert.ok(report.issues.some((issue) => /default runtime "missing" is not configured/.test(issue.message)));

  const good = preflightFlow(parseFlow({ id: "ok", steps: [{ id: "a", kind: "tool", tool: "echo" }] }), echoRegistry(), offlineConfig);
  assert.deepEqual(good, { ok: true, issues: [] });
});

test("saveFlow/loadFlow/listFlows round-trip definitions under .muster/flows", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-defs-"));
  const flow = parseFlow({ id: "digest", description: "weekly digest", steps: [{ id: "a", kind: "tool", tool: "echo" }] });
  const saved = await saveFlow(flow, cwd);
  assert.match(saved, /\.muster\/flows\/digest\.json$/);
  assert.deepEqual(await loadFlow("digest", cwd), flow);
  assert.deepEqual((await listFlows(cwd)).map((item) => item.id), ["digest"]);
  await assert.rejects(loadFlow("nope", cwd), /Flow not found: nope/);
});

test("runFlow executes tools in order, resolves templates across steps, and writes valid JSONL", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-run-"));
  const calls: unknown[] = [];
  const registry: FlowToolRegistry = {
    fetch: async () => ({ rows: [{ name: "T-1" }, { name: "T-2" }], meta: { count: 2 } }),
    post: async (args) => { calls.push(args); return { posted: true }; },
  };
  const flow = parseFlow({
    id: "templated",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "post", kind: "tool", tool: "post", args: { exact: "{{fetch.rows}}", text: "count={{fetch.meta.count}}" } },
    ],
  });
  const events: FlowRunEvent[] = [];
  const result = await runFlow(flow, { config: offlineConfig, registry, cwd, onEvent: (event) => events.push(event) });
  assert.equal(result.status, "completed");
  // exact single-template substitution preserves the raw value; embedded templates stringify
  assert.deepEqual(calls, [{ exact: [{ name: "T-1" }, { name: "T-2" }], text: "count=2" }]);
  assert.deepEqual(events.map((event) => event.type), [
    "run_started", "step_started", "step_completed", "step_started", "step_completed", "run_finished",
  ]);

  const raw = await readFile(flowRunPath(result.runId, cwd), "utf8");
  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 6, "one JSONL line per event");
  for (const line of lines) JSON.parse(line);

  const state = await getFlowRun(result.runId, cwd);
  assert.equal(state.status, "completed");
  assert.equal(state.flowId, "templated");
  assert.deepEqual(state.outputs.post, { posted: true });
  assert.deepEqual((await listFlowRuns(cwd)).map((run) => run.runId), [result.runId]);
});

test("agent steps route through executeRun and feed later templates", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-agent-"));
  const server = await startStubServer(() => ({
    status: 200,
    payload: { choices: [{ message: { content: "two tickets are open" } }] },
  }));
  try {
    const sent: unknown[] = [];
    const registry: FlowToolRegistry = {
      fetch: async () => ({ rows: "T-1, T-2" }),
      send: async (args) => { sent.push(args); return { ok: true }; },
    };
    const flow = parseFlow({
      id: "agentic",
      steps: [
        { id: "fetch", kind: "tool", tool: "fetch" },
        { id: "summarize", kind: "agent", prompt: "Summarize these tickets: {{fetch.rows}}" },
        { id: "send", kind: "tool", tool: "send", args: { message: "{{summarize.text}}" } },
      ],
    });
    const result = await runFlow(flow, { config: stubConfig(server.url), registry, cwd });
    assert.equal(result.status, "completed");
    assert.deepEqual(sent, [{ message: "two tickets are open" }]);
    const state = await getFlowRun(result.runId, cwd);
    assert.ok(state.tokensUsed > 0, "agent steps record estimated token usage");
  } finally {
    server.close();
  }
});

test("gate pauses the run, approve resumes the remaining steps", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-gate-"));
  const posted: unknown[] = [];
  const registry: FlowToolRegistry = {
    fetch: async () => ({ summary: "3 tickets need triage" }),
    post: async (args) => { posted.push(args); return { ok: true }; },
  };
  const flow = parseFlow({
    id: "gated",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "approve", kind: "gate", show: "fetch.summary", expiresHours: 48 },
      { id: "post", kind: "tool", tool: "post", args: { body: "{{fetch.summary}}" }, when: "approve.granted" },
    ],
  });
  const paused = await runFlow(flow, { config: offlineConfig, registry, cwd });
  assert.equal(paused.status, "awaiting_approval");
  assert.equal(paused.gateId, "approve");
  assert.equal(paused.show, "3 tickets need triage", "approver sees the actual output, not a step name");
  assert.deepEqual(posted, [], "steps after the gate do not run before approval");

  const state = await getFlowRun(paused.runId, cwd);
  assert.equal(state.status, "awaiting_approval");
  assert.equal(state.pendingGate?.stepId, "approve");
  assert.ok(state.pendingGate?.expiresAt, "gate records its expiry in the run file");

  const resumed = await resumeFlow(paused.runId, { approve: true, config: offlineConfig, registry, cwd });
  assert.equal(resumed.status, "completed");
  assert.deepEqual(posted, [{ body: "3 tickets need triage" }]);

  const finalState = await getFlowRun(paused.runId, cwd);
  assert.equal(finalState.status, "completed");
  assert.ok(finalState.events.some((event) => event.type === "gate_resolved" && event.approved === true));
  await assert.rejects(
    resumeFlow(paused.runId, { approve: true, config: offlineConfig, registry, cwd }),
    /no pending gate \(status: completed\)/,
  );
});

test("resume reject marks the run rejected and skips the remaining steps", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-reject-"));
  const posted: unknown[] = [];
  const registry: FlowToolRegistry = {
    fetch: async () => ({ summary: "draft" }),
    post: async (args) => { posted.push(args); return { ok: true }; },
  };
  const flow = parseFlow({
    id: "rejected",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "approve", kind: "gate", show: "fetch.summary" },
      { id: "post", kind: "tool", tool: "post", when: "approve.granted" },
    ],
  });
  const paused = await runFlow(flow, { config: offlineConfig, registry, cwd });
  const resumed = await resumeFlow(paused.runId, { approve: false, config: offlineConfig, registry, cwd });
  assert.equal(resumed.status, "rejected");
  assert.deepEqual(posted, []);
  const state = await getFlowRun(paused.runId, cwd);
  assert.equal(state.status, "rejected");
  assert.ok(state.events.some((event) => event.type === "gate_resolved" && event.approved === false), "rejection is recorded as a step event");
});

test("expired gates cannot be approved", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-expiry-"));
  const registry: FlowToolRegistry = {
    fetch: async () => ({ summary: "stale" }),
    post: async () => ({ ok: true }),
  };
  const flow = parseFlow({
    id: "expiring",
    steps: [
      { id: "fetch", kind: "tool", tool: "fetch" },
      { id: "approve", kind: "gate", show: "fetch.summary", expiresHours: 0.0001 }, // ~0.36s
      { id: "post", kind: "tool", tool: "post", when: "approve.granted" },
    ],
  });
  const paused = await runFlow(flow, { config: offlineConfig, registry, cwd });
  assert.equal(paused.status, "awaiting_approval");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  const resumed = await resumeFlow(paused.runId, { approve: true, config: offlineConfig, registry, cwd });
  assert.equal(resumed.status, "expired");
  assert.match(resumed.error ?? "", /expired at/);
  assert.equal((await getFlowRun(paused.runId, cwd)).status, "expired");
});

test("budgetTokens aborts the run cleanly with budget_exceeded", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-budget-"));
  const server = await startStubServer(() => ({
    status: 200,
    payload: { choices: [{ message: { content: "x".repeat(400) } }] },
  }));
  try {
    const flow = parseFlow({
      id: "budgeted",
      budgetTokens: 100,
      steps: [
        { id: "first", kind: "agent", prompt: "Summarize the weekly tickets in detail." },
        { id: "second", kind: "agent", prompt: "Now expand the summary further." },
      ],
    });
    const result = await runFlow(flow, { config: stubConfig(server.url), registry: {}, cwd });
    assert.equal(result.status, "budget_exceeded");
    assert.match(result.error ?? "", /budget/i);
    const state = await getFlowRun(result.runId, cwd);
    assert.equal(state.status, "budget_exceeded");
    const completed = state.events.filter((event) => event.type === "step_completed").map((event) => event.stepId);
    assert.deepEqual(completed, ["first"], "the over-budget step never executes");
  } finally {
    server.close();
  }
});

test("when conditions skip steps whose reference is falsy and run truthy ones", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-when-"));
  const ran: string[] = [];
  const registry: FlowToolRegistry = {
    check: async () => ({ granted: false, ready: true }),
    onGranted: async () => { ran.push("onGranted"); return {}; },
    onReady: async () => { ran.push("onReady"); return {}; },
  };
  const flow = parseFlow({
    id: "conditional",
    steps: [
      { id: "check", kind: "tool", tool: "check" },
      { id: "blocked", kind: "tool", tool: "onGranted", when: "check.granted" },
      { id: "allowed", kind: "tool", tool: "onReady", when: "check.ready" },
    ],
  });
  const result = await runFlow(flow, { config: offlineConfig, registry, cwd });
  assert.equal(result.status, "completed");
  assert.deepEqual(ran, ["onReady"]);
  const state = await getFlowRun(result.runId, cwd);
  const skipped = state.events.find((event) => event.type === "step_skipped");
  assert.equal(skipped && "stepId" in skipped ? skipped.stepId : undefined, "blocked");
});

test("tool failures and unresolved runtime references finish the run as failed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-fail-"));
  const registry: FlowToolRegistry = {
    boom: async () => { throw new Error("upstream exploded"); },
    echo: async (args) => args,
  };
  const failing = parseFlow({ id: "failing", steps: [{ id: "a", kind: "tool", tool: "boom" }] });
  const failed = await runFlow(failing, { config: offlineConfig, registry, cwd });
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /upstream exploded/);
  assert.equal((await getFlowRun(failed.runId, cwd)).status, "failed");

  // the field path is only resolvable at runtime; missing fields fail the step
  const missingField = parseFlow({
    id: "missing-field",
    steps: [
      { id: "a", kind: "tool", tool: "echo", args: { value: 1 } },
      { id: "b", kind: "tool", tool: "echo", args: { copy: "{{a.nope}}" } },
    ],
  });
  const fieldResult = await runFlow(missingField, { config: offlineConfig, registry, cwd });
  assert.equal(fieldResult.status, "failed");
  assert.match(fieldResult.error ?? "", /field "nope" not found/);
});

test("runFlow refuses flows that fail preflight", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-preflight-"));
  const flow: FlowDefinition = parseFlow({ id: "noreg", steps: [{ id: "a", kind: "tool", tool: "unregistered" }] });
  await assert.rejects(
    runFlow(flow, { config: offlineConfig, registry: {}, cwd }),
    /Flow preflight failed[\s\S]*tool "unregistered" is not registered/,
  );
  await assert.rejects(getFlowRun("flowrun_missing", cwd), /Flow run not found/);
});

test("a tool step retries a transient failure and ultimately succeeds", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-retry-"));
  let attempts = 0;
  const registry: FlowToolRegistry = {
    flaky: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient blip");
      return { ok: true, attempts };
    },
  };
  const flow = parseFlow({ id: "retry-ok", steps: [{ id: "s", kind: "tool", tool: "flaky", retry: 2 }] });
  const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
  assert.equal(result.status, "completed");
  assert.equal(attempts, 3, "1 initial attempt + 2 retries");
  assert.deepEqual(result.outputs.s, { ok: true, attempts: 3 });
});

test("a tool step that keeps failing fails after exhausting retries", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-retry-fail-"));
  let attempts = 0;
  const registry: FlowToolRegistry = { always: async () => { attempts += 1; throw new Error("persistent boom"); } };
  const flow = parseFlow({ id: "retry-fail", steps: [{ id: "s", kind: "tool", tool: "always", retry: 2 }] });
  const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
  assert.equal(result.status, "failed");
  assert.equal(attempts, 3, "tried 1 + 2 retries, then gave up");
  assert.match(result.error ?? "", /persistent boom/);
});

test("validateFlow rejects an out-of-range retry", () => {
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", retry: -1 }] }), /retry.*between 0 and 10/);
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", retry: 11 }] }), /retry.*between 0 and 10/);
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "a", kind: "tool", tool: "echo", retry: 1.5 }] }), /retry.*between 0 and 10/);
});

test("a foreach step runs the tool per item (item passed through) and collects the outputs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-foreach-"));
  const seen: unknown[] = [];
  const registry: FlowToolRegistry = {
    list: async () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }),
    double: async (args) => { seen.push(args.item); return { doubled: (args.item as { n: number }).n * 2, tag: args.tag }; },
  };
  const flow = parseFlow({
    id: "foreach-ok",
    steps: [
      { id: "list", kind: "tool", tool: "list" },
      { id: "each", kind: "foreach", over: "list.items", tool: "double", args: { tag: "x" } },
    ],
  });
  const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
  assert.equal(result.status, "completed");
  assert.deepEqual(seen, [{ n: 1 }, { n: 2 }, { n: 3 }], "tool ran once per item, item bound");
  assert.deepEqual(result.outputs.each, [{ doubled: 2, tag: "x" }, { doubled: 4, tag: "x" }, { doubled: 6, tag: "x" }]);
});

test("a foreach step accepts a bare step reference whose output is an array", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-foreach-bare-"));
  const registry: FlowToolRegistry = { nums: async () => [10, 20], inc: async (args) => (args.item as number) + 1 };
  const flow = parseFlow({ id: "foreach-bare", steps: [
    { id: "nums", kind: "tool", tool: "nums" },
    { id: "each", kind: "foreach", over: "nums", tool: "inc" },
  ] });
  const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.outputs.each, [11, 21]);
});

test("a foreach step fails when 'over' does not resolve to an array", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-flow-foreach-bad-"));
  const registry: FlowToolRegistry = { obj: async () => ({ notArray: true }), t: async () => 1 };
  const flow = parseFlow({ id: "foreach-nonarray", steps: [
    { id: "obj", kind: "tool", tool: "obj" },
    { id: "each", kind: "foreach", over: "obj.notArray", tool: "t" },
  ] });
  const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /did not resolve to an array/);
});

test("validateFlow rejects a foreach without a valid over/tool", () => {
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "a", kind: "tool", tool: "x" }, { id: "b", kind: "foreach", tool: "y" }] }), /requires "over"/);
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "a", kind: "tool", tool: "x" }, { id: "b", kind: "foreach", over: "a.items" }] }), /requires a non-empty "tool"/);
  assert.throws(() => parseFlow({ id: "f", steps: [{ id: "b", kind: "foreach", over: "later.items", tool: "y" }, { id: "later", kind: "tool", tool: "x" }] }), /references a later step/);
});
