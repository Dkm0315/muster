import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { activeProfile, musterRoot, profilesRoot } from "./profiles.js";

/**
 * Default operating discipline injected into every run. Distilled from
 * Karpathy's agent-failure observations (no silent assumptions, no
 * over-engineering, no orthogonal changes, explicit verification) and the
 * verification-first patterns of production agent harnesses. Override per
 * project with an AGENTS.md in the workspace root, or per profile with
 * .muster/profiles/<name>/AGENTS.md.
 */
export const DEFAULT_AGENT_RULES = `Operating discipline (hard rules):
1. No silent assumptions. If a fact, file, or behavior is unverified, either verify it with a tool or state the assumption explicitly before relying on it.
2. No over-engineering. Prefer the smallest change that solves the problem. Do not introduce abstractions, options, or layers that the task does not require.
3. No orthogonal changes. Touch only what the task asks for. Do not refactor, rename, or "improve" unrelated code or content.
4. Verify before claiming. Never say something works, exists, or is fixed without evidence from this run. If you cannot verify, say "cannot verify" explicitly.
5. Report blockers exactly. When something fails, state the exact error and the smallest next step - never a vague paraphrase.`;

export interface AgentRules {
  readonly text: string;
  readonly source: "profile" | "workspace" | "default";
}

export async function loadAgentRules(cwd = process.cwd()): Promise<AgentRules> {
  const profile = activeProfile(cwd);
  const candidates: Array<{ path: string; source: AgentRules["source"] }> = [
    ...(profile !== "default" ? [{ path: join(profilesRoot(cwd), profile, "AGENTS.md"), source: "profile" as const }] : []),
    { path: join(musterRoot(cwd), "AGENTS.md"), source: "workspace" as const },
    { path: join(cwd, "AGENTS.md"), source: "workspace" as const },
  ];
  for (const candidate of candidates) {
    try {
      const text = (await readFile(candidate.path, "utf8")).trim();
      if (text) return { text, source: candidate.source };
    } catch {
      // try the next location
    }
  }
  return { text: DEFAULT_AGENT_RULES, source: "default" };
}
