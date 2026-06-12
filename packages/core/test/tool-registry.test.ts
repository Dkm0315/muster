import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  WEBHOOK_SAFE_TOOLS,
  createToolRegistry,
  isBlockedFetchHost,
  registerBuiltinTools,
  type ToolContext,
} from "../src/index.js";

function startStubHttp(body = "ok-body"): Promise<{ host: string; port: number; close(): void }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ host: "127.0.0.1", port, close: () => server.close() });
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
  assert.ok(!core.includes("terminal"), "core never grants shell");
  assert.ok(registry.resolveToolset("full").includes("terminal"));
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
  assert.deepEqual([...WEBHOOK_SAFE_TOOLS].sort(), ["result_fetch", "web_fetch"]);
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
