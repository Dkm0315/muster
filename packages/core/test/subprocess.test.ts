import assert from "node:assert/strict";
import { test } from "node:test";
import { runSubprocess } from "../src/index.js";
import type { SubprocessError } from "../src/index.js";

test("runSubprocess resolves with stdout for a normal command", async () => {
  const result = await runSubprocess(process.execPath, ["-e", "process.stdout.write('hello')"]);
  assert.equal(result.stdout, "hello");
});

test("runSubprocess closes child stdin so stdin-reading CLIs do not hang", async () => {
  const result = await runSubprocess(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('eof'))"], { timeoutMs: 1000 });
  assert.equal(result.stdout, "eof");
});

test("runSubprocess rejects a non-zero exit with stdout/stderr attached", async () => {
  await assert.rejects(
    runSubprocess(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(3)"]),
    (error) => {
      assert.match(String(error), /exit 3/);
      assert.equal((error as SubprocessError).stderr, "boom");
      return true;
    },
  );
});

test("runSubprocess SIGKILLs a child that ignores SIGTERM (never-wedge), without hanging", async () => {
  const start = Date.now();
  await assert.rejects(
    runSubprocess(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},50)"], { timeoutMs: 150, killGraceMs: 150 }),
    (error) => {
      assert.equal((error as SubprocessError).killed, true);
      assert.match(String(error), /timed out/);
      return true;
    },
  );
  assert.ok(Date.now() - start < 3000, "graded teardown returned promptly, not an indefinite hang");
});

test("runSubprocess rejects a non-existent command cleanly (no uncaught crash)", async () => {
  // The test completing at all proves the async spawn 'error' was caught, not rethrown as uncaught.
  await assert.rejects(runSubprocess("muster-no-such-binary-xyzzy", []), /ENOENT|spawn/);
});
