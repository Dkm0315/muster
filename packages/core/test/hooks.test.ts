import assert from "node:assert/strict";
import { test } from "node:test";
import { createHookBus } from "../src/index.js";

test("hooks run in priority order, ties broken by registration order", async () => {
  const bus = createHookBus();
  const order: string[] = [];
  bus.on<string>("turn.start", (p) => { order.push("low"); return { action: "pass" }; }, { priority: 1, id: "low" });
  bus.on<string>("turn.start", (p) => { order.push("high"); return { action: "pass" }; }, { priority: 10, id: "high" });
  bus.on<string>("turn.start", (p) => { order.push("low2"); return { action: "pass" }; }, { priority: 1, id: "low2" });
  await bus.emit("turn.start", "x");
  assert.deepEqual(order, ["high", "low", "low2"]);
});

test("block is terminal: later hooks do not run and outcome carries blocker", async () => {
  const bus = createHookBus();
  let laterRan = false;
  bus.on<string>("tool.before", () => ({ action: "block", reason: "forbidden tool" }), { priority: 5, id: "guard" });
  bus.on<string>("tool.before", () => { laterRan = true; return { action: "pass" }; }, { priority: 1 });
  const outcome = await bus.emit("tool.before", "rm -rf");
  assert.equal(outcome.action, "block");
  assert.equal(outcome.blockedBy, "guard");
  assert.equal(outcome.reason, "forbidden tool");
  assert.equal(laterRan, false);
});

test("rewrite patches the payload for subsequent hooks and the outcome", async () => {
  const bus = createHookBus();
  bus.on<string>("prompt.build", (p) => ({ action: "rewrite", patch: `${p} [redacted]` }), { priority: 2 });
  let seen = "";
  bus.on<string>("prompt.build", (p) => { seen = p; return { action: "pass" }; }, { priority: 1 });
  const outcome = await bus.emit("prompt.build", "hello");
  assert.equal(seen, "hello [redacted]");
  assert.equal(outcome.payload, "hello [redacted]");
});

test("handler timeout and throw are treated as pass with collected warnings", async () => {
  const bus = createHookBus();
  bus.on<string>("outbound.before", () => new Promise(() => {}), { timeoutMs: 30, id: "slow" });
  bus.on<string>("outbound.before", () => { throw new Error("boom"); }, { id: "thrower" });
  const outcome = await bus.emit("outbound.before", "msg");
  assert.equal(outcome.action, "pass");
  assert.equal(outcome.payload, "msg");
  assert.equal(outcome.warnings.length, 2);
  assert.match(outcome.warnings[0], /slow timed out after 30ms/);
  assert.match(outcome.warnings[1], /thrower failed: boom/);
});

test("unsubscribe removes the handler; count reflects registrations", async () => {
  const bus = createHookBus();
  const off = bus.on<string>("session.start", () => ({ action: "block" }));
  assert.equal(bus.count("session.start"), 1);
  off();
  assert.equal(bus.count("session.start"), 0);
  const outcome = await bus.emit("session.start", "s");
  assert.equal(outcome.action, "pass");
});
