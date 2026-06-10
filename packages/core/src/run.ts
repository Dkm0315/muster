import { randomUUID } from "node:crypto";
import { addMemory, searchMemory } from "./memory.js";
import { runPiEmbeddedAgent, type PiAgentRunResult, type PiSessionMode } from "./pi.js";
import { completeChat } from "./provider.js";
import { classifyTask, planRun } from "./router.js";
import { appendEpisode } from "./store.js";
import { appendTokenRecord, buildTokenRecord, type TokenRecord } from "./tokens.js";
import type {
  ContextObject,
  EpisodeRecord,
  EvidenceRecord,
  HybrowClawConfig,
  MemoryScope,
  ModelRoute,
  RunPlan,
  TaskKind,
} from "./types.js";

export interface RunOptions {
  readonly prompt: string;
  readonly runtime?: string;
  readonly taskKind?: TaskKind;
  readonly sensitive?: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  readonly sessionMode?: PiSessionMode;
  readonly sessionDir?: string;
  readonly scopes?: MemoryScope[];
  readonly recallLimit?: number;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly skipMemoryWrite?: boolean;
}

export interface RunOutcome {
  readonly plan: RunPlan;
  readonly episode: EpisodeRecord;
  readonly tokens: TokenRecord;
  readonly recalled: ContextObject[];
  readonly fallbackUsed?: string;
  readonly piResult?: PiAgentRunResult;
}

function defaultScopes(): MemoryScope[] {
  const user = process.env.USER || process.env.USERNAME || "local";
  return [{ kind: "user", id: user }];
}

function promptTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function recallScore(prompt: Set<string>, summary: string): number {
  if (!prompt.size) return 0;
  const summaryTokens = promptTokens(summary);
  let hits = 0;
  for (const token of prompt) {
    for (const candidate of summaryTokens) {
      if (candidate === token || candidate.startsWith(token) || token.startsWith(candidate)) {
        hits += 1;
        break;
      }
    }
  }
  return hits / prompt.size;
}

export async function recallMemory(prompt: string, scopes: MemoryScope[], limit: number, cwd: string): Promise<ContextObject[]> {
  const visible = await searchMemory({ scopes, includeGlobal: true }, cwd);
  const tokens = promptTokens(prompt);
  return visible
    .map((object) => ({ object, score: recallScore(tokens, object.summary) }))
    .filter((entry) => entry.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.object);
}

export function buildRecalledBlock(recalled: readonly ContextObject[]): string {
  if (!recalled.length) return "";
  const lines = recalled.map((object) => `- [${object.kind}] ${object.summary}`);
  return `Recalled context (scoped memory, provenance-tracked; verify before relying on it):\n${lines.join("\n")}`;
}

function planForPi(options: RunOptions): RunPlan {
  return {
    runId: `run_${randomUUID()}`,
    taskKind: classifyTask(options.prompt, options.taskKind),
    runtimeId: "pi",
    route: {
      provider: options.provider ?? "pi-default",
      model: options.model ?? "pi-default",
    },
    sensitive: options.sensitive ?? false,
    createdAt: new Date().toISOString(),
  };
}

interface AttemptResult {
  readonly responseText: string;
  readonly status: "completed" | "failed";
  readonly errorMessage?: string;
  readonly route: ModelRoute;
  readonly piResult?: PiAgentRunResult;
}

async function attemptRoute(
  config: HybrowClawConfig,
  plan: RunPlan,
  route: ModelRoute,
  fullPrompt: string,
  options: RunOptions,
): Promise<AttemptResult> {
  if (plan.runtimeId === "pi") {
    const piResult = await runPiEmbeddedAgent({
      prompt: fullPrompt,
      cwd: options.cwd,
      provider: route.provider === "pi-default" ? undefined : route.provider,
      model: route.model === "pi-default" ? undefined : route.model,
      thinking: options.thinking,
      sessionMode: options.sessionMode,
      sessionDir: options.sessionDir,
      timeoutMs: options.timeoutMs,
    });
    return {
      responseText: piResult.stdout.trim(),
      status: piResult.status,
      errorMessage: piResult.errorMessage,
      route,
      piResult,
    };
  }
  const provider = config.providers[route.provider];
  if (!provider) {
    return { responseText: "", status: "failed", errorMessage: `Provider not configured: ${route.provider}`, route };
  }
  try {
    const text = await completeChat({ provider, route, messages: [{ role: "user", content: fullPrompt }] });
    return { responseText: text, status: text ? "completed" : "failed", errorMessage: text ? undefined : "Empty response", route };
  } catch (error) {
    return { responseText: "", status: "failed", errorMessage: error instanceof Error ? error.message : String(error), route };
  }
}

export async function executeRun(config: HybrowClawConfig, options: RunOptions): Promise<RunOutcome> {
  const cwd = options.cwd ?? process.cwd();
  const plan = options.runtime === "pi"
    ? planForPi(options)
    : planRun(config, {
        prompt: options.prompt,
        runtime: options.runtime,
        taskKind: options.taskKind,
        sensitive: options.sensitive,
        cwd,
      });

  const scopes = options.scopes ?? defaultScopes();
  const recalled = await recallMemory(options.prompt, scopes, options.recallLimit ?? 5, cwd);
  const recalledBlock = buildRecalledBlock(recalled);
  const fullPrompt = recalledBlock ? `${recalledBlock}\n\n---\n\n${options.prompt}` : options.prompt;

  const startedAt = Date.now();
  const evidence: EvidenceRecord[] = [];
  let attempt = await attemptRoute(config, plan, plan.route, fullPrompt, options);
  let fallbackUsed: string | undefined;

  if (attempt.status === "failed" && config.routing.fallbacks?.length) {
    for (const fallbackRoute of config.routing.fallbacks) {
      evidence.push({
        kind: "system_check",
        label: "model_fallback",
        status: "observed",
        detail: `Primary route ${plan.route.provider}/${plan.route.model} failed (${attempt.errorMessage ?? "unknown"}). Governed fallback to ${fallbackRoute.provider}/${fallbackRoute.model}.`,
      });
      const fallbackAttempt = await attemptRoute(config, plan, fallbackRoute, fullPrompt, options);
      if (fallbackAttempt.status === "completed") {
        attempt = fallbackAttempt;
        fallbackUsed = `${fallbackRoute.provider}/${fallbackRoute.model}`;
        break;
      }
      attempt = fallbackAttempt;
    }
  }

  const durationMs = Date.now() - startedAt;

  if (attempt.piResult?.eventTrace) {
    for (const trace of attempt.piResult.eventTrace) {
      if (trace.kind === "tool") {
        evidence.push({
          kind: "tool_result",
          label: trace.toolName ?? trace.type,
          status: trace.status === "failed" ? "failed" : "observed",
          detail: trace.message,
        });
      }
    }
  }
  evidence.push({
    kind: "model_response",
    label: "final_response",
    status: attempt.status === "completed" ? "observed" : "failed",
    detail: attempt.status === "completed" ? `${attempt.responseText.length} chars` : attempt.errorMessage,
  });

  const episode: EpisodeRecord = {
    id: plan.runId,
    createdAt: plan.createdAt,
    cwd,
    prompt: options.prompt,
    taskKind: plan.taskKind,
    runtimeId: plan.runtimeId,
    providerId: attempt.route.provider,
    model: attempt.route.model,
    responseText: attempt.responseText,
    evidence,
    outcome: { kind: attempt.status === "completed" ? "completed" : "failed", detail: attempt.errorMessage },
  };
  await appendEpisode(episode, cwd);

  const tokens = buildTokenRecord({
    runId: plan.runId,
    provider: attempt.route.provider,
    model: attempt.route.model,
    plannedModel: plan.route.model,
    prompt: options.prompt,
    recalledContext: recalledBlock,
    responseText: attempt.responseText,
    durationMs,
    sessionMode: options.sessionMode,
    sessionId: attempt.piResult?.sessionId,
  });
  await appendTokenRecord(tokens, cwd);

  if (attempt.status === "completed" && attempt.responseText && !options.skipMemoryWrite) {
    await addMemory({
      kind: "episode_summary",
      summary: `${plan.taskKind}: ${options.prompt.slice(0, 100)} -> ${attempt.responseText.slice(0, 200)}`,
      provenance: [`run:${plan.runId}`],
      scopes: [{ kind: "session", id: plan.runId }, ...scopes.filter((scope) => scope.kind !== "global")],
      confidence: 0.6,
    }, cwd);
  }

  return { plan, episode, tokens, recalled, fallbackUsed, piResult: attempt.piResult };
}
