import type { EpisodeRecord, FeedbackInput, FeedbackRecord, LearningCandidate } from "./types.js";

export function adjudicateFeedback(input: FeedbackInput, episode: EpisodeRecord): FeedbackRecord {
  const reason = input.reason?.toLowerCase() ?? "";
  const evidencePassed = episode.evidence.some((item) => item.status === "passed");
  const evidenceFailed = episode.evidence.some((item) => item.status === "failed");
  const responseEmpty = episode.responseText.trim().length === 0;
  const candidates: LearningCandidate[] = [];

  let adjudication: FeedbackRecord["adjudication"];
  if (input.value === "useful" && input.correctAndWorked) {
    adjudication = "verified_success";
    candidates.push({
      kind: "eval",
      risk: "low",
      summary: "Seed a regression eval from a user-confirmed successful episode.",
      autoApply: true
    });
  } else if (responseEmpty || evidenceFailed || /\b(error|failed|broken|crash|wrong data)\b/.test(reason)) {
    adjudication = evidencePassed ? "user_disputed_evidence_correct" : "verified_failure";
    candidates.push({
      kind: "eval",
      risk: "medium",
      summary: "Create a failure replay case to verify future behavior against this episode.",
      autoApply: false
    });
  } else if (input.value === "not_useful" && /\b(intent|wanted|expected|not what i asked)\b/.test(reason)) {
    adjudication = "intent_mismatch";
    candidates.push({
      kind: "prompt_or_routing",
      risk: "medium",
      summary: "Review routing/context selection because the answer may be factually valid but misaligned.",
      autoApply: false
    });
  } else if (input.value === "not_useful" && /\b(vague|unclear|wording|explain)\b/.test(reason)) {
    adjudication = "poor_explanation";
    candidates.push({
      kind: "prompt_or_routing",
      risk: "low",
      summary: "Improve answer style guidance for this task class.",
      autoApply: true
    });
  } else if (input.value === "useful") {
    adjudication = evidencePassed ? "verified_success" : "insufficient_evidence";
    candidates.push({
      kind: "memory",
      risk: "low",
      summary: "Consider a low-risk preference memory if this pattern repeats.",
      autoApply: false
    });
  } else {
    adjudication = "insufficient_evidence";
    candidates.push({
      kind: "eval",
      risk: "medium",
      summary: "Keep as ambiguous feedback until more outcome evidence is available.",
      autoApply: false
    });
  }

  return {
    ...input,
    createdAt: new Date().toISOString(),
    adjudication,
    learningCandidates: candidates
  };
}
