import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, listEpisodes, listTokenRecords } from "@dkm0315/core";
import type { MusterConfig } from "@dkm0315/core";
import { approvePairing, loadPairings } from "../src/pairing.js";
import { startGatewayServer } from "../src/server.js";

function startStubLlm(): Promise<{ url: string; close(): void }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "governed reply" } }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
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

test("end to end: pair a web sender, send a message, get a governed run with episode + surface-tagged tokens", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-integration-"));
  const llm = await startStubLlm();
  const gateway = await startGatewayServer({
    config: stubConfig(llm.url),
    gateway: { token: "test-token", adapters: {} },
    cwd,
    log: () => {},
  });
  try {
    const send = (token: string) => fetch(`http://127.0.0.1:${gateway.port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ surfaceId: "web:demo", conversationId: "c1", senderId: "alice", text: "hello muster" }),
    });

    const unauthorized = await send("wrong-token");
    assert.equal(unauthorized.status, 401);

    const challengeResponse = await send("test-token");
    const challenge = await challengeResponse.json() as { status?: string; code?: string };
    assert.equal(challenge.status, "pairing_required");
    assert.ok(challenge.code);

    const store = await loadPairings(cwd);
    assert.equal(store.pending.length, 1);
    await approvePairing(challenge.code!, cwd);

    const replyResponse = await send("test-token");
    const reply = await replyResponse.json() as { text?: string };
    assert.equal(reply.text, "governed reply");

    const episodes = await listEpisodes(cwd);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].prompt, "hello muster");

    const tokens = await listTokenRecords(cwd);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].surfaceId, "web:demo");

    const health = await fetch(`http://127.0.0.1:${gateway.port}/v1/health`);
    assert.equal(health.status, 200);
  } finally {
    await gateway.close();
    llm.close();
  }
});
