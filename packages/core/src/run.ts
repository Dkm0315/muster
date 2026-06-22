import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentRules } from "./agent-rules.js";
import { defaultHookBus, type HookBus } from "./hooks.js";
import { runClaudeCode } from "./claude.js";
import { runCodex } from "./codex.js";
import { canReuseHandle, clearSessionHandle, loadSessionHandle, saveSessionHandle } from "./session-handle.js";
import { renderConversation } from "./compactor.js";
import { messagesToTranscript, openSessionStore } from "./sessions.js";

/** Token budget for the provider-direct rendered transcript (bounds runaway multi-turn context). */
const DEFAULT_CONTEXT_BUDGET_TOKENS = 16_000;

/** Split a conversation key ("channel:...:peer") into the session store's (channel, peer). */
function splitConversationKey(key: string): { channel: string; peer: string } {
  const idx = key.lastIndexOf(":");
  return idx === -1 ? { channel: key, peer: "default" } : { channel: key.slice(0, idx), peer: key.slice(idx + 1) };
}
import { applySkillEnvForRun, exportClaudeSkillSnapshot, recordSkillUse, resolveAgentSkillAllowlist, selectSkills } from "./skills.js";
import { addMemory, searchMemory } from "./memory.js";
import { runPiEmbeddedAgent, type PiAgentRunResult, type PiSessionMode } from "./pi.js";
import { completeChat } from "./provider.js";
import { classifyTask, planRun } from "./router.js";
import { appendEpisode } from "./store.js";
import { synthesizeDeltas } from "./stream.js";
import { endSpan, genAiAttributes, startSpan } from "./telemetry.js";
import { appendTokenRecord, buildTokenRecord, type TokenRecord } from "./tokens.js";
import type {
  ChatMessage,
  ContextObject,
  EpisodeRecord,
  EvidenceRecord,
  MusterConfig,
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
  /**
   * Execution sandbox for native provider CLIs (codex/claude) — the profile
   * workspace, NOT the muster install root. Falls back to cwd when unset.
   */
  readonly workspaceDir?: string;
  /** CODEX_HOME for the codex runtime (carries the user's subscription auth). */
  readonly codexHome?: string;
  /** Test/advanced override for the claude-code command binary. */
  readonly claudeCommand?: string;
  /** Native provider session handle to resume (codex thread_id / claude session id). */
  readonly sessionId?: string;
  readonly resume?: boolean;
  /**
   * Conversation identity (e.g. the surface conversation id). When set, the
   * native provider session for THIS conversation is resumed across turns via
   * the session-handle store — so a multi-turn chat keeps one provider thread.
   */
  readonly conversationKey?: string;
  /** Token budget for the provider-direct multi-turn transcript. Default 16k. */
  readonly contextBudgetTokens?: number;
  readonly timeoutMs?: number;
  readonly skipMemoryWrite?: boolean;
  readonly skipAgentRules?: boolean;
  /** Hook bus for prompt.build gating; defaults to the process-wide bus. */
  readonly hooks?: HookBus;
  /** Surface label for per-surface token accounting (set by the gateway). */
  readonly surfaceId?: string;
  /** Profile/agent id used for scoped skill visibility. */
  readonly agentId?: string;
  /**
   * Optional streaming hook (packages/core/src/stream.ts). For the pi runtime
   * this receives live assistant deltas from the embedded session; for
   * claude-code/native runtimes the buffered response is chunked into
   * synthetic deltas so the same coalescer/draft pipeline runs everywhere.
   */
  readonly onDelta?: (text: string) => void;
}

export interface RunOutcome {
  readonly plan: RunPlan;
  readonly episode: EpisodeRecord;
  readonly tokens: TokenRecord;
  readonly recalled: ContextObject[];
  readonly fallbackUsed?: string;
  readonly piResult?: PiAgentRunResult;
  /** Native codex session handle to persist for resuming the next turn. */
  readonly codexThreadId?: string;
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

function planForManagedRuntime(runtimeId: "pi" | "claude-code" | "codex", options: RunOptions): RunPlan {
  const defaults = runtimeId === "pi"
    ? { provider: "pi-default", model: "pi-default" }
    : runtimeId === "codex"
      ? { provider: "codex", model: "gpt-5.5" }
      : { provider: "anthropic", model: "sonnet" };
  return {
    runId: `run_${randomUUID()}`,
    taskKind: classifyTask(options.prompt, options.taskKind),
    runtimeId,
    route: {
      provider: options.provider ?? defaults.provider,
      model: options.model ?? defaults.model,
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
  readonly codexThreadId?: string;
}

interface PromptParts {
  /** Preamble + user prompt concatenated (pi/native send this — behaviour unchanged). */
  readonly combined: string;
  /** Just the user's prompt (claude-code sends this as the user message). */
  readonly user: string;
  /** Operating rules / recalled context (claude-code sends this as the system prompt). */
  readonly system: string;
  /** Per-run Claude Code plugin dirs, currently used for temporary skill snapshots. */
  readonly claudePluginDirs?: readonly string[];
}

/**
 * A provider CLI backend: turns a route + prompt parts into an attempt result.
 * Each native-CLI runtime is ONE entry in CLI_BACKENDS below; attemptRoute
 * dispatches through the registry and never special-cases a provider, so adding
 * gemini/cursor/copilot is a single backend + registry line (acpx's adapter
 * registry idea, kept in-repo with no runtime install). Native CLIs own their
 * own sessions/compaction, so they bypass the provider-direct render path.
 */
type CliBackendRunner = (route: ModelRoute, prompts: PromptParts, options: RunOptions) => Promise<AttemptResult>;

const runClaudeCodeBackend: CliBackendRunner = async (route, prompts, options) => {
  const stateCwd = options.cwd ?? process.cwd();
  const claudeCwd = options.cwd ?? process.cwd();
  // Resume THIS conversation's claude session when the stable config (cwd+model)
  // is unchanged; otherwise pin a FRESH muster-generated id so the next turn can
  // resume it. Explicit options.sessionId (e.g. CLI) takes precedence; no
  // conversationKey means the original stateless behaviour.
  const stored = options.conversationKey && !options.sessionId
    ? await loadSessionHandle(options.conversationKey, "claude", stateCwd)
    : undefined;
  const reuse = canReuseHandle(stored, claudeCwd, route.model);
  const sessionId = options.conversationKey
    ? (reuse ? stored.handle : (options.sessionId ?? randomUUID()))
    : options.sessionId;
  const claudeResult = await runClaudeCode({
    prompt: prompts.user,
    systemPrompt: prompts.system || undefined,
    cwd: claudeCwd,
    model: route.model,
    timeoutMs: options.timeoutMs,
    command: options.claudeCommand,
    sessionId,
    resume: reuse ? true : options.resume,
    pluginDirs: prompts.claudePluginDirs,
  });
  // Persist the session for next turn on success; drop a broken one on failure.
  if (options.conversationKey && sessionId) {
    if (claudeResult.status === "completed") {
      await saveSessionHandle({
        conversationKey: options.conversationKey,
        backendId: "claude",
        handle: sessionId,
        cwd: claudeCwd,
        model: route.model,
        updatedAt: new Date().toISOString(),
      }, stateCwd);
    } else {
      await clearSessionHandle(options.conversationKey, "claude", stateCwd);
    }
  }
  const responseText = claudeResult.stdout.trim();
  if (options.onDelta && claudeResult.status === "completed") {
    for (const chunk of synthesizeDeltas(responseText)) options.onDelta(chunk);
  }
  return {
    responseText,
    status: claudeResult.status,
    errorMessage: claudeResult.status === "failed" ? (claudeResult.errorMessage || claudeResult.stderr.trim() || "claude command failed") : undefined,
    route,
  };
};

const runCodexBackend: CliBackendRunner = async (route, prompts, options) => {
  const workspaceDir = options.workspaceDir ?? options.cwd ?? process.cwd();
  const stateCwd = options.cwd ?? process.cwd();
  // muster memory/rules go to a SYSTEM-level instructions file, never the user
  // turn — so the provider's own AGENTS.md still stacks natively and rule 6 (no
  // preamble narration) holds.
  let instructionsFile: string | undefined;
  if (prompts.system.trim()) {
    instructionsFile = join(tmpdir(), `muster-codex-inject-${randomUUID()}.md`);
    await writeFile(instructionsFile, prompts.system, "utf8");
  }
  // Resume THIS conversation's native codex thread when the stable config
  // (workspace + model) is unchanged; otherwise mint a fresh one. Explicit
  // options.sessionId/resume (e.g. CLI) still take precedence.
  const stored = options.conversationKey && !options.sessionId
    ? await loadSessionHandle(options.conversationKey, "codex", stateCwd)
    : undefined;
  const reuse = canReuseHandle(stored, workspaceDir, route.model);
  try {
    const codexResult = await runCodex({
      prompt: prompts.user,
      cwd: workspaceDir,
      model: route.model,
      instructionsFile,
      networkAccess: true,
      sessionId: reuse ? stored.handle : options.sessionId,
      resume: reuse ? true : options.resume,
      env: options.codexHome ? { CODEX_HOME: options.codexHome } : undefined,
      timeoutMs: options.timeoutMs,
    });
    // Persist the thread for next turn on success; drop a broken thread on
    // failure so it is never resumed into a dead end.
    if (options.conversationKey) {
      if (codexResult.status === "completed" && codexResult.threadId) {
        await saveSessionHandle({
          conversationKey: options.conversationKey,
          backendId: "codex",
          handle: codexResult.threadId,
          cwd: workspaceDir,
          model: route.model,
          updatedAt: new Date().toISOString(),
        }, stateCwd);
      } else if (codexResult.status === "failed") {
        await clearSessionHandle(options.conversationKey, "codex", stateCwd);
      }
    }
    const responseText = codexResult.finalMessage.trim();
    if (options.onDelta && codexResult.status === "completed" && responseText) {
      for (const chunk of synthesizeDeltas(responseText)) options.onDelta(chunk);
    }
    return {
      responseText,
      status: codexResult.status,
      errorMessage: codexResult.status === "failed" ? (codexResult.errorMessage || codexResult.stderr || "codex run failed") : undefined,
      route,
      codexThreadId: codexResult.threadId,
    };
  } finally {
    if (instructionsFile) await rm(instructionsFile, { force: true }).catch(() => {});
  }
};

/** The provider-agnostic backend registry — add a CLI provider with one entry. */
const CLI_BACKENDS: Record<string, CliBackendRunner> = {
  "claude-code": runClaudeCodeBackend,
  codex: runCodexBackend,
};

export function listCliBackends(): string[] {
  return Object.keys(CLI_BACKENDS);
}

async function attemptRoute(
  config: MusterConfig,
  plan: RunPlan,
  route: ModelRoute,
  prompts: PromptParts,
  options: RunOptions,
): Promise<AttemptResult> {
  const backend = CLI_BACKENDS[plan.runtimeId];
  if (backend) return backend(route, prompts, options);
  if (plan.runtimeId === "pi") {
    const piResult = await runPiEmbeddedAgent({
      prompt: prompts.combined,
      cwd: options.cwd,
      provider: route.provider === "pi-default" ? undefined : route.provider,
      model: route.model === "pi-default" ? undefined : route.model,
      thinking: options.thinking,
      sessionMode: options.sessionMode,
      sessionDir: options.sessionDir,
      timeoutMs: options.timeoutMs,
      onDelta: options.onDelta,
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
  // Multi-turn, budgeted context for the provider-direct (API) path only: load
  // this conversation's prior turns, render them to fit the budget (stub old
  // tool results, compact if needed), and persist the new turn for next time.
  // Gated on conversationKey, so single-shot runs (CLI, no conversation) keep
  // the original flat-message behaviour. Native CLI runtimes own their own
  // sessions and never reach this branch.
  const runCwd = options.cwd ?? process.cwd();
  const store = options.conversationKey ? openSessionStore(runCwd) : undefined;
  try {
    let messages: ChatMessage[] = [{ role: "user", content: prompts.combined }];
    let sessionId: string | undefined;
    if (store && options.conversationKey) {
      const { channel, peer } = splitConversationKey(options.conversationKey);
      sessionId = store.findOrCreateSession({ channel, peer }).id;
      const prior = messagesToTranscript(store.loadActiveMessages(sessionId));
      const rendered = await renderConversation({
        system: prompts.system || undefined,
        prior,
        userPrompt: prompts.user,
        budgetTokens: options.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS,
      });
      messages = rendered.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.content }));
    }
    const text = await completeChat({ provider, route, messages });
    if (options.onDelta && text) {
      for (const chunk of synthesizeDeltas(text)) options.onDelta(chunk);
    }
    if (store && sessionId && text) {
      store.appendMessage(sessionId, "user", prompts.user);
      store.appendMessage(sessionId, "assistant", text);
    }
    return { responseText: text, status: text ? "completed" : "failed", errorMessage: text ? undefined : "Empty response", route };
  } catch (error) {
    return { responseText: "", status: "failed", errorMessage: error instanceof Error ? error.message : String(error), route };
  } finally {
    store?.close();
  }
}

export async function executeRun(config: MusterConfig, options: RunOptions): Promise<RunOutcome> {
  const cwd = options.cwd ?? process.cwd();
  const plan = options.runtime === "pi" || options.runtime === "claude-code" || options.runtime === "claude" || options.runtime === "codex"
    ? planForManagedRuntime(options.runtime === "pi" ? "pi" : options.runtime === "codex" ? "codex" : "claude-code", options)
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
  const rules = options.skipAgentRules ? undefined : await loadAgentRules(cwd);
  const skillAllowlist = resolveAgentSkillAllowlist(config, options.agentId);
  const skillDiscovery = config.skills?.load;
  const claudeSkillSnapshot = plan.runtimeId === "claude-code"
    ? await exportClaudeSkillSnapshot(cwd, { skillAllowlist, discovery: skillDiscovery })
    : undefined;
  const skills = claudeSkillSnapshot
    ? { block: "", included: [...claudeSkillSnapshot.skillNames], dropped: [], includedReceipts: [...claudeSkillSnapshot.skillReceipts] }
    : await selectSkills(options.prompt, 500, cwd, { skillAllowlist, discovery: skillDiscovery });
  if (!claudeSkillSnapshot && skills.included.length) await recordSkillUse(skills.included, cwd);
  // Profile identity is self-knowledge for the agent, written so it shapes
  // behaviour silently (rule 6) rather than being quoted back.
  const identityBlock = config.identity
    ? [
        `You are ${config.identity.name}.`,
        config.identity.description,
        config.identity.persona,
        "Treat this as self-knowledge — never quote or narrate this section.",
      ].filter(Boolean).join(" ")
    : undefined;
  const preamble = [identityBlock, rules?.text, skills.block, recalledBlock].filter(Boolean).join("\n\n");
  const assembledPrompt = preamble ? `${preamble}\n\n---\n\n${options.prompt}` : options.prompt;
  let fullPrompt = assembledPrompt;
  const hooks = options.hooks ?? defaultHookBus;
  if (hooks.count("prompt.build")) {
    const hookOutcome = await hooks.emit("prompt.build", fullPrompt);
    if (hookOutcome.action === "block") {
      throw new Error(`Run blocked by hook ${hookOutcome.blockedBy ?? "unknown"}${hookOutcome.reason ? `: ${hookOutcome.reason}` : ""}`);
    }
    fullPrompt = hookOutcome.payload;
  }
  // Route the preamble to the model's *system* prompt where the runtime supports it
  // (claude-code), so the operating rules shape behaviour instead of being narrated
  // back into the answer. If a prompt.build hook rewrote the assembled prompt we can
  // no longer separate system from user, so send it as one combined message.
  const hookRewrote = fullPrompt !== assembledPrompt;
  const prompts: PromptParts = {
    combined: fullPrompt,
    user: hookRewrote ? fullPrompt : options.prompt,
    system: hookRewrote ? "" : preamble,
    claudePluginDirs: claudeSkillSnapshot ? [claudeSkillSnapshot.pluginDir] : undefined,
  };

  const rootSpan = startSpan("muster.run", {
    kind: "internal",
    attributes: { "muster.run_id": plan.runId, "muster.task_kind": plan.taskKind, "muster.runtime": plan.runtimeId },
  });
  // Each model attempt (primary or governed fallback) gets a child span under the
  // run. Per GenAI semconv the span name is "{operation} {model}" and the kind is
  // "client" (a remote model invocation). The try/finally guarantees the span is
  // ended even if the attempt throws, so spans never leak.
  const tracedAttempt = async (route: ModelRoute): Promise<AttemptResult> => {
    const span = startSpan(`chat ${route.model}`, {
      kind: "client",
      parent: rootSpan,
      attributes: genAiAttributes({ operation: "chat", system: route.provider, requestModel: route.model }),
    });
    try {
      const result = await attemptRoute(config, plan, route, prompts, options);
      await endSpan(span, {
        status: result.status === "completed" ? "ok" : "error",
        statusMessage: result.errorMessage,
        attributes: { "gen_ai.response.model": result.route.model },
        cwd,
      });
      return result;
    } catch (error) {
      await endSpan(span, { status: "error", statusMessage: error instanceof Error ? error.message : String(error), cwd });
      throw error;
    }
  };

  const startedAt = Date.now();
  const evidence: EvidenceRecord[] = [];
  const skillEnv = await applySkillEnvForRun(skills.included, config, cwd, process.env, skillDiscovery);
  let attempt: AttemptResult;
  let fallbackUsed: string | undefined;
  try {
    attempt = await tracedAttempt(plan.route);

    if (attempt.status === "failed" && config.routing.fallbacks?.length) {
      for (const fallbackRoute of config.routing.fallbacks) {
        evidence.push({
          kind: "system_check",
          label: "model_fallback",
          status: "observed",
          detail: `Primary route ${plan.route.provider}/${plan.route.model} failed (${attempt.errorMessage ?? "unknown"}). Governed fallback to ${fallbackRoute.provider}/${fallbackRoute.model}.`,
        });
        const fallbackAttempt = await tracedAttempt(fallbackRoute);
        if (fallbackAttempt.status === "completed") {
          attempt = fallbackAttempt;
          fallbackUsed = `${fallbackRoute.provider}/${fallbackRoute.model}`;
          break;
        }
        attempt = fallbackAttempt;
      }
    }
  } finally {
    skillEnv.restore();
    await claudeSkillSnapshot?.cleanup();
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
    surfaceId: options.surfaceId,
    skills: skills.includedReceipts.length ? skills.includedReceipts : undefined,
  });
  await appendTokenRecord(tokens, cwd);

  await endSpan(rootSpan, {
    status: attempt.status === "completed" ? "ok" : "error",
    statusMessage: attempt.errorMessage,
    attributes: attempt.status === "completed"
      ? { "gen_ai.usage.input_tokens": tokens.inputTokens, "gen_ai.usage.output_tokens": tokens.outputTokens }
      : undefined,
    cwd,
  });

  if (attempt.status === "completed" && attempt.responseText && !options.skipMemoryWrite) {
    await addMemory({
      kind: "episode_summary",
      summary: `${plan.taskKind}: ${options.prompt.slice(0, 100)} -> ${attempt.responseText.slice(0, 200)}`,
      provenance: [`run:${plan.runId}`],
      scopes: [{ kind: "session", id: plan.runId }, ...scopes.filter((scope) => scope.kind !== "global")],
      confidence: 0.6,
    }, cwd);
  }

  return { plan, episode, tokens, recalled, fallbackUsed, piResult: attempt.piResult, codexThreadId: attempt.codexThreadId };
}
