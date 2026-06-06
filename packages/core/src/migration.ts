import { readdir, stat } from "node:fs/promises";
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
    | "provider"
    | "mcp"
    | "unknown";
  readonly path: string;
  readonly importMode: "map" | "archive_only" | "manual_review";
  readonly note: string;
}

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
      { relativePath: "config.json", kind: "config", importMode: "map", note: "Map legacy config if present." },
      { relativePath: "skills", kind: "skill", importMode: "manual_review", note: "Normalize skills and generate eval seeds.", recursive: true },
      { relativePath: "tools", kind: "tool", importMode: "manual_review", note: "Classify tool risk before enabling.", recursive: true },
      { relativePath: "memory", kind: "memory", importMode: "manual_review", note: "Import into governed memory ledger.", recursive: true },
      { relativePath: "mcp.json", kind: "mcp", importMode: "manual_review", note: "Convert MCP servers into scoped tool entries." }
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
      { relativePath: "workflows", kind: "workflow", importMode: "map", note: "Map pi workflow graphs directly into HybrowClaw flows.", recursive: true },
      { relativePath: "flows", kind: "workflow", importMode: "archive_only", note: "Persist historical flow runs as episode evidence.", recursive: true },
      { relativePath: "config.json", kind: "config", importMode: "map", note: "Map pi provider/runtime defaults." }
    ]
  }
};

export async function scanMigrationSource(
  source: MigrationSource,
  options: { homeDir?: string } = {}
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
    recommendedNextActions: nextActions(source, assets)
  };
}

function assetFromRule(rule: AssetRule, path: string, noteSuffix = ""): MigrationAsset {
  return {
    kind: rule.kind,
    path,
    importMode: rule.importMode,
    note: noteSuffix ? `${rule.note} ${noteSuffix}` : rule.note
  };
}

function nextActions(source: MigrationSource, assets: MigrationAsset[]): string[] {
  if (!assets.length) {
    return [`${source} root exists, but no known importable assets were discovered.`];
  }
  return [
    "Review dry-run report for secrets or stale state.",
    "Create a backup before apply.",
    "Import mappable assets into HybrowClaw state.",
    "Archive unknown or historical state without activating it.",
    "Run doctor and generated evals after migration."
  ];
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
