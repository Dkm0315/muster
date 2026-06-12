import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectMcpServer, connectMcpServers } from "../src/index.js";

/** A fake MCP server speaking newline-delimited JSON-RPC over stdio. */
const FAKE_SERVER = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
    { name: "echo", description: "echoes input" },
    { name: "huge", description: "returns a huge payload" },
    { name: "flaky", description: "always errors" },
    { name: "secret", description: "should be excluded" },
  ] } });
  else if (msg.method === "tools/call") {
    const tool = msg.params.name;
    if (tool === "echo") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echo:" + JSON.stringify(msg.params.arguments) }] } });
    else if (tool === "huge") send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "X".repeat(20000) }] } });
    else send({ jsonrpc: "2.0", id: msg.id, error: { code: -1, message: "flaky failure" } });
  }
});
`;

const stdioConfig = (extra = {}) => ({
  transport: { kind: "stdio" as const, command: process.execPath, args: ["-e", FAKE_SERVER] },
  ...extra,
});

test("stdio handshake, tool listing with namespacing, include/exclude filters", async () => {
  const handle = await connectMcpServer("fake", stdioConfig({ tools: { exclude: ["secret"] } }));
  assert.equal(handle.status, "ready");
  assert.deepEqual(handle.tools.map((tool) => tool.namespaced).sort(), ["fake__echo", "fake__flaky", "fake__huge"]);
  const result = await handle.call("echo", { a: 1 });
  assert.equal(result.ok, true);
  assert.match(result.content, /echo:\{"a":1\}/);
  handle.close();
});

test("oversized results are capped through the persistence pipeline (stub + result_fetch)", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-mcp-cap-"));
  const handle = await connectMcpServer("fake", stdioConfig({ limits: { maxResultChars: 1000 } }), cwd);
  const result = await handle.call("huge", {}, cwd);
  assert.equal(result.ok, true);
  assert.ok(result.content.length < 1000);
  assert.match(result.content, /result_fetch\("res_/);
  handle.close();
});

test("circuit breaker opens after 3 consecutive failures and reports cooling down", async () => {
  const handle = await connectMcpServer("fake", stdioConfig());
  for (let index = 0; index < 3; index += 1) {
    const failed = await handle.call("flaky", {});
    assert.equal(failed.ok, false);
    assert.match(failed.error ?? "", /flaky failure/);
  }
  const open = await handle.call("echo", {});
  assert.equal(open.ok, false);
  assert.match(open.error ?? "", /circuit open/);
  handle.close();
});

test("a failing server is isolated: the registry survives and good servers still work", async () => {
  const { handles, registry, close } = await connectMcpServers({
    good: stdioConfig(),
    broken: { transport: { kind: "stdio", command: process.execPath, args: ["-e", "process.exit(1)"] } },
  });
  const good = handles.find((handle) => handle.name === "good")!;
  const broken = handles.find((handle) => handle.name === "broken")!;
  assert.equal(good.status, "ready");
  assert.equal(broken.status, "failed");
  assert.ok(broken.error, "failure is loud, not silent");
  assert.ok(registry["good__echo"], "good server tools registered");
  assert.equal(registry["broken__anything"], undefined);
  const output = await registry["good__echo"]({ ping: true });
  assert.match(String(output), /ping/);
  close();
});

test("tool timeout produces a clear error, not a hang", async () => {
  const SILENT = 'setInterval(() => {}, 1000);'; // never replies
  const handle = await connectMcpServer("mute", {
    transport: { kind: "stdio", command: process.execPath, args: ["-e", SILENT] },
    limits: { toolTimeoutMs: 200 },
  });
  assert.equal(handle.status, "failed");
  assert.match(handle.error ?? "", /timed out/);
  handle.close();
});
