import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig } from "./config.js";
import { executeRun, type RunOutcome } from "./run.js";
import type { MusterConfig } from "./types.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaProviderLatencySample {
  readonly index: number;
  readonly status: string;
  readonly totalMs: number;
  readonly providerMs: number;
  readonly musterOverheadMs: number;
  readonly planningMs: number;
  readonly recallMs: number;
  readonly promptBuildMs: number;
  readonly persistMs: number;
  readonly providerSharePct: number;
  readonly responseChars: number;
}

export interface QaProviderLatencyResult {
  readonly suite: "provider_latency";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly samplesPath: string;
  readonly serverLogPath: string;
  readonly summary: string;
  readonly samples: readonly QaProviderLatencySample[];
  readonly metrics: {
    readonly p50TotalMs: number;
    readonly p95TotalMs: number;
    readonly p50ProviderMs: number;
    readonly p50MusterOverheadMs: number;
    readonly avgProviderSharePct: number;
    readonly diagnosis: "provider_bound" | "muster_overhead_high" | "balanced_or_fast";
  };
}

interface ProviderServerLog {
  readonly url?: string;
  readonly method?: string;
  readonly bodyBytes: number;
}

export async function runProviderLatencyQa(input: {
  readonly artifactDir: string;
  readonly runs?: number;
  readonly providerDelayMs?: number;
  readonly maxMusterOverheadP50Ms?: number;
}): Promise<QaProviderLatencyResult> {
  const artifactDir = input.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  const runCwd = join(artifactDir, "workspace");
  await mkdir(runCwd, { recursive: true });
  const runs = Math.max(1, Math.min(10, Math.floor(input.runs ?? 3)));
  const providerDelayMs = Math.max(0, Math.min(2_000, Math.floor(input.providerDelayMs ?? 25)));
  const maxMusterOverheadP50Ms = input.maxMusterOverheadP50Ms ?? 1_000;
  const logs: ProviderServerLog[] = [];
  const server = createServer((request, response) => handleProviderRequest(request, response, logs, providerDelayMs));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start provider latency QA server.");

  const config = latencyQaConfig(`http://127.0.0.1:${address.port}/v1`);
  const samples: QaProviderLatencySample[] = [];
  try {
    for (let index = 0; index < runs; index += 1) {
      const outcome = await executeRun(config, {
        prompt: `provider latency qa run ${index + 1}`,
        cwd: runCwd,
        provider: "qa-stub",
        model: "qa-fast",
        scopes: [{ kind: "user", id: "provider-latency" }],
        timeoutMs: 5_000,
        skipAgentRules: true,
        skipRecall: true,
        skipSkillSelection: true,
        skipMemoryWrite: true,
        surfaceId: "qa-provider-latency",
      });
      if (!outcome.timings) throw new Error("Provider latency QA run did not return timing data.");
      samples.push(providerLatencySample(index + 1, outcome));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const metrics = summarizeProviderLatency(samples);
  const allCompleted = samples.every((sample) => sample.status === "completed");
  const status: RuntimeDoctorStatus = allCompleted && metrics.p50MusterOverheadMs <= maxMusterOverheadP50Ms ? "passed" : "failed";
  const summary = status === "passed"
    ? `Provider latency probe passed with p50 provider=${metrics.p50ProviderMs.toFixed(1)}ms and p50 Muster overhead=${metrics.p50MusterOverheadMs.toFixed(1)}ms`
    : `Provider latency probe failed (completed=${allCompleted} p50_overhead=${metrics.p50MusterOverheadMs.toFixed(1)}ms max=${maxMusterOverheadP50Ms}ms)`;
  const manifestPath = join(artifactDir, "manifest.json");
  const samplesPath = join(artifactDir, "samples.jsonl");
  const serverLogPath = join(artifactDir, "server-log.jsonl");
  const casesPath = join(artifactDir, "cases.jsonl");
  const cases = [
    ...samples.map((sample) => ({
      id: `sample_${sample.index}`,
      status: sample.status === "completed" ? "passed" : "failed",
      summary: `total=${sample.totalMs.toFixed(1)}ms provider=${sample.providerMs.toFixed(1)}ms overhead=${sample.musterOverheadMs.toFixed(1)}ms`,
    })),
    {
      id: "overhead_p50_gate",
      status: metrics.p50MusterOverheadMs <= maxMusterOverheadP50Ms ? "passed" : "failed",
      summary: `p50_overhead=${metrics.p50MusterOverheadMs.toFixed(1)}ms max=${maxMusterOverheadP50Ms}ms diagnosis=${metrics.diagnosis}`,
    },
  ] as const;
  await writeFile(samplesPath, `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`, "utf8");
  await writeFile(serverLogPath, `${logs.map((entry) => JSON.stringify(entry)).join("\n")}${logs.length ? "\n" : ""}`, "utf8");
  await writeFile(casesPath, `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "provider_latency",
    status,
    summary,
    caseCount: cases.length,
    thresholds: { maxMusterOverheadP50Ms, providerDelayMs },
    metrics,
    artifacts: { cases: "cases.jsonl", samples: "samples.jsonl", serverLog: "server-log.jsonl", workspace: "workspace" },
  }, null, 2)}\n`, "utf8");
  return { suite: "provider_latency", status, artifactDir, manifestPath, samplesPath, serverLogPath, summary, samples, metrics };
}

function latencyQaConfig(baseUrl: string): MusterConfig {
  const base = defaultConfig();
  return {
    ...base,
    providers: {
      "qa-stub": { id: "qa-stub", kind: "openai-compatible", baseUrl, defaultModel: "qa-fast", timeoutMs: 5_000 },
    },
    runtimes: {
      native: {
        id: "native",
        enabled: true,
        provider: "qa-stub",
        routes: {
          simple_qa: { provider: "qa-stub", model: "qa-fast", reasoning: "low" },
          research: { provider: "qa-stub", model: "qa-fast", reasoning: "low" },
          architecture: { provider: "qa-stub", model: "qa-fast", reasoning: "low" },
          private_analysis: { provider: "qa-stub", model: "qa-fast", reasoning: "low" },
        },
      },
    },
    routing: { ...base.routing, defaultRuntime: "native" },
  };
}

function providerLatencySample(index: number, outcome: RunOutcome): QaProviderLatencySample {
  const timings = outcome.timings!;
  const musterOverheadMs = Math.max(0, timings.totalMs - timings.providerMs);
  return {
    index,
    status: outcome.episode.outcome?.kind ?? "unknown",
    totalMs: timings.totalMs,
    providerMs: timings.providerMs,
    musterOverheadMs,
    planningMs: timings.planningMs,
    recallMs: timings.recallMs,
    promptBuildMs: timings.promptBuildMs,
    persistMs: timings.persistMs,
    providerSharePct: timings.totalMs > 0 ? (timings.providerMs / timings.totalMs) * 100 : 0,
    responseChars: outcome.episode.responseText.length,
  };
}

function summarizeProviderLatency(samples: readonly QaProviderLatencySample[]): QaProviderLatencyResult["metrics"] {
  const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  const providers = samples.map((sample) => sample.providerMs).sort((a, b) => a - b);
  const overheads = samples.map((sample) => sample.musterOverheadMs).sort((a, b) => a - b);
  const avgProviderSharePct = samples.reduce((sum, sample) => sum + sample.providerSharePct, 0) / Math.max(1, samples.length);
  const p50MusterOverheadMs = percentile(overheads, 0.5);
  const diagnosis = avgProviderSharePct >= 80
    ? "provider_bound"
    : p50MusterOverheadMs > 1000
      ? "muster_overhead_high"
      : "balanced_or_fast";
  return {
    p50TotalMs: percentile(totals, 0.5),
    p95TotalMs: percentile(totals, 0.95),
    p50ProviderMs: percentile(providers, 0.5),
    p50MusterOverheadMs,
    avgProviderSharePct,
    diagnosis,
  };
}

function percentile(sortedValues: readonly number[], q: number): number {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * q) - 1));
  return sortedValues[index] ?? 0;
}

function handleProviderRequest(request: IncomingMessage, response: ServerResponse, logs: ProviderServerLog[], delayMs: number): void {
  let body = "";
  request.on("data", (chunk) => { body += chunk.toString(); });
  request.on("end", () => {
    logs.push({ url: request.url, method: request.method, bodyBytes: Buffer.byteLength(body) });
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: `provider latency ok ${body.length}` } }] }));
    }, delayMs);
  });
}
