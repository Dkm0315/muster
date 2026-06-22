import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import { loadConfig, saveConfig } from "./config.js";
import { archiveSkill, writeBundledSkill } from "./skills.js";

export type BuiltinCatalogSource = "hermes" | "openclaw" | "muster";
export type BuiltinRisk = "low" | "medium" | "high";

export interface BuiltinSkillCatalogEntry {
  readonly id: string;
  readonly category: string;
  readonly source: BuiltinCatalogSource;
  readonly description: string;
  readonly risk: BuiltinRisk;
  readonly tags: readonly string[];
  readonly requires?: readonly string[];
}

export interface BuiltinPluginCatalogEntry {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly category: string;
  readonly source: BuiltinCatalogSource;
  readonly description: string;
  readonly risk: BuiltinRisk;
  readonly slot?: string;
  readonly packPath?: string;
}

const HERMES_SKILLS: readonly BuiltinSkillCatalogEntry[] = [
  skill("plan", "software-development", "hermes", "Plan mode: inspect context, write an implementation plan, do not execute.", "low", ["planning"]),
  skill("systematic-debugging", "software-development", "hermes", "Debug in phases: reproduce, isolate, explain root cause, then patch.", "low", ["debugging", "quality"]),
  skill("test-driven-development", "software-development", "hermes", "Use red-green-refactor when risk warrants tests before implementation.", "low", ["testing"]),
  skill("requesting-code-review", "software-development", "hermes", "Pre-commit review of local changes for bugs, security, and missing tests.", "low", ["review", "security"]),
  skill("simplify-code", "software-development", "hermes", "Reduce recent code complexity while preserving behavior and tests.", "low", ["refactor"]),
  skill("spike", "software-development", "hermes", "Run a small throwaway experiment before committing to a design.", "low", ["prototype"]),
  skill("node-inspect-debugger", "software-development", "hermes", "Debug Node.js with inspector-oriented steps and reproducible evidence.", "medium", ["debugging", "node"], ["node"]),
  skill("python-debugpy", "software-development", "hermes", "Debug Python with pdb/debugpy style workflows and narrow repros.", "medium", ["debugging", "python"], ["python"]),
  skill("github-code-review", "github", "hermes", "Review pull requests or local diffs and prepare actionable findings.", "medium", ["github", "review"], ["git"]),
  skill("github-pr-workflow", "github", "hermes", "Create branches, commits, pull requests, and track CI in a disciplined workflow.", "medium", ["github", "git"], ["git"]),
  skill("github-issues", "github", "hermes", "Create, triage, label, and update GitHub issues from terminal context.", "medium", ["github", "issues"], ["gh"]),
  skill("github-auth", "github", "hermes", "Guide GitHub HTTPS token, SSH, and gh CLI authentication setup.", "medium", ["github", "auth"], ["git"]),
  skill("codebase-inspection", "github", "hermes", "Inspect repository size, languages, ownership, and hotspots before edits.", "low", ["inspection", "codebase"]),
  skill("claude-code", "autonomous-ai-agents", "hermes", "Delegate a bounded coding task to Claude Code when configured.", "medium", ["delegate", "claude"], ["claude"]),
  skill("codex", "autonomous-ai-agents", "hermes", "Delegate a bounded coding task to Codex when configured.", "medium", ["delegate", "codex"], ["codex"]),
  skill("opencode", "autonomous-ai-agents", "hermes", "Delegate a bounded coding task to OpenCode when configured.", "medium", ["delegate"], ["opencode"]),
  skill("architecture-diagram", "creative", "hermes", "Design clear architecture diagrams with labeled components and flows.", "low", ["diagram"]),
  skill("ascii-art", "creative", "hermes", "Create terminal-friendly ASCII art and banners with explicit sizing.", "low", ["ascii", "creative"]),
  skill("excalidraw", "creative", "hermes", "Draft hand-drawn style diagram JSON for architecture and workflows.", "low", ["diagram"]),
  skill("humanizer", "creative", "hermes", "Rewrite text to remove AI stiffness and preserve a human voice.", "low", ["writing"]),
  skill("popular-web-designs", "creative", "hermes", "Use real product design-system references for web UI direction.", "low", ["design", "frontend"]),
  skill("jupyter-live-kernel", "data-science", "hermes", "Use an iterative Jupyter-style workflow for data analysis.", "medium", ["data", "python"], ["python"]),
  skill("himalaya", "email", "hermes", "Operate email through a local CLI with search, draft, and send guardrails.", "high", ["email"], ["himalaya"]),
  skill("youtube-content", "media", "hermes", "Turn YouTube transcripts into summaries, threads, and notes.", "medium", ["media", "summary"]),
  skill("gif-search", "media", "hermes", "Search and download GIFs with terminal tools.", "medium", ["media"]),
  skill("huggingface-hub", "mlops", "hermes", "Search, download, and upload Hugging Face models or datasets.", "medium", ["mlops", "huggingface"], ["hf"]),
  skill("llama-cpp", "mlops", "hermes", "Run and inspect local GGUF inference through llama.cpp.", "medium", ["local-models"], ["llama-cli"]),
  skill("lm-evaluation-harness", "mlops", "hermes", "Evaluate models with benchmark harness workflows and result hygiene.", "medium", ["evals"]),
  skill("vllm", "mlops", "hermes", "Serve LLMs through vLLM and OpenAI-compatible endpoints.", "medium", ["serving"], ["vllm"]),
  skill("weights-and-biases", "mlops", "hermes", "Track ML experiments, sweeps, and model registry workflows.", "medium", ["mlops"], ["wandb"]),
  skill("obsidian", "note-taking", "hermes", "Read, search, create, and edit notes in an Obsidian vault.", "medium", ["notes"]),
  skill("airtable", "productivity", "hermes", "Work with Airtable records, filters, and upserts through API-safe steps.", "high", ["productivity", "database"]),
  skill("google-workspace", "productivity", "hermes", "Handle Gmail, Calendar, Drive, Docs, and Sheets workflows with auth checks.", "high", ["google", "productivity"]),
  skill("maps", "productivity", "hermes", "Geocode, route, and inspect locations with open map services.", "medium", ["maps"]),
  skill("notion", "productivity", "hermes", "Create and update Notion pages or databases with schema awareness.", "high", ["notion"]),
  skill("ocr-and-documents", "productivity", "hermes", "Extract text from PDFs and scanned documents with OCR workflows.", "medium", ["ocr", "documents"]),
  skill("powerpoint", "productivity", "hermes", "Create, read, and edit PowerPoint decks with templates and notes.", "medium", ["slides"]),
  skill("arxiv", "research", "hermes", "Search arXiv papers and produce cited research notes.", "medium", ["research"]),
  skill("blogwatcher", "research", "hermes", "Monitor RSS/Atom feeds and summarize changes.", "medium", ["research", "monitoring"]),
  skill("llm-wiki", "research", "hermes", "Build and query a linked markdown knowledge base.", "low", ["knowledge-base"]),
  skill("polymarket", "research", "hermes", "Query prediction-market data with caveats and source links.", "medium", ["research", "markets"]),
  skill("research-paper-writing", "research", "hermes", "Plan and draft ML research papers from experiment to submission.", "low", ["writing", "research"]),
  skill("browser-control", "web", "openclaw", "Operate browser tasks with explicit user-visible steps and screenshots.", "high", ["browser", "automation"]),
  skill("database-query", "data", "openclaw", "Translate natural language to SQL only after schema inspection and approval.", "high", ["database", "sql"]),
  skill("screenshot-ocr", "productivity", "openclaw", "Capture screenshots and extract visible text for debugging/documentation.", "medium", ["ocr", "screenshot"]),
  skill("workflow-automation", "automation", "openclaw", "Design multi-step automations with triggers, approvals, and rollback notes.", "high", ["automation"]),
  skill("frontend-design", "creative", "openclaw", "Design production UI with accessible components and visual QA.", "low", ["frontend", "design"]),
  skill("deep-research", "research", "openclaw", "Run multi-source research with citations, disagreement tracking, and recency checks.", "medium", ["research"]),
];

const BUILTIN_PLUGINS: readonly BuiltinPluginCatalogEntry[] = [
  plugin("frappe-federated-bridge", "business-apps", "muster", "Frappe/ERPNext capability pack for identity, records, and governed actions.", "high", "business-app", "capability-packs/frappe", ["frappe"]),
  plugin("browser", "web", "openclaw", "Browser automation capability surface; should stay permissioned and screenshot-auditable.", "high", "browser"),
  plugin("web-search", "web", "openclaw", "Search/fetch provider surface for cited research and retrieval.", "medium", "search"),
  plugin("github", "developer", "hermes", "GitHub issue, PR, repository, and review workflows.", "medium", "developer"),
  plugin("codex", "agent-runtime", "hermes", "Codex delegation runtime and task routing.", "medium", "agent-runtime"),
  plugin("claude-code", "agent-runtime", "hermes", "Claude Code delegation runtime and skill snapshot bridge.", "medium", "agent-runtime"),
  plugin("openai", "provider", "openclaw", "OpenAI provider preset and compatible model routing.", "medium", "provider"),
  plugin("anthropic", "provider", "openclaw", "Anthropic/Claude provider preset and compatible model routing.", "medium", "provider"),
  plugin("ollama", "provider", "muster", "Local OpenAI-compatible model provider via Ollama.", "low", "provider"),
  plugin("slack", "channel", "openclaw", "Slack channel adapter candidate; requires explicit bot credentials.", "high", "channel"),
  plugin("discord", "channel", "openclaw", "Discord channel adapter candidate; requires explicit bot credentials.", "high", "channel"),
  plugin("whatsapp", "channel", "openclaw", "WhatsApp channel adapter candidate; requires pairing and strict DM policy.", "high", "channel"),
  plugin("teams", "channel", "openclaw", "Microsoft Teams channel adapter candidate.", "high", "channel"),
  plugin("google-workspace", "productivity", "hermes", "Google Workspace workflows requiring OAuth-backed tools.", "high", "productivity"),
  plugin("notion", "productivity", "hermes", "Notion pages/database workflows requiring explicit API credentials.", "high", "productivity"),
  plugin("airtable", "productivity", "hermes", "Airtable CRUD workflow surface requiring explicit token configuration.", "high", "productivity"),
  plugin("jupyter", "data-science", "hermes", "Notebook/live-kernel execution surface.", "medium", "data"),
  plugin("huggingface", "mlops", "hermes", "Hugging Face model/dataset workflows.", "medium", "mlops"),
  plugin("vllm", "mlops", "hermes", "vLLM serving and inspection workflows.", "medium", "mlops"),
  plugin("obsidian", "knowledge", "hermes", "Local notes and vault workflow surface.", "medium", "knowledge"),
];

export function listBuiltinSkills(): readonly BuiltinSkillCatalogEntry[] {
  return HERMES_SKILLS;
}

export function listBuiltinPlugins(): readonly BuiltinPluginCatalogEntry[] {
  return BUILTIN_PLUGINS;
}

export async function enableBuiltinSkill(id: string, cwd = process.cwd()): Promise<BuiltinSkillCatalogEntry> {
  const entry = findBuiltinSkill(id);
  await writeBundledSkill({
    name: entry.id,
    description: entry.description,
    tags: [...entry.tags, `source:${entry.source}`, `category:${entry.category}`],
    frontmatter: { userInvocable: true },
    openclaw: {
      always: entry.risk === "low",
      requires: entry.requires?.length ? { anyBins: entry.requires } : undefined,
    },
    body: renderBuiltinSkillBody(entry),
  }, cwd);
  const config = await loadConfig(cwd);
  await saveConfig({
    ...config,
    skills: {
      ...config.skills,
      entries: {
        ...(config.skills?.entries ?? {}),
        [entry.id]: { ...(config.skills?.entries?.[entry.id] ?? {}), enabled: true },
      },
    },
  }, cwd);
  return entry;
}

export async function disableBuiltinSkill(id: string, cwd = process.cwd()): Promise<BuiltinSkillCatalogEntry> {
  const entry = findBuiltinSkill(id);
  await archiveSkill(entry.id, cwd).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("Skill not found")) return;
    throw error;
  });
  const config = await loadConfig(cwd);
  await saveConfig({
    ...config,
    skills: {
      ...config.skills,
      entries: {
        ...(config.skills?.entries ?? {}),
        [entry.id]: { ...(config.skills?.entries?.[entry.id] ?? {}), enabled: false },
      },
    },
  }, cwd);
  return entry;
}

export async function enableBuiltinPlugin(
  id: string,
  cwd = process.cwd(),
  options: { readonly allowHighRisk?: boolean } = {},
): Promise<BuiltinPluginCatalogEntry> {
  const entry = findBuiltinPlugin(id);
  if (entry.risk === "high" && !options.allowHighRisk) {
    throw new Error(`Built-in plugin "${entry.id}" is high risk and requires --allow-high-risk.`);
  }
  const config = await loadConfig(cwd);
  const packPath = await resolvePackPath(entry);
  const loadPaths = new Set(config.plugins?.load?.paths ?? []);
  if (packPath) loadPaths.add(packPath);
  await saveConfig({
    ...config,
    plugins: {
      ...config.plugins,
      allow: [...new Set([...(config.plugins?.allow ?? []), entry.id])],
      slots: entry.slot ? { ...(config.plugins?.slots ?? {}), [entry.slot]: entry.id } : config.plugins?.slots,
      load: loadPaths.size ? { paths: [...loadPaths] } : config.plugins?.load,
      entries: {
        ...(config.plugins?.entries ?? {}),
        [entry.id]: { ...(config.plugins?.entries?.[entry.id] ?? {}), enabled: true },
      },
    },
  }, cwd);
  return entry;
}

export async function disableBuiltinPlugin(id: string, cwd = process.cwd()): Promise<BuiltinPluginCatalogEntry> {
  const entry = findBuiltinPlugin(id);
  const config = await loadConfig(cwd);
  const packPath = await resolvePackPath(entry);
  const allow = (config.plugins?.allow ?? []).filter((candidate) => candidate !== entry.id);
  const loadPaths = (config.plugins?.load?.paths ?? []).filter((candidate) => candidate !== packPath);
  const slots = Object.fromEntries(Object.entries(config.plugins?.slots ?? {}).filter(([, owner]) => owner !== entry.id));
  await saveConfig({
    ...config,
    plugins: {
      ...config.plugins,
      allow,
      slots,
      load: loadPaths.length ? { paths: loadPaths } : undefined,
      entries: {
        ...(config.plugins?.entries ?? {}),
        [entry.id]: { ...(config.plugins?.entries?.[entry.id] ?? {}), enabled: false },
      },
    },
  }, cwd);
  return entry;
}

function findBuiltinSkill(id: string): BuiltinSkillCatalogEntry {
  const entry = HERMES_SKILLS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown built-in skill "${id}". Run muster skills catalog.`);
  return entry;
}

function findBuiltinPlugin(id: string): BuiltinPluginCatalogEntry {
  const entry = BUILTIN_PLUGINS.find((candidate) => candidate.id === id || candidate.aliases?.includes(id));
  if (!entry) throw new Error(`Unknown built-in plugin "${id}". Run muster plugins catalog.`);
  return entry;
}

function renderBuiltinSkillBody(entry: BuiltinSkillCatalogEntry): string {
  const requires = entry.requires?.length ? `\nPrerequisites: ${entry.requires.join(", ")}.\n` : "";
  return `Use this skill when the task matches: ${entry.description}

Source inspiration: ${entry.source}. This is a Muster-authored built-in profile, not a verbatim upstream copy.
Risk: ${entry.risk}. Ask for confirmation before using credentials, networked services, destructive writes, or broad filesystem access.
${requires}
Workflow:
1. Check whether required tools, credentials, files, or service access exist.
2. Keep the work scoped to the user's request and current workspace.
3. Prefer read/inspect steps before writes or external actions.
4. Report concrete results and any missing setup clearly.`;
}

function skill(
  id: string,
  category: string,
  source: BuiltinCatalogSource,
  description: string,
  risk: BuiltinRisk,
  tags: readonly string[],
  requires?: readonly string[],
): BuiltinSkillCatalogEntry {
  return { id, category, source, description, risk, tags, requires };
}

function plugin(
  id: string,
  category: string,
  source: BuiltinCatalogSource,
  description: string,
  risk: BuiltinRisk,
  slot?: string,
  packPath?: string,
  aliases?: readonly string[],
): BuiltinPluginCatalogEntry {
  return { id, aliases, category, source, description, risk, slot, packPath };
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

async function resolvePackPath(entry: BuiltinPluginCatalogEntry): Promise<string | undefined> {
  if (!entry.packPath) return undefined;
  for (const candidate of [
    join(repoRoot(), entry.packPath),
    join(repoRoot(), "..", entry.packPath),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", entry.packPath),
  ]) {
    if (await directoryExists(candidate)) return candidate;
  }
  return undefined;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
