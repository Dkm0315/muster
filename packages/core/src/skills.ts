import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { musterRoot } from "./profiles.js";
import { estimateTokens } from "./tokens.js";
import type { EvolveReport } from "./evolve.js";

/**
 * Eval-gated skill loop. The substrate is Hermes's proven design (SKILL.md
 * files, agentskills.io frontmatter, telemetry sidecar, curator GC, top-K
 * injection); the two structural fixes are Muster's:
 *  1. skills are born as CANDIDATES in quarantine and become active ONLY
 *     through a converged evolve report (upstream #25833: no correctness
 *     mechanism — the agent was author, executor, and inspector of itself);
 *  2. injection is top-K under a hard token budget with dropped skills
 *     reported, never inject-all (upstream #22620: 10-15K tokens per call).
 */

export type SkillStatus = "candidate" | "active" | "stale" | "archived";

export interface SkillRecord {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly tags: string[];
  readonly status: SkillStatus;
  readonly provenance: { readonly createdBy: "agent" | "user"; readonly sourceRunId?: string; readonly createdAt: string };
  readonly gate?: { readonly passedAt: string; readonly suiteTasks: number };
  readonly body: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function skillsDir(cwd = process.cwd()): string {
  return join(musterRoot(cwd), "skills");
}

function skillPath(name: string, status: SkillStatus, cwd: string): string {
  return join(skillsDir(cwd), status === "candidate" ? ".candidates" : ".", name, "SKILL.md");
}

function serialize(skill: SkillRecord): string {
  const meta = {
    version: skill.version,
    tags: skill.tags,
    status: skill.status,
    provenance: skill.provenance,
    ...(skill.gate ? { gate: skill.gate } : {}),
  };
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\nmetadata:\n  muster: ${JSON.stringify(meta)}\n---\n\n${skill.body}\n`;
}

function parse(raw: string): SkillRecord {
  const match = raw.match(/^---\nname: (.+)\ndescription: (.+)\nmetadata:\n {2}muster: (.+)\n---\n\n([\s\S]*)$/);
  if (!match) throw new Error("Malformed SKILL.md");
  const meta = JSON.parse(match[3]);
  return {
    name: match[1].trim(),
    description: match[2].trim(),
    version: meta.version ?? "0.1.0",
    tags: meta.tags ?? [],
    status: meta.status ?? "active",
    provenance: meta.provenance ?? { createdBy: "user", createdAt: new Date().toISOString() },
    gate: meta.gate,
    body: match[4],
  };
}

async function writeSkill(skill: SkillRecord, cwd: string): Promise<string> {
  const path = skillPath(skill.name, skill.status, cwd);
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, serialize(skill));
  await rename(temp, path);
  return path;
}

export async function writeCandidateSkill(
  input: { name: string; description: string; body: string; tags?: string[]; createdBy?: "agent" | "user"; sourceRunId?: string },
  cwd = process.cwd(),
): Promise<SkillRecord> {
  if (!NAME_PATTERN.test(input.name)) throw new Error(`Invalid skill name "${input.name}" (lowercase, digits, ._- only).`);
  if (input.body.length > 100_000) throw new Error("SKILL.md body exceeds 100K chars.");
  const skill: SkillRecord = {
    name: input.name,
    description: input.description.trim(),
    version: "0.1.0",
    tags: input.tags ?? [],
    status: "candidate",
    provenance: { createdBy: input.createdBy ?? "agent", sourceRunId: input.sourceRunId, createdAt: new Date().toISOString() },
    body: input.body,
  };
  await writeSkill(skill, cwd);
  return skill;
}

export async function listSkills(cwd = process.cwd(), statuses?: SkillStatus[]): Promise<SkillRecord[]> {
  const skills: SkillRecord[] = [];
  for (const base of [skillsDir(cwd), join(skillsDir(cwd), ".candidates")]) {
    let entries: { name: string; isDirectory(): boolean }[] = [];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        skills.push(parse(await readFile(join(base, entry.name, "SKILL.md"), "utf8")));
      } catch {
        // unreadable skill folders are skipped, never fatal
      }
    }
  }
  return statuses ? skills.filter((skill) => statuses.includes(skill.status)) : skills;
}

export async function viewSkill(name: string, cwd = process.cwd()): Promise<SkillRecord> {
  const all = await listSkills(cwd);
  const skill = all.find((entry) => entry.name === name);
  if (!skill) throw new Error(`Skill not found: ${name}`);
  return skill;
}

/**
 * THE GATE: a candidate becomes active only with a converged evolve report.
 * No report, no convergence, no promotion — closing upstream #25833.
 */
export async function promoteSkill(name: string, evalReport: EvolveReport, cwd = process.cwd()): Promise<SkillRecord> {
  const skill = await viewSkill(name, cwd);
  if (skill.status !== "candidate") throw new Error(`Only candidates can be promoted; "${name}" is ${skill.status}.`);
  if (!evalReport.converged) {
    throw new Error(`Promotion refused: eval suite did not converge. Fix the skill and re-run the suite.`);
  }
  const suiteTasks = evalReport.iterations[0]?.results.length ?? 0;
  if (suiteTasks === 0) throw new Error("Promotion refused: eval report contains no tasks — an empty suite is not evidence.");
  const promoted: SkillRecord = {
    ...skill,
    status: "active",
    gate: { passedAt: new Date().toISOString(), suiteTasks },
  };
  await writeSkill(promoted, cwd);
  const { rm } = await import("node:fs/promises");
  await rm(join(skillsDir(cwd), ".candidates", name), { recursive: true, force: true });
  return promoted;
}

export interface SkillSelection {
  readonly block: string;
  readonly included: string[];
  readonly dropped: string[];
}

/** Top-K budgeted injection — never inject-all, never silently drop. */
export async function selectSkills(task: string, budgetTokens = 500, cwd = process.cwd()): Promise<SkillSelection> {
  const active = await listSkills(cwd, ["active"]);
  if (!active.length) return { block: "", included: [], dropped: [] };
  const taskTokens = new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  const scored = active
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const token of taskTokens) if (haystack.includes(token)) score += 1;
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const included: string[] = [];
  const lines: string[] = [];
  let used = estimateTokens("Available skills (read with skill_view before relying on one):");
  for (const { skill } of scored) {
    const line = `- [skill:${skill.name}] ${skill.description}`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    used += cost;
    lines.push(line);
    included.push(skill.name);
  }
  const dropped = scored.map((entry) => entry.skill.name).filter((name) => !included.includes(name));
  return {
    block: lines.length ? `Available skills (read with skill_view before relying on one):\n${lines.join("\n")}` : "",
    included,
    dropped,
  };
}

/** Telemetry sidecar (never in frontmatter, mirroring upstream). */
export async function recordSkillUse(names: string[], cwd = process.cwd()): Promise<void> {
  if (!names.length) return;
  const path = join(skillsDir(cwd), ".usage.json");
  let usage: Record<string, { uses: number; lastUsedAt: string }> = {};
  try {
    usage = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // first use
  }
  for (const name of names) {
    usage[name] = { uses: (usage[name]?.uses ?? 0) + 1, lastUsedAt: new Date().toISOString() };
  }
  await mkdir(skillsDir(cwd), { recursive: true });
  await writeFile(path, JSON.stringify(usage, null, 2));
}

/** Curator: stale/archive transitions only — skills are never deleted. */
export async function curateSkills(cwd = process.cwd(), now = new Date()): Promise<{ staled: string[]; archived: string[] }> {
  const path = join(skillsDir(cwd), ".usage.json");
  let usage: Record<string, { uses: number; lastUsedAt: string }> = {};
  try {
    usage = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // no telemetry yet — nothing to curate
  }
  const staled: string[] = [];
  const archived: string[] = [];
  for (const skill of await listSkills(cwd, ["active", "stale"])) {
    const lastUsed = usage[skill.name]?.lastUsedAt ?? skill.provenance.createdAt;
    const idleDays = (now.getTime() - new Date(lastUsed).getTime()) / 86_400_000;
    if (skill.status === "active" && idleDays > 30) {
      await writeSkill({ ...skill, status: "stale" }, cwd);
      staled.push(skill.name);
    } else if (skill.status === "stale" && idleDays > 90) {
      await writeSkill({ ...skill, status: "archived" }, cwd);
      archived.push(skill.name);
    }
  }
  return { staled, archived };
}
