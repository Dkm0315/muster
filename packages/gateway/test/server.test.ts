import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, runFlow } from "@dkm0315/core";
import type { MusterConfig } from "@dkm0315/core";
import { approvePairing, initGatewayConfig, startGatewayServer } from "../src/index.js";
import type { GatewayConfig, PairingChallenge, SurfaceReply } from "../src/index.js";

function stubConfig(baseUrl: string): MusterConfig {
  const config = defaultConfig();
  return {
    ...config,
    providers: {
      ...config.providers,
      stub: { id: "stub", kind: "openai-compatible", baseUrl, defaultModel: "stub-model", timeoutMs: 5000 },
    },
    runtimes: {
      native: { id: "native", enabled: true, provider: "stub", routes: {} },
    },
    routing: { ...config.routing, defaultRuntime: "native" },
  };
}

function startStubServer(handler: (body: string) => { status: number; payload: unknown }): Promise<{ url: string; close: () => void }> {
  return import("node:http").then(({ createServer }) => new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const result = handler(body);
        response.writeHead(result.status, { "content-type": "application/json" });
        response.end(JSON.stringify(result.payload));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
    });
  }));
}

async function startTestGateway(cwd: string, llmUrl: string): Promise<{ url: string; gateway: GatewayConfig; close: () => Promise<void> }> {
  const init = await initGatewayConfig(cwd);
  const running = await startGatewayServer({ config: stubConfig(llmUrl), gateway: init.config, cwd }, 0);
  return { url: `http://127.0.0.1:${running.port}`, gateway: init.config, close: running.close };
}

test("gateway health endpoint answers without auth", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-health-"));
  const llm = await startStubServer(() => ({ status: 200, payload: { choices: [{ message: { content: "ok" } }] } }));
  const gw = await startTestGateway(cwd, llm.url);
  try {
    const response = await fetch(`${gw.url}/v1/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "muster-gateway" });
  } finally {
    await gw.close();
    llm.close();
  }
});

test("POST /v1/messages requires the gateway bearer token", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-auth-"));
  const llm = await startStubServer(() => ({ status: 200, payload: { choices: [{ message: { content: "ok" } }] } }));
  const gw = await startTestGateway(cwd, llm.url);
  try {
    const response = await fetch(`${gw.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify({ surfaceId: "web:demo", conversationId: "c1", senderId: "s1", text: "hi" }),
    });
    assert.equal(response.status, 401);
  } finally {
    await gw.close();
    llm.close();
  }
});

test("invalid envelopes are rejected with 400 and a reason", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-envelope-"));
  const llm = await startStubServer(() => ({ status: 200, payload: { choices: [{ message: { content: "ok" } }] } }));
  const gw = await startTestGateway(cwd, llm.url);
  try {
    const response = await fetch(`${gw.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gw.gateway.token}` },
      body: JSON.stringify({ surfaceId: "web:demo", text: "missing conversation and sender" }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: string };
    assert.match(payload.error, /conversationId/);
  } finally {
    await gw.close();
    llm.close();
  }
});

test("unpaired sender gets pairing_required; after approval the message runs governed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-pairing-"));
  const llm = await startStubServer(() => ({ status: 200, payload: { choices: [{ message: { content: "governed answer" } }] } }));
  const gw = await startTestGateway(cwd, llm.url);
  const send = async () => fetch(`${gw.url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${gw.gateway.token}` },
    body: JSON.stringify({ surfaceId: "web:demo", conversationId: "c1", senderId: "visitor-1", text: "hello muster" }),
  });
  try {
    const challengeResponse = await send();
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json() as PairingChallenge;
    assert.equal(challenge.status, "pairing_required");
    assert.match(challenge.code, /^[A-Z2-9]{8}$/);

    await approvePairing(challenge.code, cwd);

    const replyResponse = await send();
    assert.equal(replyResponse.status, 200);
    const reply = await replyResponse.json() as SurfaceReply;
    assert.equal(reply.text, "governed answer");
  } finally {
    await gw.close();
    llm.close();
  }
});

test("POST /v1/flows/:runId/approve resumes a gated flow run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-flow-"));
  const llm = await startStubServer(() => ({ status: 200, payload: { choices: [{ message: { content: "ok" } }] } }));
  const config = stubConfig(llm.url);
  const registry = { echo: async (args: Record<string, unknown>) => args };
  const pending = await runFlow({
    id: "gated",
    steps: [
      { id: "draft", kind: "tool", tool: "echo", args: { text: "ship it?" } },
      { id: "gate", kind: "gate", show: "draft.text" },
      { id: "after", kind: "tool", tool: "echo", args: { done: true } },
    ],
  }, { config, registry, cwd });
  assert.equal(pending.status, "awaiting_approval");

  const init = await initGatewayConfig(cwd);
  const running = await startGatewayServer({ config, gateway: init.config, cwd, registry }, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${running.port}/v1/flows/${pending.runId}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${init.config.token}` },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as { status: string; runId: string };
    assert.equal(payload.runId, pending.runId);
    assert.equal(payload.status, "completed");
  } finally {
    await running.close();
    llm.close();
  }
});
