import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultConfig } from "./config.js";
import { createProfile, profileConfigWritePath, profilesRoot } from "./profiles.js";
import type {
  AgentsConfig,
  MusterConfig,
  SkillRuntimeConfig,
  SkillRuntimeEntryConfig,
  ToolRuntimeConfig,
  ToolRuntimeEntryConfig
} from "./types.js";
import type { CapabilityPluginEntry, CapabilityPluginPolicy } from "./capability.js";
import type { McpServerConfig } from "./mcp.js";

export type MigrationSource = "openclaw" | "hermes" | "pi";

export interface MigrationAsset {
  readonly kind:
    | "config"
    | "memory"
    | "skill"
    | "tool"
    | "workflow"
    | "agent"
    | "channel"
    | "provider"
    | "mcp"
    | "unknown";
  readonly path: string;
  readonly importMode: "map" | "archive_only" | "manual_review";
  readonly note: string;
}

/**
 * Keys whose VALUES are secret-bearing. Whenever we surface content derived from
 * a source config (e.g. openclaw.json), any field whose key matches this is
 * redacted to a placeholder — the value itself is never read into a note.
 */
const SECRET_KEY_PATTERN = /token|secret|key|password|auth|bearer|credential/i;

export interface MigrationDryRunReport {
  readonly source: MigrationSource;
  readonly homeDir: string;
  readonly rootPath: string;
  readonly exists: boolean;
  readonly assets: MigrationAsset[];
  readonly missingPaths: string[];
  readonly archiveOnlyNotes: string[];
  readonly recommendedNextActions: string[];
}

type AssetRule = {
  readonly relativePath: string;
  readonly kind: MigrationAsset["kind"];
  readonly importMode: MigrationAsset["importMode"];
  readonly note: string;
  readonly recursive?: boolean;
};

const RULES: Record<MigrationSource, { root: string; assets: AssetRule[] }> = {
  openclaw: {
    root: ".openclaw",
    assets: [
      { relativePath: "openclaw.json", kind: "config", importMode: "map", note: "Map profile/runtime settings." },
      { relativePath: "memory", kind: "memory", importMode: "manual_review", note: "Import into governed memory ledger.", recursive: true },
      { relativePath: "agents", kind: "agent", importMode: "manual_review", note: "Review agent definitions; do not import session transcripts as live history.", recursive: true },
      { relativePath: "flows", kind: "workflow", importMode: "archive_only", note: "Archive historical flow registry; do not auto-activate flows.", recursive: true },
      { relativePath: "extensions", kind: "unknown", importMode: "manual_review", note: "Extensions carry executable capability; review before enabling.", recursive: true }
    ]
  },
  hermes: {
    root: ".hermes",
    assets: [
      { relativePath: "config.json", kind: "config", importMode: "map", note: "Map Hermes runtime settings." },
      { relativePath: "memory", kind: "memory", importMode: "manual_review", note: "Preserve provenance and trust level.", recursive: true },
      { relativePath: "skills", kind: "skill", importMode: "manual_review", note: "Normalize skill metadata and tests.", recursive: true },
      { relativePath: "providers.json", kind: "provider", importMode: "manual_review", note: "Redact and remap provider auth references." },
      { relativePath: "mcp.json", kind: "mcp", importMode: "manual_review", note: "Convert MCP servers into scoped tools." }
    ]
  },
  pi: {
    root: ".pi",
    assets: [
      { relativePath: "agents", kind: "agent", importMode: "map", note: "Map markdown agents into optional persona/agent overlays.", recursive: true },
      { relativePath: "workflows", kind: "workflow", importMode: "map", note: "Map pi workflow graphs directly into Muster flows.", recursive: true },
      { relativePath: "flows", kind: "workflow", importMode: "archive_only", note: "Persist historical flow runs as episode evidence.", recursive: true },
      { relativePath: "config.json", kind: "config", importMode: "map", note: "Map pi provider/runtime defaults." }
    ]
  }
};

export async function scanMigrationSource(
  source: MigrationSource,
  options: { homeDir?: string; profile?: string } = {}
): Promise<MigrationDryRunReport> {
  const homeDir = options.homeDir ?? process.env.HOME ?? process.cwd();
  const ruleSet = RULES[source];
  const rootPath = join(homeDir, ruleSet.root);
  const exists = await pathExists(rootPath);
  const missingPaths: string[] = [];
  const assets: MigrationAsset[] = [];

  if (!exists) {
    return {
      source,
      homeDir,
      rootPath,
      exists,
      assets,
      missingPaths: [rootPath],
      archiveOnlyNotes: [],
      recommendedNextActions: [`No ${source} installation found at ${rootPath}. Nothing to migrate.`]
    };
  }

  for (const rule of ruleSet.assets) {
    const absolutePath = join(rootPath, rule.relativePath);
    if (!(await pathExists(absolutePath))) {
      missingPaths.push(absolutePath);
      continue;
    }
    if (rule.recursive && (await isDirectory(absolutePath))) {
      const children = await listChildren(absolutePath);
      if (!children.length) {
        assets.push(assetFromRule(rule, absolutePath, "Directory exists but is empty."));
      } else {
        for (const child of children) {
          assets.push(assetFromRule(rule, child));
        }
      }
    } else {
      assets.push(assetFromRule(rule, absolutePath));
    }
  }

  // Content-derived expansion: OpenClaw keeps nearly all meaningful state INSIDE
  // openclaw.json. Parse it (defensively) and surface channels/agents as typed
  // assets — never reading any secret-bearing value into a note.
  const channelNames: string[] = [];
  let profileScoped = false;
  if (source === "openclaw") {
    const expansion = await expandOpenclawConfig(rootPath, options.profile);
    assets.push(...expansion.assets);
    channelNames.push(...expansion.channelNames);
    profileScoped = expansion.profileScoped;
    if (expansion.parseNote) {
      assets.push(expansion.parseNote);
    }
  }

  const archiveOnlyNotes = assets
    .filter((asset) => asset.importMode === "archive_only")
    .map((asset) => `${asset.path}: ${asset.note}`);

  return {
    source,
    homeDir,
    rootPath,
    exists,
    assets,
    missingPaths,
    archiveOnlyNotes,
    recommendedNextActions: nextActions(source, assets, {
      profile: options.profile,
      channelNames,
      profileScoped
    })
  };
}

interface OpenclawExpansion {
  readonly assets: MigrationAsset[];
  readonly channelNames: string[];
  readonly profileScoped: boolean;
  readonly parseNote?: MigrationAsset;
}

/**
 * Parse openclaw.json and turn top-level keys into typed assets. Malformed or
 * unreadable JSON is surfaced as a single note asset and never throws.
 *
 * Secret handling: no value whose key matches SECRET_KEY_PATTERN is ever read
 * into a note; channel notes carry only the channel name, model id, and a
 * command count.
 */
async function expandOpenclawConfig(
  rootPath: string,
  profile?: string
): Promise<OpenclawExpansion> {
  const configPath = join(rootPath, "openclaw.json");
  if (!(await pathExists(configPath))) {
    return { assets: [], channelNames: [], profileScoped: false };
  }

  let parsed: unknown;
  try {
    const raw = await readFile(configPath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    // Deliberately drop the raw parser error: V8's JSON.parse messages embed a
    // snippet of the offending source ("...\"botToken\":\"sk-...\"... is not valid
    // JSON"), which could leak a secret fragment into the report. A generic note
    // is enough to tell the operator to look at the file.
    return {
      assets: [],
      channelNames: [],
      profileScoped: false,
      parseNote: {
        kind: "config",
        path: configPath,
        importMode: "manual_review",
        note: "openclaw.json could not be parsed as JSON; review the file manually."
      }
    };
  }

  if (!isRecord(parsed)) {
    return {
      assets: [],
      channelNames: [],
      profileScoped: false,
      parseNote: {
        kind: "config",
        path: configPath,
        importMode: "manual_review",
        note: "openclaw.json is not a JSON object; review the file manually."
      }
    };
  }

  const assets: MigrationAsset[] = [];

  // agents.defaults -> agent asset (model + workspace), never secret-bearing.
  const agents = isRecord(parsed.agents) ? parsed.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  const model = defaults && typeof defaults.model === "string" ? defaults.model : "unknown";
  if (defaults) {
    const workspace =
      typeof defaults.workspace === "string" ? defaults.workspace : "default workspace";
    assets.push({
      kind: "agent",
      path: `${configPath}#agents.defaults`,
      importMode: "map",
      note: `OpenClaw default agent (model ${model}, ${workspace}).`
    });
  }

  // channels.<name> -> channel asset. botToken and any secret-keyed field are
  // never read; the note carries only name + model + custom-command count.
  const channels = isRecord(parsed.channels) ? parsed.channels : {};
  const allChannelNames = Object.keys(channels);
  let profileScoped = false;
  for (const name of allChannelNames) {
    if (profile && name !== profile) continue;
    if (profile && name === profile) profileScoped = true;
    const channel = channels[name];
    const commandCount = countCustomCommands(channel);
    assets.push({
      kind: "channel",
      path: `${configPath}#channels.${name}`,
      importMode: "map",
      note: `OpenClaw ${name} channel/profile (model ${model}, ${commandCount} custom commands)`
    });
  }

  return { assets, channelNames: allChannelNames, profileScoped };
}

function countCustomCommands(channel: unknown): number {
  return extractCustomCommands(channel, "").length;
}

interface MigratedCustomCommand {
  readonly name: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly surfaces: readonly string[];
}

function extractCustomCommands(channel: unknown, surface: string): MigratedCustomCommand[] {
  if (!isRecord(channel)) return [];
  const rawCommands = isRecord(channel.customCommands) || Array.isArray(channel.customCommands)
    ? channel.customCommands
    : channel.commands;
  const commands: MigratedCustomCommand[] = [];
  if (Array.isArray(rawCommands)) {
    for (const entry of rawCommands) {
      const parsed = commandFromArrayEntry(entry, surface);
      if (parsed) commands.push(parsed);
    }
    return commands;
  }
  if (isRecord(rawCommands)) {
    for (const [key, value] of Object.entries(rawCommands)) {
      const name = normalizeCommandName(key);
      if (!name) continue;
      const details = commandDetails(value);
      commands.push({ name, surfaces: surface ? [surface] : [], ...details });
    }
  }
  return commands;
}

function commandFromArrayEntry(entry: unknown, surface: string): MigratedCustomCommand | undefined {
  if (typeof entry === "string") {
    const name = normalizeCommandName(entry);
    return name ? { name, surfaces: surface ? [surface] : [] } : undefined;
  }
  if (!isRecord(entry)) return undefined;
  const rawName = stringField(entry, "name") ?? stringField(entry, "command");
  const name = normalizeCommandName(rawName ?? "");
  if (!name) return undefined;
  return { name, surfaces: surface ? [surface] : [], ...commandDetails(entry) };
}

function commandDetails(value: unknown): { description?: string; prompt?: string } {
  if (typeof value === "string") return { prompt: value };
  if (!isRecord(value)) return {};
  const description = stringField(value, "description");
  const prompt = stringField(value, "prompt") ?? stringField(value, "intent") ?? stringField(value, "instruction");
  return {
    ...(description ? { description } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  if (SECRET_KEY_PATTERN.test(key)) return undefined;
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCommandName(raw: string): string {
  return raw.trim().replace(/^\//, "").toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Result of materializing exactly ONE OpenClaw channel/profile into a runnable
 * Muster profile. The excluded* fields make selectivity auditable: the caller
 * can show the operator that the OTHER channels and the unused agent model
 * entries were deliberately left behind, not silently merged.
 */
export interface ApplyOpenclawResult {
  readonly outProfile: string;
  readonly channel: string;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly commandsMigrated: number;
  readonly excludedChannels: string[];
  readonly excludedAgents: number;
  readonly configPath: string;
  readonly skillsCarried: number;
  readonly toolsCarried: number;
  readonly pluginsCarried: number;
  readonly devicesCarried: number;
  /**
   * When the selected channel needs a bot token to actually run (e.g. telegram),
   * this names the env var the materialized config expects. The secret VALUE is
   * never read or written — only this reference and the literal placeholder.
   */
  readonly tokenEnvRef?: string;
}

/** Placeholder env reference written wherever a channel secret would otherwise live. */
const TELEGRAM_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const TELEGRAM_TOKEN_PLACEHOLDER = "${TELEGRAM_BOT_TOKEN}";

/** A muster runtime + provider that can actually run an OpenClaw channel's model. */
interface MigrationTarget {
  readonly runtime: string;
  readonly providerId: string;
  readonly providerKind: "anthropic" | "openai-compatible" | "codex-cli";
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

/**
 * Map an OpenClaw agentRuntime.id (+ the model's provider) to the muster runtime
 * and provider that actually run it on a server:
 *  - claude-cli / any anthropic model -> the managed claude-code runtime, which
 *    shells to the local `claude` binary (no API key needed).
 *  - codex -> the first-class `codex` runtime, which drives the local `codex`
 *    binary at full native power via `codex exec --json` (subscription auth, no
 *    API key needed) — preserving the user's provider, NOT swapping to Claude.
 *  - anything else -> the native runtime with an openai-compatible provider keyed
 *    on that provider's API-key env var.
 * (A previous version returned the non-runtime id "codex-cli" as the runtime,
 * which fell through to an unconfigured native path; another mapped codex to the
 * stripped one-shot native path. The `codex` runtime runs it at full power.)
 */
function resolveTarget(openclawRuntimeId: string, provider: string): MigrationTarget {
  if (openclawRuntimeId === "claude-cli" || provider === "anthropic") {
    return { runtime: "claude-code", providerId: "anthropic", providerKind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" };
  }
  if (openclawRuntimeId === "codex") {
    return { runtime: "codex", providerId: "codex", providerKind: "codex-cli" };
  }
  return {
    runtime: "native",
    providerId: provider,
    providerKind: "openai-compatible",
    apiKeyEnv: `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
    baseUrl: provider === "openai" ? "https://api.openai.com/v1" : undefined,
  };
}

/** Split "<provider>/<model>" on the FIRST slash; default provider "anthropic". */
function splitModelId(rawModel: string): { provider: string; model: string } {
  const slash = rawModel.indexOf("/");
  if (slash === -1) return { provider: "anthropic", model: rawModel };
  return { provider: rawModel.slice(0, slash), model: rawModel.slice(slash + 1) };
}

/**
 * Materialize exactly ONE OpenClaw channel/profile into a runnable Muster
 * profile. Reads <homeDir>/.openclaw/openclaw.json, resolves the model +
 * runtime for the named channel, creates the target profile, and writes a
 * MusterConfig whose default routing sends `muster run "<prompt>"` to the
 * resolved runtime + model.
 *
 * Secrets: no botToken/auth/secret VALUE is ever read or written. Where the
 * channel needs a bot token, the result records tokenEnvRef and the written
 * config carries only the literal placeholder "${TELEGRAM_BOT_TOKEN}".
 */
export async function applyOpenclawProfile(options: {
  homeDir: string;
  profile: string;
  outProfile: string;
  cwd?: string;
}): Promise<ApplyOpenclawResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(options.homeDir, ".openclaw", "openclaw.json");

  let parsed: unknown;
  try {
    const raw = await readFile(configPath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    // Never echo the raw parser/read error: JSON.parse messages embed a source
    // snippet that can contain a botToken/auth value. A generic message is enough.
    throw new Error(
      `Could not read or parse OpenClaw config at ${configPath}. Ensure it exists and is valid JSON.`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`OpenClaw config at ${configPath} is not a JSON object.`);
  }

  const channels = isRecord(parsed.channels) ? parsed.channels : {};
  const channelNames = Object.keys(channels);
  const selected = channels[options.profile];
  if (!isRecord(selected)) {
    // Names only — never any channel field value.
    throw new Error(
      `Channel/profile "${options.profile}" not found. Available: ${channelNames.join(", ") || "none"}`,
    );
  }

  // Resolve the model id: channel override, else agents.defaults.model, else the
  // OpenClaw house default.
  const agents = isRecord(parsed.agents) ? parsed.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  const channelModel = typeof selected.model === "string" ? selected.model : undefined;
  const defaultModel =
    defaults && typeof defaults.model === "string" ? defaults.model : undefined;
  const rawModel = channelModel ?? defaultModel ?? "anthropic/claude-opus-4-8";
  const { provider, model } = splitModelId(rawModel);

  // Determine the runtime from agents.defaults.models[<rawModel>].agentRuntime.id.
  const defaultsModels =
    defaults && isRecord(defaults.models) ? defaults.models : undefined;
  const modelEntry =
    defaultsModels && isRecord(defaultsModels[rawModel]) ? defaultsModels[rawModel] : undefined;
  const agentRuntime =
    modelEntry && isRecord(modelEntry.agentRuntime) ? modelEntry.agentRuntime : undefined;
  // When the channel's model has no explicit agentRuntime, leave the id empty so
  // resolveTarget picks by the model's PROVIDER (anthropic -> claude-code, else
  // native). Defaulting to "claude-cli" here forced even non-Anthropic models
  // onto the claude-code runtime, silently running the wrong model.
  const openclawRuntimeId =
    agentRuntime && typeof agentRuntime.id === "string" ? agentRuntime.id : "";
  const target = resolveTarget(openclawRuntimeId, provider);

  // Selectivity accounting: every OTHER channel is excluded; every agent model
  // entry that is not the one we resolved is an excluded agent.
  const excludedChannels = channelNames.filter((name) => name !== options.profile);
  const modelEntryNames = defaultsModels ? Object.keys(defaultsModels) : [];
  const excludedAgents = modelEntryNames.filter((name) => name !== rawModel).length;

  const customCommands = extractCustomCommands(selected, options.profile);
  const commandsMigrated = customCommands.length;
  const agentSkillVisibility = carryOpenclawAgentSkillVisibility(parsed, options.profile);
  const skills = carryOpenclawSkills(parsed, options.profile);
  const tools = carryOpenclawTools(parsed);
  const plugins = carryOpenclawPlugins(parsed);
  const devices = carryOpenclawDevices(parsed, options.profile);

  // Does this channel need a bot token to run? We only ever check for the
  // PRESENCE of a secret-keyed field — never read its value.
  let tokenEnvRef: string | undefined;
  const needsBotToken = Object.keys(selected).some((key) => SECRET_KEY_PATTERN.test(key));
  if (needsBotToken) tokenEnvRef = TELEGRAM_TOKEN_ENV;

  // Build a MusterConfig whose default routing sends `muster run "<prompt>"` to
  // the resolved runtime + model. A claude-code runtime shells to the local
  // `claude` binary, so we give it an anthropic provider with apiKeyEnv pointing
  // at ANTHROPIC_API_KEY (unused by the CLI path, but keeps planRun's provider
  // lookup valid) and route EVERY task kind at the resolved model.
  const base = defaultConfig();
  const providerId = target.providerId;
  const providerEntry = {
    id: providerId,
    kind: target.providerKind,
    defaultModel: model,
    timeoutMs: 120_000,
    ...(target.apiKeyEnv ? { apiKeyEnv: target.apiKeyEnv } : {}),
    ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}),
  };
  const route = { provider: providerId, model };
  const config: MusterConfig = {
    ...base,
    providers: { ...base.providers, [providerId]: providerEntry },
    runtimes: {
      ...base.runtimes,
      [target.runtime]: {
        id: target.runtime,
        enabled: true,
        provider: providerId,
        routes: {
          simple_qa: { ...route, reasoning: "low" },
          research: { ...route, reasoning: "medium" },
          architecture: { ...route, reasoning: "high" },
          coding: { ...route, reasoning: "high" },
          private_analysis: { ...route, reasoning: "medium" },
        },
      },
    },
    routing: { ...base.routing, defaultRuntime: target.runtime },
    // Faithful identity so the migrated agent knows what it is (injected at the
    // SYSTEM level by run.ts, never narrated). Carries the source channel, not a
    // Claude default.
    identity: {
      name: options.outProfile,
      description: `muster profile "${options.outProfile}", migrated from the OpenClaw "${options.profile}" channel, running ${model} via the ${target.runtime} runtime.`,
      ...(tokenEnvRef ? { persona: "You operate as a chat assistant over a messaging surface; keep replies concise and chat-friendly." } : {}),
    },
    ...(agentSkillVisibility ? { agents: agentSkillVisibility } : {}),
    ...(skills ? { skills } : {}),
    ...(tools ? { tools } : {}),
    ...(plugins ? { plugins } : {}),
  };

  // Record (redacted) that this profile expects a channel bot token via env. We
  // attach it under a non-routing key so the placeholder is visible to an
  // operator inspecting the file, while the secret VALUE is never present.
  const materialized: Record<string, unknown> = { ...config };
  if (tokenEnvRef) {
    materialized.channel = {
      name: options.profile,
      // The literal placeholder env reference — NEVER the real token value.
      botToken: TELEGRAM_TOKEN_PLACEHOLDER,
      tokenEnvRef,
    };
  }

  // Refuse to clobber an existing profile (createProfile's mkdir is recursive and
  // would silently overwrite the config otherwise).
  if (existsSync(join(profilesRoot(cwd), options.outProfile))) {
    throw new Error(`Profile "${options.outProfile}" already exists; choose a new --out name.`);
  }
  // Create the target profile dir, then write the config to ITS scoped path
  // (not the active profile). createProfile makes the data dir; we make the
  // config's parent dir defensively before writing.
  await createProfile(options.outProfile, cwd);
  const outPath = profileConfigWritePath(cwd, options.outProfile);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(materialized, null, 2)}\n`, "utf8");
  if (customCommands.length || devices.length) {
    await upsertGatewayMigrationData(cwd, {
      commands: customCommands,
      devices,
      sourceChannel: options.profile,
    });
  }

  return {
    outProfile: options.outProfile,
    channel: options.profile,
    provider: providerId,
    model,
    runtime: target.runtime,
    commandsMigrated,
    excludedChannels,
    excludedAgents,
    configPath: outPath,
    tokenEnvRef,
    skillsCarried: countSkillCarry(skills),
    toolsCarried: countToolCarry(tools),
    pluginsCarried: countPluginCarry(plugins),
    devicesCarried: devices.length,
  };
}

interface MigratedDeviceRecord {
  readonly id: string;
  readonly sourceId?: string;
  readonly surfaceId?: string;
  readonly accountId?: string;
  readonly scopes: readonly string[];
}

async function upsertGatewayMigrationData(
  cwd: string,
  input: {
    readonly commands: readonly MigratedCustomCommand[];
    readonly devices: readonly MigratedDeviceRecord[];
    readonly sourceChannel: string;
  }
): Promise<void> {
  const path = join(cwd, ".muster", "gateway.json");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    parsed = { token: randomBytes(24).toString("hex") };
  }
  if (typeof parsed.token !== "string" || !parsed.token.trim()) {
    parsed.token = randomBytes(24).toString("hex");
  }
  const commandsRoot = isRecord(parsed.commands) ? parsed.commands : {};
  const entries: Record<string, unknown> = isRecord(commandsRoot.entries) ? { ...commandsRoot.entries } : {};
  for (const command of input.commands) {
    const existing: Record<string, unknown> = isRecord(entries[command.name]) ? entries[command.name] as Record<string, unknown> : {};
    entries[command.name] = {
      ...existing,
      ...(command.description ? { description: command.description } : {}),
      ...(command.prompt ? { prompt: command.prompt } : {}),
      surfaces: command.surfaces,
      source: "openclaw",
      sourceChannel: input.sourceChannel,
    };
  }
  if (input.commands.length) parsed.commands = { ...commandsRoot, entries };

  const devicesRoot = isRecord(parsed.devices) ? parsed.devices : {};
  const deviceEntries: Record<string, unknown> = isRecord(devicesRoot.entries) ? { ...devicesRoot.entries } : {};
  const migratedAt = new Date().toISOString();
  for (const device of input.devices) {
    const existing: Record<string, unknown> = isRecord(deviceEntries[device.id]) ? deviceEntries[device.id] as Record<string, unknown> : {};
    deviceEntries[device.id] = {
      ...existing,
      source: "openclaw",
      ...(device.sourceId ? { sourceId: device.sourceId } : {}),
      ...(device.surfaceId ? { surfaceId: device.surfaceId } : {}),
      ...(device.accountId ? { accountId: device.accountId } : {}),
      scopes: device.scopes,
      approved: false,
      migratedAt,
    };
  }
  if (input.devices.length) parsed.devices = { ...devicesRoot, entries: deviceEntries };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function carryOpenclawAgentSkillVisibility(config: Record<string, unknown>, profile: string): AgentsConfig | undefined {
  const agents = isRecord(config.agents) ? config.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  const list = agents && Array.isArray(agents.list) ? agents.list : undefined;
  const profileAgent = list?.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.id === profile);
  const defaultSkills = stringArray(defaults?.skills);
  const profileSkills = stringArray(profileAgent?.skills);
  const next: AgentsConfig = {
    ...(defaultSkills.length ? { defaults: { skills: defaultSkills } } : {}),
    ...(profileSkills.length ? { list: [{ id: profile, skills: profileSkills }] } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

function carryOpenclawSkills(config: Record<string, unknown>, _profile: string): SkillRuntimeConfig | undefined {
  const source = isRecord(config.skills) ? config.skills : undefined;

  const load = isRecord(source?.load)
    ? {
        ...(stringArray(source.load.extraDirs).length ? { extraDirs: stringArray(source.load.extraDirs) } : {}),
        ...(typeof source.load.includeHomeDirs === "boolean" ? { includeHomeDirs: source.load.includeHomeDirs } : {}),
      }
    : undefined;
  const entries = isRecord(source?.entries) ? skillEntriesFrom(source.entries) : undefined;

  const next: SkillRuntimeConfig = {
    ...(load && Object.keys(load).length ? { load } : {}),
    ...(entries && Object.keys(entries).length ? { entries } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

function skillEntriesFrom(entries: Record<string, unknown>): Record<string, SkillRuntimeEntryConfig> {
  const carried: Record<string, SkillRuntimeEntryConfig> = {};
  for (const [rawName, rawEntry] of Object.entries(entries)) {
    const name = normalizeConfigKey(rawName);
    if (!name || !isRecord(rawEntry)) continue;
    const config = sanitizeRecord(rawEntry.config);
    const apiKey = migrateApiKey(rawEntry.apiKey, rawName);
    const entry: SkillRuntimeEntryConfig = {
      ...(typeof rawEntry.enabled === "boolean" ? { enabled: rawEntry.enabled } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(config && Object.keys(config).length ? { config } : {}),
    };
    if (Object.keys(entry).length) carried[name] = entry;
  }
  return carried;
}

function carryOpenclawPlugins(config: Record<string, unknown>): CapabilityPluginPolicy | undefined {
  const source = isRecord(config.plugins) ? config.plugins : undefined;
  if (!source) return undefined;
  const allow = stringArray(source.allow);
  const deny = stringArray(source.deny);
  const loadPaths = stringArray(isRecord(source.load) ? source.load.paths : undefined);
  const slots = stringRecord(source.slots);
  const entriesSource = isRecord(source.entries) ? source.entries : {};
  const entries: Record<string, CapabilityPluginEntry> = {};
  for (const [rawName, rawEntry] of Object.entries(entriesSource)) {
    const name = normalizeConfigKey(rawName);
    if (!name || !isRecord(rawEntry)) continue;
    const configBag = stringRecord(rawEntry.config);
    const entry: CapabilityPluginEntry = {
      // Migrated executable plugins are visible but disabled until a local pack
      // path and review policy are chosen.
      enabled: rawEntry.enabled === true ? false : rawEntry.enabled === false ? false : false,
      ...(Object.keys(configBag).length ? { config: configBag } : {}),
    };
    entries[name] = entry;
  }
  const policy: CapabilityPluginPolicy = {
    ...(allow.length ? { allow } : {}),
    ...(deny.length ? { deny } : {}),
    ...(Object.keys(slots).length ? { slots } : {}),
    ...(loadPaths.length ? { load: { paths: loadPaths } } : {}),
    ...(Object.keys(entries).length ? { entries } : {}),
  };
  return Object.keys(policy).length ? policy : undefined;
}

function carryOpenclawTools(config: Record<string, unknown>): ToolRuntimeConfig | undefined {
  const source = isRecord(config.tools) ? config.tools : undefined;
  const allow = stringArray(source?.allow ?? source?.include);
  const deny = stringArray(source?.deny ?? source?.exclude);
  const entries = isRecord(source?.entries) ? toolEntriesFrom(source.entries) : undefined;
  const servers = extractMcpServers(config);
  const carried: ToolRuntimeConfig = {
    ...(allow.length ? { allow } : {}),
    ...(deny.length ? { deny } : {}),
    ...(entries && Object.keys(entries).length ? { entries } : {}),
    ...(Object.keys(servers).length ? { mcp: { servers } } : {}),
  };
  return Object.keys(carried).length ? carried : undefined;
}

function toolEntriesFrom(entries: Record<string, unknown>): Record<string, ToolRuntimeEntryConfig> {
  const carried: Record<string, ToolRuntimeEntryConfig> = {};
  for (const [rawName, rawEntry] of Object.entries(entries)) {
    const name = normalizeConfigKey(rawName);
    if (!name || !isRecord(rawEntry)) continue;
    const config = sanitizeRecord(rawEntry.config);
    const entry: ToolRuntimeEntryConfig = {
      ...(typeof rawEntry.enabled === "boolean" ? { enabled: rawEntry.enabled } : {}),
      ...(typeof rawEntry.source === "string" ? { source: rawEntry.source } : { source: "openclaw" }),
      ...(config && Object.keys(config).length ? { config } : {}),
    };
    carried[name] = entry;
  }
  return carried;
}

function extractMcpServers(config: Record<string, unknown>): Record<string, McpServerConfig> {
  const mcp = isRecord(config.mcp) ? config.mcp : undefined;
  const sourceServers = isRecord(mcp?.servers) ? mcp.servers : isRecord(mcp) ? mcp : {};
  const servers: Record<string, McpServerConfig> = {};
  for (const [rawName, rawServer] of Object.entries(sourceServers)) {
    const name = normalizeConfigKey(rawName);
    if (!name || !isRecord(rawServer)) continue;
    const server = migrateMcpServer(rawServer);
    if (server) servers[name] = server;
  }
  return servers;
}

function migrateMcpServer(raw: Record<string, unknown>): McpServerConfig | undefined {
  const transport = isRecord(raw.transport) ? raw.transport : raw;
  const kind = typeof transport.kind === "string" ? transport.kind : typeof transport.url === "string" ? "http" : "stdio";
  const tools = isRecord(raw.tools)
    ? {
        ...(stringArray(raw.tools.include).length ? { include: stringArray(raw.tools.include) } : {}),
        ...(stringArray(raw.tools.exclude).length ? { exclude: stringArray(raw.tools.exclude) } : {}),
      }
    : undefined;
  const limits = isRecord(raw.limits)
    ? {
        ...(numberField(raw.limits, "toolTimeoutMs") ? { toolTimeoutMs: numberField(raw.limits, "toolTimeoutMs") } : {}),
        ...(numberField(raw.limits, "maxResultChars") ? { maxResultChars: numberField(raw.limits, "maxResultChars") } : {}),
        ...(numberField(raw.limits, "maxCallsPerTurn") ? { maxCallsPerTurn: numberField(raw.limits, "maxCallsPerTurn") } : {}),
      }
    : undefined;

  if (kind === "http" && typeof transport.url === "string") {
    return {
      transport: { kind: "http", url: transport.url, ...(stringRecord(transport.headers) ? { headers: stringRecord(transport.headers) } : {}) },
      ...(tools && Object.keys(tools).length ? { tools } : {}),
      ...(limits && Object.keys(limits).length ? { limits } : {}),
    };
  }
  if (typeof transport.command !== "string" || !transport.command.trim()) return undefined;
  return {
    transport: {
      kind: "stdio",
      command: transport.command,
      ...(stringArray(transport.args).length ? { args: stringArray(transport.args) } : {}),
      ...(Object.keys(stringRecord(transport.env)).length ? { env: stringRecord(transport.env) } : {}),
    },
    ...(tools && Object.keys(tools).length ? { tools } : {}),
    ...(limits && Object.keys(limits).length ? { limits } : {}),
  };
}

function carryOpenclawDevices(config: Record<string, unknown>, profile: string): MigratedDeviceRecord[] {
  const devices = isRecord(config.devices) ? config.devices : undefined;
  const entries = Array.isArray(devices?.entries)
    ? devices.entries
    : isRecord(devices?.entries)
      ? Object.entries(devices.entries).map(([id, value]) => isRecord(value) ? { id, ...value } : { id })
      : [];
  const carried: MigratedDeviceRecord[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const sourceId = stringField(entry, "id") ?? stringField(entry, "deviceId") ?? stringField(entry, "pairingId");
    const surfaceId = stringField(entry, "surfaceId") ?? stringField(entry, "channel") ?? profile;
    const accountId = stringField(entry, "accountId");
    const id = normalizeConfigKey(sourceId ?? `${surfaceId}-${accountId ?? "default"}`);
    if (!id) continue;
    carried.push({
      id,
      ...(sourceId ? { sourceId } : {}),
      ...(surfaceId ? { surfaceId } : {}),
      ...(accountId ? { accountId } : {}),
      scopes: stringArray(entry.scopes),
    });
  }
  return carried;
}

function migrateApiKey(value: unknown, nameHint: string): SkillRuntimeEntryConfig["apiKey"] | undefined {
  if (isRecord(value) && value.source === "env" && typeof value.id === "string") {
    return {
      source: "env",
      ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
      id: value.id,
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { source: "env", id: `${normalizeEnvPrefix(nameHint)}_API_KEY` };
  }
  return undefined;
}

function sanitizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = `\${${normalizeEnvPrefix(key)}}`;
      continue;
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      out[key] = raw;
    } else if (Array.isArray(raw)) {
      out[key] = raw.filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null);
    } else if (isRecord(raw)) {
      const nested = sanitizeRecord(raw);
      if (nested && Object.keys(nested).length) out[key] = nested;
    }
  }
  return out;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = `\${${normalizeEnvPrefix(key)}}`;
    } else if (typeof raw === "string") {
      out[key] = SECRET_KEY_PATTERN.test(raw) ? `\${${normalizeEnvPrefix(key)}}` : raw;
    }
  }
  return out;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeConfigKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_./:@]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeEnvPrefix(raw: string): string {
  const value = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return value || "MIGRATED_SECRET";
}

function countSkillCarry(skills: SkillRuntimeConfig | undefined): number {
  return (skills?.load ? 1 : 0) + Object.keys(skills?.entries ?? {}).length;
}

function countToolCarry(tools: ToolRuntimeConfig | undefined): number {
  return (tools?.allow?.length ?? 0) + (tools?.deny?.length ?? 0) + Object.keys(tools?.entries ?? {}).length + Object.keys(tools?.mcp?.servers ?? {}).length;
}

function countPluginCarry(plugins: CapabilityPluginPolicy | undefined): number {
  return (plugins?.allow?.length ?? 0) + (plugins?.deny?.length ?? 0) + Object.keys(plugins?.entries ?? {}).length + Object.keys(plugins?.slots ?? {}).length + (plugins?.load?.paths?.length ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assetFromRule(rule: AssetRule, path: string, noteSuffix = ""): MigrationAsset {
  return {
    kind: rule.kind,
    path,
    importMode: rule.importMode,
    note: noteSuffix ? `${rule.note} ${noteSuffix}` : rule.note
  };
}

function nextActions(
  source: MigrationSource,
  assets: MigrationAsset[],
  openclaw?: { profile?: string; channelNames: string[]; profileScoped: boolean }
): string[] {
  if (!assets.length) {
    return [`${source} root exists, but no known importable assets were discovered.`];
  }
  const actions = [
    "Review dry-run report for secrets or stale state.",
    "Create a backup before apply.",
    "Import mappable assets into Muster state.",
    "Archive unknown or historical state without activating it.",
    "Run doctor and generated evals after migration."
  ];
  if (source === "openclaw" && openclaw) {
    if (openclaw.profile) {
      const hasShared = assets.some((asset) => asset.kind !== "channel");
      actions.unshift(
        openclaw.profileScoped
          ? hasShared
            ? `Profile "${openclaw.profile}" selected: only the channels.${openclaw.profile} entry is profile-specific. The other listed assets (agent, memory, flows, extensions) are instance-wide — shared by all channels, not part of this profile.`
            : `Only the "${openclaw.profile}" channel/profile is selected for migration.`
          : `Requested profile "${openclaw.profile}" was not found among channels (${openclaw.channelNames.join(", ") || "none"}).`
      );
    } else if (openclaw.channelNames.length) {
      actions.unshift(
        `Available channels/profiles: ${openclaw.channelNames.join(", ")}. Pass --profile <name> to select one.`
      );
    }
  }
  return actions;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listChildren(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => join(path, entry.name)).sort();
}
