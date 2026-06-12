import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeRun } from "./run.js";
import { parseCron } from "./scheduler.js";
import { dataDir } from "./store.js";
import { listTokenRecords } from "./tokens.js";
import { musterRoot } from "./profiles.js";
import type { MusterConfig } from "./types.js";

/**
 * Pulse — heartbeat and proactive checks, re-modeled from OpenClaw's
 * HEARTBEAT.md UX without its token economics (their tickets document
 * 2M-47M tokens/day burned by full-context heartbeat polls). Three rules:
 *  1. a CHEAP deterministic preflight runs before ANY model call — no due
 *     checklist content means no API call at all;
 *  2. every pulse has a hard daily token budget; breaching it pauses the
 *     pulse with a visible reason instead of silently burning money;
 *  3. surfacing is a structured decision (quiet replies are suppressed by
 *     a deterministic check), not a magic string the model must echo.
 */

export interface Pulse {
  readonly id: string;
  readonly cron: string;
  readonly kind: "heartbeat" | "task";
  /** task kind: the prompt to run. heartbeat kind: prompt prefix before the checklist. */
  readonly prompt?: string;
  readonly maxTokensPerDay: number;
  readonly createdAt: string;
  readonly lastRunAt?: string;
  readonly pausedReason?: string;
}

export interface PulseResult {
  readonly pulse: Pulse;
  readonly action: "skipped_preflight" | "skipped_budget" | "skipped_not_due" | "quiet" | "surfaced" | "failed";
  readonly detail?: string;
  readonly text?: string;
  readonly runId?: string;
}

export function pulsesPath(cwd = process.cwd()): string {
  return join(dataDir(cwd), "pulses.json");
}

export function pulseChecklistPath(cwd = process.cwd()): string {
  return join(musterRoot(cwd), "PULSE.md");
}

async function readPulses(cwd: string): Promise<Pulse[]> {
  try {
    return JSON.parse(await readFile(pulsesPath(cwd), "utf8"));
  } catch {
    return [];
  }
}

async function writePulses(pulses: Pulse[], cwd: string): Promise<void> {
  await mkdir(dirname(pulsesPath(cwd)), { recursive: true });
  await writeFile(pulsesPath(cwd), JSON.stringify(pulses, null, 2));
}

export async function addPulse(
  input: { cron: string; kind?: "heartbeat" | "task"; prompt?: string; maxTokensPerDay?: number },
  cwd = process.cwd(),
): Promise<Pulse> {
  parseCron(input.cron);
  const kind = input.kind ?? "heartbeat";
  if (kind === "task" && !input.prompt) throw new Error("Task pulses need a prompt.");
  const pulse: Pulse = {
    id: `pulse_${randomUUID().slice(0, 8)}`,
    cron: input.cron,
    kind,
    prompt: input.prompt,
    maxTokensPerDay: input.maxTokensPerDay ?? 50_000,
    createdAt: new Date().toISOString(),
  };
  const pulses = await readPulses(cwd);
  pulses.push(pulse);
  await writePulses(pulses, cwd);
  return pulse;
}

export async function listPulses(cwd = process.cwd()): Promise<Pulse[]> {
  return readPulses(cwd);
}

export async function resumePulse(id: string, cwd = process.cwd()): Promise<void> {
  const pulses = await readPulses(cwd);
  await writePulses(pulses.map((pulse) => (pulse.id === id ? { ...pulse, pausedReason: undefined } : pulse)), cwd);
}

/** Deterministic, zero-LLM gate. Heartbeats with no due checklist content never call a model. */
export async function pulsePreflight(pulse: Pulse, cwd: string): Promise<{ due: boolean; reason: string; checklist?: string }> {
  if (pulse.kind === "task") return { due: true, reason: "task pulse is always due on its schedule" };
  let checklist = "";
  try {
    checklist = (await readFile(pulseChecklistPath(cwd), "utf8")).trim();
  } catch {
    return { due: false, reason: "no PULSE.md checklist — skipped without any API call" };
  }
  const items = checklist.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line));
  if (!items.length) return { due: false, reason: "PULSE.md has no checklist items — skipped without any API call" };
  return { due: true, reason: `${items.length} checklist item(s)`, checklist };
}

async function spentToday(pulseId: string, cwd: string, now: Date): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const records = await listTokenRecords(cwd);
  return records
    .filter((record) => record.surfaceId === `pulse:${pulseId}` && record.createdAt.startsWith(today))
    .reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0);
}

const QUIET_PATTERN = /^(ok|all clear|nothing (needs|to report)|no (issues|action needed))\b[.!]?\s*$/i;

/**
 * Run all due pulses once. No daemon: call from external cron or the CLI.
 * Surfacing decision is deterministic: short all-clear replies are quiet.
 */
export async function runDuePulses(
  config: MusterConfig,
  options: { cwd?: string; now?: Date } = {},
): Promise<PulseResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const pulses = await readPulses(cwd);
  const results: PulseResult[] = [];

  for (let index = 0; index < pulses.length; index += 1) {
    const pulse = pulses[index];
    if (pulse.pausedReason) {
      results.push({ pulse, action: "skipped_budget", detail: pulse.pausedReason });
      continue;
    }
    if (!parseCron(pulse.cron).matches(now)) {
      results.push({ pulse, action: "skipped_not_due" });
      continue;
    }
    const preflight = await pulsePreflight(pulse, cwd);
    if (!preflight.due) {
      results.push({ pulse, action: "skipped_preflight", detail: preflight.reason });
      continue;
    }
    const spent = await spentToday(pulse.id, cwd, now);
    if (spent >= pulse.maxTokensPerDay) {
      const reason = `daily budget exhausted (${spent}/${pulse.maxTokensPerDay} tokens) — paused; resume with: muster pulse resume ${pulse.id}`;
      pulses[index] = { ...pulse, pausedReason: reason };
      results.push({ pulse: pulses[index], action: "skipped_budget", detail: reason });
      continue;
    }

    const prompt = pulse.kind === "task"
      ? pulse.prompt!
      : `${pulse.prompt ?? "Review this checklist. For each item, check only what can be verified from context."}\n\n${preflight.checklist}\n\nIf nothing needs attention, reply with exactly: OK`;
    try {
      const outcome = await executeRun(config, {
        prompt,
        cwd,
        surfaceId: `pulse:${pulse.id}`,
        skipMemoryWrite: true,
        recallLimit: pulse.kind === "heartbeat" ? 2 : 5, // light context: the whole point
      });
      pulses[index] = { ...pulses[index], lastRunAt: now.toISOString() };
      if (outcome.episode.outcome?.kind !== "completed") {
        results.push({ pulse: pulses[index], action: "failed", detail: outcome.episode.outcome?.detail, runId: outcome.plan.runId });
      } else if (QUIET_PATTERN.test(outcome.episode.responseText.trim()) || outcome.episode.responseText.trim().length < 4) {
        results.push({ pulse: pulses[index], action: "quiet", runId: outcome.plan.runId });
      } else {
        results.push({ pulse: pulses[index], action: "surfaced", text: outcome.episode.responseText, runId: outcome.plan.runId });
      }
    } catch (error) {
      results.push({ pulse: pulses[index], action: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  await writePulses(pulses, cwd);
  return results;
}
