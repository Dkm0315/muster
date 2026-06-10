import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildClaudeCodeArgs, inspectClaudeCode, runClaudeCode } from "../src/index.js";

test("buildClaudeCodeArgs creates a non-interactive Claude Code invocation", () => {
  const args = buildClaudeCodeArgs({
    prompt: "Review this repo",
    model: "sonnet",
    effort: "low",
    allowedTools: ["Bash(git status)", "Read"]
  });

  assert.deepEqual(args, [
    "--print",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--model",
    "sonnet",
    "--effort",
    "low",
    "--allowedTools",
    "Bash(git status),Read",
    "Review this repo"
  ]);
});

test("runClaudeCode invokes an external Claude-compatible command", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-claude-command-"));
  const command = join(cwd, "fake-claude.sh");
  await writeFile(command, "#!/usr/bin/env bash\nprintf 'claude-output:%s\\n' \"$*\"\n", "utf8");
  await chmod(command, 0o755);

  const result = await runClaudeCode({
    command,
    prompt: "Say hello",
    cwd,
    model: "sonnet",
    effort: "low"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.command, command);
  assert.match(result.stdout, /claude-output:/);
  assert.match(result.stdout, /Say hello/);
});

test("inspectClaudeCode reports unavailable commands safely", async () => {
  const report = await inspectClaudeCode("/definitely/missing/claude");

  assert.equal(report.available, false);
});
