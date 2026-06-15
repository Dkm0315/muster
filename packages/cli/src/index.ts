#!/usr/bin/env node
import { printBanner } from "./banner.js";
import {
  openSessionStore,
  listSkills,
  viewSkill,
  promoteSkill,
  curateSkills,
  listPulses,
  addPulse,
  runDuePulses,
  resumePulse,
  listSubRuns,
  reapOrphans,
  runWasteBenchmark,
  renderWasteReport,
  adjudicateFeedback,
  addMemory,
  appendEpisode,
  buildPiSessionLabel,
  summarizePiEventTrace,
  appendFeedback,
  addOpenAICompatibleProvider,
  addCodexCliProvider,
  buildCockpitState,
  buildEpisodeContextGraph,
  completeChat,
  configPath,
  ensureDefaultConfig,
  evalPath,
  findEpisode,
  flowPath,
  flowRunPath,
  getFlowRun,
  listFlowRuns,
  listFlows,
  loadFlow,
  parseFlow,
  preflightFlow,
  replayFlowRun,
  diffFlowRuns,
  scheduleFlowLoop,
  executeScheduledJob,
  resumeFlow,
  runFlow,
  saveFlow,
  inspectClaudeCode,
  inspectCapabilityPack,
  loadCapabilityPack,
  inspectPiCommands,
  inspectPiRuntime,
  inspectPiTools,
  listLearningCandidates,
  listEpisodes,
  listMemory,
  listPiModels,
  loadConfig,
  parseMemoryScope,
  planRun,
  promoteMemory,
  runClaudeCode,
  runPiAgent,
  runPiInteractive,
  runEvalCases,
  scanMigrationSource,
  applyOpenclawProfile,
  seedEvalFromEpisode,
  searchMemory,
  setRuntimeProvider,
  addPresetProvider,
  renderProviderPresets,
  executeRun,
  listTokenRecords,
  renderTokenTable,
  listSpans,
  renderTracesTable,
  activeProfile,
  dataDir,
  parseCron,
  cloneProfile,
  createProfile,
  listProfiles,
  useProfile,
  addSchedule,
  listSchedules,
  removeSchedule,
  runDueSchedules,
  loadEvolveSuite,
  evolve,
  renderEvolveReport,
  runHarnessChecks,
  verifyIntegrity,
  renderIntegrityReport
} from "@musterhq/core";
import {
  approvePairing,
  DEFAULT_GATEWAY_PORT,
  initGatewayConfig,
  loadGatewayConfig,
  loadPairings,
  pollTelegram,
  startGatewayServer
} from "@musterhq/gateway";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ChatMessage, EvidenceRecord, FeedbackValue, FlowRunEvent, FlowRunState, FlowToolRegistry, MigrationSource } from "@musterhq/core";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printBanner();
      printHelp();
      return;
    case "init":
      await init();
      return;
    case "doctor":
      await doctor(args);
      return;
    case "status":
      await statusCommand();
      return;
    case "chat":
      await chat(args.join(" ").trim());
      return;
    case "claude":
      await claude(args);
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
    case "eval":
      await evalCommand(args);
      return;
    case "capability":
      await capability(args);
      return;
    case "context":
      await context(args);
      return;
    case "memory":
      await memory(args);
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
    case "sessions":
      await sessionsCommand(args);
      return;
    case "skills":
      await skillsCommand(args);
      return;
    case "pulse":
      await pulseCommand(args);
      return;
    case "subagents":
      await subagentsCommand(args);
      return;
    case "demo":
      await demoCommand(args);
      return;
    case "benchmark":
      await benchmarkCommand();
      return;
    case "run":
      await runCommand(args);
      return;
    case "tokens":
      await tokensCommand(args);
      return;
    case "traces":
      await tracesCommand(args);
      return;
    case "profile":
      await profileCommand(args);
      return;
    case "schedule":
      await scheduleCommand(args);
      return;
    case "evolve":
      await evolveCommand(args);
      return;
    case "flow":
      await flowCommand(args);
      return;
    case "verify":
      await verifyCommand();
      return;
    case "gateway":
      await gatewayCommand(args);
      return;
    case "pairing":
      await pairingCommand(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp(): void {
  console.log(`Muster v0

Usage:
  muster init
  muster doctor [--fix]
  muster status
  muster chat "your prompt"
  muster claude inspect
  muster claude ask "prompt" [--model sonnet] [--effort low] [--timeout-ms 30000]
  muster episodes
  muster feedback <episode-id> --useful|--not-useful [--correct] [--reason "..."]
  muster candidates
  muster eval seed <episode-id> [--expect "..."] [--forbid "..."]
  muster eval run [path-or-dir]
  muster capability inspect <path>
  muster capability load <path> [--allow-high-risk]
  muster context graph [episode-id] [--scope tenant:hybrow] [--latest]
  muster memory add --summary "..." --scope user:me --provenance manual
  muster memory search --scope user:me [--query "..."] [--include-global]
  muster memory promote <memory-id> --to tenant:acme [--allow-global]
  muster tui
  muster tui ask "your prompt"
  muster provider list
  muster provider add-openai-compatible <id> <base-url> <model> [--api-key-env OPENAI_API_KEY]
  muster provider add-codex-cli <id> <model>
  muster provider presets
  muster provider add <preset> [--model X] [--api-key-env VAR] [--base-url URL]   (openai, anthropic, xai, kimi, deepseek, groq, ollama, openrouter, ...)
  muster runtime use-provider <runtime-id> <provider-id> [model]
  muster pi inspect [--home /path/to/home]
  muster pi models [--provider anthropic] [--available] [--agent-dir ~/.pi/agent]
  muster pi tools [--agent-dir ~/.pi/agent] [--tools read,grep,find,ls]
  muster pi commands [--agent-dir ~/.pi/agent] [--tools read,grep,find,ls]
  muster pi tui ["optional startup prompt"] [--agent-dir ~/.pi/agent] [--session create|continue|memory] [--session-dir path]
  muster pi ask "prompt" [--provider openai] [--model gpt-4o-mini] [--transport sdk|cli] [--session memory|create|continue] [--session-dir path] [--timeout-ms 30000]
  muster state export [--output packages/ui/public/muster-state.json]
  muster state show
  muster migrate openclaw --dry-run [--profile <channel-name>]
  muster migrate hermes --dry-run
  muster migrate pi --dry-run
  muster sessions search "query" | show <id> | recent
  muster skills list | view <name> | curate
  muster pulse add "<cron>" [--kind heartbeat|task] [--prompt "..."] | list | resume <id> | run-due
  muster subagents list | reap [--ttl-min N]
  muster demo                         # provision a throwaway workspace + stub model, show the full pipeline
  muster benchmark                    # Token Waste Index — prove the ledger savings (deterministic, no model)
  muster run "prompt" [--runtime pi] [--provider anthropic] [--model claude-sonnet-4-5] [--session memory|create|continue] [--scope user:me] [--task-kind coding] [--sensitive]
  muster tokens [--limit 20]
  muster traces [--limit N] [--trace <id>]     # OpenTelemetry spans — set MUSTER_TRACE=1 to record, MUSTER_OTLP_ENDPOINT to export
  muster profile create|list|use|current [name] | clone <from> <to>
  muster schedule add "*/5 * * * *" "prompt" | list | remove <id> | run-due
  muster evolve <suite.json> [--runtime pi] [--provider anthropic] [--model ...] [--iterations 2]
  muster evolve selfcheck
  muster flow save <file.json> | list | check <id> | run <id>
  muster flow runs | show <run-id> | approve <run-id> | reject <run-id>
  muster gateway init
  muster gateway start [--port 7460]
  muster gateway poll                 # Telegram long-poll (no public webhook URL needed)
  muster pairing list | approve <code>
  muster flow replay <run-id> [--live-agents]
  muster flow diff <run-id-a> <run-id-b>
  muster flow loop <flow-id> --cron "0 9 * * 1"
  muster verify

Design rule:
  One active runtime per run. Providers/models can route dynamically by task.
`);
}

async function init(): Promise<void> {
  printBanner();
  const target = await ensureDefaultConfig();
  console.log(`Created or reused Muster config: ${target}`);
  console.log("Default provider: local OpenAI-compatible endpoint at http://localhost:11434/v1");
  console.log("Next: muster doctor");
}

async function doctor(commandArgs: string[] = []): Promise<void> {
  if (commandArgs.includes("--fix")) {
    const configTarget = await ensureDefaultConfig();
    console.log(`fix config            ${configTarget}`);
    const data = dataDir();
    await mkdir(data, { recursive: true });
    console.log(`fix data-dir          ${data}`);
  }
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
    throw new Error('Missing prompt. Example: muster chat "Summarize this repo"');
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

async function evalCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "seed") {
    const episodeId = args[1];
    if (!episodeId) throw new Error('Usage: muster eval seed <episode-id> [--expect "..."] [--forbid "..."]');
    const fixture = await seedEvalFromEpisode(episodeId, {
      expectedContains: readFlags(args, "--expect"),
      forbiddenContains: readFlags(args, "--forbid")
    });
    console.log(`eval=${fixture.id}`);
    console.log(`source_episode=${fixture.sourceEpisodeId}`);
    console.log(`path=${evalPath(fixture.id)}`);
    console.log(`expected=${fixture.expectedContains.join(" | ")}`);
    if (fixture.forbiddenContains?.length) console.log(`forbidden=${fixture.forbiddenContains.join(" | ")}`);
    return;
  }
  if (subcommand === "run") {
    const target = args[1];
    const results = await runEvalCases(target);
    if (!results.length) {
      console.log("No eval fixtures found.");
      return;
    }
    for (const result of results) {
      console.log(`eval=${result.id} status=${result.status} source_episode=${result.sourceEpisodeId}`);
      for (const check of result.checks) {
        console.log(`check=${check.label} status=${check.status} detail=${check.detail}`);
      }
    }
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: muster eval <seed|run>");
}

async function capability(args: string[]): Promise<void> {
  const subcommand = args[0];
  const path = args[1];
  if (subcommand === "load") {
    if (!path) throw new Error("Usage: muster capability load <path> [--allow-high-risk]");
    const registry = builtinFlowRegistry();
    const loaded = await loadCapabilityPack(resolve(process.cwd(), path), {
      registry,
      allowHighRisk: args.includes("--allow-high-risk")
    });
    console.log(`pack=${loaded.manifest.id} version=${loaded.manifest.version}`);
    console.log(`permissions=${loaded.manifest.permissions.join(",") || "none"}`);
    console.log(`tools_registered=${loaded.toolNames.length} (dry-run: nothing persisted)`);
    for (const name of loaded.toolNames) console.log(`tool=${name}`);
    for (const warning of loaded.warnings) console.log(`warning=${warning}`);
    console.log(`use in flows: { "kind": "tool", "tool": "${loaded.toolNames[0]}" } with: muster flow run <id> --pack ${path}`);
    return;
  }
  if (subcommand !== "inspect" || !path) {
    throw new Error("Usage: muster capability <inspect|load> <path>");
  }
  const report = await inspectCapabilityPack(resolve(process.cwd(), path));
  console.log(`status=${report.status}`);
  console.log(`risk=${report.risk}`);
  console.log(`path=${report.path}`);
  if (report.manifest) {
    console.log(`id=${report.manifest.id}`);
    console.log(`name=${report.manifest.name}`);
    console.log(`version=${report.manifest.version}`);
    console.log(`kind=${report.manifest.kind}`);
    console.log(`sandbox=${report.manifest.sandbox}`);
    console.log(`permissions=${report.manifest.permissions.join(",") || "none"}`);
    console.log(`secrets=${report.manifest.secrets?.join(",") || "none"}`);
    console.log(`evals=${report.manifest.evals?.join(",") || "none"}`);
    console.log(`digest=${report.manifest.digest ?? "missing"}`);
  }
  if (report.blockers.length) {
    console.log("blockers:");
    for (const blocker of report.blockers) console.log(`- ${blocker}`);
  }
  if (report.warnings.length) {
    console.log("warnings:");
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
  if (report.status === "blocked") process.exitCode = 1;
}

async function context(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "graph") {
    throw new Error("Usage: muster context graph [episode-id] [--scope kind:id] [--latest]");
  }
  const episodes = await listEpisodes();
  if (!episodes.length) throw new Error("No episodes found. Run a prompt first.");
  const positional = stripFlags(args.slice(1), ["--scope"]).filter((arg) => arg !== "--latest");
  const requestedId = args.includes("--latest") ? undefined : positional[0];
  const episode = requestedId ? episodes.find((item) => item.id === requestedId) : episodes.at(-1);
  if (!episode) throw new Error(`Episode not found: ${requestedId}`);
  const scopeRaw = readFlag(args, "--scope");
  const graph = buildEpisodeContextGraph({
    episode,
    memories: await listMemory(),
    scope: scopeRaw ? parseMemoryScope(scopeRaw) : undefined
  });
  console.log(JSON.stringify(graph, null, 2));
}

async function memory(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "add") {
    const summary = readFlag(args, "--summary");
    if (!summary) throw new Error('Usage: muster memory add --summary "..." --scope user:me --provenance manual');
    const scopes = readFlags(args, "--scope").map(parseMemoryScope);
    const provenance = readFlags(args, "--provenance");
    const confidenceRaw = readFlag(args, "--confidence");
    const object = await addMemory({
      kind: readFlag(args, "--kind"),
      summary,
      sourceUri: readFlag(args, "--source-uri"),
      confidence: confidenceRaw ? Number(confidenceRaw) : undefined,
      provenance,
      scopes,
      redactionState: readRedactionState(readFlag(args, "--redaction"))
    });
    printMemoryObject(object);
    return;
  }
  if (subcommand === "search") {
    const scopes = readFlags(args, "--scope").map(parseMemoryScope);
    const records = await searchMemory({
      query: readFlag(args, "--query"),
      scopes,
      includeGlobal: args.includes("--include-global")
    });
    if (!records.length) {
      console.log("No memory matched the requested scope and query.");
      return;
    }
    for (const record of records.slice(0, 20)) printMemoryObject(record);
    return;
  }
  if (subcommand === "promote") {
    const id = args[1];
    if (!id) throw new Error("Usage: muster memory promote <memory-id> --to tenant:acme [--allow-global]");
    const targetScopes = readFlags(args, "--to").map(parseMemoryScope);
    const object = await promoteMemory({ id, targetScopes, allowGlobal: args.includes("--allow-global") });
    printMemoryObject(object);
    return;
  }
  throw new Error("Usage: muster memory <add|search|promote>");
}

async function tui(): Promise<void> {
  if (args[0] === "/tokens" || args[0] === "tokens") {
    console.log(renderTokenTable(await listTokenRecords(), readNumberFlag(args, "--limit") ?? 20));
    return;
  }
  if (args[0] === "ask") {
    const runtimeFlag = readFlag(args, "--runtime");
    const promptArgs = stripFlags(args.slice(1), ["--runtime", "--provider", "--model", "--thinking", "--effort", "--transport", "--session", "--session-dir", "--timeout-ms"]);
    const prompt = promptArgs.join(" ").trim();
    if (!prompt) throw new Error('Usage: muster tui ask "your prompt"');
    if (runtimeFlag === "pi") {
      await runPiPrompt(prompt, {
        renderTui: true,
        provider: readFlag(args, "--provider"),
        model: readFlag(args, "--model"),
        transport: readPiTransport(readFlag(args, "--transport")),
        sessionMode: readPiSessionMode(readFlag(args, "--session")),
        sessionDir: readFlag(args, "--session-dir"),
        timeoutMs: readNumberFlag(args, "--timeout-ms")
      });
      return;
    }
    if (runtimeFlag === "claude" || runtimeFlag === "claude-code") {
      await runClaudePrompt(prompt, {
        renderTui: true,
        model: readFlag(args, "--model"),
        effort: readClaudeEffort(readFlag(args, "--effort")),
        timeoutMs: readNumberFlag(args, "--timeout-ms")
      });
      return;
    }
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
        "You are Muster v0 running inside the terminal harness. Be concise, evidence-aware, and explicit about missing evidence."
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
  console.log(`feedback: muster feedback ${plan.runId} --useful --correct`);
}

function renderTuiState(state: Awaited<ReturnType<typeof buildCockpitState>>): void {
  const episode = state.episodes.at(-1);
  const feedback = episode ? state.feedback.filter((item) => item.episodeId === episode.id).at(-1) : undefined;
  const candidates = (episode ? state.candidates.filter((item) => item.episodeId === episode.id) : state.candidates).slice(-5);
  const title = "Muster Terminal Cockpit";
  const width = Math.min(process.stdout.columns || 120, 140);
  console.log(boxLine("top", width));
  console.log(boxText(`${title}  source=${state.source} configured=${state.configured}`, width));
  console.log(boxLine("mid", width));
  console.log(boxText(`run=${episode?.id ?? "-"} runtime=${episode?.runtimeId ?? state.configSummary?.defaultRuntime ?? "-"} provider=${episode?.providerId ?? "-"} model=${episode?.model ?? "-"}`, width));
  console.log(boxText(`prompt=${truncate(episode?.prompt ?? "No run recorded yet. Use muster chat or seed an episode.", width - 10)}`, width));
  console.log(boxLine("mid", width));
  console.log(boxText("assistant", width));
  console.log(wrapText(episode?.responseText ?? "No assistant response recorded yet.", width).map((line) => boxText(line, width)).join("\n"));
  console.log(boxLine("mid", width));
  console.log(boxText(`feedback=${feedback?.adjudication ?? "none"} candidates=${candidates.length}`, width));
  for (const candidate of candidates) {
    console.log(boxText(`- ${candidate.kind}/${candidate.risk}: ${truncate(candidate.summary, width - 18)}`, width));
  }
  console.log(boxLine("mid", width));
  console.log(boxText("next: muster pi inspect | muster state export | muster feedback <episode> --useful --correct", width));
  console.log(boxLine("bottom", width));
}

async function pi(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "tui") {
    const prompt = stripFlags(args.slice(1), ["--agent-dir", "--provider", "--model", "--thinking", "--tools", "--session", "--session-dir", "--session-id"]).join(" ").trim();
    const result = await runPiInteractive({
      prompt,
      cwd: process.cwd(),
      agentDir: readFlag(args, "--agent-dir"),
      provider: readFlag(args, "--provider"),
      model: readFlag(args, "--model"),
      thinking: readPiThinking(readFlag(args, "--thinking")),
      tools: readCsvFlag(args, "--tools"),
      sessionMode: readPiSessionMode(readFlag(args, "--session")),
      sessionDir: readFlag(args, "--session-dir"),
      sessionId: readFlag(args, "--session-id")
    });
    if (result.status === "blocked") {
      console.log(`runtime=pi transport=interactive package=${result.packageName}@${result.packageVersion}`);
      console.log(`status=${result.status}`);
      console.log(`reason=${result.reason}`);
      process.exitCode = 1;
    } else if (result.status === "failed") {
      console.log(`runtime=pi transport=interactive package=${result.packageName}@${result.packageVersion}`);
      console.log(`status=${result.status} exit_code=${result.exitCode ?? "-"} signal=${result.signal ?? "-"}`);
      process.exitCode = result.exitCode ?? 1;
    }
    return;
  }
  if (subcommand === "ask") {
    const prompt = stripFlags(args.slice(1), ["--provider", "--model", "--thinking", "--transport", "--session", "--session-dir", "--timeout-ms"]).join(" ").trim();
    if (!prompt) throw new Error('Usage: muster pi ask "prompt" [--provider openai] [--model gpt-4o-mini] [--transport sdk|cli] [--session memory|create|continue] [--session-dir path] [--timeout-ms 30000]');
    await runPiPrompt(prompt, {
      provider: readFlag(args, "--provider"),
      model: readFlag(args, "--model"),
      thinking: readPiThinking(readFlag(args, "--thinking")),
      transport: readPiTransport(readFlag(args, "--transport")),
      sessionMode: readPiSessionMode(readFlag(args, "--session")),
      sessionDir: readFlag(args, "--session-dir"),
      timeoutMs: readNumberFlag(args, "--timeout-ms")
    });
    return;
  }
  if (subcommand === "models") {
    const models = await listPiModels({
      provider: readFlag(args, "--provider"),
      agentDir: readFlag(args, "--agent-dir"),
      availableOnly: args.includes("--available")
    });
    if (!models.length) {
      console.log("No Pi models matched. Run without filters or login/configure a provider in Pi.");
      return;
    }
    console.log("provider\tmodel\tavailable\tauth\tapi\tthinking\tinput\tcontext\tmax_output\tname");
    for (const model of models) {
      console.log(
        [
          model.provider,
          model.id,
          model.available ? "yes" : "no",
          model.usingOAuth ? "oauth" : model.authSource ?? "-",
          model.api ?? "-",
          model.reasoning ? "yes" : "no",
          model.input.join(","),
          formatCompactNumber(model.contextWindow),
          formatCompactNumber(model.maxTokens),
          model.name
        ].join("\t")
      );
    }
    return;
  }
  if (subcommand === "tools") {
    const report = await inspectPiTools({
      agentDir: readFlag(args, "--agent-dir"),
      tools: readCsvFlag(args, "--tools")
    });
    console.log(`session=${report.sessionId}`);
    console.log(`cwd=${report.cwd}`);
    console.log(`agent_dir=${report.agentDir}`);
    console.log(`active_tools=${report.activeTools.join(",") || "-"}`);
    console.log("tool\tactive\tscope\torigin\tsource\tparameters\tdescription");
    for (const tool of report.tools) {
      console.log(
        [
          tool.name,
          tool.active ? "yes" : "no",
          tool.scope,
          tool.origin,
          tool.source,
          tool.parameterKeys.join(",") || "-",
          tool.description.replace(/\s+/g, " ").trim()
        ].join("\t")
      );
    }
    return;
  }
  if (subcommand === "commands") {
    const report = await inspectPiCommands({
      agentDir: readFlag(args, "--agent-dir"),
      tools: readCsvFlag(args, "--tools")
    });
    console.log(`session=${report.sessionId}`);
    console.log(`cwd=${report.cwd}`);
    console.log(`agent_dir=${report.agentDir}`);
    console.log("command\tsource\tscope\torigin\tpath\tdescription");
    for (const command of report.commands) {
      console.log(
        [
          command.invocation,
          command.source,
          command.scope,
          command.origin,
          command.sourcePath ?? "-",
          command.description.replace(/\s+/g, " ").trim() || "-"
        ].join("\t")
      );
    }
    return;
  }
  if (subcommand !== "inspect") {
    throw new Error("Usage: muster pi <inspect|models|tools|commands|tui|ask>");
  }
  const report = await inspectPiRuntime({ homeDir: readFlag(args, "--home") });
  console.log(`pi_root=${report.rootPath}`);
  console.log(`installed=${report.installed}`);
  console.log(`integration_mode=${report.integrationMode}`);
  console.log(`sdk_loadable=${report.sdkLoadable}`);
  console.log(`missing_sdk_exports=${report.missingSdkExports.length ? report.missingSdkExports.join(",") : "-"}`);
  console.log(`cli_available=${report.cliAvailable}`);
  console.log(`npx_available=${report.npxAvailable}`);
  console.log(`package=${report.packageName}@${report.packageVersion}`);
  console.log(`adapter_state=${report.adapterState}`);
  console.log(`config_files=${report.configFiles.length}`);
  for (const file of report.configFiles.slice(0, 20)) console.log(`config=${file}`);
  console.log(`workflow_files=${report.workflowFiles.length}`);
  for (const file of report.workflowFiles.slice(0, 20)) console.log(`workflow=${file}`);
  console.log("next_actions:");
  for (const action of report.nextActions) console.log(`- ${action}`);
}

async function runPiPrompt(
  prompt: string,
  options: {
    readonly renderTui?: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    readonly transport?: "sdk" | "cli";
    readonly sessionMode?: "memory" | "create" | "continue";
    readonly sessionDir?: string;
    readonly timeoutMs?: number;
  } = {}
): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = `pi_${Date.now()}`;
  const result = await runPiAgent({
    prompt,
    cwd: process.cwd(),
    provider: options.provider,
    model: options.model,
    thinking: options.thinking,
    timeoutMs: options.timeoutMs,
    tools: ["read", "grep", "find", "ls"],
    transport: options.transport,
    sessionMode: options.sessionMode,
    sessionDir: options.sessionDir
  });
  const failureText = result.errorMessage ?? result.stderr ?? "empty response";
  await appendEpisode({
    id: runId,
    createdAt: startedAt,
    cwd: process.cwd(),
    prompt,
    taskKind: "workflow",
    runtimeId: "pi",
    providerId: options.provider ?? "pi-default",
    model: options.model ?? "pi-default",
    reasoning: piThinkingToReasoning(options.thinking),
    responseText: result.stdout || `Pi failed: ${failureText}`,
    evidence: [
      {
        kind: "system_check",
        label: result.transport === "sdk" ? "pi embedded sdk invocation" : "pi cli diagnostic invocation",
        status: result.status === "completed" ? "passed" : "failed",
        detail:
          result.transport === "sdk"
            ? `${buildPiSessionLabel(result)} ${summarizePiEventTrace(result.eventTrace ?? [])} (${result.durationMs}ms)`
            : `${result.command} ${result.args?.slice(0, -1).join(" ")} (${result.durationMs}ms)`
      }
    ],
    outcome: { kind: result.status === "completed" ? "completed" : "failed", detail: result.errorMessage ?? result.stderr }
  });
  if (options.renderTui) {
    renderTuiState(await buildCockpitState());
    return;
  }
  console.log(`runtime=pi transport=${result.transport} package=${result.packageName}@${result.packageVersion}`);
  if (result.command) console.log(`command=${result.command}`);
  if (result.sessionId) console.log(`session=${result.sessionId}`);
  if (result.sessionMode) console.log(`session_mode=${result.sessionMode}`);
  if (result.sessionFile) console.log(`session_file=${result.sessionFile}`);
  if (result.sessionDir) console.log(`session_dir=${result.sessionDir}`);
  if (result.activeTools?.length) console.log(`active_tools=${result.activeTools.join(",")}`);
  if (result.eventTrace?.length) console.log(`event_trace=${summarizePiEventTrace(result.eventTrace)}`);
  console.log(`status=${result.status} duration_ms=${result.durationMs}`);
  if (result.stderr) console.log(`stderr=${result.stderr}`);
  console.log("\n" + (result.stdout || result.errorMessage || "Pi returned no output") + "\n");
  console.log(`episode=${runId}`);
  if (result.status === "failed") process.exitCode = 1;
}

async function claude(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "inspect") {
    const report = await inspectClaudeCode();
    console.log(`available=${report.available}`);
    if (report.version) console.log(`version=${report.version}`);
    return;
  }
  if (subcommand === "ask") {
    const prompt = stripFlags(args.slice(1), ["--model", "--effort", "--timeout-ms"]).join(" ").trim();
    if (!prompt) throw new Error('Usage: muster claude ask "prompt" [--model sonnet] [--effort low] [--timeout-ms 30000]');
    await runClaudePrompt(prompt, {
      model: readFlag(args, "--model"),
      effort: readClaudeEffort(readFlag(args, "--effort")),
      timeoutMs: readNumberFlag(args, "--timeout-ms")
    });
    return;
  }
  throw new Error("Usage: muster claude <inspect|ask>");
}

async function runClaudePrompt(
  prompt: string,
  options: {
    readonly renderTui?: boolean;
    readonly model?: string;
    readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
    readonly timeoutMs?: number;
  } = {}
): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = `claude_${Date.now()}`;
  const result = await runClaudeCode({
    prompt,
    cwd: process.cwd(),
    model: options.model,
    effort: options.effort,
    timeoutMs: options.timeoutMs
  });
  const failureText = result.errorMessage ?? result.stderr ?? "empty response";
  await appendEpisode({
    id: runId,
    createdAt: startedAt,
    cwd: process.cwd(),
    prompt,
    taskKind: "workflow",
    runtimeId: "claude-code",
    providerId: "claude-code",
    model: options.model ?? "default",
    reasoning: claudeEffortToReasoning(options.effort),
    responseText: result.stdout || `Claude Code failed: ${failureText}`,
    evidence: [
      {
        kind: "system_check",
        label: "claude code invocation",
        status: result.status === "completed" ? "passed" : "failed",
        detail: `${result.command} ${result.args.slice(0, -1).join(" ")} (${result.durationMs}ms)`
      }
    ],
    outcome: { kind: result.status === "completed" ? "completed" : "failed", detail: result.errorMessage ?? result.stderr }
  });
  if (options.renderTui) {
    renderTuiState(await buildCockpitState());
    return;
  }
  console.log(`runtime=claude-code command=${result.command}`);
  console.log(`status=${result.status} duration_ms=${result.durationMs}`);
  if (result.stderr) console.log(`stderr=${result.stderr}`);
  console.log("\n" + (result.stdout || result.errorMessage || "Claude Code returned no output") + "\n");
  console.log(`episode=${runId}`);
  if (result.status === "failed") process.exitCode = 1;
}

async function provider(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "presets") {
    console.log(renderProviderPresets());
    return;
  }
  if (subcommand === "add") {
    const presetId = args[1];
    if (!presetId) {
      throw new Error("Usage: muster provider add <preset> [--model X] [--api-key-env VAR] [--base-url URL]. List presets with: muster provider presets");
    }
    const added = await addPresetProvider(presetId, {
      model: readFlag(args, "--model"),
      apiKeyEnv: readFlag(args, "--api-key-env"),
      baseUrl: readFlag(args, "--base-url"),
    });
    console.log(`provider_added=${added.id}`);
    console.log(`kind=${added.kind}`);
    if (added.baseUrl) console.log(`base_url=${added.baseUrl}`);
    console.log(`default_model=${added.defaultModel}`);
    if (added.apiKeyEnv) {
      const keyPresent = Boolean(process.env[added.apiKeyEnv]);
      console.log(`api_key_env=${added.apiKeyEnv} (${keyPresent ? "set" : "NOT SET - export it before running"})`);
    } else {
      console.log("api_key_env=- (no key required)");
    }
    console.log(`try: muster run "hello" --runtime native --provider ${added.id}`);
    return;
  }
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
      throw new Error("Usage: muster provider add-openai-compatible <id> <base-url> <model> [--api-key-env ENV_NAME]");
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
      throw new Error("Usage: muster provider add-codex-cli <id> <model>");
    }
    await addCodexCliProvider({ id, defaultModel: model });
    console.log(`provider_added=${id}`);
    console.log("kind=codex-cli");
    console.log(`default_model=${model}`);
    return;
  }
  throw new Error("Usage: muster provider <list|add-openai-compatible|add-codex-cli>");
}

async function runtime(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "use-provider") {
    throw new Error("Usage: muster runtime use-provider <runtime-id> <provider-id> [model]");
  }
  const [runtimeId, providerId, model] = args.slice(1);
  if (!runtimeId || !providerId) {
    throw new Error("Usage: muster runtime use-provider <runtime-id> <provider-id> [model]");
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
    throw new Error("Usage: muster state <export|show> [--output path]");
  }
  const output = readFlag(args, "--output") ?? readFlag(args, "--out") ?? "packages/ui/public/muster-state.json";
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
  const apply = args.includes("--apply");
  if (!isMigrationSource(source)) {
    throw new Error("Usage: muster migrate <openclaw|hermes|pi> --dry-run [--profile <name>] | muster migrate openclaw --apply --profile <name> --out <name>");
  }
  if (apply) {
    if (source !== "openclaw") {
      throw new Error(`--apply is only supported for openclaw. ${source} apply is not yet enabled (dry-run only).`);
    }
    const home = readFlag(args, "--home");
    const profile = readFlag(args, "--profile");
    const outProfile = readFlag(args, "--out");
    if (!profile || !outProfile) {
      throw new Error("Usage: muster migrate openclaw --apply --profile <name> --out <new-profile-name>");
    }
    const result = await applyOpenclawProfile({ homeDir: home ?? process.env.HOME ?? process.cwd(), profile, outProfile });
    console.log(`migration_source=openclaw`);
    console.log("mode=apply");
    console.log(`out_profile=${result.outProfile}`);
    console.log(`channel=${result.channel}`);
    console.log(`provider=${result.provider}`);
    console.log(`model=${result.model}`);
    console.log(`runtime=${result.runtime}`);
    console.log(`commands_migrated=${result.commandsMigrated}`);
    if (result.tokenEnvRef) console.log(`token_env_ref=${result.tokenEnvRef}`);
    // Make selectivity explicit: exactly ONE channel/profile was migrated.
    console.log(
      `excluded ${result.excludedChannels.length} other channel(s): ${result.excludedChannels.join(", ") || "none"}`
    );
    console.log(`excluded ${result.excludedAgents} agent(s)`);
    console.log(`config_path=${result.configPath}`);
    // No --runtime flag on purpose: passing one bypasses the profile's routing and
    // falls back to a default model. A flagless run uses the migrated config's
    // defaultRuntime (${result.runtime}) + model (${result.model}).
    console.log(`try: muster profile use ${result.outProfile} && muster run "hello"`);
    return;
  }
  if (!dryRun) {
    throw new Error("v0 only supports migration dry-runs. Apply is enabled only for: muster migrate openclaw --apply --profile <name> --out <name>.");
  }
  const home = readFlag(args, "--home");
  const profile = readFlag(args, "--profile");
  const report = await scanMigrationSource(source, { homeDir: home, profile });
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

function readFlags(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function readCsvFlag(args: string[], flag: string): string[] | undefined {
  const value = readFlag(args, flag);
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const raw = readFlag(args, flag);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number.`);
  return value;
}

function stripFlags(args: string[], flagsWithValues: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flagsWithValues.includes(arg)) {
      index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function readRedactionState(value: string | undefined): "none" | "redacted" | "hashed" | "blocked" | undefined {
  if (!value) return undefined;
  if (value === "none" || value === "redacted" || value === "hashed" || value === "blocked") return value;
  throw new Error("Invalid redaction state. Use one of none, redacted, hashed, blocked.");
}

function readPiThinking(value: string | undefined): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  if (!value) return undefined;
  if (value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error("Invalid Pi thinking level. Use off, minimal, low, medium, high, or xhigh.");
}

function readPiTransport(value: string | undefined): "sdk" | "cli" | undefined {
  if (!value) return undefined;
  if (value === "sdk" || value === "cli") return value;
  throw new Error("Invalid Pi transport. Use sdk or cli.");
}

function readPiSessionMode(value: string | undefined): "memory" | "create" | "continue" | undefined {
  if (!value) return undefined;
  if (value === "memory" || value === "create" || value === "continue") return value;
  throw new Error("Invalid Pi session mode. Use memory, create, or continue.");
}

function readClaudeEffort(value: string | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") return value;
  throw new Error("Invalid Claude Code effort. Use low, medium, high, xhigh, or max.");
}

function piThinkingToReasoning(value: ReturnType<typeof readPiThinking>): "none" | "low" | "medium" | "high" | undefined {
  if (!value) return undefined;
  if (value === "off") return "none";
  if (value === "minimal" || value === "low") return "low";
  if (value === "medium") return "medium";
  return "high";
}

function claudeEffortToReasoning(value: ReturnType<typeof readClaudeEffort>): "low" | "medium" | "high" | undefined {
  if (!value) return undefined;
  if (value === "low" || value === "medium") return value;
  return "high";
}

function printMemoryObject(object: Awaited<ReturnType<typeof addMemory>>): void {
  console.log(`id=${object.id}`);
  console.log(`kind=${object.kind}`);
  console.log(`summary=${object.summary}`);
  console.log(`confidence=${object.confidence}`);
  console.log(`redaction=${object.redactionState}`);
  console.log(`scopes=${object.scopes.map((scope) => `${scope.kind}:${scope.id}`).join(",")}`);
  console.log(`provenance=${object.provenance.join(",")}`);
  if (object.sourceUri) console.log(`source_uri=${object.sourceUri}`);
  if (object.links?.length) console.log(`links=${object.links.join(",")}`);
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

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});


async function runCommand(commandArgs: string[]): Promise<void> {
  const flagNames = ["--runtime", "--provider", "--model", "--thinking", "--session", "--session-dir", "--scope", "--task-kind", "--timeout-ms", "--recall-limit"];
  const prompt = stripFlags(commandArgs, flagNames).filter((value) => value !== "--sensitive").join(" ").trim();
  if (!prompt) throw new Error('Usage: muster run "prompt" [--runtime pi] [--provider X] [--model Y] [--session memory|create|continue] [--scope user:me]');
  const config = await loadConfig();
  const scopeFlags = commandArgs.flatMap((value, index) => (value === "--scope" && commandArgs[index + 1] ? [commandArgs[index + 1]] : []));
  const outcome = await executeRun(config, {
    prompt,
    runtime: readFlag(commandArgs, "--runtime"),
    provider: readFlag(commandArgs, "--provider"),
    model: readFlag(commandArgs, "--model"),
    thinking: readFlag(commandArgs, "--thinking") as never,
    sessionMode: readPiSessionMode(readFlag(commandArgs, "--session")),
    sessionDir: readFlag(commandArgs, "--session-dir"),
    taskKind: readFlag(commandArgs, "--task-kind") as never,
    sensitive: commandArgs.includes("--sensitive"),
    scopes: scopeFlags.length ? scopeFlags.map(parseMemoryScope) : undefined,
    recallLimit: readNumberFlag(commandArgs, "--recall-limit"),
    timeoutMs: readNumberFlag(commandArgs, "--timeout-ms")
  });
  if (outcome.recalled.length) {
    console.log(`recalled ${outcome.recalled.length} scoped memories into context`);
  }
  if (outcome.fallbackUsed) {
    console.log(`governed fallback used: ${outcome.fallbackUsed} (recorded as evidence)`);
  }
  console.log(`run=${outcome.plan.runId} runtime=${outcome.plan.runtimeId} model=${outcome.episode.providerId}/${outcome.episode.model} task=${outcome.plan.taskKind} status=${outcome.episode.outcome?.kind}`);
  console.log(`tokens in=${outcome.tokens.inputTokens}${outcome.tokens.estimated ? "~" : ""} out=${outcome.tokens.outputTokens}${outcome.tokens.estimated ? "~" : ""}${outcome.tokens.costUsd !== undefined ? ` cost=$${outcome.tokens.costUsd.toFixed(4)}` : ""}`);
  // Persist to the session store so `muster sessions` works from the CLI, not only the gateway.
  try {
    const store = openSessionStore();
    const session = store.createSession({ channel: "cli", peer: process.env.USER ?? "local", title: prompt.slice(0, 60) });
    store.appendMessage(session.id, "user", prompt);
    store.appendMessage(session.id, "assistant", outcome.episode.responseText);
    store.addUsage(session.id, outcome.tokens.inputTokens, outcome.tokens.outputTokens, outcome.tokens.costUsd ?? 0);
    store.close();
  } catch {
    // session store is best-effort from the CLI; never fail a run over it
  }
  if (outcome.episode.outcome?.kind === "failed") {
    throw new Error(outcome.episode.outcome.detail ?? "Run failed");
  }
  console.log("\n" + outcome.episode.responseText + "\n");
}

async function tokensCommand(commandArgs: string[]): Promise<void> {
  console.log(renderTokenTable(await listTokenRecords(), readNumberFlag(commandArgs, "--limit") ?? 20));
}

async function tracesCommand(commandArgs: string[]): Promise<void> {
  console.log(
    renderTracesTable(await listSpans(), {
      limit: readNumberFlag(commandArgs, "--limit") ?? 20,
      traceId: readFlag(commandArgs, "--trace")
    })
  );
}

async function profileCommand(commandArgs: string[]): Promise<void> {
  const [action, name] = commandArgs;
  if (action === "create" && name) {
    await createProfile(name);
    console.log(`Created profile: ${name}`);
    return;
  }
  if (action === "list") {
    const current = activeProfile();
    for (const profile of await listProfiles()) {
      console.log(`${profile === current ? "* " : "  "}${profile}`);
    }
    return;
  }
  if (action === "use" && name) {
    await useProfile(name);
    console.log(`Active profile: ${name}`);
    return;
  }
  if (action === "clone") {
    const [, from, to] = commandArgs;
    if (!from || !to) throw new Error("Usage: muster profile clone <from> <to>");
    await cloneProfile(from, to);
    console.log(`Cloned profile ${from} -> ${to} (history-free copy of config, memory, and skills)`);
    return;
  }
  if (action === "current" || action === undefined) {
    console.log(activeProfile());
    return;
  }
  throw new Error("Usage: muster profile create|list|use|current|clone [name]");
}

async function scheduleCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  if (action === "add") {
    const positional = stripFlags(rest, ["--profile"]);
    const [cron, ...promptParts] = positional;
    const prompt = promptParts.join(" ").trim();
    if (!cron || !prompt) throw new Error('Usage: muster schedule add "*/5 * * * *" "prompt" [--profile name]');
    const job = await addSchedule(cron, prompt, { profile: readFlag(rest, "--profile") });
    console.log(`Scheduled ${job.id}: [${job.cron}] ${job.prompt}`);
    console.log("No daemon runs these. Add to external cron: * * * * * cd <repo> && pnpm hc schedule run-due");
    return;
  }
  if (action === "list") {
    const jobs = await listSchedules();
    if (!jobs.length) {
      console.log("No schedules.");
      return;
    }
    for (const job of jobs) {
      console.log(`${job.id} [${job.cron}] ${job.prompt.slice(0, 60)} last=${job.lastRunAt ?? "-"} status=${job.lastStatus ?? "-"}`);
    }
    return;
  }
  if (action === "remove" && rest[0]) {
    const removed = await removeSchedule(rest[0]);
    console.log(removed ? `Removed ${rest[0]}` : `No schedule found: ${rest[0]}`);
    return;
  }
  if (action === "run-due") {
    const config = await loadConfig();
    const results = await runDueSchedules(async (job) =>
      executeScheduledJob(job, { config, registry: builtinFlowRegistry() })
    );
    if (!results.length) {
      console.log("No jobs due.");
      return;
    }
    for (const result of results) {
      console.log(`${result.job.id}: ${result.status}${result.runId ? ` run=${result.runId}` : ""}${result.detail ? ` (${result.detail})` : ""}`);
    }
    return;
  }
  throw new Error("Usage: muster schedule add|list|remove|run-due");
}

async function evolveCommand(commandArgs: string[]): Promise<void> {
  if (commandArgs[0] === "selfcheck") {
    const checks = await runHarnessChecks();
    for (const check of checks) {
      console.log(`[${check.status === "passed" ? "PASS" : "FAIL"}] ${check.id}: ${check.description}${check.detail ? ` - ${check.detail}` : ""}`);
    }
    if (checks.some((check) => check.status === "failed")) process.exitCode = 1;
    return;
  }
  const flagNames = ["--runtime", "--provider", "--model", "--iterations", "--session", "--timeout-ms"];
  const suitePath = stripFlags(commandArgs, flagNames)[0];
  if (!suitePath) throw new Error("Usage: muster evolve <suite.json> [--runtime pi] [--provider anthropic] [--model ...] [--iterations 2] | muster evolve selfcheck");
  const config = await loadConfig();
  const tasks = await loadEvolveSuite(resolve(suitePath));
  const report = await evolve(config, tasks, {
    runtime: readFlag(commandArgs, "--runtime"),
    provider: readFlag(commandArgs, "--provider"),
    model: readFlag(commandArgs, "--model"),
    sessionMode: readPiSessionMode(readFlag(commandArgs, "--session")),
    timeoutMs: readNumberFlag(commandArgs, "--timeout-ms"),
    maxIterations: readNumberFlag(commandArgs, "--iterations") ?? 2
  });
  console.log(renderEvolveReport(report));
  if (!report.converged || report.harnessChecks.some((check) => check.status === "failed")) process.exitCode = 1;
}

/**
 * v1 built-in deterministic tool registry for flows. `echo` returns its
 * resolved args, which is enough to demo template resolution and gates.
 * Real tool wiring (capability packs, Pi tools) lands in a later slice.
 */
function builtinFlowRegistry(): FlowToolRegistry {
  return {
    echo: async (args) => args
  };
}

/** Built-in registry plus any capability packs requested via --pack <dir> (repeatable). */
async function flowRegistryWithPacks(commandArgs: string[]): Promise<FlowToolRegistry> {
  const registry = builtinFlowRegistry();
  for (const packDir of readFlags(commandArgs, "--pack")) {
    const loaded = await loadCapabilityPack(resolve(process.cwd(), packDir), {
      registry,
      allowHighRisk: commandArgs.includes("--allow-high-risk")
    });
    console.log(`pack_loaded=${loaded.manifest.id} tools=${loaded.toolNames.join(",")}`);
  }
  return registry;
}

function printFlowEvent(event: FlowRunEvent): void {
  if (event.type === "run_started") console.log(`run=${event.runId} flow=${event.flowId}`);
  if (event.type === "step_started") console.log(`step=${event.stepId} status=started`);
  if (event.type === "step_completed") console.log(`step=${event.stepId} status=completed${event.tokensUsed ? ` tokens=~${event.tokensUsed}` : ""}`);
  if (event.type === "step_failed") console.log(`step=${event.stepId} status=failed error=${event.error}`);
  if (event.type === "step_skipped") console.log(`step=${event.stepId} status=skipped reason=${event.reason}`);
  if (event.type === "gate_pending") console.log(`step=${event.stepId} status=gate_pending${event.expiresAt ? ` expires=${event.expiresAt}` : ""}`);
  if (event.type === "gate_resolved") console.log(`step=${event.stepId} status=${event.approved ? "approved" : "rejected"}`);
  if (event.type === "run_finished") console.log(`run_status=${event.status}`);
}

function printFlowRunResult(result: Awaited<ReturnType<typeof runFlow>>): void {
  if (result.status === "awaiting_approval") {
    console.log(`flow_run=${result.runId} status=awaiting_approval gate=${result.gateId}`);
    console.log("--- gate shows ---");
    console.log(typeof result.show === "string" ? result.show : JSON.stringify(result.show, null, 2));
    console.log("------------------");
    console.log(`approve: muster flow approve ${result.runId}`);
    console.log(`reject:  muster flow reject ${result.runId}`);
    return;
  }
  console.log(`flow_run=${result.runId} status=${result.status}`);
  if (result.error) console.log(`error=${result.error}`);
  if (result.status === "failed" || result.status === "budget_exceeded" || result.status === "expired") process.exitCode = 1;
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function renderFlowRunsTable(runs: readonly FlowRunState[]): string {
  if (!runs.length) return "No flow runs yet. Start one with: muster flow run <id>";
  const lines: string[] = [];
  const header = `${padCell("run", 18)} ${padCell("flow", 24)} ${padCell("status", 18)} ${padCell("steps", 6)} ${padCell("tokens", 8)} ${padCell("started", 24)}`;
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const run of runs) {
    const completedSteps = run.events.filter((event) => event.type === "step_completed").length;
    lines.push([
      padCell(run.runId, 18),
      padCell(run.flowId, 24),
      padCell(run.status, 18),
      padCell(`${completedSteps}/${run.flow.steps.length}`, 6),
      padCell(run.tokensUsed ? `~${run.tokensUsed}` : "-", 8),
      padCell(run.startedAt, 24)
    ].join(" "));
  }
  return lines.join("\n");
}

async function flowCommand(commandArgs: string[]): Promise<void> {
  const [action, target] = commandArgs;
  if (action === "save") {
    if (!target) throw new Error("Usage: muster flow save <file.json>");
    const flow = parseFlow(await readFile(resolve(process.cwd(), target), "utf8"));
    const saved = await saveFlow(flow);
    console.log(`flow=${flow.id} steps=${flow.steps.length}`);
    console.log(`saved=${saved}`);
    console.log(`next: muster flow check ${flow.id}`);
    return;
  }
  if (action === "list") {
    const flows = await listFlows();
    if (!flows.length) {
      console.log("No flows saved yet. Add one with: muster flow save <file.json>");
      return;
    }
    const header = `${padCell("flow", 28)} ${padCell("steps", 6)} ${padCell("budget", 8)} description`;
    console.log(header);
    console.log("-".repeat(Math.max(header.length, 60)));
    for (const flow of flows) {
      console.log(`${padCell(flow.id, 28)} ${padCell(String(flow.steps.length), 6)} ${padCell(flow.budgetTokens ? String(flow.budgetTokens) : "-", 8)} ${flow.description ?? "-"}`);
    }
    return;
  }
  if (action === "check") {
    if (!target) throw new Error("Usage: muster flow check <id>");
    const flow = await loadFlow(target);
    const report = preflightFlow(flow, await flowRegistryWithPacks(commandArgs), await loadConfig());
    console.log(`flow=${flow.id} preflight=${report.ok ? "ok" : "failed"}`);
    for (const issue of report.issues) console.log(`- ${issue.message}`);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (action === "run") {
    if (!target) throw new Error("Usage: muster flow run <id>");
    const flow = await loadFlow(target);
    const result = await runFlow(flow, {
      config: await loadConfig(),
      registry: await flowRegistryWithPacks(commandArgs),
      cwd: process.cwd(),
      onEvent: printFlowEvent
    });
    printFlowRunResult(result);
    return;
  }
  if (action === "runs") {
    console.log(renderFlowRunsTable(await listFlowRuns()));
    return;
  }
  if (action === "show") {
    if (!target) throw new Error("Usage: muster flow show <run-id>");
    const run = await getFlowRun(target);
    console.log(`flow_run=${run.runId} flow=${run.flowId} status=${run.status} tokens=${run.tokensUsed ? `~${run.tokensUsed}` : "-"}`);
    console.log(`file=${flowRunPath(run.runId)}`);
    console.log(`definition=${flowPath(run.flowId)}`);
    for (const event of run.events) printFlowEvent(event);
    if (run.pendingGate) {
      console.log("--- pending gate shows ---");
      console.log(typeof run.pendingGate.show === "string" ? run.pendingGate.show : JSON.stringify(run.pendingGate.show, null, 2));
    }
    return;
  }
  if (action === "approve" || action === "reject") {
    if (!target) throw new Error(`Usage: muster flow ${action} <run-id>`);
    const result = await resumeFlow(target, {
      approve: action === "approve",
      config: await loadConfig(),
      registry: await flowRegistryWithPacks(commandArgs),
      cwd: process.cwd(),
      onEvent: printFlowEvent
    });
    printFlowRunResult(result);
    return;
  }
  if (action === "replay") {
    if (!target) throw new Error("Usage: muster flow replay <run-id> [--live-agents]");
    const result = await replayFlowRun(target, {
      config: await loadConfig(),
      registry: await flowRegistryWithPacks(commandArgs),
      cwd: process.cwd(),
      liveAgents: commandArgs.includes("--live-agents"),
      onEvent: printFlowEvent
    });
    console.log(`replay_of=${target}`);
    printFlowRunResult(result);
    return;
  }
  if (action === "diff") {
    const other = commandArgs[2];
    if (!target || !other) throw new Error("Usage: muster flow diff <run-id-a> <run-id-b>");
    const diff = await diffFlowRuns(target, other);
    console.log(`diff a=${diff.runIdA} b=${diff.runIdB} identical=${diff.identical}`);
    for (const difference of diff.differences) {
      console.log(`step=${difference.stepId} field=${difference.field}`);
      console.log(`  a=${typeof difference.a === "string" ? difference.a : JSON.stringify(difference.a)}`);
      console.log(`  b=${typeof difference.b === "string" ? difference.b : JSON.stringify(difference.b)}`);
    }
    if (!diff.identical) process.exitCode = 1;
    return;
  }
  if (action === "loop") {
    const cron = readFlag(commandArgs, "--cron");
    if (!target || !cron) throw new Error('Usage: muster flow loop <flow-id> --cron "0 9 * * 1"');
    const job = await scheduleFlowLoop(target, cron);
    console.log(`Scheduled ${job.id}: [${job.cron}] flow=${job.flowId}`);
    console.log("No daemon runs these. Add to external cron: * * * * * cd <repo> && pnpm hc schedule run-due");
    return;
  }
  throw new Error("Usage: muster flow <save|list|check|run|runs|show|approve|reject|replay|diff|loop>");
}

/**
 * `muster status`: one-screen mission-control overview of the fleet —
 * active profile, providers, episodes, tokens spent today, schedules due,
 * flows pending approval gates, and store integrity. All local reads.
 */
async function statusCommand(): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  let providersLine = "no config (run: muster doctor --fix)";
  let runtimeLine = "-";
  try {
    const config = await loadConfig();
    const providers = Object.values(config.providers);
    providersLine = `${providers.length} configured (${providers.map((provider) => provider.id).join(", ") || "none"})`;
    runtimeLine = config.routing.defaultRuntime;
  } catch {
    // keep the hint; status must never crash on a fresh workspace
  }

  const episodes = await listEpisodes();
  const lastEpisode = episodes.at(-1);

  const tokenRecords = await listTokenRecords();
  const todayRecords = tokenRecords.filter((record) => record.createdAt.startsWith(today));
  const tokensToday = todayRecords.reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0);
  const costToday = todayRecords.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);

  const schedules = await listSchedules();
  const currentMinute = new Date(now);
  currentMinute.setSeconds(0, 0);
  const dueSchedules = schedules.filter((job) => {
    if (job.disabled) return false;
    if (!parseCron(job.cron).matches(now)) return false;
    return !(job.lastRunAt && new Date(job.lastRunAt) >= currentMinute);
  });

  const flowRuns = await listFlowRuns();
  const pendingGates = flowRuns.filter((run) => run.status === "awaiting_approval");

  const integrity = await verifyIntegrity();

  const rows: Array<[string, string]> = [
    ["profile", activeProfile()],
    ["providers", providersLine],
    ["default runtime", runtimeLine],
    ["episodes", `${episodes.length} recorded${lastEpisode ? ` (last: ${lastEpisode.id} ${lastEpisode.createdAt})` : ""}`],
    ["tokens today", `${tokensToday} across ${todayRecords.length} runs${costToday ? ` (~$${costToday.toFixed(4)})` : ""}`],
    ["schedules", `${schedules.length} total, ${dueSchedules.length} due now`],
    ["flows pending gate", pendingGates.length ? pendingGates.map((run) => run.runId).join(", ") : "none"],
    ["verify", integrity.ok ? "OK" : `${integrity.issues.length} issue(s) — run: muster verify`],
  ];

  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2;
  console.log(`muster status — ${now.toISOString()}`);
  console.log("-".repeat(64));
  for (const [label, value] of rows) {
    console.log(`${padCell(label, labelWidth)} ${value}`);
  }
  if (pendingGates.length) {
    console.log("-".repeat(64));
    for (const run of pendingGates) {
      console.log(`approve: muster flow approve ${run.runId}   reject: muster flow reject ${run.runId}`);
    }
  }
}

async function verifyCommand(): Promise<void> {
  const report = await verifyIntegrity();
  console.log(renderIntegrityReport(report));
  if (!report.ok) process.exitCode = 1;
}

async function gatewayCommand(commandArgs: string[]): Promise<void> {
  const [action] = commandArgs;
  if (action === "init") {
    const result = await initGatewayConfig();
    console.log(`gateway_config=${result.path} (${result.created ? "created" : "already exists"})`);
    console.log(`token=${result.config.token}`);
    console.log("Surfaces authenticate with: Authorization: Bearer <token>");
    console.log(`next: muster gateway start --port ${result.config.port ?? DEFAULT_GATEWAY_PORT}`);
    return;
  }
  if (action === "start") {
    const gateway = await loadGatewayConfig();
    const config = await loadConfig();
    const port = readNumberFlag(commandArgs, "--port") ?? gateway.port ?? DEFAULT_GATEWAY_PORT;
    await startGatewayServer({ config, gateway, cwd: process.cwd(), log: (line) => console.log(line) }, port);
    console.log("routes: GET /v1/health | POST /v1/messages | POST /v1/flows/<run>/approve|reject | POST /v1/adapters/telegram|slack|discord|whatsapp|gchat|teams");
    console.log("stop with Ctrl-C");
    return;
  }
  if (action === "poll") {
    // Long-poll Telegram getUpdates instead of running a webhook — no public URL
    // needed. Uses the active profile's config + .muster/gateway.json telegram.botToken.
    const gateway = await loadGatewayConfig();
    const config = await loadConfig();
    const controller = new AbortController();
    process.on("SIGINT", () => controller.abort());
    console.log("telegram long-poll (no webhook). Message the bot; stop with Ctrl-C.");
    await pollTelegram({ config, gateway, cwd: process.cwd(), signal: controller.signal, log: (line) => console.log(line) });
    return;
  }
  throw new Error("Usage: muster gateway <init|start [--port 7460]|poll>");
}

async function pairingCommand(commandArgs: string[]): Promise<void> {
  const [action, code] = commandArgs;
  if (action === "list") {
    const store = await loadPairings();
    if (!store.pending.length && !store.paired.length) {
      console.log("No pairings yet. Senders appear here after their first gateway message.");
      return;
    }
    for (const pending of store.pending) {
      console.log(`pending code=${pending.code} surface=${pending.surfaceId} sender=${pending.senderId} requested=${pending.requestedAt}`);
    }
    for (const paired of store.paired) {
      console.log(`paired  id=${paired.pairingId} surface=${paired.surfaceId} sender=${paired.senderId} approved=${paired.approvedAt}`);
    }
    return;
  }
  if (action === "approve" && code) {
    const paired = await approvePairing(code);
    console.log(`paired=${paired.pairingId}`);
    console.log(`surface=${paired.surfaceId}`);
    console.log(`sender=${paired.senderId}`);
    return;
  }
  throw new Error("Usage: muster pairing list | approve <code>");
}


async function sessionsCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  const store = openSessionStore();
  try {
    if (action === "search") {
      const query = stripFlags(rest, ["--limit"]).join(" ").trim();
      if (!query) throw new Error('Usage: muster sessions search "query" [--limit N]');
      const result = store.search({ query, limit: readNumberFlag(rest, "--limit") });
      if (result.shape !== "discover") return;
      if (!result.hits.length) { console.log("No matching sessions."); return; }
      for (const hit of result.hits) {
        console.log(`${hit.sessionId}  ${hit.title || "(untitled)"}\n  ${hit.snippet}`);
      }
      return;
    }
    if (action === "show" && rest[0]) {
      const result = store.search({ sessionId: rest[0] });
      if (result.shape !== "read") return;
      console.log(`${result.session.title || "(untitled)"}  [${result.session.channel}/${result.session.peer}]  in=${result.session.tokensIn} out=${result.session.tokensOut}`);
      for (const message of [...result.head, ...(result.omitted ? [{ role: "system", content: `… ${result.omitted} messages omitted …` } as { role: string; content: string }] : []), ...result.tail]) {
        console.log(`  ${message.role.padEnd(9)} ${message.content.slice(0, 100)}`);
      }
      return;
    }
    if (action === "recent" || action === undefined) {
      const result = store.search({ limit: readNumberFlag(rest, "--limit") ?? 15 });
      if (result.shape !== "browse") return;
      for (const session of result.sessions) {
        console.log(`${session.id}  ${session.createdAt.slice(0, 16)}  ${session.title || "(untitled)"}  [${session.channel}/${session.peer}]`);
      }
      return;
    }
    throw new Error("Usage: muster sessions search|show|recent");
  } finally {
    store.close();
  }
}

async function skillsCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  if (action === "list" || action === undefined) {
    const skills = await listSkills();
    if (!skills.length) { console.log("No skills yet."); return; }
    for (const skill of skills) {
      console.log(`${skill.status.padEnd(10)} ${skill.name.padEnd(28)} ${skill.description.slice(0, 60)}`);
    }
    return;
  }
  if (action === "view" && rest[0]) {
    const skill = await viewSkill(rest[0]);
    console.log(`# ${skill.name} (${skill.status}, v${skill.version})\n${skill.description}\n\n${skill.body}`);
    return;
  }
  if (action === "curate") {
    const result = await curateSkills();
    console.log(`staled: ${result.staled.join(", ") || "none"}; archived: ${result.archived.join(", ") || "none"}`);
    return;
  }
  if (action === "promote") {
    console.log("Promotion is eval-gated: a skill becomes active only after `muster evolve` converges on its suite.");
    console.log("This is intentional — skills cannot self-certify. See docs/FEATURE_PARITY_PLAN.md.");
    return;
  }
  throw new Error("Usage: muster skills list|view <name>|curate");
}

async function pulseCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  if (action === "add") {
    const positional = stripFlags(rest, ["--kind", "--prompt", "--max-tokens"]);
    const cron = positional[0];
    if (!cron) throw new Error('Usage: muster pulse add "<cron>" [--kind heartbeat|task] [--prompt "..."] [--max-tokens N]');
    const pulse = await addPulse({
      cron,
      kind: (readFlag(rest, "--kind") as "heartbeat" | "task" | undefined) ?? "heartbeat",
      prompt: readFlag(rest, "--prompt"),
      maxTokensPerDay: readNumberFlag(rest, "--max-tokens"),
    });
    console.log(`${pulse.id} [${pulse.cron}] ${pulse.kind} budget=${pulse.maxTokensPerDay}/day`);
    console.log("No daemon. Add to external cron: * * * * * cd <repo> && pnpm hc pulse run-due");
    if (pulse.kind === "heartbeat") console.log("Heartbeats need a .muster/PULSE.md checklist; empty checklist = zero API calls.");
    return;
  }
  if (action === "list" || action === undefined) {
    const pulses = await listPulses();
    if (!pulses.length) { console.log("No pulses."); return; }
    for (const pulse of pulses) {
      console.log(`${pulse.id} [${pulse.cron}] ${pulse.kind}${pulse.pausedReason ? `  PAUSED: ${pulse.pausedReason}` : ""}`);
    }
    return;
  }
  if (action === "resume" && rest[0]) {
    await resumePulse(rest[0]);
    console.log(`Resumed ${rest[0]}`);
    return;
  }
  if (action === "run-due") {
    const config = await loadConfig();
    const results = await runDuePulses(config);
    if (!results.length) { console.log("No pulses due."); return; }
    for (const result of results) {
      console.log(`${result.pulse.id}: ${result.action}${result.detail ? ` (${result.detail})` : ""}`);
      if (result.action === "surfaced" && result.text) console.log(`  ${result.text.slice(0, 200)}`);
    }
    return;
  }
  throw new Error("Usage: muster pulse add|list|resume|run-due");
}

async function subagentsCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  if (action === "list" || action === undefined) {
    const runs = await listSubRuns();
    if (!runs.length) { console.log("No subagent runs."); return; }
    for (const run of runs) {
      console.log(`${run.id}  ${run.status.padEnd(10)} ${run.parentKey.padEnd(24)} ${run.task.slice(0, 50)}`);
    }
    return;
  }
  if (action === "reap") {
    const ttlMin = readNumberFlag(rest, "--ttl-min") ?? 30;
    const reaped = await reapOrphans(ttlMin * 60_000);
    console.log(reaped.length ? `Orphaned ${reaped.length} stale run(s): ${reaped.map((run) => run.id).join(", ")}` : "No stale runs to reap.");
    return;
  }
  throw new Error("Usage: muster subagents list|reap [--ttl-min N]");
}


async function demoCommand(_commandArgs: string[]): Promise<void> {
  const { createServer } = await import("node:http");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const {
    executeRun, addMemory, verifyIntegrity, renderIntegrityReport,
    listTokenRecords, renderTokenTable, ensureDefaultConfig, loadConfig, saveConfig,
  } = await import("@musterhq/core");

  // Provision a real, isolated workspace + a real stub LLM HTTP service.
  const cwd = await mkdtemp(join(tmpdir(), "muster-demo-"));
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const prompt = JSON.stringify(body);
      const text = /deploy/i.test(prompt)
        ? "Muster deploys to uat-erp.example.com (recalled from scoped memory)."
        : "Demo run complete. Every token above is real, recorded to the ledger.";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    await ensureDefaultConfig(cwd);
    const config = await loadConfig(cwd);
    await saveConfig({
      ...config,
      providers: { ...config.providers, demo: { id: "demo", kind: "openai-compatible", baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: "demo-model", timeoutMs: 5000 } },
      runtimes: { ...config.runtimes, native: { id: "native", enabled: true, provider: "demo", routes: {} } },
      routing: { ...config.routing, defaultRuntime: "native" },
    }, cwd);
    const live = await loadConfig(cwd);

    console.log("muster demo — provisioned an isolated workspace and a live stub model service.\n");
    await addMemory({ summary: "Muster deploys to uat-erp.example.com", provenance: ["demo"], scopes: [{ kind: "user", id: "demo" }] }, cwd);

    for (const prompt of ["Where do we deploy?", "Summarize the day's work."]) {
      const outcome = await executeRun(live, { prompt, cwd, scopes: [{ kind: "user", id: "demo" }] });
      console.log(`> ${prompt}`);
      if (outcome.recalled.length) console.log(`  (recalled ${outcome.recalled.length} scoped memory)`);
      console.log(`  ${outcome.episode.responseText}\n`);
    }

    console.log(renderTokenTable(await listTokenRecords(cwd)));
    console.log("\n" + renderIntegrityReport(await verifyIntegrity(cwd)));
    console.log("\nThat was a real run loop: scoped memory recall, token ledger, integrity verification — on a throwaway workspace.");
  } finally {
    server.close();
  }
}


async function benchmarkCommand(): Promise<void> {
  // Built-in Token Waste Index scenarios — deterministic, no model calls.
  const toolResult = (name: string, chars: number) => ({ role: "tool" as const, toolName: name, content: `${name} ` + "output line ".repeat(Math.ceil(chars / 12)) });
  const task = (id: string, description: string, turns: number, chars: number) => {
    const transcript: import("@musterhq/core").TranscriptMessage[] = [
      { role: "system", content: "You are an autonomous agent. Use tools, then report." },
      { role: "user", content: `Task: ${description}` },
    ];
    for (let i = 0; i < turns; i += 1) {
      transcript.push({ role: "assistant", content: `Step ${i + 1}: inspect the next artifact.` });
      transcript.push(toolResult(`read_${i}`, chars));
      transcript.push({ role: "user", content: `Continue with step ${i + 2}.` });
    }
    transcript.push({ role: "assistant", content: "Done." });
    return { id, description, transcript };
  };
  const scenarios = [
    task("codebase-refactor-20", "Refactor a module across 20 files", 20, 1440),
    task("incident-triage-30", "Triage an incident across 30 log pulls", 30, 1080),
    task("erp-data-audit-40", "Audit ERP records across 40 queries", 40, 840),
    task("research-synthesis-25", "Synthesize 25 fetched sources", 25, 1800),
    task("long-support-thread-50", "Resolve a 50-message support thread", 50, 720),
  ];
  const report = await runWasteBenchmark(scenarios, { budgetTokens: 8000, keepRecentToolResults: 5 });
  console.log(renderWasteReport(report));
  console.log(`\nMuster reduced naive token cost by ${report.aggregate.musterReductionPct}% across these scenarios.`);
  console.log("Deterministic — no model calls. Regenerate the published table with: node benchmark/run.mjs");
}

