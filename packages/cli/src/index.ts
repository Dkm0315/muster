#!/usr/bin/env node
import {
  adjudicateFeedback,
  appendEpisode,
  appendFeedback,
  addOpenAICompatibleProvider,
  addCodexCliProvider,
  buildCockpitState,
  completeChat,
  configPath,
  ensureDefaultConfig,
  findEpisode,
  inspectPiRuntime,
  listLearningCandidates,
  listEpisodes,
  loadConfig,
  planRun,
  scanMigrationSource,
  setRuntimeProvider
} from "@hybrowclaw/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ChatMessage, EvidenceRecord, FeedbackValue, MigrationSource } from "@hybrowclaw/core";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "init":
      await init();
      return;
    case "doctor":
      await doctor();
      return;
    case "chat":
      await chat(args.join(" ").trim());
      return;
    case "episodes":
      await episodes();
      return;
    case "feedback":
      await feedback(args);
      return;
    case "candidates":
      await candidates();
      return;
    case "tui":
      await tui();
      return;
    case "provider":
      await provider(args);
      return;
    case "runtime":
      await runtime(args);
      return;
    case "pi":
      await pi(args);
      return;
    case "state":
      await state(args);
      return;
    case "migrate":
      await migrate(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp(): void {
  console.log(`HybrowClaw v0

Usage:
  hybrowclaw init
  hybrowclaw doctor
  hybrowclaw chat "your prompt"
  hybrowclaw episodes
  hybrowclaw feedback <episode-id> --useful|--not-useful [--correct] [--reason "..."]
  hybrowclaw candidates
  hybrowclaw tui
  hybrowclaw tui ask "your prompt"
  hybrowclaw provider list
  hybrowclaw provider add-openai-compatible <id> <base-url> <model> [--api-key-env OPENAI_API_KEY]
  hybrowclaw provider add-codex-cli <id> <model>
  hybrowclaw runtime use-provider <runtime-id> <provider-id> [model]
  hybrowclaw pi inspect [--home /path/to/home]
  hybrowclaw state export [--output packages/ui/public/hybrowclaw-state.json]
  hybrowclaw state show
  hybrowclaw migrate openclaw --dry-run
  hybrowclaw migrate hermes --dry-run
  hybrowclaw migrate pi --dry-run

Design rule:
  One active runtime per run. Providers/models can route dynamically by task.
`);
}

async function init(): Promise<void> {
  const target = await ensureDefaultConfig();
  console.log(`Created or reused HybrowClaw config: ${target}`);
  console.log("Default provider: local OpenAI-compatible endpoint at http://localhost:11434/v1");
  console.log("Next: hybrowclaw doctor");
}

async function doctor(): Promise<void> {
  const checks: Array<[string, boolean, string]> = [];
  let configLoaded = false;
  try {
    const config = await loadConfig();
    configLoaded = true;
    checks.push(["config", true, configPath()]);
    checks.push(["one-runtime-per-run", config.routing.oneRuntimePerRun === true, "routing policy"]);
    checks.push(["default-runtime", Boolean(config.runtimes[config.routing.defaultRuntime]), config.routing.defaultRuntime]);
    for (const provider of Object.values(config.providers)) {
      checks.push([`provider:${provider.id}`, true, `${provider.kind} ${provider.baseUrl ?? ""}`.trim()]);
    }
  } catch (error) {
    checks.push(["config", false, error instanceof Error ? error.message : String(error)]);
  }

  if (configLoaded) {
    const config = await loadConfig();
    for (const provider of Object.values(config.providers)) {
      if (provider.kind === "openai-compatible" && provider.baseUrl) {
        const ok = await checkModelsEndpoint(provider.baseUrl);
        checks.push([`provider:${provider.id}:models`, ok, `${provider.baseUrl.replace(/\/$/, "")}/models`]);
      }
    }
  }

  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "ok " : "err"} ${name.padEnd(28)} ${detail}`);
  }
}

async function chat(prompt: string): Promise<void> {
  if (!prompt) {
    throw new Error('Missing prompt. Example: hybrowclaw chat "Summarize this repo"');
  }
  await runPrompt(prompt);
}

async function episodes(): Promise<void> {
  const records = await listEpisodes();
  if (!records.length) {
    console.log("No episodes recorded yet.");
    return;
  }
  for (const episode of records.slice(-20)) {
    console.log(
      `${episode.id} ${episode.createdAt} ${episode.taskKind} ${episode.runtimeId}/${episode.providerId}/${episode.model} ${episode.prompt.slice(0, 80)}`
    );
  }
}

async function feedback(args: string[]): Promise<void> {
  const episodeId = args[0];
  if (!episodeId) throw new Error("Missing episode id.");
  const useful = args.includes("--useful");
  const notUseful = args.includes("--not-useful");
  if (useful === notUseful) throw new Error("Pass exactly one of --useful or --not-useful.");
  const reason = readFlag(args, "--reason");
  const episode = await findEpisode(episodeId);
  if (!episode) throw new Error(`Episode not found: ${episodeId}`);
  const record = adjudicateFeedback(
    {
      episodeId,
      value: (useful ? "useful" : "not_useful") as FeedbackValue,
      reason,
      correctAndWorked: args.includes("--correct")
    },
    episode
  );
  await appendFeedback(record);
  console.log(`feedback=${record.value}`);
  console.log(`adjudication=${record.adjudication}`);
  for (const candidate of record.learningCandidates) {
    console.log(`candidate=${candidate.kind} risk=${candidate.risk} auto=${candidate.autoApply} ${candidate.summary}`);
  }
}

async function candidates(): Promise<void> {
  const records = await listLearningCandidates();
  if (!records.length) {
    console.log("No learning candidates recorded yet.");
    return;
  }
  for (const candidate of records) {
    console.log(
      `${candidate.episodeId}\t${candidate.kind}\t${candidate.risk}\tauto=${candidate.autoApply}\t${candidate.summary}`
    );
  }
}

async function tui(): Promise<void> {
  if (args[0] === "ask") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) throw new Error('Usage: hybrowclaw tui ask "your prompt"');
    await runPrompt(prompt, { renderTui: true });
    return;
  }
  const state = await buildCockpitState();
  renderTuiState(state);
}

async function runPrompt(prompt: string, options: { readonly renderTui?: boolean } = {}): Promise<void> {
  const config = await loadConfig();
  const plan = planRun(config, { prompt, cwd: process.cwd() });
  const provider = config.providers[plan.route.provider];
  if (!provider) throw new Error(`Missing provider: ${plan.route.provider}`);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are HybrowClaw v0 running inside the terminal harness. Be concise, evidence-aware, and explicit about missing evidence."
    },
    { role: "user", content: prompt }
  ];

  if (!options.renderTui) console.log(`runtime=${plan.runtimeId} provider=${provider.id} model=${plan.route.model} task=${plan.taskKind}`);
  const started = Date.now();
  let responseText = "";
  let errorMessage: string | undefined;
  try {
    responseText = await completeChat({ provider, route: plan.route, messages });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const elapsedMs = Date.now() - started;
  const evidence: EvidenceRecord[] = [
    {
      kind: "model_response",
      label: "assistant response",
      status: responseText ? "observed" : "failed",
      detail: errorMessage ? `${elapsedMs}ms ${errorMessage}` : `${elapsedMs}ms`
    }
  ];
  await appendEpisode({
    id: plan.runId,
    createdAt: plan.createdAt,
    cwd: process.cwd(),
    prompt,
    taskKind: plan.taskKind,
    runtimeId: plan.runtimeId,
    providerId: provider.id,
    model: plan.route.model,
    reasoning: plan.route.reasoning,
    responseText: responseText || `Provider failed: ${errorMessage ?? "empty response"}`,
    evidence,
    outcome: { kind: responseText ? "completed" : "failed", detail: errorMessage }
  });
  if (options.renderTui) {
    renderTuiState(await buildCockpitState());
    return;
  }
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  console.log("\n" + responseText + "\n");
  console.log(`episode=${plan.runId}`);
  console.log(`feedback: hybrowclaw feedback ${plan.runId} --useful --correct`);
}

function renderTuiState(state: Awaited<ReturnType<typeof buildCockpitState>>): void {
  const episode = state.episodes.at(-1);
  const feedback = episode ? state.feedback.filter((item) => item.episodeId === episode.id).at(-1) : undefined;
  const candidates = (episode ? state.candidates.filter((item) => item.episodeId === episode.id) : state.candidates).slice(-5);
  const title = "HybrowClaw Terminal Cockpit";
  const width = Math.min(process.stdout.columns || 120, 140);
  console.log(boxLine("top", width));
  console.log(boxText(`${title}  source=${state.source} configured=${state.configured}`, width));
  console.log(boxLine("mid", width));
  console.log(boxText(`run=${episode?.id ?? "-"} runtime=${episode?.runtimeId ?? state.configSummary?.defaultRuntime ?? "-"} provider=${episode?.providerId ?? "-"} model=${episode?.model ?? "-"}`, width));
  console.log(boxText(`prompt=${truncate(episode?.prompt ?? "No run recorded yet. Use hybrowclaw chat or seed an episode.", width - 10)}`, width));
  console.log(boxLine("mid", width));
  console.log(boxText("assistant", width));
  console.log(wrapText(episode?.responseText ?? "No assistant response recorded yet.", width).map((line) => boxText(line, width)).join("\n"));
  console.log(boxLine("mid", width));
  console.log(boxText(`feedback=${feedback?.adjudication ?? "none"} candidates=${candidates.length}`, width));
  for (const candidate of candidates) {
    console.log(boxText(`- ${candidate.kind}/${candidate.risk}: ${truncate(candidate.summary, width - 18)}`, width));
  }
  console.log(boxLine("mid", width));
  console.log(boxText("next: hybrowclaw pi inspect | hybrowclaw state export | hybrowclaw feedback <episode> --useful --correct", width));
  console.log(boxLine("bottom", width));
}

async function pi(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "inspect") {
    throw new Error("Usage: hybrowclaw pi inspect [--home /path/to/home]");
  }
  const report = await inspectPiRuntime({ homeDir: readFlag(args, "--home") });
  console.log(`pi_root=${report.rootPath}`);
  console.log(`installed=${report.installed}`);
  console.log(`adapter_state=${report.adapterState}`);
  console.log(`config_files=${report.configFiles.length}`);
  for (const file of report.configFiles.slice(0, 20)) console.log(`config=${file}`);
  console.log(`workflow_files=${report.workflowFiles.length}`);
  for (const file of report.workflowFiles.slice(0, 20)) console.log(`workflow=${file}`);
  console.log("next_actions:");
  for (const action of report.nextActions) console.log(`- ${action}`);
}

async function provider(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "list") {
    const config = await loadConfig();
    for (const item of Object.values(config.providers)) {
      console.log(
        `${item.id}\t${item.kind}\t${item.defaultModel}\t${item.baseUrl ?? "-"}\tapiKeyEnv=${item.apiKeyEnv ?? "-"}`
      );
    }
    return;
  }
  if (subcommand === "add-openai-compatible") {
    const [id, baseUrl, model] = args.slice(1);
    if (!id || !baseUrl || !model) {
      throw new Error("Usage: hybrowclaw provider add-openai-compatible <id> <base-url> <model> [--api-key-env ENV_NAME]");
    }
    const apiKeyEnv = readFlag(args, "--api-key-env");
    await addOpenAICompatibleProvider({ id, baseUrl, defaultModel: model, apiKeyEnv });
    console.log(`provider_added=${id}`);
    console.log(`kind=openai-compatible`);
    console.log(`base_url=${baseUrl.replace(/\/$/, "")}`);
    console.log(`default_model=${model}`);
    if (apiKeyEnv) console.log(`api_key_env=${apiKeyEnv}`);
    return;
  }
  if (subcommand === "add-codex-cli") {
    const [id, model] = args.slice(1);
    if (!id || !model) {
      throw new Error("Usage: hybrowclaw provider add-codex-cli <id> <model>");
    }
    await addCodexCliProvider({ id, defaultModel: model });
    console.log(`provider_added=${id}`);
    console.log("kind=codex-cli");
    console.log(`default_model=${model}`);
    return;
  }
  throw new Error("Usage: hybrowclaw provider <list|add-openai-compatible|add-codex-cli>");
}

async function runtime(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "use-provider") {
    throw new Error("Usage: hybrowclaw runtime use-provider <runtime-id> <provider-id> [model]");
  }
  const [runtimeId, providerId, model] = args.slice(1);
  if (!runtimeId || !providerId) {
    throw new Error("Usage: hybrowclaw runtime use-provider <runtime-id> <provider-id> [model]");
  }
  await setRuntimeProvider({ runtimeId, providerId, model });
  console.log(`runtime=${runtimeId}`);
  console.log(`provider=${providerId}`);
  if (model) console.log(`model=${model}`);
}

async function state(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "show") {
    console.log(JSON.stringify(await buildCockpitState(), null, 2));
    return;
  }
  if (subcommand !== "export") {
    throw new Error("Usage: hybrowclaw state <export|show> [--output path]");
  }
  const output = readFlag(args, "--output") ?? readFlag(args, "--out") ?? "packages/ui/public/hybrowclaw-state.json";
  const target = resolve(process.cwd(), output);
  const statePayload = await buildCockpitState();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(statePayload, null, 2)}\n`, "utf8");
  console.log(`state_exported=${target}`);
  console.log(`configured=${statePayload.configured}`);
  if (statePayload.configSummary) {
    console.log(`providers=${statePayload.configSummary.providers.length}`);
    console.log(`runtimes=${statePayload.configSummary.runtimes.length}`);
  }
  console.log(`episodes=${statePayload.episodes.length}`);
  console.log(`feedback=${statePayload.feedback.length}`);
  console.log(`candidates=${statePayload.candidates.length}`);
}

async function migrate(args: string[]): Promise<void> {
  const source = args[0];
  const dryRun = args.includes("--dry-run");
  if (!isMigrationSource(source)) {
    throw new Error("Usage: hybrowclaw migrate <openclaw|hermes|pi> --dry-run");
  }
  if (!dryRun) {
    throw new Error("v0 only supports migration dry-runs. Apply will be added after scanners are verified.");
  }
  const home = readFlag(args, "--home");
  const report = await scanMigrationSource(source, { homeDir: home });
  console.log(`migration_source=${report.source}`);
  console.log("mode=dry-run");
  console.log(`root=${report.rootPath}`);
  console.log(`exists=${report.exists}`);
  console.log(`assets=${report.assets.length}`);
  for (const asset of report.assets) {
    console.log(`asset kind=${asset.kind} mode=${asset.importMode} path=${asset.path}`);
  }
  if (report.missingPaths.length) {
    console.log("missing:");
    for (const missingPath of report.missingPaths) console.log(`- ${missingPath}`);
  }
  if (report.archiveOnlyNotes.length) {
    console.log("archive_only:");
    for (const note of report.archiveOnlyNotes) console.log(`- ${note}`);
  }
  console.log("next_actions:");
  for (const action of report.recommendedNextActions) console.log(`- ${action}`);
}

function isMigrationSource(source: string | undefined): source is MigrationSource {
  return source === "openclaw" || source === "hermes" || source === "pi";
}

async function checkModelsEndpoint(baseUrl: string): Promise<boolean> {
  try {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const response = await fetch(`${cleanBase}/models`, {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) return true;
    if (cleanBase.endsWith("/v1")) {
      const ollamaBase = cleanBase.slice(0, -3);
      const ollamaResponse = await fetch(`${ollamaBase}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      return ollamaResponse.ok;
    }
    return false;
  } catch {
    return false;
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function boxLine(position: "top" | "mid" | "bottom", width: number): string {
  const left = position === "top" ? "+" : position === "bottom" ? "+" : "+";
  const right = "+";
  return `${left}${"-".repeat(Math.max(2, width - 2))}${right}`;
}

function boxText(text: string, width: number): string {
  const body = truncate(text, width - 4);
  return `| ${body.padEnd(Math.max(0, width - 4))} |`;
}

function wrapText(text: string, width: number): string[] {
  const max = Math.max(20, width - 4);
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines.slice(0, 12) : [""];
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
