import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

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
  if (!isRecord(channel)) return 0;
  const commands = channel.commands;
  if (Array.isArray(commands)) return commands.length;
  if (isRecord(commands)) return Object.keys(commands).length;
  return 0;
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
      actions.unshift(
        openclaw.profileScoped
          ? `Only the "${openclaw.profile}" channel/profile is selected for migration.`
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
