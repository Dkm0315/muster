import assert from "node:assert/strict";
import { test } from "node:test";
import { adjudicateFeedback } from "../src/index.js";
import type { EpisodeRecord } from "../src/index.js";

const episode: EpisodeRecord = {
  id: "episode-1",
  createdAt: "2026-06-06T00:00:00.000Z",
  cwd: "/tmp/hybrowclaw",
  prompt: "Show pending invoices",
  taskKind: "simple_qa",
  runtimeId: "native",
  providerId: "local",
  model: "llama3.1",
  responseText: "There are 7 pending invoices.",
  evidence: [
    {
      kind: "tool_result",
      label: "database query",
      status: "passed",
      detail: "Frappe returned 7 rows"
    }
  ],
  outcome: { kind: "completed" }
};

test("useful and correct feedback becomes verified success", () => {
  const record = adjudicateFeedback(
    {
      episodeId: episode.id,
      value: "useful",
      correctAndWorked: true
    },
    episode
  );

  assert.equal(record.adjudication, "verified_success");
  assert.equal(record.learningCandidates[0]?.kind, "eval");
  assert.equal(record.learningCandidates[0]?.autoApply, true);
});

test("negative feedback against passing evidence is a disagreement episode", () => {
  const record = adjudicateFeedback(
    {
      episodeId: episode.id,
      value: "not_useful",
      reason: "wrong data"
    },
    episode
  );

  assert.equal(record.adjudication, "user_disputed_evidence_correct");
  assert.equal(record.learningCandidates[0]?.autoApply, false);
});

test("intent mismatch is routed to prompt or routing candidate", () => {
  const record = adjudicateFeedback(
    {
      episodeId: episode.id,
      value: "not_useful",
      reason: "not what I asked, I expected overdue invoices only"
    },
    episode
  );

  assert.equal(record.adjudication, "intent_mismatch");
  assert.equal(record.learningCandidates[0]?.kind, "prompt_or_routing");
});
