import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.js";
import type { EpisodeRecord, FeedbackRecord, HybrowClawConfig, LearningCandidate } from "./types.js";

export function dataDir(cwd = process.cwd()): string {
  return join(cwd, ".hybrowclaw", "data");
}

export function episodesPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "episodes.jsonl");
}

export function feedbackPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "feedback.jsonl");
}

export async function appendEpisode(episode: EpisodeRecord, cwd = process.cwd()): Promise<void> {
  await appendJsonLine(episodesPath(cwd), episode);
}

export async function appendFeedback(feedback: FeedbackRecord, cwd = process.cwd()): Promise<void> {
  await appendJsonLine(feedbackPath(cwd), feedback);
}

export async function listEpisodes(cwd = process.cwd()): Promise<EpisodeRecord[]> {
  return readJsonLines<EpisodeRecord>(episodesPath(cwd));
}

export async function findEpisode(id: string, cwd = process.cwd()): Promise<EpisodeRecord | undefined> {
  const episodes = await listEpisodes(cwd);
  return episodes.find((episode) => episode.id === id);
}

export async function listFeedback(cwd = process.cwd()): Promise<FeedbackRecord[]> {
  return readJsonLines<FeedbackRecord>(feedbackPath(cwd));
}

export async function listLearningCandidates(cwd = process.cwd()): Promise<Array<LearningCandidate & { episodeId: string }>> {
  const feedback = await listFeedback(cwd);
  return feedback.flatMap((record) =>
    record.learningCandidates.map((candidate) => ({
      ...candidate,
      episodeId: record.episodeId
    }))
  );
}

export interface CockpitState {
  readonly generatedAt: string;
  readonly generatedFrom: string;
  readonly source: "exported" | "fallback";
  readonly configured: boolean;
  readonly configSummary?: CockpitConfigSummary;
  readonly episodes: EpisodeRecord[];
  readonly feedback: FeedbackRecord[];
  readonly candidates: Array<LearningCandidate & { episodeId: string }>;
}

export interface CockpitConfigSummary {
  readonly version: HybrowClawConfig["version"];
  readonly defaultRuntime: string;
  readonly oneRuntimePerRun: boolean;
  readonly preferLocalForSensitive: boolean;
  readonly providers: Array<{
    readonly id: string;
    readonly kind: string;
    readonly defaultModel: string;
    readonly baseUrl?: string;
    readonly apiKeyEnv?: string;
  }>;
  readonly runtimes: Array<{
    readonly id: string;
    readonly enabled: boolean;
    readonly provider: string;
    readonly taskRoutes: string[];
  }>;
}

export async function buildCockpitState(cwd = process.cwd()): Promise<CockpitState> {
  const config = await loadConfig(cwd).catch(() => undefined);
  const episodes = await readRecentJsonLines<EpisodeRecord>(episodesPath(cwd), 25);
  const feedback = await readRecentJsonLines<FeedbackRecord>(feedbackPath(cwd), 100);
  const candidates = feedback.flatMap((record) =>
    record.learningCandidates.map((candidate) => ({
      ...candidate,
      episodeId: record.episodeId
    }))
  );
  return {
    generatedAt: new Date().toISOString(),
    generatedFrom: cwd,
    source: "exported",
    configured: Boolean(config),
    configSummary: config ? summarizeConfig(config) : undefined,
    episodes,
    feedback: feedback.slice(-50),
    candidates: candidates.slice(-100)
  };
}

function summarizeConfig(config: HybrowClawConfig): CockpitConfigSummary {
  return {
    version: config.version,
    defaultRuntime: config.routing.defaultRuntime,
    oneRuntimePerRun: config.routing.oneRuntimePerRun,
    preferLocalForSensitive: config.routing.preferLocalForSensitive,
    providers: Object.values(config.providers).map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      defaultModel: provider.defaultModel,
      baseUrl: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv
    })),
    runtimes: Object.values(config.runtimes).map((runtime) => ({
      id: runtime.id,
      enabled: runtime.enabled,
      provider: runtime.provider,
      taskRoutes: Object.keys(runtime.routes).sort()
    }))
  };
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return parseJsonLines<T>(path, raw);
}

async function readRecentJsonLines<T>(path: string, limit: number, byteWindow = 1024 * 1024): Promise<T[]> {
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!file) return [];
  try {
    const stat = await file.stat();
    const length = Math.min(stat.size, byteWindow);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, start);
    let raw = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = raw.indexOf("\n");
      raw = firstNewline === -1 ? "" : raw.slice(firstNewline + 1);
    }
    return parseJsonLines<T>(path, raw).slice(-limit);
  } finally {
    await file.close();
  }
}

function parseJsonLines<T>(path: string, raw: string): T[] {
  const values: T[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as T);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL in ${path} at line ${index + 1}: ${detail}`);
    }
  }
  return values;
}
