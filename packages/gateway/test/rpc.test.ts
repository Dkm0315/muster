import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { defaultConfig } from "@musterhq/core";
import type { MusterConfig } from "@musterhq/core";
import { RPC_CONTRACT_VERSION, attachStdioTransport, createRpcCore } from "../src/rpc.js";

function startStubLlm(): Promise<{ url: string; close(): void }> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "rpc reply" } }] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`, close: () => server.close() });
    });
  });
}

function stubConfig(baseUrl: string): MusterConfig {
  const config = defaultConfig();
  return {
    ...config,
    providers: { stub: { id: "stub", kind: "openai-compatible", baseUrl, defaultModel: "stub-model", timeoutMs: 5000 } },
    runtimes: { native: { id: "native", enabled: true, provider: "stub", routes: {} } },
    routing: { ...config.routing, defaultRuntime: "native" },
  };
}

test("contract handshake, session lifecycle, prompt round-trip with ledger.tick", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rpc-"));
  const llm = await startStubLlm();
  try {
    const core = createRpcCore({ config: stubConfig(llm.url), cwd });
    const events: string[] = [];
    core.subscribe((event) => events.push(event.type));

    const version = await core.handle({ jsonrpc: "2.0", id: 1, method: "contract.version" });
    assert.deepEqual(version.result, { contract: RPC_CONTRACT_VERSION, name: "muster-gateway" });

    const created = await core.handle({ jsonrpc: "2.0", id: 2, method: "session.create" });
    const sessionId = (created.result as { sessionId: string }).sessionId;

    const reply = await core.handle({ jsonrpc: "2.0", id: 3, method: "prompt.submit", params: { sessionId, prompt: "hello" } });
    assert.equal((reply.result as { text: string }).text, "rpc reply");
    assert.deepEqual(events, ["session.created", "message.stop", "ledger.tick"]);

    const ledger = await core.handle({ jsonrpc: "2.0", id: 4, method: "ledger.recent" });
    assert.equal((ledger.result as { records: unknown[] }).records.length, 1);
  } finally {
    llm.close();
  }
});

test("contract mismatch halts loudly; unknown methods and sessions error cleanly", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rpc-err-"));
  const core = createRpcCore({ config: defaultConfig(), cwd });
  const mismatch = await core.handle({ jsonrpc: "2.0", id: 1, method: "session.create", params: { minContract: 99 } });
  assert.match(mismatch.error?.message ?? "", /Contract mismatch.*never silently downgrade/);
  const unknown = await core.handle({ jsonrpc: "2.0", id: 2, method: "nope" });
  assert.equal(unknown.error?.code, -32601);
  const badSession = await core.handle({ jsonrpc: "2.0", id: 3, method: "prompt.submit", params: { sessionId: "ghost", prompt: "x" } });
  assert.match(badSession.error?.message ?? "", /Unknown session/);
});

test("stream tickets are single-use and expire", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rpc-ticket-"));
  const core = createRpcCore({ config: defaultConfig(), cwd });
  const { ticket } = core.mintTicket();
  assert.equal(core.consumeTicket(ticket), true);
  assert.equal(core.consumeTicket(ticket), false, "single-use");
  assert.equal(core.consumeTicket("tk_forged"), false);
});

test("stdio transport: NDJSON requests, responses, and pushed events on one pipe", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rpc-stdio-"));
  const llm = await startStubLlm();
  try {
    const core = createRpcCore({ config: stubConfig(llm.url), cwd });
    const input = new PassThrough();
    const output = new PassThrough();
    const detach = attachStdioTransport(core, input, output);
    let received = "";
    output.on("data", (chunk) => { received += chunk.toString(); });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.create" })}\n`);
    await delay(50);
    const sessionId = (JSON.parse(received.split("\n").find((line) => line.includes("sessionId") && line.includes("result"))!) as { result: { sessionId: string } }).result.sessionId;

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt.submit", params: { sessionId, prompt: "hi" } })}\n`);
    await delay(300);
    input.write("not-json\n");
    await delay(50);

    const lines = received.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(lines.some((line) => line.method === "event" && line.params?.type === "ledger.tick"), "events pushed on the same pipe");
    assert.ok(lines.some((line) => line.result?.text === "rpc reply"));
    assert.ok(lines.some((line) => line.error?.code === -32700), "parse errors answered, not fatal");
    detach();
  } finally {
    llm.close();
  }
});
