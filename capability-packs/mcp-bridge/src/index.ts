type JsonRecord = Record<string, unknown>;

const KNOWN_MCP: Record<string, {
  category: string;
  risk: "medium" | "high";
  auth: "none" | "local" | "api_key" | "oauth";
  command: string;
  setupUrls: string[];
  notes: string[];
}> = {
  filesystem: {
    category: "workspace",
    risk: "high",
    auth: "local",
    command: "muster mcp install filesystem",
    setupUrls: ["https://github.com/modelcontextprotocol/servers"],
    notes: ["Filesystem MCP should be scoped to the current workspace or a specific directory."],
  },
  git: {
    category: "developer",
    risk: "medium",
    auth: "local",
    command: "muster mcp install git",
    setupUrls: ["https://github.com/modelcontextprotocol/servers"],
    notes: ["Git MCP is a good default developer server and does not need cloud auth."],
  },
  github: {
    category: "developer",
    risk: "high",
    auth: "api_key",
    command: "muster mcp install github",
    setupUrls: ["https://github.com/settings/tokens"],
    notes: ["Requires GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN."],
  },
  browser: {
    category: "web",
    risk: "high",
    auth: "local",
    command: "muster mcp install browser",
    setupUrls: ["https://github.com/microsoft/playwright-mcp"],
    notes: ["Browser MCP should stay explicit because it can inspect live pages and screenshots."],
  },
  postgres: {
    category: "data",
    risk: "high",
    auth: "api_key",
    command: "muster mcp install postgres",
    setupUrls: ["https://github.com/modelcontextprotocol/servers"],
    notes: ["Requires DATABASE_URL and should start read-only whenever possible."],
  },
  sqlite: {
    category: "data",
    risk: "medium",
    auth: "local",
    command: "muster mcp install sqlite",
    setupUrls: ["https://github.com/modelcontextprotocol/servers"],
    notes: ["Good local default for compact project data and memory inspection."],
  },
  "parallel-search": {
    category: "web",
    risk: "medium",
    auth: "none",
    command: "muster mcp install parallel-search",
    setupUrls: ["https://docs.parallel.ai/integrations/mcp/search-mcp"],
    notes: ["Hosted Streamable HTTP endpoint; useful for fast web retrieval."],
  },
  firecrawl: {
    category: "web",
    risk: "high",
    auth: "api_key",
    command: "muster mcp install firecrawl",
    setupUrls: ["https://www.firecrawl.dev/app/api-keys"],
    notes: ["Requires FIRECRAWL_API_KEY."],
  },
  linear: {
    category: "productivity",
    risk: "high",
    auth: "oauth",
    command: "muster mcp install linear && muster mcp oauth setup linear",
    setupUrls: ["https://linear.app/docs/mcp"],
    notes: ["OAuth setup should open/print the provider authorization URL."],
  },
  notion: {
    category: "productivity",
    risk: "high",
    auth: "oauth",
    command: "muster mcp install notion && muster mcp oauth setup notion",
    setupUrls: ["https://mcp.notion.com/mcp", "https://developers.notion.com/docs/mcp"],
    notes: ["Keep the /mcp path in the server URL for protected-resource validation."],
  },
  n8n: {
    category: "automation",
    risk: "high",
    auth: "api_key",
    command: "muster mcp install n8n",
    setupUrls: ["https://github.com/CyberSamuraiX/hermes-n8n-mcp"],
    notes: ["Requires N8N_BASE_URL and N8N_API_KEY; default tools should stay read-mostly."],
  },
};

const SHELL_INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const IOC_SUBSTRINGS = ["AAAAC3NzaC1lZDI1NTE5AAAAICBoh1oDC4DnsO1m5mJ4yfEKrQebaFh", "hermes-0day", "60.165.167.", "118.182.244.156", "61.178.123.196"];
const EGRESS_PATTERN = /(?<![\w.-])(?:curl|wget|nc|ncat|socat)(?![\w.-])|\/dev\/tcp\/|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\bSystem\.Net\.WebClient\b/i;
const EXFIL_HINT_PATTERN = /\.env\b|--data-binary|--data-raw|\b-X\s+POST\b|\bPOST\b|<\s*[^\s]+/i;
const PERSISTENCE_PATTERN = /authorized_keys|\.ssh\/|\/etc\/ssh\b|\/etc\/pam\.d\b|pam_[\w-]+\.so|\/etc\/sudoers|\/etc\/cron|crontab\b|\/etc\/rc\.local|\/etc\/systemd|\.bashrc\b|\.bash_profile\b|\.profile\b|\.zshrc\b/i;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function listArg(args: JsonRecord, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function commandBasename(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const first = text.split(/\s+/)[0] ?? text;
  return first.split(/[\\/]/).pop()?.toLowerCase() ?? first.toLowerCase();
}

function flattenEntry(entry: JsonRecord): string {
  const parts = [String(entry.command ?? "")];
  const args = entry.args;
  if (Array.isArray(args)) parts.push(args.map(String).join(" "));
  else if (args !== undefined) parts.push(String(args));
  const env = asRecord(entry.env);
  parts.push(...Object.values(env).map(String));
  return parts.join(" ");
}

function validateEntry(name: string, entry: JsonRecord): string[] {
  const issues: string[] = [];
  const flat = flattenEntry(entry);
  for (const ioc of IOC_SUBSTRINGS) {
    if (flat.includes(ioc)) {
      return [`MCP server '${name}' contains a known hermes-0day indicator-of-compromise ('${ioc}')`];
    }
  }
  const command = entry.command;
  const basename = commandBasename(command);
  if (!SHELL_INTERPRETERS.has(basename)) return issues;
  const script = Array.isArray(entry.args) ? entry.args.map(String).join(" ") : String(entry.args ?? "");
  if (!script) return issues;
  if (EGRESS_PATTERN.test(script)) {
    issues.push(`MCP server '${name}' uses shell interpreter '${String(command)}' with network egress in args${EXFIL_HINT_PATTERN.test(script) ? " and exfiltration-shaped arguments" : ""}`);
  }
  if (PERSISTENCE_PATTERN.test(script)) {
    issues.push(`MCP server '${name}' uses shell interpreter '${String(command)}' to write to an OS persistence surface; this matches the hermes-0day backdoor class, not a normal MCP server`);
  }
  return issues;
}

function normalizeServerConfig(server: JsonRecord): JsonRecord {
  const transport = asRecord(server.transport);
  if (transport.kind) return server;
  if (typeof server.command === "string") {
    return { ...server, transport: { kind: "stdio", command: server.command, args: Array.isArray(server.args) ? server.args : [] } };
  }
  if (typeof server.url === "string") {
    return { ...server, transport: { kind: "http", url: server.url, headers: asRecord(server.headers) } };
  }
  return server;
}

export async function mcp_bridge_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const requested = listArg(args, "servers");
  const ids = requested.length ? requested : ["git", "sqlite", "parallel-search", "github", "notion"];
  return {
    source: "Hermes ships a curated optional-mcps catalog plus security checks; OpenClaw keeps provider/model choices visible for configured local providers.",
    principles: [
      "Prefer curated built-ins before arbitrary commands.",
      "Use stdio for local tools, HTTP/OAuth for remote services.",
      "Pass only explicit env vars to stdio servers; never inherit the whole shell env.",
      "Run mcp check before install, then mcp test after install.",
      "Use OAuth setup for auth-heavy remote MCPs instead of hand-writing bearer tokens.",
    ],
    servers: ids.map((id) => {
      const entry = KNOWN_MCP[id];
      return entry ? {
        id,
        category: entry.category,
        risk: entry.risk,
        auth: entry.auth,
        check: `muster mcp check ${id}`,
        install: entry.command,
        test: `muster mcp test ${id}`,
        setupUrls: entry.setupUrls,
        notes: entry.notes,
      } : {
        id,
        status: "unknown",
        addStdio: `muster mcp add-stdio ${id} <command> [args...]`,
        addHttp: `muster mcp add-http ${id} <url> [--oauth ...]`,
      };
    }),
  };
}

export async function mcp_bridge_config_lint(args: JsonRecord): Promise<JsonRecord> {
  const rawServers = asRecord(args.servers ?? args.config);
  const findings = Object.entries(rawServers).map(([name, value]) => {
    const server = normalizeServerConfig(asRecord(value));
    const transport = asRecord(server.transport);
    const issues = validateEntry(name, {
      command: transport.command ?? server.command,
      args: transport.args ?? server.args,
      env: transport.env ?? server.env,
    });
    const shapeIssues: string[] = [];
    if (transport.kind !== "stdio" && transport.kind !== "http") shapeIssues.push("transport.kind must be stdio or http.");
    if (transport.kind === "stdio" && typeof transport.command !== "string") shapeIssues.push("stdio transport requires command.");
    if (transport.kind === "http" && typeof transport.url !== "string") shapeIssues.push("http transport requires url.");
    if (transport.kind === "stdio" && Object.keys(asRecord(transport.env)).length === 0) {
      shapeIssues.push("stdio transport has no explicit env; this is safest unless the server needs a named token.");
    }
    return {
      name,
      transport: transport.kind ?? "unknown",
      command: transport.kind === "stdio" ? transport.command : undefined,
      url: transport.kind === "http" ? transport.url : undefined,
      auth: server.auth ?? "none",
      issues: [...issues, ...shapeIssues],
      ok: issues.length === 0 && shapeIssues.filter((issue) => !issue.includes("no explicit env")).length === 0,
    };
  });
  return {
    checked: findings.length,
    blocked: findings.filter((finding) => finding.issues.some((issue) => issue.includes("indicator-of-compromise") || issue.includes("network egress") || issue.includes("persistence"))).length,
    warnings: findings.reduce((count, finding) => count + finding.issues.length, 0),
    findings,
  };
}

export async function mcp_bridge_install_workflow(args: JsonRecord): Promise<JsonRecord> {
  const id = stringArg(args, "id");
  if (!id) return { error: 'mcp_bridge_install_workflow requires "id".' };
  const entry = KNOWN_MCP[id];
  if (!entry) {
    return {
      id,
      known: false,
      commands: [
        `muster mcp add-stdio ${id} <command> [args...]`,
        `muster mcp add-http ${id} <url> [--oauth --setup-url URL --client-id ID ...]`,
        `muster mcp test ${id}`,
      ],
      note: "Unknown MCPs should be treated as custom high-risk integrations until reviewed.",
    };
  }
  return {
    id,
    known: true,
    risk: entry.risk,
    auth: entry.auth,
    commands: [
      `muster mcp check ${id}`,
      entry.command,
      ...(entry.auth === "oauth" ? [`muster mcp oauth status ${id}`, `muster mcp oauth setup ${id}`] : []),
      `muster mcp test ${id}`,
      `muster plugins enable mcp-bridge --allow-high-risk`,
    ],
    setupUrls: entry.setupUrls,
    notes: entry.notes,
  };
}

export async function mcp_bridge_tool_policy(args: JsonRecord): Promise<JsonRecord> {
  const include = listArg(args, "include");
  const exclude = listArg(args, "exclude");
  const server = stringArg(args, "server", "<server>");
  return {
    server,
    include,
    exclude,
    recommended: include.length
      ? { tools: { include } }
      : exclude.length
        ? { tools: { exclude } }
        : { tools: "all discovered tools enabled; use include for high-risk servers" },
    guidance: [
      "Prefer include allowlists for auth-heavy or mutating MCP servers.",
      "Keep read-only/list/get/export tools enabled first.",
      "Add write/delete/admin tools only after a successful mcp test and explicit user approval.",
    ],
  };
}

export const tools = {
  mcp_bridge_setup_plan,
  mcp_bridge_config_lint,
  mcp_bridge_install_workflow,
  mcp_bridge_tool_policy,
};
