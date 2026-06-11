import assert from "node:assert/strict";
import { test } from "node:test";
import { createSurface, isPairingRequired, type Fetcher } from "../src/index.js";

function stubFetcher(responses: Array<{ status?: number; payload: unknown }>): { fetcher: Fetcher; calls: Array<{ url: string; body?: string; auth?: string }> } {
  const calls: Array<{ url: string; body?: string; auth?: string }> = [];
  const queue = [...responses];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, body: init.body, auth: init.headers.authorization });
    const next = queue.shift() ?? { payload: {} };
    return { ok: (next.status ?? 200) < 400, status: next.status ?? 200, json: async () => next.payload };
  };
  return { fetcher, calls };
}

test("send posts the envelope with bearer auth and default conversation", async () => {
  const { fetcher, calls } = stubFetcher([{ payload: { text: "hello back" } }]);
  const surface = createSurface({ url: "http://gw:7460/", token: "tok123", surfaceId: "web:demo", senderId: "user-1", fetcher });
  const reply = await surface.send("hi");
  assert.equal((reply as { text: string }).text, "hello back");
  assert.equal(calls[0].url, "http://gw:7460/v1/messages");
  assert.equal(calls[0].auth, "Bearer tok123");
  assert.deepEqual(JSON.parse(calls[0].body!), { surfaceId: "web:demo", conversationId: "default", senderId: "user-1", text: "hi" });
});

test("pairing challenge is detectable via isPairingRequired", async () => {
  const { fetcher } = stubFetcher([{ payload: { status: "pairing_required", code: "ABC123" } }]);
  const surface = createSurface({ url: "http://gw:7460", token: "t", surfaceId: "web:demo", senderId: "u", fetcher });
  const result = await surface.send("hi");
  assert.ok(isPairingRequired(result));
  assert.equal(result.code, "ABC123");
});

test("approvalRequest in a reply fires onApproval subscribers, unsubscribe works", async () => {
  const approval = { runId: "flow_1", gateId: "g1", show: "preview", options: ["approve", "reject"] };
  const { fetcher } = stubFetcher([{ payload: { text: "needs approval", approvalRequest: approval } }, { payload: { text: "x" } }]);
  const surface = createSurface({ url: "http://gw:7460", token: "t", surfaceId: "web:demo", senderId: "u", fetcher });
  const seen: unknown[] = [];
  const unsubscribe = surface.onApproval((request) => seen.push(request.runId));
  await surface.send("do it");
  assert.deepEqual(seen, ["flow_1"]);
  unsubscribe();
  await surface.send("again");
  assert.deepEqual(seen, ["flow_1"]);
});

test("approve/reject hit the flow endpoints with encoded run ids", async () => {
  const { fetcher, calls } = stubFetcher([{ payload: { ok: true } }, { payload: { ok: true } }]);
  const surface = createSurface({ url: "http://gw:7460", token: "t", surfaceId: "s", senderId: "u", fetcher });
  await surface.approve("run/1");
  await surface.reject("run 2");
  assert.equal(calls[0].url, "http://gw:7460/v1/flows/run%2F1/approve");
  assert.equal(calls[1].url, "http://gw:7460/v1/flows/run%202/reject");
});

test("gateway errors surface with the server-provided detail", async () => {
  const { fetcher } = stubFetcher([{ status: 401, payload: { error: "bad token" } }]);
  const surface = createSurface({ url: "http://gw:7460", token: "t", surfaceId: "s", senderId: "u", fetcher });
  await assert.rejects(() => surface.send("hi"), /bad token/);
});
