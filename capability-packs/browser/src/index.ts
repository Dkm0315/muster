type BrowserMode = "local-mcp" | "remote-cdp" | "cloud";

interface BrowserReadinessArgs {
  readonly configured?: unknown;
  readonly hasDisplay?: unknown;
  readonly cdpUrl?: unknown;
  readonly provider?: unknown;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function modeFromArgs(args: Record<string, unknown>): BrowserMode {
  const requested = stringArg(args, "mode");
  if (requested === "remote-cdp" || requested === "cloud" || requested === "local-mcp") return requested;
  if (stringArg(args, "cdpUrl")) return "remote-cdp";
  if (stringArg(args, "provider")) return "cloud";
  return "local-mcp";
}

function redactUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username) url.username = "__redacted__";
    if (url.password) url.password = "__redacted__";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password/i.test(key)) url.searchParams.set(key, "__redacted__");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&](?:token|key|secret|password)=)[^&]+/gi, "$1__redacted__");
  }
}

export async function browser_setup_plan(args: Record<string, unknown>) {
  const mode = modeFromArgs(args);
  const provider = stringArg(args, "provider");
  const cdpUrl = redactUrl(stringArg(args, "cdpUrl"));
  return {
    mode,
    sourceEvidence: [
      "Hermes browser_tool.py uses an accessibility/snapshot-first browser surface, backend autodetection, task isolation, and cleanup.",
      "Hermes browser_cdp_tool.py keeps raw CDP as an escape hatch instead of the default path.",
      "OpenClaw gates browser operations through plugin/tool authorization, origin checks, and per-run tool allowlists.",
    ],
    setup: mode === "local-mcp"
      ? [
          "Install/configure the Playwright MCP through Muster rather than exposing raw browser control directly.",
          "Run: muster mcp install browser",
          "Run: muster mcp test browser",
          "Enable the browser pack only for sessions that need visible web/UI verification.",
        ]
      : mode === "remote-cdp"
        ? [
            "Keep CDP URLs out of chat transcripts and config output; redact tokens and credentials.",
            "Prefer a local loopback CDP endpoint or a provider with scoped, short-lived sessions.",
            "Use browser_cdp-style raw CDP only when snapshot/click/navigation tools are insufficient.",
          ]
        : [
            `Configure the selected cloud browser provider${provider ? ` (${provider})` : ""} with scoped credentials outside Muster chat.`,
            "Use provider dashboards to rotate keys and restrict project/session lifetimes.",
            "Treat cloud browser sessions as high-risk because they can reach external sites and authenticated pages.",
          ],
    commands: [
      "muster plugins setup browser",
      "muster plugins enable browser --allow-high-risk",
      "muster mcp install browser",
      "muster mcp test browser",
    ],
    cdpUrl,
  };
}

export async function browser_mcp_readiness(args: BrowserReadinessArgs & Record<string, unknown>) {
  const configured = boolArg(args, "configured") ?? false;
  const hasDisplay = boolArg(args, "hasDisplay");
  const mode = modeFromArgs(args);
  const cdpUrl = redactUrl(stringArg(args, "cdpUrl"));
  const checks = [
    {
      id: "mcp_configured",
      ok: configured,
      severity: "high",
      detail: configured ? "Browser MCP is configured in Muster." : "Run `muster mcp install browser` before expecting browser tools.",
    },
    {
      id: "headless_ok",
      ok: hasDisplay !== false,
      severity: "medium",
      detail: hasDisplay === false ? "Use Playwright headless mode or install browser system dependencies on the server." : "No display blocker was reported.",
    },
    {
      id: "cdp_redaction",
      ok: !cdpUrl || !/(token|password|secret)=((?!__redacted__).)+/i.test(cdpUrl),
      severity: "high",
      detail: cdpUrl ? "CDP URL was normalized/redacted for display." : "No CDP URL supplied.",
    },
  ];
  return {
    mode,
    ready: checks.every((check) => check.ok || check.severity === "medium"),
    checks,
    next: configured ? "Run `muster mcp test browser` and then a screenshot-backed smoke task." : "Run `muster plugins enable browser --allow-high-risk` or `muster mcp install browser`.",
    cdpUrl,
  };
}

export async function browser_task_policy(args: Record<string, unknown>) {
  const task = stringArg(args, "task") ?? "browser task";
  const allowAuthenticated = boolArg(args, "allowAuthenticated") ?? false;
  return {
    task,
    defaultPolicy: {
      screenshotsRequired: true,
      rawCdpDefault: false,
      allowAuthenticatedSites: allowAuthenticated,
      requireUserApprovalFor: [
        "form submissions",
        "payments",
        "account changes",
        "downloads from untrusted sites",
        "credential entry",
        "authenticated production admin pages",
      ],
      blockByDefault: [
        "private IP/metadata URLs unless explicitly allowlisted",
        "persistent profile mutation",
        "saving credentials",
        "bypassing website policy or robots-like restrictions",
      ],
    },
    toolAllow: ["browser"],
    mcp: ["browser"],
    notes: [
      "Prefer snapshot, navigate, click, fill, screenshot, and console/network inspection before raw CDP.",
      "Raw CDP is an escape hatch for dialogs, iframe scope, cookies/network state, and low-level tab operations.",
      "Every important UI result should be backed by a screenshot or accessible snapshot in the transcript.",
    ],
  };
}

export async function browser_smoke_plan(args: Record<string, unknown>) {
  const url = stringArg(args, "url") ?? "https://example.com";
  return {
    url: redactUrl(url),
    steps: [
      { name: "install", command: "muster mcp install browser", expected: "browser MCP server appears in `muster mcp list`." },
      { name: "probe", command: "muster mcp test browser", expected: "tool listing succeeds or reports a precise dependency error." },
      { name: "navigate", action: `Open ${redactUrl(url)} with the browser MCP navigate tool.`, expected: "page title or accessibility snapshot is visible." },
      { name: "screenshot", action: "Capture a screenshot after navigation.", expected: "screenshot evidence exists for visual verification." },
      { name: "cleanup", action: "Close browser session or let MCP server end with the run.", expected: "no orphaned long-lived browser session remains." },
    ],
    failureTriage: [
      "If install fails, verify Node/npm/npx availability.",
      "If Chromium dependencies fail on Linux, install Playwright system dependencies or use a container image with browsers.",
      "If a site blocks automation, use browser policy notes before escalating to cloud/CDP providers.",
    ],
  };
}

export const tools = {
  browser_setup_plan,
  browser_mcp_readiness,
  browser_task_policy,
  browser_smoke_plan,
};
