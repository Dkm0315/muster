import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendEpisode, runEvalCase, runEvalCases, seedEvalFromEpisode } from "../src/index.js";
import type { EpisodeRecord } from "../src/index.js";

const episode: EpisodeRecord = {
  id: "episode-eval-1",
  createdAt: "2026-06-06T00:00:00.000Z",
  cwd: "/tmp/hybrowclaw",
  prompt: "Summarize Redis risk",
  taskKind: "architecture",
  runtimeId: "native",
  providerId: "local",
  model: "llama3.1",
  responseText: "Redis risk is high until the patch is deployed and unsafe commands are disabled.",
  evidence: [{ kind: "system_check", label: "fixture", status: "passed", detail: "recorded response" }],
  outcome: { kind: "completed" }
};

test("seedEvalFromEpisode writes a replayable fixture", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-eval-"));
  await appendEpisode(episode, cwd);

  const fixture = await seedEvalFromEpisode(episode.id, { expectedContains: ["patch is deployed"] }, cwd);
  const results = await runEvalCases(undefined, cwd);

  assert.equal(fixture.sourceEpisodeId, episode.id);
  assert.deepEqual(fixture.expectedContains, ["patch is deployed"]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, "passed");
});

test("runEvalCase fails when expected text is missing", () => {
  const result = runEvalCase({
    schemaVersion: 1,
    id: "eval_fail",
    createdAt: "2026-06-06T00:00:00.000Z",
    sourceEpisodeId: "episode-fail",
    prompt: "Check",
    taskKind: "simple_qa",
    recordedResponseText: "The answer does not include the required phrase.",
    expectedContains: ["missing phrase"],
    evidenceLabels: []
  });

  assert.equal(result.status, "failed");
  assert.equal(result.checks[0]?.status, "failed");
});

test("runEvalCase enforces forbidden text", () => {
  const result = runEvalCase({
    schemaVersion: 1,
    id: "eval_forbidden",
    createdAt: "2026-06-06T00:00:00.000Z",
    sourceEpisodeId: "episode-forbidden",
    prompt: "Check",
    taskKind: "simple_qa",
    recordedResponseText: "Never leak customer private notes.",
    expectedContains: ["customer"],
    forbiddenContains: ["private notes"],
    evidenceLabels: []
  });

  assert.equal(result.status, "failed");
  assert.equal(result.checks.at(-1)?.label, "forbidden_absent");
});
