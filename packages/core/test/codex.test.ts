import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCodexArgs, parseCodexEvents } from "../src/codex.js";

test("buildCodexArgs: fresh turn runs codex exec at full native power", () => {
  const args = buildCodexArgs({
    prompt: "build me an xlsx of last week's tickets",
    cwd: "/home/goblin/.muster/profiles/tg/workspace",
    model: "gpt-5.5",
    instructionsFile: "/tmp/muster-inject.md",
    networkAccess: true,
  }, "/tmp/out.txt");

  assert.deepEqual(args, [
    "exec", "--json",
    "-C", "/home/goblin/.muster/profiles/tg/workspace", "--skip-git-repo-check",
    "-m", "gpt-5.5",
    "-s", "workspace-write",
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

  assert.equal(args[0], "exec");
  assert.equal(args[1], "resume");
  assert.equal(args[2], "11111111-2222-3333-4444-555555555555");
  assert.equal(args[3], "--json");
  // never passes --no-session-persistence; full native power retained
  assert.ok(!args.includes("--no-session-persistence"));
  assert.ok(!args.includes("-q"));
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
