import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeRun } from "./run.js";
import { addSchedule, type ScheduleJob } from "./scheduler.js";
import { dataDir } from "./store.js";
import { estimateTokens } from "./tokens.js";
import type { MusterConfig, TaskKind } from "./types.js";

/**
 * hc flow v1 (HC-033 slice 1): tool/agent/gate step kinds, preflight
 * validation, durable JSONL run store, budget ceilings, and resumable gates.
 * Later slices (replay/diff, eval seeding, scheduler binding, channel
 * approvals) build on these records; see docs/FLOW_ENGINE_SPEC.md.
 */

export interface ToolFlowStep {
  readonly id: string;
  readonly kind: "tool";
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly when?: string;
}

export interface AgentFlowStep {
  readonly id: string;
  readonly kind: "agent";
  readonly prompt: string;
  readonly taskKind?: TaskKind;
  readonly when?: string;
}

export interface GateFlowStep {
  readonly id: string;
  readonly kind: "gate";
  /** Reference to a prior step output, e.g. "summarize.text". The approver sees the actual value. */
  readonly show: string;
  readonly expiresHours?: number;
  readonly when?: string;
}

export type FlowStep = ToolFlowStep | AgentFlowStep | GateFlowStep;

export interface FlowDefinition {
  readonly id: string;
  readonly description?: string;
  /** Hard token ceiling across all agent steps; the run aborts cleanly past it. */
  readonly budgetTokens?: number;
  readonly steps: readonly FlowStep[];
}

/** v1 deterministic tool registry: the caller supplies tool implementations. Real tool wiring comes in a later slice. */
export type FlowToolRegistry = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

export interface FlowIssue {
  readonly stepId?: string;
  readonly message: string;
}

export interface FlowPreflightReport {
  readonly ok: boolean;
  readonly issues: readonly FlowIssue[];
}

export type FlowRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "rejected"
  | "expired"
  | "budget_exceeded";

export type FlowRunEvent =
  | { readonly type: "run_started"; readonly at: string; readonly runId: string; readonly flowId: string; readonly flow: FlowDefinition; readonly replayOf?: string }
  | { readonly type: "step_started"; readonly at: string; readonly stepId: string }
  | { readonly type: "step_completed"; readonly at: string; readonly stepId: string; readonly output: unknown; readonly tokensUsed?: number }
  | { readonly type: "step_failed"; readonly at: string; readonly stepId: string; readonly error: string }
  | { readonly type: "step_skipped"; readonly at: string; readonly stepId: string; readonly reason: string }
  | { readonly type: "gate_pending"; readonly at: string; readonly stepId: string; readonly show: unknown; readonly expiresAt?: string }
  | { readonly type: "gate_resolved"; readonly at: string; readonly stepId: string; readonly approved: boolean }
  | { readonly type: "run_finished"; readonly at: string; readonly status: Exclude<FlowRunStatus, "running" | "awaiting_approval"> };

export interface FlowRunResult {
  readonly runId: string;
  readonly flowId: string;
  readonly status: FlowRunStatus;
  readonly outputs: Record<string, unknown>;
  readonly gateId?: string;
  readonly show?: unknown;
  readonly error?: string;
}

export interface FlowRunState {
  readonly runId: string;
  readonly flowId: string;
  readonly flow: FlowDefinition;
  /** Set when this run was produced by replayFlowRun: the source run id. */
  readonly replayOf?: string;
  readonly status: FlowRunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly outputs: Record<string, unknown>;
  readonly tokensUsed: number;
  readonly events: readonly FlowRunEvent[];
  readonly pendingGate?: { readonly stepId: string; readonly show: unknown; readonly expiresAt?: string };
}

export interface RunFlowOptions {
  readonly config: MusterConfig;
  readonly registry: FlowToolRegistry;
  readonly cwd?: string;
  readonly onEvent?: (event: FlowRunEvent) => void;
}

export interface ResumeFlowOptions extends RunFlowOptions {
  readonly approve: boolean;
}

const STEP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const FLOW_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const STEP_KINDS = ["tool", "agent", "gate"] as const;

export function flowsDir(cwd = process.cwd()): string {
  return join(cwd, ".muster", "flows");
}

export function flowPath(id: string, cwd = process.cwd()): string {
  return join(flowsDir(cwd), `${id}.json`);
}

export function flowRunsDir(cwd = process.cwd()): string {
  return join(dataDir(cwd), "flows");
}

export function flowRunPath(runId: string, cwd = process.cwd()): string {
  return join(flowRunsDir(cwd), `${runId}.jsonl`);
}

// --- definition validation ---

export function validateFlow(value: unknown): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [{ message: "Flow definition must be a JSON object." }];
  }
  const flow = value as Partial<FlowDefinition> & Record<string, unknown>;
  if (typeof flow.id !== "string" || !FLOW_ID_PATTERN.test(flow.id)) {
    issues.push({ message: `Flow id must be lowercase letters, digits, dots, underscores, or dashes; got ${JSON.stringify(flow.id)}.` });
  }
  if (flow.description !== undefined && typeof flow.description !== "string") {
    issues.push({ message: "Flow description must be a string when present." });
  }
  if (flow.budgetTokens !== undefined && (typeof flow.budgetTokens !== "number" || !Number.isFinite(flow.budgetTokens) || flow.budgetTokens <= 0)) {
    issues.push({ message: "Flow budgetTokens must be a positive number when present." });
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    issues.push({ message: "Flow must declare a non-empty steps array." });
    return issues;
  }

  const seenIds = new Set<string>();
  const priorIds = new Set<string>();
  const allIds = new Set<string>(
    flow.steps
      .map((step) => (typeof step === "object" && step !== null ? (step as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string"),
  );
  for (const [index, rawStep] of flow.steps.entries()) {
    const label = `Step ${index + 1}`;
    if (typeof rawStep !== "object" || rawStep === null) {
      issues.push({ message: `${label}: each step must be an object.` });
      continue;
    }
    const step = rawStep as Partial<FlowStep> & Record<string, unknown>;
    const stepId = typeof step.id === "string" ? step.id : undefined;
    if (!stepId || !STEP_ID_PATTERN.test(stepId)) {
      issues.push({ message: `${label}: step id must match ${STEP_ID_PATTERN}; got ${JSON.stringify(step.id)}.` });
    } else if (seenIds.has(stepId)) {
      issues.push({ stepId, message: `Duplicate step id "${stepId}".` });
    } else {
      seenIds.add(stepId);
    }
    const name = stepId ?? label;

    if (!STEP_KINDS.includes(step.kind as never)) {
      issues.push({ stepId, message: `Step "${name}": unknown step kind ${JSON.stringify(step.kind)} (expected one of: ${STEP_KINDS.join(", ")}).` });
      if (stepId) priorIds.add(stepId);
      continue;
    }

    if (step.when !== undefined) {
      const reference = typeof step.when === "string" ? parseReference(step.when) : undefined;
      if (!reference) {
        issues.push({ stepId, message: `Step "${name}": "when" must be a "<stepId>.<field>" reference (e.g. "approve.granted"); got ${JSON.stringify(step.when)}.` });
      } else if (!priorIds.has(reference.stepId)) {
        issues.push({ stepId, message: `Step "${name}": "when" references ${allIds.has(reference.stepId) ? "a later step" : "nonexistent step"} "${reference.stepId}".` });
      }
    }

    if (step.kind === "tool") {
      if (typeof step.tool !== "string" || !step.tool.trim()) {
        issues.push({ stepId, message: `Tool step "${name}" requires a non-empty "tool" name.` });
      }
      if (step.args !== undefined && (typeof step.args !== "object" || step.args === null || Array.isArray(step.args))) {
        issues.push({ stepId, message: `Tool step "${name}": "args" must be an object when present.` });
      } else if (step.args) {
        issues.push(...validateTemplateRefs(name, stepId, JSON.stringify(step.args), priorIds, allIds));
      }
    }

    if (step.kind === "agent") {
      if (typeof step.prompt !== "string" || !step.prompt.trim()) {
        issues.push({ stepId, message: `Agent step "${name}" requires a non-empty "prompt".` });
      } else {
        issues.push(...validateTemplateRefs(name, stepId, step.prompt, priorIds, allIds));
      }
    }

    if (step.kind === "gate") {
      if (typeof step.show !== "string" || !step.show.trim()) {
        issues.push({ stepId, message: `Gate step "${name}" requires "show" referencing a prior step output (e.g. "summarize.text").` });
      } else {
        const reference = parseReference(step.show);
        if (!reference) {
          issues.push({ stepId, message: `Gate step "${name}": "show" must be a "<stepId>.<field>" reference; got ${JSON.stringify(step.show)}.` });
        } else if (!priorIds.has(reference.stepId)) {
          issues.push({ stepId, message: `Gate step "${name}": "show" references ${allIds.has(reference.stepId) ? "a later step" : "nonexistent step"} "${reference.stepId}".` });
        }
      }
      if (step.expiresHours !== undefined && (typeof step.expiresHours !== "number" || !Number.isFinite(step.expiresHours) || step.expiresHours <= 0)) {
        issues.push({ stepId, message: `Gate step "${name}": "expiresHours" must be a positive number when present.` });
      }
    }

    if (stepId) priorIds.add(stepId);
  }
  return issues;
}

function validateTemplateRefs(name: string, stepId: string | undefined, text: string, priorIds: ReadonlySet<string>, allIds: ReadonlySet<string>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  for (const reference of collectTemplateRefs(text)) {
    const parsed = parseReference(reference);
    if (!parsed) {
      issues.push({ stepId, message: `Step "${name}": template reference "{{${reference}}}" must be "<stepId>.<field.path>".` });
    } else if (!priorIds.has(parsed.stepId)) {
      issues.push({ stepId, message: `Step "${name}": template reference "{{${reference}}}" points to ${allIds.has(parsed.stepId) ? "a later step" : "unknown step"} "${parsed.stepId}".` });
    }
  }
  return issues;
}

export function parseFlow(json: string | unknown): FlowDefinition {
  let value: unknown = json;
  if (typeof json === "string") {
    try {
      value = JSON.parse(json);
    } catch (error) {
      throw new Error(`Flow definition is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const issues = validateFlow(value);
  if (issues.length) {
    throw new Error(`Invalid flow definition:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  }
  return value as FlowDefinition;
}

export function preflightFlow(flow: unknown, registry: FlowToolRegistry, config: MusterConfig): FlowPreflightReport {
  const issues = validateFlow(flow);
  if (!issues.length) {
    const definition = flow as FlowDefinition;
    for (const step of definition.steps) {
      if (step.kind === "tool" && !registry[step.tool]) {
        issues.push({ stepId: step.id, message: `Step "${step.id}": tool "${step.tool}" is not registered.` });
      }
    }
    if (definition.steps.some((step) => step.kind === "agent") && !config.runtimes[config.routing.defaultRuntime]) {
      issues.push({ message: `Flow has agent steps but the default runtime "${config.routing.defaultRuntime}" is not configured.` });
    }
  }
  return { ok: issues.length === 0, issues };
}

// --- flow definition store (.muster/flows/<id>.json) ---

export async function saveFlow(flow: FlowDefinition, cwd = process.cwd()): Promise<string> {
  parseFlow(flow);
  const target = flowPath(flow.id, cwd);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  return target;
}

export async function loadFlow(id: string, cwd = process.cwd()): Promise<FlowDefinition> {
  const raw = await readFile(flowPath(id, cwd), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`Flow not found: ${id}. Save it first with: muster flow save <file.json>`);
    throw error;
  });
  return parseFlow(raw);
}

export async function listFlows(cwd = process.cwd()): Promise<FlowDefinition[]> {
  const names = await readdir(flowsDir(cwd)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const flows: FlowDefinition[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    flows.push(parseFlow(await readFile(join(flowsDir(cwd), name), "utf8")));
  }
  return flows;
}

// --- template + reference resolution ---

function parseReference(reference: string): { stepId: string; path: string[] } | undefined {
  const segments = reference.split(".");
  if (segments.length < 2 || segments.some((segment) => !segment.trim())) return undefined;
  if (!STEP_ID_PATTERN.test(segments[0])) return undefined;
  return { stepId: segments[0], path: segments.slice(1) };
}

function collectTemplateRefs(text: string): string[] {
  return [...text.matchAll(TEMPLATE_PATTERN)].map((match) => match[1]);
}

function lookupReference(reference: string, outputs: Record<string, unknown>): unknown {
  const parsed = parseReference(reference);
  if (!parsed) throw new Error(`Invalid reference "${reference}" (expected "<stepId>.<field.path>").`);
  if (!(parsed.stepId in outputs)) throw new Error(`Reference "${reference}": no output recorded for step "${parsed.stepId}".`);
  let current: unknown = outputs[parsed.stepId];
  for (const segment of parsed.path) {
    if (typeof current !== "object" || current === null || !(segment in (current as Record<string, unknown>))) {
      throw new Error(`Reference "${reference}": field "${segment}" not found in output of step "${parsed.stepId}".`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function renderValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function resolveTemplates(value: unknown, outputs: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
    if (exact) return lookupReference(exact[1], outputs);
    return value.replace(TEMPLATE_PATTERN, (_match, reference: string) => renderValue(lookupReference(reference, outputs)));
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, outputs));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveTemplates(item, outputs)]));
  }
  return value;
}

// --- durable run store (.muster/data/flows/<runId>.jsonl, append-only) ---

async function appendEvent(runId: string, event: FlowRunEvent, cwd: string, onEvent?: (event: FlowRunEvent) => void): Promise<void> {
  const path = flowRunPath(runId, cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  onEvent?.(event);
}

export async function getFlowRun(runId: string, cwd = process.cwd()): Promise<FlowRunState> {
  const raw = await readFile(flowRunPath(runId, cwd), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error(`Flow run not found: ${runId}`);
    throw error;
  });
  const events: FlowRunEvent[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as FlowRunEvent);
    } catch (error) {
      throw new Error(`Invalid JSONL in flow run ${runId} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const started = events.find((event): event is Extract<FlowRunEvent, { type: "run_started" }> => event.type === "run_started");
  if (!started) throw new Error(`Flow run ${runId} is missing its run_started record.`);

  const outputs: Record<string, unknown> = {};
  let tokensUsed = 0;
  let status: FlowRunStatus = "running";
  let pendingGate: FlowRunState["pendingGate"];
  for (const event of events) {
    if (event.type === "step_completed") {
      outputs[event.stepId] = event.output;
      tokensUsed += event.tokensUsed ?? 0;
    }
    if (event.type === "gate_pending") {
      pendingGate = { stepId: event.stepId, show: event.show, expiresAt: event.expiresAt };
      status = "awaiting_approval";
    }
    if (event.type === "gate_resolved") {
      if (event.approved) outputs[event.stepId] = { granted: true };
      pendingGate = undefined;
      status = "running";
    }
    if (event.type === "run_finished") {
      status = event.status;
      pendingGate = undefined;
    }
  }
  return {
    runId,
    flowId: started.flowId,
    flow: started.flow,
    replayOf: started.replayOf,
    status,
    startedAt: started.at,
    updatedAt: events[events.length - 1].at,
    outputs,
    tokensUsed,
    events,
    pendingGate,
  };
}

export async function listFlowRuns(cwd = process.cwd()): Promise<FlowRunState[]> {
  const names = await readdir(flowRunsDir(cwd)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const runs: FlowRunState[] = [];
  for (const name of names.filter((item) => item.endsWith(".jsonl"))) {
    runs.push(await getFlowRun(name.slice(0, -".jsonl".length), cwd));
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// --- execution ---

interface ExecutionContext {
  readonly runId: string;
  readonly flow: FlowDefinition;
  readonly config: MusterConfig;
  readonly registry: FlowToolRegistry;
  readonly cwd: string;
  readonly onEvent?: (event: FlowRunEvent) => void;
  readonly outputs: Record<string, unknown>;
  /** Set when this execution replays a prior run deterministically. */
  readonly replay?: { readonly source: FlowRunState; readonly liveAgents: boolean };
  tokensUsed: number;
}

function now(): string {
  return new Date().toISOString();
}

async function finishRun(context: ExecutionContext, status: Exclude<FlowRunStatus, "running" | "awaiting_approval">, error?: string): Promise<FlowRunResult> {
  await appendEvent(context.runId, { type: "run_finished", at: now(), status }, context.cwd, context.onEvent);
  return { runId: context.runId, flowId: context.flow.id, status, outputs: context.outputs, error };
}

async function failStep(context: ExecutionContext, stepId: string, error: string): Promise<FlowRunResult> {
  await appendEvent(context.runId, { type: "step_failed", at: now(), stepId, error }, context.cwd, context.onEvent);
  return finishRun(context, "failed", error);
}

async function executeSteps(context: ExecutionContext, fromIndex: number): Promise<FlowRunResult> {
  const { flow, runId, cwd, onEvent } = context;
  for (let index = fromIndex; index < flow.steps.length; index += 1) {
    const step = flow.steps[index];

    if (step.when) {
      let granted = false;
      try {
        granted = Boolean(lookupReference(step.when, context.outputs));
      } catch {
        granted = false; // missing output (e.g. upstream step skipped) means the condition is not met
      }
      if (!granted) {
        await appendEvent(runId, { type: "step_skipped", at: now(), stepId: step.id, reason: `when "${step.when}" is not truthy` }, cwd, onEvent);
        continue;
      }
    }

    if (step.kind === "gate") {
      let show: unknown;
      try {
        show = lookupReference(step.show, context.outputs);
      } catch (error) {
        return failStep(context, step.id, error instanceof Error ? error.message : String(error));
      }
      if (context.replay) {
        // Replays never wait for a human: reuse the recorded gate decision.
        const recorded = context.replay.source.events.find(
          (event): event is Extract<FlowRunEvent, { type: "gate_resolved" }> => event.type === "gate_resolved" && event.stepId === step.id,
        );
        if (!recorded) {
          return failStep(context, step.id, `Replay source run ${context.replay.source.runId} never resolved gate "${step.id}"; nothing deterministic to replay.`);
        }
        await appendEvent(runId, { type: "gate_resolved", at: now(), stepId: step.id, approved: recorded.approved }, cwd, onEvent);
        if (!recorded.approved) return finishRun(context, "rejected", `Gate "${step.id}" was rejected in the source run.`);
        context.outputs[step.id] = { granted: true };
        continue;
      }
      const expiresAt = step.expiresHours !== undefined ? new Date(Date.now() + step.expiresHours * 3_600_000).toISOString() : undefined;
      await appendEvent(runId, { type: "gate_pending", at: now(), stepId: step.id, show, expiresAt }, cwd, onEvent);
      return { runId, flowId: flow.id, status: "awaiting_approval", outputs: context.outputs, gateId: step.id, show };
    }

    if (step.kind === "tool") {
      let args: Record<string, unknown>;
      try {
        args = resolveTemplates(step.args ?? {}, context.outputs) as Record<string, unknown>;
      } catch (error) {
        return failStep(context, step.id, error instanceof Error ? error.message : String(error));
      }
      const tool = context.registry[step.tool];
      if (!tool) return failStep(context, step.id, `Tool "${step.tool}" is not registered.`);
      await appendEvent(runId, { type: "step_started", at: now(), stepId: step.id }, cwd, onEvent);
      try {
        const output = await tool(args);
        context.outputs[step.id] = output;
        await appendEvent(runId, { type: "step_completed", at: now(), stepId: step.id, output }, cwd, onEvent);
      } catch (error) {
        return failStep(context, step.id, error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    // agent step
    if (context.replay && !context.replay.liveAgents) {
      // Deterministic replay: agent steps reuse the recorded output instead of hitting a model.
      if (!(step.id in context.replay.source.outputs)) {
        return failStep(context, step.id, `Replay source run ${context.replay.source.runId} has no recorded output for agent step "${step.id}"; replay with { liveAgents: true } to re-execute it.`);
      }
      const recordedOutput = context.replay.source.outputs[step.id];
      await appendEvent(runId, { type: "step_started", at: now(), stepId: step.id }, cwd, onEvent);
      context.outputs[step.id] = recordedOutput;
      await appendEvent(runId, { type: "step_completed", at: now(), stepId: step.id, output: recordedOutput }, cwd, onEvent);
      continue;
    }
    let prompt: string;
    try {
      prompt = String(resolveTemplates(step.prompt, context.outputs));
    } catch (error) {
      return failStep(context, step.id, error instanceof Error ? error.message : String(error));
    }
    const budget = flow.budgetTokens;
    const promptEstimate = estimateTokens(prompt);
    if (budget !== undefined && context.tokensUsed + promptEstimate > budget) {
      return finishRun(context, "budget_exceeded", `Step "${step.id}" would exceed budget: ${context.tokensUsed} used + ~${promptEstimate} prompt tokens > ${budget}.`);
    }
    await appendEvent(runId, { type: "step_started", at: now(), stepId: step.id }, cwd, onEvent);
    try {
      const outcome = await executeRun(context.config, { prompt, cwd, taskKind: step.taskKind, skipMemoryWrite: true });
      const stepTokens = outcome.tokens.inputTokens + outcome.tokens.outputTokens;
      context.tokensUsed += stepTokens;
      if (outcome.episode.outcome?.kind !== "completed") {
        return failStep(context, step.id, outcome.episode.outcome?.detail ?? "agent run failed");
      }
      const output = { text: outcome.episode.responseText, runId: outcome.plan.runId };
      context.outputs[step.id] = output;
      await appendEvent(runId, { type: "step_completed", at: now(), stepId: step.id, output, tokensUsed: stepTokens }, cwd, onEvent);
      if (budget !== undefined && context.tokensUsed > budget) {
        return finishRun(context, "budget_exceeded", `Cumulative ~${context.tokensUsed} tokens exceeded budget of ${budget} after step "${step.id}".`);
      }
    } catch (error) {
      return failStep(context, step.id, error instanceof Error ? error.message : String(error));
    }
  }
  return finishRun(context, "completed");
}

export async function runFlow(flow: FlowDefinition, options: RunFlowOptions): Promise<FlowRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const preflight = preflightFlow(flow, options.registry, options.config);
  if (!preflight.ok) {
    throw new Error(`Flow preflight failed:\n${preflight.issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  }
  const runId = `flowrun_${randomUUID().slice(0, 8)}`;
  const context: ExecutionContext = {
    runId,
    flow,
    config: options.config,
    registry: options.registry,
    cwd,
    onEvent: options.onEvent,
    outputs: {},
    tokensUsed: 0,
  };
  await appendEvent(runId, { type: "run_started", at: now(), runId, flowId: flow.id, flow }, cwd, options.onEvent);
  return executeSteps(context, 0);
}

export async function resumeFlow(runId: string, options: ResumeFlowOptions): Promise<FlowRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const state = await getFlowRun(runId, cwd);
  if (state.status !== "awaiting_approval" || !state.pendingGate) {
    throw new Error(`Flow run ${runId} has no pending gate (status: ${state.status}).`);
  }
  const gate = state.pendingGate;
  const context: ExecutionContext = {
    runId,
    flow: state.flow,
    config: options.config,
    registry: options.registry,
    cwd,
    onEvent: options.onEvent,
    outputs: { ...state.outputs },
    tokensUsed: state.tokensUsed,
  };
  if (gate.expiresAt && new Date(gate.expiresAt).getTime() < Date.now()) {
    return finishRun(context, "expired", `Gate "${gate.stepId}" expired at ${gate.expiresAt}.`);
  }
  await appendEvent(runId, { type: "gate_resolved", at: now(), stepId: gate.stepId, approved: options.approve }, cwd, options.onEvent);
  if (!options.approve) {
    return finishRun(context, "rejected", `Gate "${gate.stepId}" was rejected.`);
  }
  context.outputs[gate.stepId] = { granted: true };
  const gateIndex = state.flow.steps.findIndex((step) => step.id === gate.stepId);
  if (gateIndex === -1) {
    return finishRun(context, "failed", `Pending gate "${gate.stepId}" is not present in the stored flow definition.`);
  }
  return executeSteps(context, gateIndex + 1);
}

// --- replay & diff (HC-034) ---

export interface ReplayFlowOptions extends RunFlowOptions {
  /** Re-execute agent steps against the live model instead of reusing recorded outputs. */
  readonly liveAgents?: boolean;
}

/**
 * Re-executes the flow definition recorded in a prior run. Tool steps run
 * again through the supplied registry; agent steps reuse the recorded output
 * (deterministic, token-free) unless `liveAgents` is set; gates replay the
 * recorded approve/reject decision and never pause. The new run file links
 * back to the source via `replayOf`.
 */
export async function replayFlowRun(runId: string, options: ReplayFlowOptions): Promise<FlowRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const source = await getFlowRun(runId, cwd);
  const liveAgents = options.liveAgents === true;
  const issues = validateFlow(source.flow);
  for (const step of source.flow.steps) {
    if (step.kind === "tool" && !options.registry[step.tool]) {
      issues.push({ stepId: step.id, message: `Step "${step.id}": tool "${step.tool}" is not registered.` });
    }
  }
  if (liveAgents && source.flow.steps.some((step) => step.kind === "agent") && !options.config.runtimes[options.config.routing.defaultRuntime]) {
    issues.push({ message: `Replay with liveAgents needs the default runtime "${options.config.routing.defaultRuntime}" configured.` });
  }
  if (issues.length) {
    throw new Error(`Flow replay preflight failed:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`);
  }
  const newRunId = `flowrun_${randomUUID().slice(0, 8)}`;
  const context: ExecutionContext = {
    runId: newRunId,
    flow: source.flow,
    config: options.config,
    registry: options.registry,
    cwd,
    onEvent: options.onEvent,
    outputs: {},
    replay: { source, liveAgents },
    tokensUsed: 0,
  };
  await appendEvent(newRunId, { type: "run_started", at: now(), runId: newRunId, flowId: source.flowId, flow: source.flow, replayOf: runId }, cwd, options.onEvent);
  return executeSteps(context, 0);
}

export interface FlowRunDifference {
  /** Step id the difference belongs to, or "(flow)" for run-level fields. */
  readonly stepId: string;
  readonly field: "flowId" | "presence" | "status" | "output";
  readonly a: unknown;
  readonly b: unknown;
}

export interface FlowRunDiff {
  readonly runIdA: string;
  readonly runIdB: string;
  readonly identical: boolean;
  readonly differences: readonly FlowRunDifference[];
}

type StepOutcome = "completed" | "failed" | "skipped" | "gate_approved" | "gate_rejected" | "gate_pending" | "not_run";

function stepOutcome(state: FlowRunState, stepId: string): StepOutcome {
  let outcome: StepOutcome = "not_run";
  for (const event of state.events) {
    if (!("stepId" in event) || event.stepId !== stepId) continue;
    if (event.type === "step_completed") outcome = "completed";
    if (event.type === "step_failed") outcome = "failed";
    if (event.type === "step_skipped") outcome = "skipped";
    if (event.type === "gate_pending") outcome = "gate_pending";
    if (event.type === "gate_resolved") outcome = event.approved ? "gate_approved" : "gate_rejected";
  }
  return outcome;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Step-by-step structural diff of two flow runs: same steps, same per-step
 * outcome, structurally equal outputs. Regression detection for automations —
 * replay a run after a site/tool change and diff against the original.
 */
export async function diffFlowRuns(runIdA: string, runIdB: string, cwd = process.cwd()): Promise<FlowRunDiff> {
  const [a, b] = await Promise.all([getFlowRun(runIdA, cwd), getFlowRun(runIdB, cwd)]);
  const differences: FlowRunDifference[] = [];
  if (a.flowId !== b.flowId) differences.push({ stepId: "(flow)", field: "flowId", a: a.flowId, b: b.flowId });

  const stepIds: string[] = [];
  for (const step of a.flow.steps) stepIds.push(step.id);
  for (const step of b.flow.steps) if (!stepIds.includes(step.id)) stepIds.push(step.id);

  for (const stepId of stepIds) {
    const inA = a.flow.steps.some((step) => step.id === stepId);
    const inB = b.flow.steps.some((step) => step.id === stepId);
    if (!inA || !inB) {
      differences.push({ stepId, field: "presence", a: inA ? "present" : "absent", b: inB ? "present" : "absent" });
      continue;
    }
    const outcomeA = stepOutcome(a, stepId);
    const outcomeB = stepOutcome(b, stepId);
    if (outcomeA !== outcomeB) {
      differences.push({ stepId, field: "status", a: outcomeA, b: outcomeB });
    }
    const hasOutputA = stepId in a.outputs;
    const hasOutputB = stepId in b.outputs;
    if (hasOutputA && hasOutputB) {
      if (stableStringify(a.outputs[stepId]) !== stableStringify(b.outputs[stepId])) {
        differences.push({ stepId, field: "output", a: a.outputs[stepId], b: b.outputs[stepId] });
      }
    } else if (hasOutputA !== hasOutputB) {
      differences.push({ stepId, field: "output", a: hasOutputA ? a.outputs[stepId] : undefined, b: hasOutputB ? b.outputs[stepId] : undefined });
    }
  }
  return { runIdA, runIdB, identical: differences.length === 0, differences };
}

// --- scheduler binding (HC-035): flow loops via cron ---

/**
 * Binds a saved flow to the existing scheduler: `muster flow loop <id> --cron`.
 * The job carries `flowId`, so run-due executes runFlow instead of executeRun.
 */
export async function scheduleFlowLoop(flowId: string, cron: string, options: { cwd?: string } = {}): Promise<ScheduleJob> {
  const cwd = options.cwd ?? process.cwd();
  const flow = await loadFlow(flowId, cwd); // refuses unknown flows up front
  return addSchedule(cron, `flow-loop: run flow "${flow.id}"`, { cwd, flowId: flow.id });
}

/**
 * Run-due executor shared by the CLI: jobs with a flowId run the flow through
 * runFlow (a paused gate counts as a successful scheduled kick-off); plain
 * prompt jobs keep going through executeRun.
 */
export async function executeScheduledJob(
  job: ScheduleJob,
  options: { readonly config: MusterConfig; readonly registry: FlowToolRegistry; readonly cwd?: string },
): Promise<{ runId: string; status: "completed" | "failed" }> {
  const cwd = options.cwd ?? process.cwd();
  if (job.flowId) {
    const flow = await loadFlow(job.flowId, cwd);
    const result = await runFlow(flow, { config: options.config, registry: options.registry, cwd });
    const ok = result.status === "completed" || result.status === "awaiting_approval";
    return { runId: result.runId, status: ok ? "completed" : "failed" };
  }
  const outcome = await executeRun(options.config, { prompt: job.prompt, cwd });
  return { runId: outcome.plan.runId, status: outcome.episode.outcome?.kind === "completed" ? "completed" : "failed" };
}
