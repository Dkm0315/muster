import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildCodexArgs, parseCodexEvents } from "../src/codex.js";
import { clearCodexAppServerSessions, runCodexAppServer } from "../src/codex-app-server.js";

test("buildCodexArgs: fresh turn runs codex exec at full native power", () => {
  const args = buildCodexArgs({
    prompt: "build me an xlsx of last week's tickets",
    cwd: "/home/goblin/.muster/profiles/tg/workspace",
    model: "gpt-5.5",
    instructionsFile: "/tmp/muster-inject.md",
    networkAccess: true,
    ignoreRules: true,
  }, "/tmp/out.txt");

  assert.deepEqual(args, [
    "exec", "--json",
    "-C", "/home/goblin/.muster/profiles/tg/workspace", "--skip-git-repo-check",
    "-m", "gpt-5.5",
    "-s", "workspace-write",
    "--ignore-rules",
    "-c", "approval_policy=never",
    "-c", "sandbox_workspace_write.network_access=true",
    "-c", "experimental_instructions_file=/tmp/muster-inject.md",
    "-o", "/tmp/out.txt",
    "build me an xlsx of last week's tickets",
  ]);
});

test("buildCodexArgs: resume threads the native session id", () => {
  const args = buildCodexArgs({
    prompt: "now add a totals row",
    cwd: "/ws",
    sessionId: "11111111-2222-3333-4444-555555555555",
    resume: true,
  }, "/tmp/o.txt");

  assert.deepEqual(args, [
    "exec", "resume", "--json",
    "--skip-git-repo-check",
    "-c", "approval_policy=never",
    "-o", "/tmp/o.txt",
    "11111111-2222-3333-4444-555555555555",
    "now add a totals row",
  ]);
  // never passes --no-session-persistence; full native power retained
  assert.ok(!args.includes("--no-session-persistence"));
  assert.ok(!args.includes("-q"));
});

test("buildCodexArgs: ephemeral fresh turns skip native session persistence for speed", () => {
  const args = buildCodexArgs({
    prompt: "hi",
    cwd: "/ws",
    model: "gpt-5.5",
    ephemeral: true,
  }, "/tmp/o.txt");

  assert.deepEqual(args.slice(0, 5), ["exec", "--json", "--ephemeral", "-C", "/ws"]);
  assert.ok(args.includes("--ephemeral"));
});

test("parseCodexEvents: extracts thread_id (resume handle) from the JSONL stream", () => {
  const stream = [
    '{"type":"thread.started","thread_id":"abc-123"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"assistant_message","text":"done"}}',
    '{"type":"turn.completed"}',
  ].join("\n");
  const r = parseCodexEvents(stream);
  assert.equal(r.threadId, "abc-123");
  assert.equal(r.failed, false);
});

test("parseCodexEvents: detects a failed turn and its message", () => {
  const stream = [
    '{"type":"thread.started","thread_id":"x"}',
    '{"type":"turn.failed","error":{"message":"401 Unauthorized"}}',
  ].join("\n");
  const r = parseCodexEvents(stream);
  assert.equal(r.failed, true);
  assert.equal(r.failureMessage, "401 Unauthorized");
});

test("parseCodexEvents: tolerates non-JSON log lines without throwing", () => {
  const stream = "warning: --full-auto is deprecated\n{\"type\":\"thread.started\",\"thread_id\":\"y\"}\nplain log line";
  const r = parseCodexEvents(stream);
  assert.equal(r.threadId, "y");
  assert.equal(r.failed, false);
});

test("runCodexAppServer: streams a turn and reuses the session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "muster-codex-app-server-"));
  const fake = join(dir, "codex-fake.mjs");
  await writeFile(fake, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
let threadId = "thread-1";
let turn = 0;
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ id: msg.id, result: { userAgent: "fake" } });
  else if (msg.method === "initialized") {}
  else if (msg.method === "thread/start") send({ id: msg.id, result: { thread: { id: threadId } } });
  else if (msg.method === "turn/start") {
    turn += 1;
    send({ id: msg.id, result: { turn: { id: "turn-" + turn, status: "inProgress" } } });
    send({ method: "item/agentMessage/delta", params: { threadId, turnId: "turn-" + turn, itemId: "m", delta: "ok" + turn } });
    send({ method: "item/completed", params: { item: { type: "agentMessage", id: "m", text: "ok" + turn }, threadId, turnId: "turn-" + turn } });
    send({ method: "thread/tokenUsage/updated", params: { threadId, turnId: "turn-" + turn, tokenUsage: { last: { inputTokens: 10 + turn, cachedInputTokens: turn === 1 ? 0 : 10, outputTokens: 1 } } } });
    send({ method: "turn/completed", params: { threadId, turn: { id: "turn-" + turn, status: "completed" } } });
  }
});
`, "utf8");
  await chmod(fake, 0o755);
  try {
    const deltas: string[] = [];
    const first = await runCodexAppServer({ prompt: "one", cwd: dir, command: fake, cacheKey: "test", onDelta: (delta) => deltas.push(delta) });
    const second = await runCodexAppServer({ prompt: "two", cwd: dir, command: fake, cacheKey: "test", onDelta: (delta) => deltas.push(delta) });
    assert.equal(first.status, "completed");
    assert.equal(first.finalMessage, "ok1");
    assert.equal(second.finalMessage, "ok2");
    assert.equal(second.threadId, "thread-1");
    assert.deepEqual(deltas, ["ok1", "ok2"]);
    assert.equal(second.tokenUsage?.cachedInputTokens, 10);
  } finally {
    clearCodexAppServerSessions();
    await rm(dir, { recursive: true, force: true });
  }
});
