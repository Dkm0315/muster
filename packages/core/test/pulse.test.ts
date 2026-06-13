import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { addPulse, defaultConfig, listPulses, pulseChecklistPath, pulsesPath, resumePulse, runDuePulses } from "../src/index.js";
import type { MusterConfig } from "../src/index.js";

function startStubLlm(reply: string): Promise<{ url: string; calls: () => number; close(): void }> {
  let calls = 0;
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`, calls: () => calls, close: () => server.close() });
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

// Anchor to *today* at 09:00 local time. The daily-budget kill-switch compares
// the run clock (this `now`) against the wall-clock `createdAt` on token records,
// so a hardcoded past date silently breaks the budget filter the moment the
// calendar advances past it. 09:00 keeps the "0 9 * * *" cron cases matching.
const NOW = (() => {
  const anchor = new Date();
  anchor.setHours(9, 0, 0, 0);
  return anchor;
})();

async function writeChecklist(cwd: string, content: string): Promise<void> {
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(pulseChecklistPath(cwd), content);
}

test("preflight gate: heartbeat with no checklist makes ZERO model calls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pulse-pre-"));
  const llm = await startStubLlm("OK");
  try {
    await addPulse({ cron: "* * * * *" }, cwd);
    const results = await runDuePulses(stubConfig(llm.url), { cwd, now: NOW });
    assert.equal(results[0].action, "skipped_preflight");
    assert.equal(llm.calls(), 0, "the whole point: no due content, no API call");
  } finally {
    llm.close();
  }
});

test("quiet all-clear replies are suppressed; real findings surface", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pulse-quiet-"));
  await writeChecklist(cwd, "- check disk space\n- check failed deploys");
  const quiet = await startStubLlm("OK");
  try {
    await addPulse({ cron: "* * * * *" }, cwd);
    const results = await runDuePulses(stubConfig(quiet.url), { cwd, now: NOW });
    assert.equal(results[0].action, "quiet");
    assert.equal(quiet.calls(), 1);
  } finally {
    quiet.close();
  }

  const cwd2 = await mkdtemp(join(tmpdir(), "muster-pulse-surface-"));
  await writeChecklist(cwd2, "- check failed deploys");
  const loud = await startStubLlm("Deploy pipeline has 3 failures since 08:00 — investigate runner disk space.");
  try {
    await addPulse({ cron: "* * * * *" }, cwd2);
    const results = await runDuePulses(stubConfig(loud.url), { cwd: cwd2, now: NOW });
    assert.equal(results[0].action, "surfaced");
    assert.match(results[0].text ?? "", /3 failures/);
  } finally {
    loud.close();
  }
});

test("daily budget kill-switch pauses the pulse with a visible reason; resume clears it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pulse-budget-"));
  await writeChecklist(cwd, "- anything");
  const llm = await startStubLlm("findings ".repeat(50));
  try {
    const pulse = await addPulse({ cron: "* * * * *", maxTokensPerDay: 50 }, cwd);
    const first = await runDuePulses(stubConfig(llm.url), { cwd, now: NOW });
    assert.equal(first[0].action, "surfaced", "first run fits the budget");
    const second = await runDuePulses(stubConfig(llm.url), { cwd, now: new Date(NOW.getTime() + 60_000) });
    assert.equal(second[0].action, "skipped_budget");
    assert.match(second[0].detail ?? "", /budget exhausted/);
    assert.equal(llm.calls(), 1, "no model call after the kill-switch");
    const paused = (await listPulses(cwd))[0];
    assert.ok(paused.pausedReason);
    await resumePulse(pulse.id, cwd);
    assert.equal((await listPulses(cwd))[0].pausedReason, undefined);
  } finally {
    llm.close();
  }
});

test("task pulses skip preflight checklist requirements and not-due crons are skipped", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pulse-task-"));
  const llm = await startStubLlm("Daily digest: nothing notable.");
  try {
    await addPulse({ cron: "0 9 * * *", kind: "task", prompt: "Summarize open work." }, cwd);
    await addPulse({ cron: "0 23 * * *", kind: "task", prompt: "never due now" }, cwd);
    const results = await runDuePulses(stubConfig(llm.url), { cwd, now: NOW });
    assert.equal(results[0].action, "surfaced");
    assert.equal(results[1].action, "skipped_not_due");
    assert.equal(llm.calls(), 1);
  } finally {
    llm.close();
  }
});

test("addPulse validates cron and task pulses require prompts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-pulse-validate-"));
  await assert.rejects(() => addPulse({ cron: "bad" }, cwd), /5 fields/);
  await assert.rejects(() => addPulse({ cron: "* * * * *", kind: "task" }, cwd), /need a prompt/);
});

test("missing pulses.json yields no pulses; a corrupt one throws instead of silently disabling pulses", async () => {
  const missingCwd = await mkdtemp(join(tmpdir(), "muster-pulse-missing-"));
  assert.deepEqual(await listPulses(missingCwd), []);

  const corruptCwd = await mkdtemp(join(tmpdir(), "muster-pulse-corrupt-"));
  const path = pulsesPath(corruptCwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "not json at all");
  await assert.rejects(() => listPulses(corruptCwd), /Corrupt JSON/);
});
