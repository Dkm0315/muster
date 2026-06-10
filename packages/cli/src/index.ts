#!/usr/bin/env node
import {
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
  inspectClaudeCode,
  inspectCapabilityPack,
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
  seedEvalFromEpisode,
  searchMemory,
  setRuntimeProvider,
  executeRun,
  listTokenRecords,
  renderTokenTable,
  activeProfile,
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
    case "run":
      await runCommand(args);
      return;
    case "tokens":
      await tokensCommand(args);
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
    case "verify":
      await verifyCommand();
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
  hybrowclaw claude inspect
  hybrowclaw claude ask "prompt" [--model sonnet] [--effort low] [--timeout-ms 30000]
  hybrowclaw episodes
  hybrowclaw feedback <episode-id> --useful|--not-useful [--correct] [--reason "..."]
  hybrowclaw candidates
  hybrowclaw eval seed <episode-id> [--expect "..."] [--forbid "..."]
  hybrowclaw eval run [path-or-dir]
  hybrowclaw capability inspect <path>
  hybrowclaw context graph [episode-id] [--scope tenant:hybrow] [--latest]
  hybrowclaw memory add --summary "..." --scope user:me --provenance manual
  hybrowclaw memory search --scope user:me [--query "..."] [--include-global]
  hybrowclaw memory promote <memory-id> --to tenant:acme [--allow-global]
  hybrowclaw tui
  hybrowclaw tui ask "your prompt"
  hybrowclaw provider list
  hybrowclaw provider add-openai-compatible <id> <base-url> <model> [--api-key-env OPENAI_API_KEY]
  hybrowclaw provider add-codex-cli <id> <model>
  hybrowclaw runtime use-provider <runtime-id> <provider-id> [model]
  hybrowclaw pi inspect [--home /path/to/home]
  hybrowclaw pi models [--provider anthropic] [--available] [--agent-dir ~/.pi/agent]
  hybrowclaw pi tools [--agent-dir ~/.pi/agent] [--tools read,grep,find,ls]
  hybrowclaw pi commands [--agent-dir ~/.pi/agent] [--tools read,grep,find,ls]
  hybrowclaw pi tui ["optional startup prompt"] [--agent-dir ~/.pi/agent] [--session create|continue|memory] [--session-dir path]
  hybrowclaw pi ask "prompt" [--provider openai] [--model gpt-4o-mini] [--transport sdk|cli] [--session memory|create|continue] [--session-dir path] [--timeout-ms 30000]
  hybrowclaw state export [--output packages/ui/public/hybrowclaw-state.json]
  hybrowclaw state show
  hybrowclaw migrate openclaw --dry-run
  hybrowclaw migrate hermes --dry-run
  hybrowclaw migrate pi --dry-run
  hybrowclaw run "prompt" [--runtime pi] [--provider anthropic] [--model claude-sonnet-4-5] [--session memory|create|continue] [--scope user:me] [--task-kind coding] [--sensitive]
  hybrowclaw tokens [--limit 20]
  hybrowclaw profile create|list|use|current [name]
  hybrowclaw schedule add "*/5 * * * *" "prompt" | list | remove <id> | run-due
  hybrowclaw evolve <suite.json> [--runtime pi] [--provider anthropic] [--model ...] [--iterations 2]
  hybrowclaw evolve selfcheck
  hybrowclaw verify

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

async function evalCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "seed") {
    const episodeId = args[1];
    if (!episodeId) throw new Error('Usage: hybrowclaw eval seed <episode-id> [--expect "..."] [--forbid "..."]');
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
  throw new Error("Usage: hybrowclaw eval <seed|run>");
}

async function capability(args: string[]): Promise<void> {
  const subcommand = args[0];
  const path = args[1];
  if (subcommand !== "inspect" || !path) {
    throw new Error("Usage: hybrowclaw capability inspect <path>");
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
    throw new Error("Usage: hybrowclaw context graph [episode-id] [--scope kind:id] [--latest]");
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
    if (!summary) throw new Error('Usage: hybrowclaw memory add --summary "..." --scope user:me --provenance manual');
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
    if (!id) throw new Error("Usage: hybrowclaw memory promote <memory-id> --to tenant:acme [--allow-global]");
    const targetScopes = readFlags(args, "--to").map(parseMemoryScope);
    const object = await promoteMemory({ id, targetScopes, allowGlobal: args.includes("--allow-global") });
    printMemoryObject(object);
    return;
  }
  throw new Error("Usage: hybrowclaw memory <add|search|promote>");
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
    if (!prompt) throw new Error('Usage: hybrowclaw tui ask "your prompt"');
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
    if (!prompt) throw new Error('Usage: hybrowclaw pi ask "prompt" [--provider openai] [--model gpt-4o-mini] [--transport sdk|cli] [--session memory|create|continue] [--session-dir path] [--timeout-ms 30000]');
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
    throw new Error("Usage: hybrowclaw pi <inspect|models|tools|commands|tui|ask>");
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
    if (!prompt) throw new Error('Usage: hybrowclaw claude ask "prompt" [--model sonnet] [--effort low] [--timeout-ms 30000]');
    await runClaudePrompt(prompt, {
      model: readFlag(args, "--model"),
      effort: readClaudeEffort(readFlag(args, "--effort")),
      timeoutMs: readNumberFlag(args, "--timeout-ms")
    });
    return;
  }
  throw new Error("Usage: hybrowclaw claude <inspect|ask>");
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
  if (!prompt) throw new Error('Usage: hybrowclaw run "prompt" [--runtime pi] [--provider X] [--model Y] [--session memory|create|continue] [--scope user:me]');
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
  if (outcome.episode.outcome?.kind === "failed") {
    throw new Error(outcome.episode.outcome.detail ?? "Run failed");
  }
  console.log("\n" + outcome.episode.responseText + "\n");
}

async function tokensCommand(commandArgs: string[]): Promise<void> {
  console.log(renderTokenTable(await listTokenRecords(), readNumberFlag(commandArgs, "--limit") ?? 20));
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
  if (action === "current" || action === undefined) {
    console.log(activeProfile());
    return;
  }
  throw new Error("Usage: hybrowclaw profile create|list|use|current [name]");
}

async function scheduleCommand(commandArgs: string[]): Promise<void> {
  const [action, ...rest] = commandArgs;
  if (action === "add") {
    const positional = stripFlags(rest, ["--profile"]);
    const [cron, ...promptParts] = positional;
    const prompt = promptParts.join(" ").trim();
    if (!cron || !prompt) throw new Error('Usage: hybrowclaw schedule add "*/5 * * * *" "prompt" [--profile name]');
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
    const results = await runDueSchedules(async (job) => {
      const outcome = await executeRun(config, { prompt: job.prompt });
      return { runId: outcome.plan.runId, status: outcome.episode.outcome?.kind === "completed" ? "completed" : "failed" };
    });
    if (!results.length) {
      console.log("No jobs due.");
      return;
    }
    for (const result of results) {
      console.log(`${result.job.id}: ${result.status}${result.runId ? ` run=${result.runId}` : ""}${result.detail ? ` (${result.detail})` : ""}`);
    }
    return;
  }
  throw new Error("Usage: hybrowclaw schedule add|list|remove|run-due");
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
  if (!suitePath) throw new Error("Usage: hybrowclaw evolve <suite.json> [--runtime pi] [--provider anthropic] [--model ...] [--iterations 2] | hybrowclaw evolve selfcheck");
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

async function verifyCommand(): Promise<void> {
  const report = await verifyIntegrity();
  console.log(renderIntegrityReport(report));
  if (!report.ok) process.exitCode = 1;
}

