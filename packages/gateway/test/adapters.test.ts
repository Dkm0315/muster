import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "@musterhq/core";
import type { MusterConfig } from "@musterhq/core";
import { createHmac } from "node:crypto";
import {
  approvePairing,
  gatewayConfigPath,
  loadGatewayConfig,
  requestPairing,
  resetAdapterAuthWarnings,
  slackEventToSurfaceMessage,
  slackSignatureIsValid,
  SLACK_REPLAY_WINDOW_SECONDS,
  startGatewayServer,
  surfaceReplyToSlackPost,
  surfaceReplyToTelegramSend,
  telegramUpdateToSurfaceMessage,
  TELEGRAM_SURFACE_ID,
} from "../src/index.js";

/** Build the X-Slack-Signature value Slack would send for a given body/timestamp/secret. */
function slackSignature(timestamp: string, rawBody: string, secret: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`, "utf8").digest("hex")}`;
}

// --- realistic fixtures (shape per Bot API / Events API docs) ---

const telegramUpdate = {
  update_id: 837366021,
  message: {
    message_id: 142,
    from: { id: 5599220011, is_bot: false, first_name: "Dhairya", username: "dhairya" },
    chat: { id: -1001234567890, title: "Muster Ops", type: "supergroup" },
    date: 1765432100,
    text: "what is the deploy status?",
    reply_to_message: { message_id: 141 },
  },
};

const slackEventCallback = {
  token: "XXYYZZ",
  team_id: "T024BE7LD",
  api_app_id: "A4H1JB4AZ",
  type: "event_callback",
  event_id: "Ev0PV52K21",
  event_time: 1765432100,
  event: {
    type: "message",
    channel: "C2147483705",
    user: "U2147483697",
    text: "muster: summarize the open tickets",
    ts: "1765432100.000259",
    thread_ts: "1765432000.000200",
  },
};

const slackUrlVerification = {
  token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
  challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
  type: "url_verification",
};

// --- Telegram mapper ---

test("telegram update maps to a SurfaceMessage with chat/sender/replyTo preserved", () => {
  const message = telegramUpdateToSurfaceMessage(telegramUpdate);
  assert.ok(message);
  assert.equal(message.surfaceId, TELEGRAM_SURFACE_ID);
  assert.equal(message.conversationId, "-1001234567890");
  assert.equal(message.senderId, "5599220011");
  assert.equal(message.text, "what is the deploy status?");
  assert.equal(message.replyTo, "141");
  assert.equal(message.raw, telegramUpdate);
});

test("telegram non-text updates map to undefined", () => {
  assert.equal(telegramUpdateToSurfaceMessage({ update_id: 1 }), undefined);
  assert.equal(telegramUpdateToSurfaceMessage({ update_id: 1, message: { chat: { id: 5 }, from: { id: 7 }, sticker: {} } }), undefined);
  assert.equal(telegramUpdateToSurfaceMessage("not json object"), undefined);
});

test("telegram reply maps to sendMessage; approvals render inline keyboard buttons", () => {
  const plain = surfaceReplyToTelegramSend({ text: "deploy is green" }, "-100123");
  assert.deepEqual(plain, { chat_id: "-100123", text: "deploy is green" });

  const pairing = surfaceReplyToTelegramSend({ status: "pairing_required", code: "AB23CD45" }, "-100123");
  assert.match(pairing.text, /muster pairing approve AB23CD45/);
  assert.equal(pairing.reply_markup, undefined);

  const approval = surfaceReplyToTelegramSend({
    text: "drafted",
    approvalRequest: { runId: "flowrun_1a2b3c4d", gateId: "gate", show: "ship it?", options: ["approve", "reject"] },
  }, "-100123");
  assert.match(approval.text, /Approval required/);
  const buttons = approval.reply_markup?.inline_keyboard[0];
  assert.deepEqual(buttons?.map((button) => button.callback_data), [
    "muster:approve:flowrun_1a2b3c4d",
    "muster:reject:flowrun_1a2b3c4d",
  ]);
});

// --- Slack mapper ---

test("slack url_verification challenge is recognized and echoed", () => {
  const inbound = slackEventToSurfaceMessage(slackUrlVerification);
  assert.equal(inbound.kind, "url_verification");
  assert.equal((inbound as { challenge: string }).challenge, slackUrlVerification.challenge);
});

test("slack event_callback message maps to a SurfaceMessage", () => {
  const inbound = slackEventToSurfaceMessage(slackEventCallback);
  assert.equal(inbound.kind, "message");
  const message = (inbound as { message: { surfaceId: string; conversationId: string; senderId: string; text: string; replyTo?: string } }).message;
  assert.equal(message.surfaceId, "slack:T024BE7LD");
  assert.equal(message.conversationId, "C2147483705");
  assert.equal(message.senderId, "U2147483697");
  assert.equal(message.text, "muster: summarize the open tickets");
  assert.equal(message.replyTo, "1765432000.000200");
});

test("slack bot echoes and unsupported events are ignored", () => {
  const botEcho = slackEventToSurfaceMessage({
    type: "event_callback",
    team_id: "T024BE7LD",
    event: { type: "message", bot_id: "B19", channel: "C1", user: "U1", text: "I am the bot" },
  });
  assert.equal(botEcho.kind, "ignored");
  const reaction = slackEventToSurfaceMessage({
    type: "event_callback",
    team_id: "T024BE7LD",
    event: { type: "reaction_added", user: "U1" },
  });
  assert.equal(reaction.kind, "ignored");
});

test("slack reply maps to chat.postMessage; approvals render Block Kit buttons", () => {
  const plain = surfaceReplyToSlackPost({ text: "3 open tickets" }, "C1", "1765432000.000200");
  assert.deepEqual(plain, { channel: "C1", thread_ts: "1765432000.000200", text: "3 open tickets" });

  const approval = surfaceReplyToSlackPost({
    text: "draft ready",
    approvalRequest: { runId: "flowrun_9z8y7x6w", gateId: "publish", show: { title: "Q2 report" }, options: ["approve", "reject"] },
  }, "C1");
  assert.ok(approval.blocks);
  const actions = approval.blocks!.find((block) => (block as { type: string }).type === "actions") as {
    elements: Array<{ action_id: string; value: string }>;
  };
  assert.deepEqual(actions.elements.map((element) => [element.action_id, element.value]), [
    ["muster_approve", "flowrun_9z8y7x6w"],
    ["muster_reject", "flowrun_9z8y7x6w"],
  ]);

  const pairing = surfaceReplyToSlackPost({ status: "pairing_required", code: "QR45ST67" }, "C1");
  assert.match(pairing.text, /muster pairing approve QR45ST67/);
});

// --- webhook routes (injected fetcher, no live network) ---

function stubConfig(baseUrl: string): MusterConfig {
  const config = defaultConfig();
  return {
    ...config,
    providers: { stub: { id: "stub", kind: "openai-compatible", baseUrl, defaultModel: "stub-model", timeoutMs: 5000 } },
    runtimes: { native: { id: "native", enabled: true, provider: "stub", routes: {} } },
    routing: { ...config.routing, defaultRuntime: "native" },
  };
}

function startStubLlm(content: string): Promise<{ url: string; close: () => void }> {
  return import("node:http").then(({ createServer }) => new Promise((resolvePromise) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
    });
  }));
}

test("telegram webhook: pairing challenge then governed reply, outbound via injected fetcher", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-telegram-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", telegram: { botToken: "123:ABC" } }));
  const gateway = await loadGatewayConfig(cwd);

  const llm = await startStubLlm("deploy is green");
  const outbound: Array<{ url: string; body: unknown }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    outbound.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd, fetcher }, 0);
  const post = async () => fetch(`http://127.0.0.1:${running.port}/v1/adapters/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(telegramUpdate),
  });
  try {
    // first contact: pairing challenge goes back to the chat
    assert.equal((await post()).status, 200);
    assert.equal(outbound.length, 1);
    assert.match(outbound[0].url, /^https:\/\/api\.telegram\.org\/bot123:ABC\/sendMessage$/);
    const challengeBody = outbound[0].body as { chat_id: string; text: string };
    assert.equal(challengeBody.chat_id, "-1001234567890");
    const code = challengeBody.text.match(/approve ([A-Z2-9]{8})/)?.[1];
    assert.ok(code, "pairing code is included in the challenge text");

    await approvePairing(code!, cwd);

    // second contact: governed run, reply posted to the chat
    assert.equal((await post()).status, 200);
    assert.equal(outbound.length, 2);
    assert.equal((outbound[1].body as { text: string }).text, "deploy is green");
  } finally {
    await running.close();
    llm.close();
  }
});

test("slack webhook answers url_verification with the challenge", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-slack-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", slack: { botToken: "xoxb-test" } }));
  const gateway = await loadGatewayConfig(cwd);
  const llm = await startStubLlm("unused");
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd }, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${running.port}/v1/adapters/slack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackUrlVerification),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: slackUrlVerification.challenge });
  } finally {
    await running.close();
    llm.close();
  }
});

test("slack webhook posts governed reply via chat.postMessage with bot token", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-slack-msg-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", slack: { botToken: "xoxb-test" } }));
  const gateway = await loadGatewayConfig(cwd);

  await requestPairing("slack:T024BE7LD", "U2147483697", cwd).then((pending) => approvePairing(pending.code, cwd));

  const llm = await startStubLlm("3 open tickets");
  const outbound: Array<{ url: string; auth?: string; body: unknown }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    outbound.push({ url: String(url), auth: headers?.authorization, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd, fetcher }, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${running.port}/v1/adapters/slack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackEventCallback),
    });
    assert.equal(response.status, 200);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].url, "https://slack.com/api/chat.postMessage");
    assert.equal(outbound[0].auth, "Bearer xoxb-test");
    const body = outbound[0].body as { channel: string; text: string; thread_ts?: string };
    assert.equal(body.channel, "C2147483705");
    assert.equal(body.text, "3 open tickets");
    assert.equal(body.thread_ts, "1765432000.000200");
  } finally {
    await running.close();
    llm.close();
  }
});

// --- Slack signing-secret verification (fix #6) ---

test("slackSignatureIsValid accepts a correct v0 signature and rejects tampering/replay", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const rawBody = JSON.stringify(slackEventCallback);
  const now = 1_765_432_500_000; // fixed clock
  const ts = String(Math.floor(now / 1000));
  const good = slackSignature(ts, rawBody, secret);

  assert.equal(slackSignatureIsValid(ts, rawBody, good, secret, now), true, "valid signature passes");
  assert.equal(slackSignatureIsValid(ts, `${rawBody} `, good, secret, now), false, "tampered body fails");
  assert.equal(slackSignatureIsValid(ts, rawBody, "v0=deadbeef", secret, now), false, "bad signature fails");
  assert.equal(slackSignatureIsValid(ts, rawBody, good, "wrong-secret", now), false, "wrong secret fails");
  assert.equal(slackSignatureIsValid(undefined, rawBody, good, secret, now), false, "missing timestamp fails");
  assert.equal(slackSignatureIsValid(ts, rawBody, undefined, secret, now), false, "missing signature fails");

  // A timestamp older than the replay window is rejected even with a correct HMAC.
  const oldTs = String(Math.floor(now / 1000) - SLACK_REPLAY_WINDOW_SECONDS - 1);
  const oldSig = slackSignature(oldTs, rawBody, secret);
  assert.equal(slackSignatureIsValid(oldTs, rawBody, oldSig, secret, now), false, "stale timestamp rejected (replay)");
});

test("slack webhook verifies the signing secret before processing when configured", async () => {
  resetAdapterAuthWarnings();
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-slack-sig-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  const signingSecret = "topsecretsigning";
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", slack: { botToken: "xoxb-test", signingSecret } }));
  const gateway = await loadGatewayConfig(cwd);
  const llm = await startStubLlm("unused");
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd }, 0);
  const rawBody = JSON.stringify(slackUrlVerification);
  const ts = String(Math.floor(Date.now() / 1000));
  const postSlack = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${running.port}/v1/adapters/slack`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody,
  });
  try {
    // No signature headers -> 401.
    assert.equal((await postSlack({})).status, 401);
    // Wrong signature -> 401.
    assert.equal((await postSlack({ "x-slack-request-timestamp": ts, "x-slack-signature": "v0=bad" })).status, 401);
    // Tampered body (valid sig for different body) -> 401.
    const sigForOther = slackSignature(ts, "{}", signingSecret);
    assert.equal((await postSlack({ "x-slack-request-timestamp": ts, "x-slack-signature": sigForOther })).status, 401);
    // Correct signature -> 200 and the url_verification challenge echoes back.
    const good = slackSignature(ts, rawBody, signingSecret);
    const ok = await postSlack({ "x-slack-request-timestamp": ts, "x-slack-signature": good });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { challenge: slackUrlVerification.challenge });
  } finally {
    await running.close();
    llm.close();
  }
});

test("slack webhook without a signing secret warns once that it is unauthenticated", async () => {
  resetAdapterAuthWarnings();
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-slack-warn-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", slack: { botToken: "xoxb-test" } }));
  const gateway = await loadGatewayConfig(cwd);
  const llm = await startStubLlm("unused");
  const lines: string[] = [];
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd, log: (line) => lines.push(line) }, 0);
  const postSlack = () => fetch(`http://127.0.0.1:${running.port}/v1/adapters/slack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackUrlVerification),
  });
  try {
    assert.equal((await postSlack()).status, 200, "unauthenticated slack still processes (back-compat)");
    assert.equal((await postSlack()).status, 200);
    const warnings = lines.filter((line) => line.includes("UNAUTHENTICATED") && line.includes("slack"));
    assert.equal(warnings.length, 1, "warns exactly once per process");
  } finally {
    await running.close();
    llm.close();
  }
});

// --- Telegram secret-token verification (fix #7) ---

test("telegram webhook requires the secret-token header when configured", async () => {
  resetAdapterAuthWarnings();
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-tg-secret-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  const secretToken = "tg-webhook-secret-123";
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", telegram: { botToken: "123:ABC", secretToken } }));
  const gateway = await loadGatewayConfig(cwd);
  const llm = await startStubLlm("unused");
  const fetcher = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd, fetcher }, 0);
  const postTg = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${running.port}/v1/adapters/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(telegramUpdate),
  });
  try {
    assert.equal((await postTg({})).status, 401, "missing secret token rejected");
    assert.equal((await postTg({ "x-telegram-bot-api-secret-token": "wrong" })).status, 401, "wrong secret token rejected");
    // Matching token is accepted (proceeds to pairing -> 200).
    assert.equal((await postTg({ "x-telegram-bot-api-secret-token": secretToken })).status, 200, "matching secret token accepted");
  } finally {
    await running.close();
    llm.close();
  }
});

test("telegram webhook without a secret token warns once that it is unauthenticated", async () => {
  resetAdapterAuthWarnings();
  const cwd = await mkdtemp(join(tmpdir(), "muster-gw-tg-warn-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(gatewayConfigPath(cwd), JSON.stringify({ token: "test-token", telegram: { botToken: "123:ABC" } }));
  const gateway = await loadGatewayConfig(cwd);
  const llm = await startStubLlm("unused");
  const lines: string[] = [];
  const fetcher = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  const running = await startGatewayServer({ config: stubConfig(llm.url), gateway, cwd, fetcher, log: (line) => lines.push(line) }, 0);
  const postTg = () => fetch(`http://127.0.0.1:${running.port}/v1/adapters/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(telegramUpdate),
  });
  try {
    assert.equal((await postTg()).status, 200, "unauthenticated telegram still processes (back-compat)");
    assert.equal((await postTg()).status, 200);
    const warnings = lines.filter((line) => line.includes("UNAUTHENTICATED") && line.includes("telegram"));
    assert.equal(warnings.length, 1, "warns exactly once per process");
  } finally {
    await running.close();
    llm.close();
  }
});
