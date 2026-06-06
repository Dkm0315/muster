import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir, findEpisode } from "./store.js";
import type { EpisodeRecord, TaskKind } from "./types.js";

export interface EvalCase {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly sourceEpisodeId: string;
  readonly prompt: string;
  readonly taskKind: TaskKind;
  readonly recordedResponseText: string;
  readonly expectedContains: string[];
  readonly forbiddenContains?: string[];
  readonly evidenceLabels: string[];
}

export interface EvalRunResult {
  readonly id: string;
  readonly sourceEpisodeId: string;
  readonly status: "passed" | "failed";
  readonly checks: Array<{
    readonly label: string;
    readonly status: "passed" | "failed";
    readonly detail: string;
  }>;
}

export function evalsDir(cwd = process.cwd()): string {
  return join(dataDir(cwd), "evals");
}

export function evalPath(id: string, cwd = process.cwd()): string {
  return join(evalsDir(cwd), `${id}.json`);
}

export async function seedEvalFromEpisode(
  episodeId: string,
  options: { readonly expectedContains?: readonly string[]; readonly forbiddenContains?: readonly string[] } = {},
  cwd = process.cwd()
): Promise<EvalCase> {
  const episode = await findEpisode(episodeId, cwd);
  if (!episode) throw new Error(`Episode not found: ${episodeId}`);
  const fixture = buildEvalCase(episode, options);
  await mkdir(evalsDir(cwd), { recursive: true });
  await writeFile(evalPath(fixture.id, cwd), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return fixture;
}

export async function listEvalCases(cwd = process.cwd()): Promise<EvalCase[]> {
  const dir = evalsDir(cwd);
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const cases: EvalCase[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    cases.push(await readEvalCase(join(dir, name)));
  }
  return cases;
}

export async function runEvalCases(pathOrDir: string | undefined, cwd = process.cwd()): Promise<EvalRunResult[]> {
  if (!pathOrDir) {
    const cases = await listEvalCases(cwd);
    return cases.map(runEvalCase);
  }
  const absolute = pathOrDir.startsWith("/") ? pathOrDir : join(cwd, pathOrDir);
  if (absolute.endsWith(".json")) return [runEvalCase(await readEvalCase(absolute))];
  const names = await readdir(absolute);
  const cases = await Promise.all(names.filter((item) => item.endsWith(".json")).sort().map((name) => readEvalCase(join(absolute, name))));
  return cases.map(runEvalCase);
}

export function runEvalCase(fixture: EvalCase): EvalRunResult {
  const response = fixture.recordedResponseText.toLowerCase();
  const checks: EvalRunResult["checks"] = [];
  for (const expected of fixture.expectedContains) {
    const passed = response.includes(expected.toLowerCase());
    checks.push({
      label: "expected_contains",
      status: passed ? "passed" : "failed",
      detail: expected
    });
  }
  for (const forbidden of fixture.forbiddenContains ?? []) {
    const passed = !response.includes(forbidden.toLowerCase());
    checks.push({
      label: "forbidden_absent",
      status: passed ? "passed" : "failed",
      detail: forbidden
    });
  }
  return {
    id: fixture.id,
    sourceEpisodeId: fixture.sourceEpisodeId,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks
  };
}

function buildEvalCase(
  episode: EpisodeRecord,
  options: { readonly expectedContains?: readonly string[]; readonly forbiddenContains?: readonly string[] }
): EvalCase {
  const expectedContains = [...(options.expectedContains?.filter(Boolean) ?? [])];
  if (!expectedContains.length) {
    const derived = episode.responseText.trim().split(/\n|\./)[0]?.trim();
    if (derived) expectedContains.push(derived);
  }
  if (!expectedContains.length) throw new Error("Cannot seed eval without expected text.");
  return {
    schemaVersion: 1,
    id: safeEvalId(episode.id),
    createdAt: new Date().toISOString(),
    sourceEpisodeId: episode.id,
    prompt: episode.prompt,
    taskKind: episode.taskKind,
    recordedResponseText: episode.responseText,
    expectedContains,
    forbiddenContains: options.forbiddenContains?.filter(Boolean),
    evidenceLabels: episode.evidence.map((item) => item.label)
  };
}

async function readEvalCase(path: string): Promise<EvalCase> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as EvalCase;
  if (parsed.schemaVersion !== 1 || !parsed.id || !parsed.sourceEpisodeId || !Array.isArray(parsed.expectedContains)) {
    throw new Error(`Invalid eval fixture: ${path}`);
  }
  return parsed;
}

function safeEvalId(episodeId: string): string {
  return `eval_${episodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
