type JsonRecord = Record<string, unknown>;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  return typeof args[key] === "boolean" ? args[key] : fallback;
}

export async function codex_web_search_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const provider = stringArg(args, "provider", "codex");
  return {
    provider,
    sourceEvidence: [
      "Muster runCodex can delegate native Codex web_search when the local Codex runtime exposes it.",
      "The local web-search pack provides keyless DuckDuckGo plus optional Parallel/Firecrawl MCPs for deterministic fallback.",
    ],
    commands: [
      "muster plugins enable codex",
      "muster plugins enable codex-web-search",
      "muster plugins enable web-search",
      "muster mcp install parallel-search",
    ],
    setupUrls: ["https://github.com/openai/codex", "https://docs.parallel.ai/integrations/mcp/search-mcp"],
  };
}

export async function codex_web_search_readiness(args: JsonRecord): Promise<JsonRecord> {
  const codexReady = booleanArg(args, "codexReady");
  const webToolAvailable = booleanArg(args, "webToolAvailable");
  const fallbackSearchReady = booleanArg(args, "fallbackSearchReady", true);
  const checks = [
    { id: "codex_runtime", ok: codexReady, detail: codexReady ? "Codex runtime is ready." : "Enable and verify the Codex runtime first." },
    { id: "native_web_tool", ok: webToolAvailable, detail: webToolAvailable ? "Codex native web tool is available." : "Use local web-search/Parallel fallback when Codex web is unavailable." },
    { id: "fallback", ok: fallbackSearchReady, detail: fallbackSearchReady ? "Local/fallback search is ready." : "Enable web-search or install Parallel/Firecrawl MCP." },
  ];
  return { plugin: "codex-web-search", ready: checks.every((check) => check.ok), checks, next: checks.every((check) => check.ok) ? "muster run \"research ...\" --runtime codex" : "muster plugins setup codex-web-search" };
}

export async function codex_web_research_policy(args: JsonRecord): Promise<JsonRecord> {
  const topic = stringArg(args, "topic", "research");
  return {
    topic,
    policy: [
      "Browse for current or unstable facts before answering.",
      "Prefer direct source URLs and cite what was used.",
      "Use local web-search for fast result discovery; escalate to Codex native web for synthesis when needed.",
      "Use Parallel/Firecrawl MCP for heavier extraction or pages that DuckDuckGo snippets cannot cover.",
    ],
    outputContract: ["source links", "date-aware summary", "uncertainty noted", "no uncited claims for current facts"],
  };
}

export async function codex_web_search_fallback_plan(args: JsonRecord): Promise<JsonRecord> {
  const reason = stringArg(args, "reason", "native unavailable");
  return {
    reason,
    order: [
      { id: "local-web-search", command: "muster plugins enable web-search", useFor: "fast keyless search/fetch" },
      { id: "parallel-search", command: "muster mcp install parallel-search", useFor: "hosted MCP search" },
      { id: "firecrawl", command: "muster mcp install firecrawl", useFor: "scrape/extract with API key" },
      { id: "codex-native-web", command: "muster run <prompt> --runtime codex", useFor: "native Codex web synthesis when available" },
    ],
  };
}

export const tools = {
  codex_web_research_policy,
  codex_web_search_fallback_plan,
  codex_web_search_readiness,
  codex_web_search_setup_plan,
};
