import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  WEBHOOK_SAFE_TOOLS,
  addMemory,
  appendEpisode,
  createToolRegistry,
  ensureDefaultConfig,
  isBlockedFetchHost,
  openSessionStore,
  parseMemoryScope,
  registerBuiltinTools,
  type ToolContext,
} from "../src/index.js";

function startStubHttp(body = "ok-body", contentType = "text/plain"): Promise<{ host: string; port: number; close(): void; calls(): number }> {
  return new Promise((resolve) => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": contentType });
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ host: "127.0.0.1", port, close: () => server.close(), calls: () => calls });
    });
  });
}

function setup() {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

test("toolsets resolve recursively: core excludes shell, full includes it", () => {
  const registry = setup();
  const core = registry.resolveToolset("core");
  assert.ok(core.includes("read_file") && core.includes("web_fetch"));
  assert.ok(core.includes("session_search"));
  assert.ok(core.includes("tool_search") && core.includes("tool_describe") && core.includes("tool_call"));
  assert.ok(!core.includes("terminal"), "core never grants shell");
  assert.ok(registry.resolveToolset("full").includes("terminal"));
});

test("tool discovery searches compact metadata and describes schemas without exposing unavailable tools", async () => {
  const registry = setup();
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-discovery-"));
  const search = await registry.execute("tool_search", { query: "web search", limit: 3 }, { cwd });
  assert.equal(search.ok, true);
  const results = (search as { data: { results: Array<{ name: string; toolset: string; description: string }> } }).data.results;
  assert.equal(results[0].name, "web_search");
  assert.equal(results[0].toolset, "web");
  assert.ok(results.every((entry) => entry.name !== "terminal"), "unavailable shell tool should stay out of search results");

  const describe = await registry.execute("tool_describe", { id: "web_search" }, { cwd });
  assert.equal(describe.ok, true);
  const metadata = (describe as { data: { name: string; inputSchema: { properties: Record<string, unknown> } } }).data;
  assert.equal(metadata.name, "web_search");
  assert.ok(metadata.inputSchema.properties.query);

  const hidden = await registry.execute("tool_describe", { id: "terminal" }, { cwd });
  assert.equal(hidden.ok, false);
  assert.match((hidden as { error: string }).error, /Unknown or unavailable tool/);
});

test("tool_call executes through the normal registry path and honors discovery allowlists", async () => {
  const registry = setup();
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-call-"));
  const allowed = await registry.execute(
    "tool_call",
    { id: "write_file", args: { path: "note.txt", content: "from tool_call" } },
    { cwd, toolAllowlist: ["write_file", "read_file"] },
  );
  assert.equal(allowed.ok, true);
  assert.equal(await readFile(join(cwd, "note.txt"), "utf8"), "from tool_call");

  const read = await registry.execute(
    "tool_call",
    { name: "read_file", args: { path: "note.txt" } },
    { cwd, toolAllowlist: ["write_file", "read_file"] },
  );
  assert.equal(read.ok, true);
  assert.equal((read as { data: string }).data, "from tool_call");

  const blockedByAllowlist = await registry.execute(
    "tool_call",
    { id: "web_fetch", args: { url: "https://example.com/" } },
    { cwd, toolAllowlist: ["read_file"] },
  );
  assert.equal(blockedByAllowlist.ok, false);
  assert.match((blockedByAllowlist as { error: string }).error, /Unknown or unavailable tool/);

  const recursive = await registry.execute("tool_call", { id: "tool_search", args: { query: "file" } }, { cwd });
  assert.equal(recursive.ok, false);
  assert.match((recursive as { error: string }).error, /cannot invoke discovery tool/);
});

test("session_search exposes fast browse, discover, read, and scroll shapes through the registry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-sessions-"));
  const store = openSessionStore(cwd);
  const deploy = store.createSession({ channel: "web", peer: "alice", title: "Deploy notes" });
  const finance = store.createSession({ channel: "slack", peer: "finance", title: "Finance export" });
  let pivot = 0;
  for (let index = 0; index < 35; index += 1) {
    const row = store.appendMessage(deploy.id, index % 2 ? "assistant" : "user", `deployment message ${index} about release windows`);
    if (index === 17) pivot = row.id;
  }
  store.appendMessage(finance.id, "user", "quarterly payroll export is delayed");
  store.close();

  const registry = setup();
  const browse = await registry.execute("session_search", {}, { cwd });
  assert.equal(browse.ok, true);
  assert.equal((browse as { data: { shape: string; sessions: unknown[] } }).data.shape, "browse");
  assert.equal((browse as { data: { sessions: unknown[] } }).data.sessions.length, 2);

  const discover = await registry.execute("session_search", { query: "payroll" }, { cwd });
  assert.equal(discover.ok, true);
  const hit = (discover as { data: { shape: string; hits: Array<{ sessionId: string; snippet: string }> } }).data;
  assert.equal(hit.shape, "discover");
  assert.equal(hit.hits[0].sessionId, finance.id);
  assert.match(hit.hits[0].snippet, /payroll/);

  const read = await registry.execute("session_search", { sessionId: deploy.id, limit: 999 }, { cwd });
  assert.equal(read.ok, true);
  const readData = (read as { data: { shape: string; omitted: number; head: unknown[]; tail: unknown[] } }).data;
  assert.equal(readData.shape, "read");
  assert.equal(readData.head.length, 20);
  assert.equal(readData.tail.length, 10);
  assert.equal(readData.omitted, 5);

  const scroll = await registry.execute("session_search", { sessionId: deploy.id, aroundMessageId: pivot }, { cwd });
  assert.equal(scroll.ok, true);
  const scrollData = (scroll as { data: { shape: string; messages: Array<{ id: number }> } }).data;
  assert.equal(scrollData.shape, "scroll");
  assert.ok(scrollData.messages.some((message) => message.id === pivot));
});

test("session_status reports live status for the latest or requested session", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-status-"));
  await ensureDefaultConfig(cwd);
  await appendEpisode({
    id: "episode-status",
    createdAt: "2026-06-22T10:00:00.000Z",
    cwd,
    prompt: "status check",
    taskKind: "simple_qa",
    runtimeId: "native",
    providerId: "local",
    model: "gpt-5.5",
    responseText: "ok",
    evidence: [{ kind: "system_check", label: "status", status: "passed" }],
    outcome: { kind: "completed" },
  }, cwd);
  const store = openSessionStore(cwd);
  const older = store.createSession({ channel: "web", peer: "alice", title: "Older" });
  const current = store.createSession({ channel: "slack", peer: "team", title: "Current" });
  store.addUsage(current.id, 120, 34, 0.012);
  store.close();

  const registry = setup();
  const latest = await registry.execute("session_status", {}, { cwd });
  assert.equal(latest.ok, true);
  const latestData = (latest as { data: { defaultRuntime: string; provider: { id: string }; session: { id: string; tokensIn: number }; latestRun: { id: string; outcome: string }; timezone?: string } }).data;
  assert.equal(latestData.defaultRuntime, "native");
  assert.equal(latestData.provider.id, "codex");
  assert.ok([older.id, current.id].includes(latestData.session.id));
  assert.equal(latestData.latestRun.id, "episode-status");
  assert.equal(latestData.latestRun.outcome, "completed");
  assert.ok(latestData.timezone);

  const requested = await registry.execute("session_status", { sessionId: current.id }, { cwd });
  assert.equal(requested.ok, true);
  const requestedData = (requested as { data: { session: { id: string; tokensIn: number } } }).data;
  assert.equal(requestedData.session.id, current.id);
  assert.equal(requestedData.session.tokensIn, 120);

  const search = await registry.execute("tool_search", { query: "status session" }, { cwd });
  assert.equal(search.ok, true);
  assert.ok((search as { data: { results: Array<{ name: string }> } }).data.results.some((entry) => entry.name === "session_status"));
});

test("memory tools search and read only caller-visible scopes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-memory-"));
  const mine = await addMemory({
    summary: "Architecture decision: keep plugin memory access scoped and read-only.",
    provenance: ["test:mine"],
    scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:dhairya")],
  }, cwd);
  const other = await addMemory({
    summary: "Architecture decision for another user should not leak.",
    provenance: ["test:other"],
    scopes: [parseMemoryScope("tenant:hybrow"), parseMemoryScope("user:someone-else")],
  }, cwd);
  const global = await addMemory({
    summary: "Evidence note: Hermes providers must not bypass tool policy.",
    provenance: ["test:global"],
    scopes: [parseMemoryScope("global:global")],
  }, cwd);

  const registry = setup();
  const ctx: ToolContext = { cwd };
  const search = await registry.execute("memory_search", {
    query: "architecture",
    scopes: ["tenant:hybrow", "user:dhairya"],
    includeGlobal: true,
  }, ctx);
  assert.equal(search.ok, true);
  const searchData = (search as { data: { results: Array<{ id: string; summary: string; scopes: string[] }> } }).data;
  assert.deepEqual(searchData.results.map((entry) => entry.id), [mine.id]);
  assert.deepEqual(searchData.results[0].scopes, ["tenant:hybrow", "user:dhairya"]);

  const globalSearch = await registry.execute("memory_search", {
    query: "evidence",
    scopes: ["tenant:hybrow", "user:dhairya"],
    includeGlobal: true,
  }, ctx);
  assert.equal(globalSearch.ok, true);
  assert.deepEqual((globalSearch as { data: { results: Array<{ id: string }> } }).data.results.map((entry) => entry.id), [global.id]);

  const getMine = await registry.execute("memory_get", { id: mine.id, scopes: ["tenant:hybrow", "user:dhairya"] }, ctx);
  assert.equal(getMine.ok, true);
  assert.equal((getMine as { data: { memory: { id: string } } }).data.memory.id, mine.id);

  const blocked = await registry.execute("memory_get", { id: other.id, scopes: ["tenant:hybrow", "user:dhairya"] }, ctx);
  assert.equal(blocked.ok, false);
  assert.match((blocked as { error: string }).error, /Unknown or unavailable memory/);

  const discovered = await registry.execute("tool_search", { query: "memory" }, ctx);
  assert.equal(discovered.ok, true);
  const names = (discovered as { data: { results: Array<{ name: string }> } }).data.results.map((entry) => entry.name);
  assert.ok(names.includes("memory_search"));
  assert.ok(names.includes("memory_get"));
});

test("file tools read/write/search within the workspace and refuse escapes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-"));
  const registry = setup();
  const ctx: ToolContext = { cwd };
  const write = await registry.execute("write_file", { path: "sub/note.txt", content: "hello muster" }, ctx);
  assert.equal(write.ok, true);
  assert.equal(await readFile(join(cwd, "sub/note.txt"), "utf8"), "hello muster");
  const read = await registry.execute("read_file", { path: "sub/note.txt" }, ctx);
  assert.equal((read as { data: string }).data, "hello muster");
  const search = await registry.execute("search_files", { query: "muster" }, ctx);
  assert.match(String((search as { data: string }).data), /note\.txt/);
  const escape = await registry.execute("read_file", { path: "../../../etc/passwd" }, ctx);
  assert.equal(escape.ok, false);
  assert.match((escape as { error: string }).error, /escapes the workspace/);
});

test("terminal is deny-by-default and honors the command allowlist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-sh-"));
  const registry = setup();
  const denied = await registry.execute("terminal", { command: "echo", args: ["hi"] }, { cwd });
  assert.equal(denied.ok, false, "no allowlist -> unavailable");
  const allowed = await registry.execute("terminal", { command: "echo", args: ["hi"] }, { cwd, allowCommands: ["echo"] });
  assert.equal(allowed.ok, true);
  assert.match(String((allowed as { data: string }).data), /hi/);
  const blocked = await registry.execute("terminal", { command: "rm", args: ["-rf", "/"] }, { cwd, allowCommands: ["echo"] });
  assert.equal(blocked.ok, false);
  assert.match((blocked as { error: string }).error, /not allowlisted/);
});

test("oversized results are capped through the persistence pipeline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-cap-"));
  const registry = setup();
  await registry.execute("write_file", { path: "big.txt", content: "Z".repeat(20000) }, { cwd });
  const read = await registry.execute("read_file", { path: "big.txt" }, { cwd });
  assert.match(String((read as { data: string }).data), /result_fetch\("res_/);
  const id = String((read as { data: string }).data).match(/result_fetch\("(res_[^"]+)"\)/)![1];
  const fetched = await registry.execute("result_fetch", { id, limit: 10 }, { cwd });
  assert.equal((fetched as { data: string }).data.length, 10);
});

test("web_fetch honors the host allowlist; webhook-safe set excludes writes and shell", () => {
  assert.deepEqual([...WEBHOOK_SAFE_TOOLS].sort(), ["result_fetch", "web_fetch", "web_search"]);
  assert.ok(!WEBHOOK_SAFE_TOOLS.includes("write_file"));
  assert.ok(!WEBHOOK_SAFE_TOOLS.includes("terminal"));
});

test("isBlockedFetchHost blocks loopback/private/link-local/metadata but allows public hosts", () => {
  for (const blocked of [
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.5.5.5",
    "0.0.0.0",
    "169.254.169.254", // cloud metadata
    "169.254.1.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1", // CGNAT
    "::1",
    "::",
    "fe80::1", // IPv6 link-local
    "fc00::1", // IPv6 unique-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ]) {
    assert.equal(isBlockedFetchHost(blocked), true, `${blocked} must be blocked`);
  }
  for (const allowed of ["example.com", "api.github.com", "8.8.8.8", "172.32.0.1", "9.9.9.9", "100.63.0.1", "100.128.0.1"]) {
    assert.equal(isBlockedFetchHost(allowed), false, `${allowed} must be allowed`);
  }
});

test("web_search uses DuckDuckGo HTML search with bounded structured results and caching", async () => {
  const registry = setup();
  const html = `
    <html><body>
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Example &amp; Result</a>
      <div class="result__snippet">First <b>snippet</b>.</div>
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Second</a>
      <div class="result__snippet">Second snippet.</div>
    </body></html>
  `;
  const stub = await startStubHttp(html, "text/html");
  try {
    const baseUrl = `http://127.0.0.1:${stub.port}/html/`;
    const ctx: ToolContext = { cwd: process.cwd(), allowHosts: ["127.0.0.1"] };
    const first = await registry.execute("web_search", { query: "muster", provider: "duckduckgo", baseUrl, count: 1 }, ctx);
    assert.equal(first.ok, true);
    assert.deepEqual((first as { data: { provider: string; cached: boolean; results: Array<{ title: string; url: string; snippet?: string }> } }).data, {
      provider: "duckduckgo",
      cached: false,
      results: [{ title: "Example & Result", url: "https://example.com/a", snippet: "First snippet.", source: "duckduckgo" }],
    });

    const second = await registry.execute("web_search", { query: "muster", provider: "duckduckgo", baseUrl, count: 1 }, ctx);
    assert.equal(second.ok, true);
    assert.equal((second as { data: { cached: boolean } }).data.cached, true);
    assert.equal(stub.calls(), 1, "identical web_search requests should use the short in-process cache");
  } finally {
    stub.close();
  }
});

test("web_search Brave provider requires a key and maps Brave JSON results", async () => {
  const registry = setup();
  const previous = process.env.BRAVE_API_KEY;
  delete process.env.BRAVE_API_KEY;
  const missing = await registry.execute("web_search", { query: "muster", provider: "brave" }, { cwd: process.cwd() });
  assert.equal(missing.ok, false);
  assert.match((missing as { error: string }).error, /BRAVE_API_KEY/);

  const stub = await startStubHttp(JSON.stringify({
    web: {
      results: [
        { title: "Muster <b>Docs</b>", url: "https://example.com/docs", description: "Docs snippet" },
      ],
    },
  }), "application/json");
  process.env.BRAVE_API_KEY = "test-key";
  try {
    const result = await registry.execute("web_search", {
      query: "muster docs",
      provider: "brave",
      baseUrl: `http://127.0.0.1:${stub.port}`,
      count: 3,
      freshness: "week",
    }, { cwd: process.cwd(), allowHosts: ["127.0.0.1"] });
    assert.equal(result.ok, true);
    assert.deepEqual((result as { data: { provider: string; results: Array<{ title: string; url: string; snippet?: string; source?: string }> } }).data, {
      provider: "brave",
      cached: false,
      results: [{ title: "Muster Docs", url: "https://example.com/docs", snippet: "Docs snippet", source: "brave" }],
    });
  } finally {
    stub.close();
    if (previous === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = previous;
  }
});

test("web_search refuses private hosts without an explicit allowlist", async () => {
  const registry = setup();
  const result = await registry.execute("web_search", {
    query: "muster",
    provider: "duckduckgo",
    baseUrl: "http://127.0.0.1:9/html/",
  }, { cwd: process.cwd() });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /Blocked private\/loopback\/metadata host/);
});

test("web_fetch blocks SSRF targets by default but lets an explicit allowlist through", async () => {
  const registry = setup();
  const stub = await startStubHttp("real body");
  try {
    // Default (no allowlist): loopback / metadata / private are refused before any fetch.
    for (const url of [
      `http://localhost:${stub.port}/`,
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      `http://127.0.0.1:${stub.port}/`,
    ]) {
      const result = await registry.execute("web_fetch", { url }, { cwd: process.cwd() });
      assert.equal(result.ok, false, `${url} must be blocked`);
      assert.match((result as { error: string }).error, /Blocked private\/loopback\/metadata host/);
    }

    // A non-allowlisted public host is rejected by the allowlist gate (no SSRF bypass either way).
    const offAllowlist = await registry.execute(
      "web_fetch",
      { url: "https://example.com/" },
      { cwd: process.cwd(), allowHosts: ["api.github.com"] },
    );
    assert.equal(offAllowlist.ok, false);
    assert.match((offAllowlist as { error: string }).error, /Host not in allowlist/);

    // An explicit allowlist still works — even for loopback the operator opted into.
    const allowed = await registry.execute(
      "web_fetch",
      { url: `http://127.0.0.1:${stub.port}/` },
      { cwd: process.cwd(), allowHosts: ["127.0.0.1"] },
    );
    assert.equal(allowed.ok, true);
    assert.equal((allowed as { data: string }).data, "real body");
  } finally {
    stub.close();
  }
});

test("insideWorkspace rejects sibling-prefix dirs and ../ escapes but allows legit nested paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "muster-ws-"));
  const cwd = join(root, "work");
  await mkdir(cwd, { recursive: true });
  // Sibling directory sharing a name prefix: /…/work-evil must NOT count as inside /…/work.
  await mkdir(join(root, "work-evil"), { recursive: true });
  await writeFile(join(root, "work-evil", "secret.txt"), "stolen");
  const registry = setup();
  const ctx: ToolContext = { cwd };

  const sibling = await registry.execute("read_file", { path: "../work-evil/secret.txt" }, ctx);
  assert.equal(sibling.ok, false, "sibling-prefix dir must be rejected");
  assert.match((sibling as { error: string }).error, /escapes the workspace/);

  const escape = await registry.execute("read_file", { path: "../../etc/passwd" }, ctx);
  assert.equal(escape.ok, false);
  assert.match((escape as { error: string }).error, /escapes the workspace/);

  // A legitimate nested path is still allowed.
  await registry.execute("write_file", { path: "nested/dir/ok.txt", content: "fine" }, ctx);
  const nested = await registry.execute("read_file", { path: "nested/dir/ok.txt" }, ctx);
  assert.equal((nested as { data: string }).data, "fine");
});

test("toFlowRegistry exposes tools to flows and respects an allowlist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-flow-"));
  const registry = setup();
  const flowReg = registry.toFlowRegistry({ cwd }, ["read_file", "write_file"]);
  assert.deepEqual(Object.keys(flowReg).sort(), ["read_file", "write_file"]);
  await flowReg.write_file({ path: "f.txt", content: "x" });
  assert.equal(await readFile(join(cwd, "f.txt"), "utf8"), "x");
});
