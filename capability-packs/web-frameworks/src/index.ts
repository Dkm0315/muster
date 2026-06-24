import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

interface PackageJson {
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface FrameworkHit {
  readonly id: string;
  readonly name: string;
  readonly confidence: "high" | "medium" | "low";
  readonly evidence: string[];
}

interface ProjectSnapshot {
  readonly root: string;
  readonly files: Set<string>;
  readonly packageJson?: PackageJson;
  readonly appsTxt?: string[];
}

interface WorkflowStep {
  readonly phase: "inspect" | "local" | "test" | "build" | "deploy" | "operate" | "integrate";
  readonly title: string;
  readonly command?: string;
  readonly detail: string;
  readonly risk: "safe" | "review" | "mutating";
}

type FrameworkOperation = "setup" | "develop" | "test" | "build" | "deploy" | "integrate" | "debug";

interface FrameworkRunbook {
  readonly id: string;
  readonly label: string;
  readonly docs: string[];
  readonly prerequisites: string[];
  readonly local: WorkflowStep[];
  readonly production: WorkflowStep[];
  readonly integrations: Array<{ label: string; command: string; detail: string }>;
}

const MAX_FILE_BYTES = 180_000;
const MAX_WALK_ENTRIES = 1600;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".output", "coverage", "env", ".venv", "__pycache__"]);

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
    throw new Error("web-frameworks rootPath must stay inside the current workspace.");
  }
  return root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

async function snapshot(root: string): Promise<ProjectSnapshot> {
  const files = await walk(root);
  const packageRaw = await readText(join(root, "package.json"));
  const appsRaw = await readText(join(root, "sites", "apps.txt")) ?? await readText(join(root, "apps.txt"));
  return {
    root,
    files,
    packageJson: packageRaw ? safeJson(packageRaw) : undefined,
    appsTxt: appsRaw?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  };
}

function safeJson(value: string): PackageJson | undefined {
  try {
    const parsed = JSON.parse(value) as PackageJson;
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

function deps(pkg: PackageJson | undefined): Record<string, string> {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

function packageManager(project: ProjectSnapshot): string | undefined {
  if (project.files.has("pnpm-lock.yaml")) return "pnpm";
  if (project.files.has("yarn.lock")) return "yarn";
  if (project.files.has("package-lock.json")) return "npm";
  if (project.files.has("bun.lockb")) return "bun";
  return project.packageJson ? "npm" : undefined;
}

function detectFrameworks(project: ProjectSnapshot): FrameworkHit[] {
  const hits: FrameworkHit[] = [];
  const allDeps = deps(project.packageJson);
  const add = (id: string, name: string, confidence: FrameworkHit["confidence"], evidence: string[]) => hits.push({ id, name, confidence, evidence });

  const frappeEvidence = [
    project.appsTxt?.length ? `sites/apps.txt apps: ${project.appsTxt.join(", ")}` : "",
    hasFile(project.files, ["Procfile"]) ? "Procfile" : "",
    hasPrefix(project.files, "apps/") ? "apps/ directory" : "",
    hasPrefix(project.files, "sites/") ? "sites/ directory" : "",
  ].filter(Boolean);
  if (frappeEvidence.length >= 2 || project.appsTxt?.includes("frappe")) {
    add("frappe", project.appsTxt?.includes("erpnext") ? "Frappe/ERPNext bench" : "Frappe bench", "high", frappeEvidence);
  }

  if (allDeps.next || hasFile(project.files, ["next.config.js", "next.config.mjs", "next.config.ts"])) add("next", "Next.js", "high", ["next dependency or next.config.*"]);
  if (allDeps.nuxt || hasFile(project.files, ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"])) add("nuxt", "Nuxt", "high", ["nuxt dependency or nuxt.config.*"]);
  if (allDeps["@sveltejs/kit"] || hasFile(project.files, ["svelte.config.js", "svelte.config.ts"])) add("sveltekit", "SvelteKit", "high", ["@sveltejs/kit dependency or svelte.config.*"]);
  if (allDeps["@angular/core"] || hasFile(project.files, ["angular.json"])) add("angular", "Angular", "high", ["@angular/core dependency or angular.json"]);
  if (allDeps.vue || hasFile(project.files, ["vue.config.js"])) add("vue", "Vue", allDeps.nuxt ? "medium" : "high", ["vue dependency"]);
  if (allDeps.react || allDeps["react-dom"]) add("react", "React", allDeps.next ? "medium" : "high", ["react/react-dom dependency"]);
  if (allDeps.vite || hasFile(project.files, ["vite.config.js", "vite.config.ts", "vite.config.mjs"])) add("vite", "Vite", "high", ["vite dependency or vite.config.*"]);
  if (allDeps.express) add("express", "Express", "medium", ["express dependency"]);
  if (hasFile(project.files, ["pyproject.toml", "manage.py"]) && !hits.some((hit) => hit.id === "frappe")) add("python-web", "Python web app", "medium", ["pyproject.toml/manage.py"]);
  if (hasFile(project.files, ["composer.json", "artisan"])) add("laravel", "Laravel/PHP app", "medium", ["composer.json/artisan"]);

  return hits;
}

function scriptCommand(pkg: PackageJson | undefined, pm: string | undefined, names: readonly string[]): string | undefined {
  const scripts = pkg?.scripts ?? {};
  const name = names.find((candidate) => scripts[candidate]);
  if (!name) return undefined;
  if (pm === "npm") return `npm run ${name}`;
  if (pm === "yarn") return `yarn ${name}`;
  if (pm === "bun") return `bun run ${name}`;
  return `${pm ?? "npm"} ${name}`;
}

function commandSuggestions(project: ProjectSnapshot, frameworks: FrameworkHit[]) {
  const ids = new Set(frameworks.map((hit) => hit.id));
  const commands: Array<{ task: string; command: string; source: string }> = [];
  const add = (task: string, command: string, source: string) => commands.push({ task, command, source });
  const pkg = project.packageJson;
  const pm = packageManager(project);

  const dev = scriptCommand(pkg, pm, ["dev", "start"]);
  if (dev) add("local_dev", dev, "package.json scripts");
  const build = scriptCommand(pkg, pm, ["build"]);
  if (build) add("build", build, "package.json scripts");
  const test = scriptCommand(pkg, pm, ["test"]);
  if (test) add("test", test, "package.json scripts");
  const lint = scriptCommand(pkg, pm, ["lint"]);
  if (lint) add("lint", lint, "package.json scripts");

  if (ids.has("frappe")) {
    add("frappe_start", "bench start", "Frappe bench");
    add("frappe_list_sites", "bench list-sites", "Frappe bench");
    add("frappe_migrate", "bench --site <site> migrate", "Frappe bench");
    add("frappe_build_assets", "bench build", "Frappe bench");
    add("frappe_worker_status", "bench doctor", "Frappe bench");
    add("frappe_installed_apps", "bench --site <site> list-apps", "Frappe bench");
  }
  if (ids.has("next")) add("next_production_local", `${pm ?? "npm"} ${pm === "npm" ? "run " : ""}build && ${pm ?? "npm"} ${pm === "npm" ? "run " : ""}start`, "Next.js");
  if (ids.has("vite") && !dev) add("vite_local_dev", `${pm ?? "npm"} ${pm === "npm" ? "run " : ""}dev`, "Vite convention");

  return commands;
}

function productionChecks(project: ProjectSnapshot, frameworks: FrameworkHit[], publicUrl?: string) {
  const ids = new Set(frameworks.map((hit) => hit.id));
  const scripts = project.packageJson?.scripts ?? {};
  const checks: Array<{ id: string; ok: boolean; severity: "low" | "medium" | "high"; detail: string }> = [];
  const check = (id: string, ok: boolean, severity: "low" | "medium" | "high", detail: string) => checks.push({ id, ok, severity, detail });

  check("build_script", Boolean(scripts.build || ids.has("frappe")), "high", scripts.build ? "package.json has a build script." : ids.has("frappe") ? "Frappe uses bench build for assets." : "Add a build script for production artifacts.");
  check("start_or_procfile", Boolean(scripts.start || hasFile(project.files, ["Procfile"]) || ids.has("frappe")), "high", "Production process command is discoverable.");
  check("env_template", hasFile(project.files, [".env.example", ".env.sample", "example.env"]), "medium", "Ship a non-secret env template for production setup.");
  check("container_or_process", hasFile(project.files, ["Dockerfile", "docker-compose.yml", "compose.yml", "Procfile"]), "medium", "Dockerfile/compose/Procfile helps reproducible deployment.");
  check("ci_present", hasPrefix(project.files, ".github/workflows/") || hasFile(project.files, [".gitlab-ci.yml"]), "medium", "CI workflow present for tests/builds.");
  check("public_url_https", publicUrl ? publicUrl.startsWith("https://") : false, "medium", publicUrl ? "Production URL should use HTTPS." : "Pass publicUrl to check HTTPS readiness.");

  if (ids.has("frappe")) {
    check("frappe_sites", hasPrefix(project.files, "sites/"), "high", "Frappe bench should contain a sites directory.");
    check("frappe_apps_txt", Boolean(project.appsTxt?.length), "high", "Frappe bench should include sites/apps.txt.");
  }
  if (ids.has("react") || ids.has("vue") || ids.has("vite") || ids.has("next") || ids.has("nuxt")) {
    check("frontend_lockfile", hasFile(project.files, ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"]), "medium", "Lockfile keeps production installs deterministic.");
  }

  return checks;
}

function fileList(project: ProjectSnapshot): string[] {
  return [...project.files].sort();
}

function hasAnyFile(project: ProjectSnapshot, names: readonly string[]): boolean {
  return hasFile(project.files, names);
}

function deployTargets(project: ProjectSnapshot, frameworks: FrameworkHit[]) {
  const ids = new Set(frameworks.map((hit) => hit.id));
  const files = fileList(project);
  const targets: Array<{ id: string; confidence: "high" | "medium" | "low"; reason: string }> = [];
  const add = (id: string, confidence: "high" | "medium" | "low", reason: string) => targets.push({ id, confidence, reason });

  if (hasAnyFile(project, ["Dockerfile", "docker-compose.yml", "compose.yml"])) add("container", "high", "Docker or Compose file is present.");
  if (hasAnyFile(project, ["Procfile"])) add("process-manager", "high", "Procfile is present.");
  if (files.some((file) => file.startsWith(".github/workflows/"))) add("github-actions", "high", "GitHub Actions workflow is present.");
  if (hasAnyFile(project, ["vercel.json"]) || ids.has("next")) add("vercel", ids.has("next") ? "medium" : "high", "Next.js/Vercel deployment markers detected.");
  if (hasAnyFile(project, ["netlify.toml"])) add("netlify", "high", "netlify.toml is present.");
  if (hasAnyFile(project, ["fly.toml"])) add("fly.io", "high", "fly.toml is present.");
  if (hasAnyFile(project, ["render.yaml"])) add("render", "high", "render.yaml is present.");
  if (ids.has("frappe")) add("frappe-bench", "high", "Frappe bench apps/sites layout detected.");
  if (targets.length === 0) add("manual", "low", "No deployment descriptor found; use the generated build/start commands as the base runbook.");
  return targets;
}

function healthChecks(project: ProjectSnapshot, frameworks: FrameworkHit[], publicUrl?: string) {
  const ids = new Set(frameworks.map((hit) => hit.id));
  const checks: Array<{ name: string; command?: string; url?: string; detail: string }> = [];
  const add = (name: string, detail: string, command?: string, url?: string) => checks.push({ name, detail, command, url });
  const pkg = project.packageJson;
  const pm = packageManager(project);
  const test = scriptCommand(pkg, pm, ["test"]);
  const lint = scriptCommand(pkg, pm, ["lint"]);

  if (test) add("test-suite", "Run the repository test script before deployment.", test);
  if (lint) add("lint", "Run lint/static checks before deployment.", lint);
  if (ids.has("frappe")) {
    add("frappe-doctor", "Check bench process, scheduler, Redis, and worker health.", "bench doctor");
    add("frappe-migrate-dry-run-plan", "Review migrations for the selected site before production execution.", "bench --site <site> migrate --skip-search-index");
  }
  if (publicUrl) add("public-url", "Check the production URL is reachable over HTTPS.", undefined, publicUrl);
  if (checks.length === 0) add("manual-smoke", "No test script was found; create a minimal route/API smoke test before treating the app as production-ready.");
  return checks;
}

function integrationAdvice(frameworks: FrameworkHit[]) {
  const ids = new Set(frameworks.map((hit) => hit.id));
  const advice: Array<{ integration: string; detail: string; next: string }> = [];
  const add = (integration: string, detail: string, next: string) => advice.push({ integration, detail, next });

  if (ids.has("frappe")) {
    add("Frappe/ERPNext surface", "Use the Frappe capability pack for permission-scoped identity, record lookup, and governed creates.", "muster plugins setup frappe && muster plugins enable frappe --allow-high-risk");
    add("Frappe webapp embed", "Expose Muster through a Desk/page surface only after the site token and user pairing policy are configured.", "muster channels setup web");
  }
  if (ids.has("react") || ids.has("vue") || ids.has("vite") || ids.has("next") || ids.has("nuxt") || ids.has("sveltekit")) {
    add("frontend agent surface", "Wire a web channel or app backend route to Muster so non-technical users can ask from inside the app.", "muster channels setup web");
    add("browser QA", "Attach browser MCP for screenshot-backed UI checks and route smoke tests.", "muster mcp install browser");
  }
  if (ids.has("express") || ids.has("python-web") || ids.has("laravel")) {
    add("API smoke testing", "Expose health and auth-safe smoke endpoints, then connect browser or HTTP MCP for checks.", "muster plugins setup mcp-bridge");
  }
  add("repo intelligence", "Enable Git/GitHub context so Muster can inspect diffs, issues, and CI when working on this app.", "muster plugins setup github");
  return advice;
}

function workflowPlan(project: ProjectSnapshot, frameworks: FrameworkHit[], publicUrl?: string) {
  const commands = commandSuggestions(project, frameworks);
  const checks = productionChecks(project, frameworks, publicUrl);
  const ids = new Set(frameworks.map((hit) => hit.id));
  const steps: WorkflowStep[] = [];
  const add = (step: WorkflowStep) => steps.push(step);
  const command = (task: string) => commands.find((item) => item.task === task)?.command;

  add({ phase: "inspect", title: "Detect stack", command: "muster plugins check web-frameworks", detail: "Confirm framework markers, package manager, and production gaps before making changes.", risk: "safe" });
  if (command("local_dev")) add({ phase: "local", title: "Start local app", command: command("local_dev"), detail: "Use the repository's own dev script instead of guessing a framework command.", risk: "safe" });
  if (ids.has("frappe")) add({ phase: "local", title: "Start Frappe bench", command: "bench start", detail: "Run from the bench root after confirming sites/apps.txt and selected site.", risk: "safe" });
  if (command("lint")) add({ phase: "test", title: "Run lint", command: command("lint"), detail: "Catch style, static, and import errors before the agent edits deeper.", risk: "safe" });
  if (command("test")) add({ phase: "test", title: "Run tests", command: command("test"), detail: "Use the repo's test command as the first regression gate.", risk: "safe" });
  if (command("build")) add({ phase: "build", title: "Build production artifact", command: command("build"), detail: "Verify the production build before deployment or channel embedding.", risk: "safe" });
  if (ids.has("frappe")) add({ phase: "deploy", title: "Migrate selected Frappe site", command: "bench --site <site> migrate", detail: "Mutates database schema/data; take a backup and confirm the site first.", risk: "mutating" });
  if (ids.has("frappe")) add({ phase: "deploy", title: "Build Frappe assets", command: "bench build", detail: "Compile assets after app changes and before production reload.", risk: "review" });
  for (const failed of checks.filter((check) => !check.ok && check.severity !== "low")) {
    add({ phase: "operate", title: `Fix ${failed.id}`, detail: failed.detail, risk: "review" });
  }
  add({ phase: "integrate", title: "Enable web-frameworks pack", command: "muster plugins enable web-frameworks", detail: "Expose these read-only framework tools to agents and channels.", risk: "safe" });
  if (ids.has("frappe")) add({ phase: "integrate", title: "Enable Frappe bridge when credentials are ready", command: "muster plugins setup frappe", detail: "Use Frappe's own permissions as the authorization boundary for ERPNext data.", risk: "review" });
  return steps;
}

function frameworkRunbook(project: ProjectSnapshot, frameworkId: string): FrameworkRunbook {
  const pm = packageManager(project) ?? "npm";
  const dev = scriptCommand(project.packageJson, pm, ["dev", "start"]);
  const build = scriptCommand(project.packageJson, pm, ["build"]);
  const test = scriptCommand(project.packageJson, pm, ["test"]);
  const lint = scriptCommand(project.packageJson, pm, ["lint"]);
  const local = (title: string, detail: string, command?: string, risk: WorkflowStep["risk"] = "safe"): WorkflowStep => ({ phase: "local", title, detail, command, risk });
  const testStep = (title: string, detail: string, command?: string): WorkflowStep => ({ phase: "test", title, detail, command, risk: "safe" });
  const buildStep = (title: string, detail: string, command?: string): WorkflowStep => ({ phase: "build", title, detail, command, risk: "safe" });
  const deploy = (title: string, detail: string, command?: string, risk: WorkflowStep["risk"] = "review"): WorkflowStep => ({ phase: "deploy", title, detail, command, risk });
  const integrate = (label: string, command: string, detail: string) => ({ label, command, detail });

  if (frameworkId === "frappe" || frameworkId === "erpnext") {
    return {
      id: "frappe",
      label: "Frappe/ERPNext",
      docs: ["https://frappeframework.com/docs", "https://docs.frappe.io/erpnext"],
      prerequisites: ["bench CLI available", "sites/apps.txt present", "selected site name", "database backup before migrate"],
      local: [
        local("List sites", "Pick the exact site before running site-scoped commands.", "bench list-sites"),
        local("Start bench", "Start web, socketio, Redis, scheduler, and workers from the bench root.", "bench start"),
        local("Check bench health", "Inspect process, scheduler, Redis, and worker state.", "bench doctor"),
      ],
      production: [
        deploy("Backup selected site", "Take a site backup before schema/data changes.", "bench --site <site> backup", "mutating"),
        deploy("Migrate selected site", "Apply patches and schema changes only after confirming the target site.", "bench --site <site> migrate", "mutating"),
        deploy("Build assets", "Compile Desk/web assets after app or frontend changes.", "bench build"),
        deploy("Restart processes", "Use the production process manager after build/migrate.", "sudo supervisorctl restart all", "mutating"),
      ],
      integrations: [
        integrate("Frappe capability bridge", "muster plugins setup frappe", "Configure permission-scoped Frappe/ERPNext access before agents touch business data."),
        integrate("Web app surface", "muster channels setup web", "Expose Muster inside a Desk/page or webapp backend route for non-terminal users."),
        integrate("Browser QA", "muster plugins enable browser --allow-high-risk", "Use browser MCP for screenshot-backed route checks after UI changes."),
      ],
    };
  }

  if (frameworkId === "react" || frameworkId === "vite") {
    return {
      id: frameworkId,
      label: frameworkId === "vite" ? "Vite frontend" : "React app",
      docs: ["https://react.dev/learn", "https://vite.dev/guide/"],
      prerequisites: [`${pm} install completed`, "lockfile committed", "API/base URL env variables documented"],
      local: [
        local("Install dependencies", "Install using the detected package manager.", `${pm} install`, "review"),
        local("Start dev server", "Use the repository's own dev/start script when present.", dev ?? `${pm} run dev`),
      ],
      production: [
        testStep("Run lint", "Catch import and component issues before build.", lint),
        testStep("Run tests", "Run the app's test suite before deployment.", test),
        buildStep("Build static/client artifact", "Verify production bundling and env handling.", build ?? `${pm} run build`),
        deploy("Serve built artifact", "Deploy dist/build through the selected host or container.", "deploy using detected target"),
      ].filter((step) => step.command),
      integrations: [
        integrate("Browser QA", "muster plugins enable browser --allow-high-risk", "Attach Playwright/browser MCP for route, screenshot, and interaction checks."),
        integrate("Web channel", "muster channels setup web", "Embed a chat surface or backend route so users can ask inside the product."),
        integrate("Repo intelligence", "muster plugins setup github", "Connect issues, PRs, and CI context for development workflows."),
      ],
    };
  }

  if (frameworkId === "vue" || frameworkId === "nuxt") {
    return {
      id: frameworkId,
      label: frameworkId === "nuxt" ? "Nuxt app" : "Vue app",
      docs: ["https://vuejs.org/guide/introduction.html", "https://nuxt.com/docs/getting-started/introduction"],
      prerequisites: [`${pm} install completed`, "lockfile committed", "runtime config/env documented"],
      local: [
        local("Install dependencies", "Install using the detected package manager.", `${pm} install`, "review"),
        local("Start dev server", "Use the repository's configured dev command.", dev ?? `${pm} run dev`),
      ],
      production: [
        testStep("Run tests", "Run unit/component tests if configured.", test),
        buildStep("Build app", "Verify production bundling and SSR/static output.", build ?? `${pm} run build`),
        deploy("Preview production output", "Run a local preview before external deployment when supported.", scriptCommand(project.packageJson, pm, ["preview"])),
      ].filter((step) => step.command),
      integrations: [
        integrate("Browser QA", "muster plugins enable browser --allow-high-risk", "Use browser MCP to inspect rendered routes and regressions."),
        integrate("Web channel", "muster channels setup web", "Route user questions from the app into Muster through a backend surface."),
      ],
    };
  }

  return {
    id: frameworkId || "generic-web",
    label: frameworkId || "Generic web app",
    docs: ["https://developer.mozilla.org/en-US/docs/Learn"],
    prerequisites: ["document runtime version", "document environment variables", "define a health check"],
    local: [
      local("Inspect scripts", "Use package/framework scripts when present before trying conventions.", "cat package.json"),
      local("Start local server", "Run the detected dev/start command.", dev),
    ].filter((step) => step.command),
    production: [
      testStep("Run tests", "Use the repository test command if available.", test),
      buildStep("Build app", "Use the repository build command if available.", build),
      deploy("Add deployment descriptor", "Add Dockerfile, Procfile, or platform descriptor if none exists."),
    ].filter((step) => step.command || step.title === "Add deployment descriptor"),
    integrations: [
      integrate("MCP bridge", "muster plugins setup mcp-bridge", "Expose filesystem/browser/API tools through explicit MCP configuration."),
      integrate("Browser QA", "muster plugins setup browser", "Add browser-backed smoke testing for web surfaces."),
    ],
  };
}

function selectFramework(project: ProjectSnapshot, frameworks: FrameworkHit[], requested?: string): string {
  const normalized = requested?.toLowerCase();
  if (normalized === "erpnext") return "frappe";
  if (normalized) return normalized;
  const preferred = ["frappe", "next", "nuxt", "react", "vue", "vite", "sveltekit", "angular", "express", "python-web", "laravel"];
  return preferred.find((id) => frameworks.some((hit) => hit.id === id)) ?? (project.packageJson ? "generic-web" : "frappe");
}

function operationSteps(runbook: FrameworkRunbook, operation: FrameworkOperation) {
  if (operation === "setup") return [
    ...runbook.local.filter((step) => /install|list|inspect/i.test(step.title)),
    { phase: "integrate" as const, title: "Review integration choices", detail: "Pick only the channels/MCPs needed for this app before enabling mutating access.", risk: "safe" as const },
  ];
  if (operation === "develop") return runbook.local;
  if (operation === "test") return [...runbook.production.filter((step) => step.phase === "test"), ...runbook.local.filter((step) => /doctor|health/i.test(step.title))];
  if (operation === "build") return runbook.production.filter((step) => step.phase === "build");
  if (operation === "deploy") return runbook.production;
  if (operation === "integrate") return runbook.integrations.map((item): WorkflowStep => ({ phase: "integrate", title: item.label, command: item.command, detail: item.detail, risk: "review" }));
  return [
    ...runbook.local.filter((step) => /health|doctor|start|inspect/i.test(step.title)),
    ...runbook.production.filter((step) => step.phase === "test"),
  ];
}

export async function web_frameworks_detect(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const project = await snapshot(root);
  const frameworks = detectFrameworks(project);
  return {
    root,
    frameworks,
    packageManager: packageManager(project),
    filesScanned: project.files.size,
    truncated: project.files.size >= MAX_WALK_ENTRIES,
  };
}

export async function web_frameworks_local_commands(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const project = await snapshot(root);
  const frameworks = detectFrameworks(project);
  return {
    root,
    frameworks: frameworks.map((hit) => hit.id),
    commands: commandSuggestions(project, frameworks),
  };
}

export async function web_frameworks_production_check(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const project = await snapshot(root);
  const frameworks = detectFrameworks(project);
  const checks = productionChecks(project, frameworks, stringArg(args, "publicUrl"));
  return {
    root,
    frameworks: frameworks.map((hit) => hit.id),
    ready: checks.every((item) => item.ok || item.severity === "low"),
    checks,
    failing: checks.filter((item) => !item.ok).length,
  };
}

export async function web_frameworks_workflow_plan(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const publicUrl = stringArg(args, "publicUrl");
  const project = await snapshot(root);
  const frameworks = detectFrameworks(project);
  return {
    root,
    frameworks: frameworks.map((hit) => hit.id),
    packageManager: packageManager(project),
    deployTargets: deployTargets(project, frameworks),
    healthChecks: healthChecks(project, frameworks, publicUrl),
    integrations: integrationAdvice(frameworks),
    steps: workflowPlan(project, frameworks, publicUrl),
  };
}

export async function web_frameworks_framework_guide(args: Record<string, unknown>) {
  const root = rootFromArgs(args);
  const project = await snapshot(root);
  const frameworks = detectFrameworks(project);
  const operation = (stringArg(args, "operation") ?? "setup") as FrameworkOperation;
  const framework = selectFramework(project, frameworks, stringArg(args, "framework"));
  const runbook = frameworkRunbook(project, framework);
  return {
    root,
    framework: runbook.id,
    label: runbook.label,
    operation,
    detectedFrameworks: frameworks.map((hit) => hit.id),
    packageManager: packageManager(project),
    prerequisites: runbook.prerequisites,
    docs: runbook.docs,
    steps: operationSteps(runbook, operation),
    integrations: runbook.integrations,
    safety: {
      mutatingSteps: operationSteps(runbook, operation).filter((step) => step.risk === "mutating").length,
      note: "Commands are guidance only; agents should ask before running mutating production steps.",
    },
  };
}

export const tools = {
  web_frameworks_detect,
  web_frameworks_framework_guide,
  web_frameworks_local_commands,
  web_frameworks_production_check,
  web_frameworks_workflow_plan,
};
