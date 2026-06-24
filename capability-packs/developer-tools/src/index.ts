import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

interface PackageJson {
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly packageManager?: string;
}

interface RepoSnapshot {
  readonly root: string;
  readonly files: Set<string>;
  readonly packageJson?: PackageJson;
}

const MAX_FILE_BYTES = 180_000;
const MAX_WALK_ENTRIES = 1800;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".output", "coverage", "env", ".venv", "__pycache__"]);

const HERMES_DEVELOPMENT_TOOLSET_WEIGHTS: Record<string, number> = {
  terminal: 80,
  file: 80,
  reasoning: 60,
  web: 30,
  vision: 10,
};

const SAFE_COMMANDS = new Set(["test", "lint", "typecheck", "check", "build", "format:check", "doctor", "status"]);
const REVIEW_COMMAND_PATTERNS = [/^dev$/, /^start$/, /^preview$/, /^serve$/, /^bench (start|doctor|list-sites|--site <site> list-apps)$/];
const MUTATING_HINTS = /\b(migrate|deploy|publish|release|push|apply|write|create|delete|drop|seed|prisma migrate|db push|bench --site .* migrate)\b/i;

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rootFromArgs(args: Record<string, unknown>): string {
  const requested = stringArg(args, "rootPath");
  const cwd = process.cwd();
  if (!requested) return cwd;
  if (isAbsolute(requested)) return resolve(requested);
  const root = resolve(cwd, requested);
  const rel = relative(cwd, root);
  if (rel.startsWith("..") || rel === ".." || rel.split("/").includes("..")) {
    throw new Error("developer-tools rootPath must stay inside the current workspace.");
  }
  return root;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size > MAX_FILE_BYTES) return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function walk(root: string): Promise<Set<string>> {
  const found = new Set<string>();
  const queue = [root];
  while (queue.length && found.size < MAX_WALK_ENTRIES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full) || entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && (!entry.name.startsWith(".") || entry.name === ".github")) queue.push(full);
      } else if (entry.isFile()) {
        found.add(rel);
      }
      if (found.size >= MAX_WALK_ENTRIES) break;
    }
  }
  return found;
}

async function snapshot(root: string): Promise<RepoSnapshot> {
  const files = await walk(root);
  const raw = await readText(join(root, "package.json"));
  return { root, files, packageJson: raw ? safeJson(raw) : undefined };
}

function safeJson(raw: string): PackageJson | undefined {
  try {
    const parsed = JSON.parse(raw) as PackageJson;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasFile(files: Set<string>, names: readonly string[]): boolean {
  return names.some((name) => files.has(name) || [...files].some((file) => basename(file) === name));
}

function hasPrefix(files: Set<string>, prefix: string): boolean {
  return [...files].some((file) => file.startsWith(prefix));
}

function packageManager(repo: RepoSnapshot): string | undefined {
  if (repo.files.has("pnpm-lock.yaml")) return "pnpm";
  if (repo.files.has("yarn.lock")) return "yarn";
  if (repo.files.has("package-lock.json")) return "npm";
  if (repo.files.has("bun.lockb")) return "bun";
  return repo.packageJson ? "npm" : undefined;
}

function scriptCommand(pm: string | undefined, script: string): string {
  if (pm === "npm") return `npm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  return `${pm ?? "npm"} ${script}`;
}

function languages(repo: RepoSnapshot): string[] {
  const langs = new Set<string>();
  const deps = { ...(repo.packageJson?.dependencies ?? {}), ...(repo.packageJson?.devDependencies ?? {}) };
  if (deps.typescript || deps.tsx || deps.ts-node) langs.add("typescript");
  if (deps.react || deps.vue || deps.vite || deps.next || deps.nuxt || repo.packageJson) langs.add("javascript");
  for (const file of repo.files) {
    if (/\.(ts|tsx)$/.test(file)) langs.add("typescript");
    if (/\.(js|jsx|mjs|cjs)$/.test(file)) langs.add("javascript");
    if (/\.py$/.test(file) || file === "pyproject.toml") langs.add("python");
    if (/\.go$/.test(file) || file === "go.mod") langs.add("go");
    if (/\.rs$/.test(file) || file === "Cargo.toml") langs.add("rust");
    if (/\.php$/.test(file) || file === "composer.json") langs.add("php");
    if (/\.java$/.test(file) || file === "pom.xml" || file === "build.gradle") langs.add("java");
  }
  return [...langs].sort();
}

function workflowCommands(repo: RepoSnapshot) {
  const pm = packageManager(repo);
  const scripts = repo.packageJson?.scripts ?? {};
  const commands: Array<{ name: string; command: string; risk: "safe" | "review" | "mutating"; source: string }> = [];
  for (const [name, body] of Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b))) {
    const command = scriptCommand(pm, name);
    const risk = MUTATING_HINTS.test(name) || MUTATING_HINTS.test(body)
      ? "mutating"
      : SAFE_COMMANDS.has(name) || /^(test|lint|typecheck|check|build)(:|$)/.test(name)
        ? "safe"
        : REVIEW_COMMAND_PATTERNS.some((pattern) => pattern.test(name))
          ? "review"
          : "review";
    commands.push({ name, command, risk, source: "package.json scripts" });
  }
  if (hasFile(repo.files, ["sites/apps.txt"]) || (hasPrefix(repo.files, "apps/") && hasPrefix(repo.files, "sites/"))) {
    commands.push(
      { name: "frappe_list_sites", command: "bench list-sites", risk: "safe", source: "Frappe bench" },
      { name: "frappe_doctor", command: "bench doctor", risk: "safe", source: "Frappe bench" },
      { name: "frappe_migrate", command: "bench --site <site> migrate", risk: "mutating", source: "Frappe bench" },
    );
  }
  return commands;
}

function recommendedToolsets(taskKind: string | undefined, strict: boolean) {
  const base = [
    { toolset: "files", weight: HERMES_DEVELOPMENT_TOOLSET_WEIGHTS.file, reason: "Read, search, and patch workspace files." },
    { toolset: "git", weight: 75, reason: "Inspect status, diffs, branches, and commit context." },
    { toolset: "memory", weight: 50, reason: "Recall repo-specific decisions and prior debugging context." },
  ];
  if (!strict) base.push({ toolset: "shell", weight: HERMES_DEVELOPMENT_TOOLSET_WEIGHTS.terminal, reason: "Run allowlisted tests, builds, and diagnostics only." });
  if (taskKind === "debugging" || taskKind === "research") base.push({ toolset: "web", weight: HERMES_DEVELOPMENT_TOOLSET_WEIGHTS.web, reason: "Lookup current docs and errors when local evidence is insufficient." });
  if (taskKind === "ui" || taskKind === "frontend") base.push({ toolset: "browser", weight: 70, reason: "Use browser MCP for screenshot-backed UI checks." });
  base.push({ toolset: "reasoning", weight: HERMES_DEVELOPMENT_TOOLSET_WEIGHTS.reasoning, reason: "Keep planning/review explicit before mutating commands." });
  return base;
}

export async function developer_tools_repo_workflow(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const repo = await snapshot(root);
  return {
    root,
    packageManager: packageManager(repo),
    languages: languages(repo),
    workflows: workflowCommands(repo),
    markers: {
      git: repo.files.has(".gitignore") || hasPrefix(repo.files, ".github/"),
      ci: hasPrefix(repo.files, ".github/workflows/") || hasFile(repo.files, [".gitlab-ci.yml"]),
      docker: hasFile(repo.files, ["Dockerfile", "docker-compose.yml", "compose.yml"]),
      frappeBench: hasFile(repo.files, ["sites/apps.txt"]) || (hasPrefix(repo.files, "apps/") && hasPrefix(repo.files, "sites/")),
      monorepo: hasFile(repo.files, ["pnpm-workspace.yaml", "lerna.json", "turbo.json", "nx.json"]),
    },
    filesScanned: repo.files.size,
    truncated: repo.files.size >= MAX_WALK_ENTRIES,
  };
}

export async function developer_tools_surface_plan(args: Record<string, unknown>) {
  const taskKind = stringArg(args, "taskKind") ?? "coding";
  const strict = args.strict === true;
  return {
    taskKind,
    mode: strict ? "strict-read-first" : "development",
    sourceEvidence: [
      "Hermes development distribution: terminal 80, file 80, reasoning 60, web 30, vision 10.",
      "OpenClaw AgentCommandOpts supports per-run toolsAllow, provider/model overrides, and workspace/cwd separation.",
    ],
    toolsets: recommendedToolsets(taskKind, strict),
    mcp: [
      { id: "git", command: "muster mcp install git", default: true, reason: "Repository context with isolated MCP failure." },
      { id: "filesystem", command: "muster mcp install filesystem", default: false, reason: "High-risk broad file access; keep opt-in and workspace-scoped." },
      { id: "browser", command: "muster mcp install browser", default: taskKind === "ui" || taskKind === "frontend", reason: "Screenshot-backed frontend verification." },
      { id: "sqlite", command: "muster mcp install sqlite", default: false, reason: "Inspect local app state, logs, and Muster memory databases." },
    ],
    policy: {
      defaultShell: "deny-by-default",
      allowMutatingCommands: false,
      requireApprovalFor: ["migrate", "deploy", "publish", "release", "push", "delete", "drop"],
    },
  };
}

export async function developer_tools_command_policy(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const repo = await snapshot(root);
  const commands = workflowCommands(repo);
  return {
    root,
    allow: commands.filter((command) => command.risk === "safe"),
    review: commands.filter((command) => command.risk === "review"),
    blockedUntilExplicitApproval: commands.filter((command) => command.risk === "mutating"),
    notes: [
      "Commands are suggested from repository markers; this pack does not execute shell.",
      "Run through Muster's terminal tool or MCP layer so output is captured as evidence.",
      "Mutating commands need an explicit user confirmation and concrete target, especially Frappe site names and deploy environments.",
    ],
  };
}

export async function developer_tools_release_check(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const repo = await snapshot(root);
  const commands = workflowCommands(repo);
  const checks: Array<{ id: string; ok: boolean; severity: "low" | "medium" | "high"; detail: string }> = [];
  const check = (id: string, ok: boolean, severity: "low" | "medium" | "high", detail: string) => checks.push({ id, ok, severity, detail });

  check("tests", commands.some((command) => /^test(:|$)|^test$/.test(command.name)), "high", "A test command should be discoverable before release.");
  check("lint_or_typecheck", commands.some((command) => /^(lint|typecheck|check)(:|$)|^(lint|typecheck|check)$/.test(command.name)), "medium", "Lint/typecheck/check command helps catch regressions.");
  check("build", commands.some((command) => /^build(:|$)|^build$/.test(command.name)), "medium", "Build command verifies distributable artifacts.");
  check("ci", hasPrefix(repo.files, ".github/workflows/") || hasFile(repo.files, [".gitlab-ci.yml"]), "medium", "CI should run the same checks as local release gates.");
  check("changelog_or_release_notes", hasFile(repo.files, ["CHANGELOG.md", "RELEASE.md", "RELEASE_NOTES.md"]), "low", "Release notes or changelog make user-facing changes auditable.");
  check("env_template", hasFile(repo.files, [".env.example", ".env.sample", "example.env"]), "low", "Env templates help users configure integrations without leaking secrets.");

  return {
    root,
    ready: checks.every((item) => item.ok || item.severity === "low"),
    checks,
    next: checks.filter((item) => !item.ok && item.severity !== "low").map((item) => item.detail),
  };
}

export const tools = {
  developer_tools_repo_workflow,
  developer_tools_surface_plan,
  developer_tools_command_policy,
  developer_tools_release_check,
};
