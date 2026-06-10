import { readFile } from "node:fs/promises";
import { episodesPath, feedbackPath } from "./store.js";
import { memoryPath } from "./memory.js";
import { tokensPath } from "./tokens.js";
import type { EpisodeRecord } from "./types.js";

export interface IntegrityIssue {
  readonly severity: "error" | "warning";
  readonly store: string;
  readonly kind: string;
  readonly detail: string;
}

export interface IntegrityReport {
  readonly checkedAt: string;
  readonly stores: Record<string, { lines: number; corrupt: number }>;
  readonly issues: IntegrityIssue[];
  readonly ok: boolean;
}

async function scanJsonl(path: string, store: string, issues: IntegrityIssue[]): Promise<{ lines: number; corrupt: number; records: unknown[] }> {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { lines: 0, corrupt: 0, records: [] };
  }
  const lines = raw.split("\n").filter(Boolean);
  const records: unknown[] = [];
  let corrupt = 0;
  for (let index = 0; index < lines.length; index += 1) {
    try {
      records.push(JSON.parse(lines[index]));
    } catch {
      corrupt += 1;
      issues.push({ severity: "error", store, kind: "corrupt_line", detail: `${store} line ${index + 1} is not valid JSON` });
    }
  }
  return { lines: lines.length, corrupt, records };
}

/**
 * Session/store integrity verification. Detects the failure classes observed
 * in other harnesses: corrupt transcript lines, duplicate run ids, silent
 * model drift (actual model differs from planned without recorded fallback
 * evidence), and stale-narrative poisoning (a failure narrative repeated
 * verbatim across consecutive episodes).
 */
export async function verifyIntegrity(cwd = process.cwd()): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const episodesScan = await scanJsonl(episodesPath(cwd), "episodes", issues);
  const feedbackScan = await scanJsonl(feedbackPath(cwd), "feedback", issues);
  const memoryScan = await scanJsonl(memoryPath(cwd), "memory", issues);
  const tokensScan = await scanJsonl(tokensPath(cwd), "tokens", issues);

  const episodes = episodesScan.records as EpisodeRecord[];
  const seenIds = new Set<string>();
  for (const episode of episodes) {
    if (seenIds.has(episode.id)) {
      issues.push({ severity: "error", store: "episodes", kind: "duplicate_run_id", detail: `Run id ${episode.id} appears more than once` });
    }
    seenIds.add(episode.id);
  }

  const tokens = tokensScan.records as Array<{ runId?: string; plannedModel?: string; model?: string }>;
  const episodeById = new Map(episodes.map((episode) => [episode.id, episode]));
  for (const record of tokens) {
    if (!record.runId || !record.plannedModel || !record.model) continue;
    if (record.plannedModel !== record.model && record.plannedModel !== "pi-default") {
      const episode = episodeById.get(record.runId);
      const hasFallbackEvidence = episode?.evidence.some((item) => item.label === "model_fallback");
      if (!hasFallbackEvidence) {
        issues.push({
          severity: "error",
          store: "tokens",
          kind: "silent_model_drift",
          detail: `Run ${record.runId} planned ${record.plannedModel} but used ${record.model} with no recorded fallback evidence`,
        });
      }
    }
  }

  const failureTexts = episodes
    .filter((episode) => episode.outcome?.kind === "failed" && episode.responseText.length > 40)
    .map((episode) => ({ id: episode.id, text: episode.responseText.trim() }));
  for (let index = 1; index < failureTexts.length; index += 1) {
    if (failureTexts[index].text === failureTexts[index - 1].text) {
      issues.push({
        severity: "warning",
        store: "episodes",
        kind: "stale_narrative",
        detail: `Episodes ${failureTexts[index - 1].id} and ${failureTexts[index].id} repeat an identical failure narrative; a poisoned session may be replaying old context`,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    stores: {
      episodes: { lines: episodesScan.lines, corrupt: episodesScan.corrupt },
      feedback: { lines: feedbackScan.lines, corrupt: feedbackScan.corrupt },
      memory: { lines: memoryScan.lines, corrupt: memoryScan.corrupt },
      tokens: { lines: tokensScan.lines, corrupt: tokensScan.corrupt },
    },
    issues,
    ok: !issues.some((issue) => issue.severity === "error"),
  };
}

export function renderIntegrityReport(report: IntegrityReport): string {
  const lines: string[] = [];
  lines.push(`integrity check at ${report.checkedAt}: ${report.ok ? "OK" : "ISSUES FOUND"}`);
  lines.push("");
  lines.push("store      lines    corrupt");
  lines.push("---------- -------- --------");
  for (const [name, stats] of Object.entries(report.stores)) {
    lines.push(`${name.padEnd(10)} ${String(stats.lines).padEnd(8)} ${String(stats.corrupt).padEnd(8)}`);
  }
  if (report.issues.length) {
    lines.push("");
    for (const issue of report.issues) {
      lines.push(`[${issue.severity}] ${issue.store}/${issue.kind}: ${issue.detail}`);
    }
  }
  return lines.join("\n");
}
