import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "@musterhq/core";
import { dispatchCommand, parseCommand, resolveCustomCommand } from "../src/commands.js";
import type { SurfaceMessage } from "../src/envelope.js";
import type { PairedSender } from "../src/pairing.js";

const PAIRED: PairedSender = { pairingId: "pair_abc", surfaceId: "telegram:bot", senderId: "555", approvedAt: "2026-06-15T00:00:00Z" };
const msg = (text: string): SurfaceMessage => ({ surfaceId: "telegram:bot", conversationId: "c1", senderId: "555", text });
const ctx = { config: defaultConfig(), profile: "tg", paired: PAIRED, conversationKey: "telegram:bot:c1" };

test("parseCommand: extracts name + args, lowercasing the name", () => {
  assert.deepEqual(parseCommand("/help"), { name: "help", args: "" });
  assert.deepEqual(parseCommand("/status now"), { name: "status", args: "now" });
  assert.deepEqual(parseCommand("  /Review the PR  "), { name: "review", args: "the PR" });
});

test("parseCommand: a path-like prompt is NOT a command (passes through)", () => {
  assert.equal(parseCommand("/etc/hosts is missing an entry"), null);
  assert.equal(parseCommand("just a normal message"), null);
  assert.equal(parseCommand("tell me about /usr/bin"), null);
});

test("dispatchCommand: /help is answered in-gateway with the command list", async () => {
  const reply = await dispatchCommand(msg("/help"), ctx);
  assert.ok(reply, "expected a reply");
  assert.match(reply.text, /\/start/);
  assert.match(reply.text, /\/status/);
  assert.match(reply.text, /\/pair/);
  assert.match(reply.text, /\/new/);
  assert.match(reply.text, /\/reset/);
  assert.match(reply.text, /\/stop/);
});

test("dispatchCommand: /status reports profile, runtime, model, pairing", async () => {
  const reply = await dispatchCommand(msg("/status"), ctx);
  assert.ok(reply);
  assert.match(reply.text, /profile: tg/);
  assert.match(reply.text, new RegExp(ctx.config.routing.defaultRuntime));
  assert.match(reply.text, /pair_abc/);
});

test("dispatchCommand: /pair tells an already-paired chat there is nothing to do", async () => {
  const reply = await dispatchCommand(msg("/pair"), ctx);
  assert.ok(reply);
  assert.match(reply.text, /already paired/i);
  assert.match(reply.text, /pair_abc/);
});

test("dispatchCommand: /stop is acknowledged in-gateway", async () => {
  const reply = await dispatchCommand(msg("/stop"), ctx);
  assert.ok(reply);
  assert.match(reply.text, /No active gateway command/i);
});

test("resolveCustomCommand: matches exact or prefix surfaces and renders prompt templates", () => {
  const custom = resolveCustomCommand(msg("/deploy site-a"), {
    token: "t",
    commands: {
      entries: {
        deploy: {
          description: "Deploy a site",
          prompt: "Deploy with args: {args}",
          surfaces: ["telegram"],
        },
      },
    },
  });
  assert.ok(custom);
  assert.match(custom.prompt, /Deploy a site/);
  assert.match(custom.prompt, /Deploy with args: site-a/);

  const blocked = resolveCustomCommand({ ...msg("/deploy site-a"), surfaceId: "web:demo" }, {
    token: "t",
    commands: { entries: { deploy: { prompt: "nope", surfaces: ["telegram"] } } },
  });
  assert.equal(blocked, undefined);
});

test("dispatchCommand: a non-builtin /command returns null (passthrough to the agent)", async () => {
  assert.equal(await dispatchCommand(msg("/review the diff"), ctx), null);
  assert.equal(await dispatchCommand(msg("/init"), ctx), null);
});

test("dispatchCommand: a normal message returns null (goes to the agent)", async () => {
  assert.equal(await dispatchCommand(msg("build me an xlsx of tickets"), ctx), null);
});
