import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendEpisode,
  appendFeedback,
  buildCockpitState,
  ensureDefaultConfig,
  feedbackPath,
  listLearningCandidates
} from "../src/index.js";

test("listLearningCandidates flattens persisted feedback records", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-store-"));
  await appendFeedback(
    {
      episodeId: "episode-1",
      value: "useful",
      correctAndWorked: true,
      createdAt: "2026-06-06T00:00:00.000Z",
      adjudication: "verified_success",
      learningCandidates: [
        {
          kind: "eval",
          risk: "low",
          summary: "Seed a regression eval.",
          autoApply: true
        }
      ]
    },
    cwd
  );

  const candidates = await listLearningCandidates(cwd);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.episodeId, "episode-1");
  assert.equal(candidates[0]?.kind, "eval");
  assert.equal(candidates[0]?.autoApply, true);
});

test("buildCockpitState summarizes config and recent local run state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cockpit-"));
  await ensureDefaultConfig(cwd);
  await appendEpisode(
    {
      id: "episode-1",
      createdAt: "2026-06-06T00:00:00.000Z",
      cwd,
      prompt: "Summarize the harness architecture",
      taskKind: "architecture",
      runtimeId: "native",
      providerId: "local",
      model: "gpt-5.5",
      reasoning: "high",
      responseText: "Use one runtime per run and preserve evidence.",
      evidence: [
        {
          kind: "model_response",
          label: "assistant response",
          status: "observed",
          detail: "120ms"
        }
      ],
      outcome: { kind: "completed" }
    },
    cwd
  );

  const state = await buildCockpitState(cwd);
  assert.equal(state.configured, true);
  assert.equal(state.generatedFrom, cwd);
  assert.equal(state.configSummary?.defaultRuntime, "native");
  assert.equal(state.configSummary?.providers[0]?.id, "codex");
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0]?.prompt, "Summarize the harness architecture");
});

test("buildCockpitState bounds exported learning candidates", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-cockpit-bounds-"));
  await ensureDefaultConfig(cwd);
  for (let index = 0; index < 105; index += 1) {
    await appendFeedback(
      {
        episodeId: `episode-${index}`,
        value: "useful",
        correctAndWorked: true,
        createdAt: "2026-06-06T00:00:00.000Z",
        adjudication: "verified_success",
        learningCandidates: [
          {
            kind: "eval",
            risk: "low",
            summary: `Candidate ${index}`,
            autoApply: true
          }
        ]
      },
      cwd
    );
  }

  const state = await buildCockpitState(cwd);
  assert.equal(state.candidates.length, 100);
  assert.equal(state.candidates[0]?.episodeId, "episode-5");
});

test("JSONL read errors identify the broken line", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-corrupt-jsonl-"));
  await mkdir(join(cwd, ".muster", "data"), { recursive: true });
  await appendFile(feedbackPath(cwd), "{\"episodeId\":\"ok\",\"value\":\"useful\",\"createdAt\":\"2026-06-06T00:00:00.000Z\",\"adjudication\":\"verified_success\",\"learningCandidates\":[]}\n", "utf8");
  await appendFile(feedbackPath(cwd), "{bad-json}\n", "utf8");

  await assert.rejects(() => listLearningCandidates(cwd), /line 2/);
});
