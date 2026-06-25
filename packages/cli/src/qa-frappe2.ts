import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuntimeDoctorStatus } from "@musterhq/core";

const execFileAsync = promisify(execFile);

export interface QaFrappe2CommandCase {
  readonly id: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly requiredStdout?: readonly RegExp[];
}

export interface QaFrappe2CaseResult {
  readonly id: string;
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly command: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly requiredStdout: readonly string[];
}

export interface QaFrappe2RealPromptsResult {
  readonly suite: "frappe2_real_prompts";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly transcriptPath: string;
  readonly cases: readonly QaFrappe2CaseResult[];
  readonly summary: string;
}

export async function runFrappe2RealPromptsQa(input: {
  readonly artifactDir: string;
  readonly host?: string;
  readonly sshCommand?: string;
  readonly remoteCwd?: string;
  readonly remoteArtifactRoot?: string;
  readonly timeoutMs?: number;
  readonly commands?: readonly QaFrappe2CommandCase[];
}): Promise<QaFrappe2RealPromptsResult> {
  const artifactDir = input.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  const outputsDir = join(artifactDir, "outputs");
  await mkdir(outputsDir, { recursive: true });

  const host = input.host ?? "Frappe-2";
  const sshCommand = input.sshCommand ?? "ssh";
  const remoteCwd = input.remoteCwd ?? "/home/goblin/personal";
  const remoteArtifactRoot = input.remoteArtifactRoot ?? "/home/goblin/muster-artifacts";
  const commands = input.commands ?? defaultFrappe2Commands(remoteCwd, remoteArtifactRoot, input.timeoutMs ?? 120_000);
  const cases: QaFrappe2CaseResult[] = [];
  const transcriptLines: string[] = [
    `suite=frappe2_real_prompts host=${host} remote_cwd=${remoteCwd}`,
    `started_at=${new Date().toISOString()}`,
  ];

  for (const testCase of commands) {
    const started = Date.now();
    const result = await runRemoteCommand({ host, sshCommand, command: testCase.command, timeoutMs: testCase.timeoutMs });
    const durationMs = Date.now() - started;
    const stdoutPath = join(outputsDir, `${testCase.id}.stdout.txt`);
    const stderrPath = join(outputsDir, `${testCase.id}.stderr.txt`);
    await writeFile(stdoutPath, redactOutput(result.stdout), "utf8");
    await writeFile(stderrPath, redactOutput(result.stderr), "utf8");
    const missing = (testCase.requiredStdout ?? []).filter((pattern) => !pattern.test(result.stdout));
    const passed = result.exitCode === 0 && missing.length === 0;
    const summary = passed
      ? `${testCase.id} passed on ${host} in ${durationMs}ms`
      : `${testCase.id} failed on ${host}: exit=${result.exitCode} missing=${missing.map(String).join(",") || "-"}`;
    const caseResult: QaFrappe2CaseResult = {
      id: testCase.id,
      status: passed ? "passed" : "failed",
      summary,
      command: testCase.command,
      durationMs,
      exitCode: result.exitCode,
      stdoutPath,
      stderrPath,
      stdoutBytes: Buffer.byteLength(result.stdout),
      stderrBytes: Buffer.byteLength(result.stderr),
      requiredStdout: (testCase.requiredStdout ?? []).map(String),
    };
    cases.push(caseResult);
    transcriptLines.push(
      `case=${caseResult.id} status=${caseResult.status} exit=${caseResult.exitCode} duration_ms=${caseResult.durationMs}`,
      `command=${caseResult.command}`,
      `stdout=${stdoutPath}`,
      `stderr=${stderrPath}`,
    );
  }

  const status: RuntimeDoctorStatus = cases.every((testCase) => testCase.status === "passed") ? "passed" : "failed";
  const summary = status === "passed"
    ? `Frappe-2 real prompt regression passed on ${host} with ${cases.length} artifact-backed cases`
    : `Frappe-2 real prompt regression failed on ${host}; inspect per-command artifacts`;
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const transcriptPath = join(artifactDir, "transcript.txt");
  await writeFile(casesPath, `${cases.map((testCase) => JSON.stringify(testCase)).join("\n")}\n`, "utf8");
  await writeFile(transcriptPath, `${transcriptLines.join("\n")}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "frappe2_real_prompts",
    status,
    summary,
    host,
    remoteCwd,
    remoteArtifactRoot,
    caseCount: cases.length,
    artifacts: { cases: "cases.jsonl", transcript: "transcript.txt", outputs: "outputs/" },
  }, null, 2)}\n`, "utf8");
  return { suite: "frappe2_real_prompts", status, artifactDir, manifestPath, casesPath, transcriptPath, cases, summary };
}

function defaultFrappe2Commands(remoteCwd: string, remoteArtifactRoot: string, timeoutMs: number): readonly QaFrappe2CommandCase[] {
  const cd = `cd ${shellQuote(remoteCwd)}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const artifact = `${remoteArtifactRoot.replace(/\/$/, "")}/qa-frappe2-${stamp}`;
  const retrievalPackId = `f2-live-${stamp.toLowerCase()}`;
  return [
    {
      id: "remote_identity",
      command: `${cd} && printf 'user=' && whoami && printf 'pwd=' && pwd && printf 'node=' && node --version && printf 'muster=' && command -v muster`,
      timeoutMs: Math.min(timeoutMs, 30_000),
      requiredStdout: [/user=/, /pwd=/, /muster=/],
    },
    {
      id: "global_help_and_qa_catalog",
      command: `${cd} && muster help | sed -n '1,120p' && muster qa suites`,
      timeoutMs: Math.min(timeoutMs, 45_000),
      requiredStdout: [/muster qa scorecard/, /suite=pty_tui/, /suite=frappe2_real_prompts/],
    },
    {
      id: "codex_runtime_doctor",
      command: `${cd} && muster doctor codex`,
      timeoutMs: Math.min(timeoutMs, 60_000),
      requiredStdout: [/codex_doctor command=/, /codex_available=true/, /auth_status=/],
    },
    {
      id: "memory_status_probe",
      command: `${cd} && muster memory status --probe --scope tenant:f2 --scope user:goblin --query f2-live-exact-needle`,
      timeoutMs: Math.min(timeoutMs, 60_000),
      requiredStdout: [/backend=|memory backend=|sqlite|jsonl|objects/i],
    },
    {
      id: "real_prompt_latency",
      command: `${cd} && MUSTER_TIMINGS=1 muster run "Reply with exactly: muster-f2-ok" --scope tenant:f2 --scope user:goblin --transport warm --timeout-ms ${Math.max(30_000, timeoutMs)}`,
      timeoutMs: Math.max(45_000, timeoutMs + 5_000),
      requiredStdout: [/muster-f2-ok/i, /timings total=/, /transport=/, /first_token_ms=/],
    },
    {
      id: "retrieval_artifact_gate",
      command: `${cd} && ART=${shellQuote(artifact)} && mkdir -p "$ART" && PACK_OUT=$(muster eval retrieval seed-pack ${shellQuote(retrievalPackId)} --tenant f2 --user goblin --other-user alice --distractors 250) && printf '%s\n' "$PACK_OUT" > "$ART/seed-pack.txt" && PACK_PATH=$(printf '%s\n' "$PACK_OUT" | awk -F= '/^path=/{print $2}' | tail -1) && test -n "$PACK_PATH" && muster eval retrieval "$PACK_PATH" --min-recall 1 --min-mrr 1 --max-leakage-rate 0 --max-stale-hit-rate 0 --max-p95-ms 1000 --artifact-dir "$ART/retrieval"`,
      timeoutMs: Math.max(90_000, timeoutMs),
      requiredStdout: [/retrieval_suite status=passed/, /recall@5=1\.000/, /leakage_rate=0\.000/],
    },
  ];
}

async function runRemoteCommand(input: {
  readonly host: string;
  readonly sshCommand: string;
  readonly command: string;
  readonly timeoutMs: number;
}): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number | null }> {
  try {
    const result = await execFileAsync(input.sshCommand, [input.host, input.command], {
      timeout: input.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
    const code = typeof err.code === "number" ? err.code : null;
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? String(error), exitCode: code };
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function redactOutput(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "sk-REDACTED")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "xox-REDACTED")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "gh_REDACTED")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1REDACTED");
}
