import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import {
  addMemory,
  buildRecalledBlock,
  defaultConfig,
  episodesPath,
  executeRun,
  listEpisodes,
  listTokenRecords,
  renderIntegrityReport,
  runHarnessChecks,
  searchMemory,
  tokensPath,
  verifyIntegrity,
} from "../src/index.js";
import type { HybrowClawConfig } from "../src/index.js";

function stubConfig(baseUrl: string): HybrowClawConfig {
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

test("executeRun records the episode, token usage, and a session-scoped memory candidate", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-run-"));
  const server = await startStubServer(() => ({
    status: 200,
    payload: { choices: [{ message: { content: "stubbed answer about HybrowClaw" } }] },
  }));
  try {
    const outcome = await executeRun(stubConfig(server.url), { prompt: "what is hybrowclaw?", cwd });
    assert.equal(outcome.episode.outcome?.kind, "completed");
    assert.equal(outcome.episode.responseText, "stubbed answer about HybrowClaw");

    const episodes = await listEpisodes(cwd);
    assert.equal(episodes.length, 1);

    const tokens = await listTokenRecords(cwd);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].runId, outcome.plan.runId);
    assert.equal(tokens[0].estimated, true);

    const runUser = process.env.USER || process.env.USERNAME || "local";
    const sessionMemory = await searchMemory({
      scopes: [{ kind: "session", id: outcome.plan.runId }, { kind: "user", id: runUser }],
    }, cwd);
    assert.equal(sessionMemory.length, 1, "completed runs write a session-scoped memory candidate");

    const otherSession = await searchMemory({
      scopes: [{ kind: "session", id: "some-other-run" }, { kind: "user", id: runUser }],
    }, cwd);
    assert.equal(otherSession.length, 0, "memory candidates never leak across sessions");
  } finally {
    server.close();
  }
});

test("executeRun injects recalled scoped memory into the prompt", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-run-recall-"));
  let observedPrompt = "";
  const server = await startStubServer((body) => {
    observedPrompt = (JSON.parse(body).messages as Array<{ content: string }>).map((message) => message.content).join("\n");
    return { status: 200, payload: { choices: [{ message: { content: "ok" } }] } };
  });
  try {
    await addMemory({
      summary: "The deployment target is uat-erp.pwhr.in.",
      provenance: ["test"],
      scopes: [{ kind: "user", id: "tester" }],
    }, cwd);
    await executeRun(stubConfig(server.url), {
      prompt: "where do we deploy?",
      cwd,
      scopes: [{ kind: "user", id: "tester" }],
    });
    assert.match(observedPrompt, /Recalled context/);
    assert.match(observedPrompt, /uat-erp\.pwhr\.in/);
  } finally {
    server.close();
  }
});

test("governed fallback is recorded as evidence and never silent", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-run-fallback-"));
  let calls = 0;
  const server = await startStubServer(() => {
    calls += 1;
    if (calls === 1) return { status: 500, payload: { error: "primary down" } };
    return { status: 200, payload: { choices: [{ message: { content: "fallback answer" } }] } };
  });
  try {
    const config = stubConfig(server.url);
    const withFallback: HybrowClawConfig = {
      ...config,
      routing: { ...config.routing, fallbacks: [{ provider: "stub", model: "fallback-model" }] },
    };
    const outcome = await executeRun(withFallback, { prompt: "hello", cwd });
    assert.equal(outcome.fallbackUsed, "stub/fallback-model");
    assert.equal(outcome.episode.model, "fallback-model");
    const fallbackEvidence = outcome.episode.evidence.find((item) => item.label === "model_fallback");
    assert.ok(fallbackEvidence, "fallback must be recorded as evidence");
    assert.match(fallbackEvidence!.detail ?? "", /primary route/i);

    const integrity = await verifyIntegrity(cwd);
    assert.equal(integrity.ok, true, "recorded fallback is not silent drift");
  } finally {
    server.close();
  }
});

test("verifyIntegrity detects corrupt lines, duplicate run ids, and silent model drift", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-integrity-"));
  const episodes = episodesPath(cwd);
  await mkdir(dirname(episodes), { recursive: true });
  const baseEpisode = {
    id: "run_dup",
    createdAt: new Date().toISOString(),
    cwd,
    prompt: "p",
    taskKind: "simple_qa",
    runtimeId: "native",
    providerId: "stub",
    model: "actual-model",
    responseText: "r",
    evidence: [],
    outcome: { kind: "completed" },
  };
  await writeFile(episodes, `${JSON.stringify(baseEpisode)}\n${JSON.stringify(baseEpisode)}\nnot-json\n`);
  await appendFile(tokensPath(cwd), `${JSON.stringify({ runId: "run_dup", plannedModel: "planned-model", model: "actual-model" })}\n`);

  const report = await verifyIntegrity(cwd);
  assert.equal(report.ok, false);
  const kinds = report.issues.map((issue) => issue.kind);
  assert.ok(kinds.includes("corrupt_line"));
  assert.ok(kinds.includes("duplicate_run_id"));
  assert.ok(kinds.includes("silent_model_drift"));
  assert.match(renderIntegrityReport(report), /ISSUES FOUND/);
});

test("harness self-checks pass on a clean workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-selfcheck-"));
  const checks = await runHarnessChecks(cwd);
  assert.deepEqual(checks.map((check) => check.status), ["passed", "passed", "passed"]);
});

test("buildRecalledBlock formats memory deterministically and stays empty without memory", () => {
  assert.equal(buildRecalledBlock([]), "");
  const block = buildRecalledBlock([
    {
      id: "mem_1",
      kind: "fact",
      summary: "X is true",
      observedAt: new Date().toISOString(),
      confidence: 0.9,
      provenance: ["test"],
      scopes: [{ kind: "user", id: "u" }],
      redactionState: "none",
    },
  ]);
  assert.match(block, /Recalled context/);
  assert.match(block, /- \[fact\] X is true/);
});
