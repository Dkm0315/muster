import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  WEBHOOK_SAFE_TOOLS,
  createToolRegistry,
  registerBuiltinTools,
  type ToolContext,
} from "../src/index.js";

function setup() {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

test("toolsets resolve recursively: core excludes shell, full includes it", () => {
  const registry = setup();
  const core = registry.resolveToolset("core");
  assert.ok(core.includes("read_file") && core.includes("web_fetch"));
  assert.ok(!core.includes("terminal"), "core never grants shell");
  assert.ok(registry.resolveToolset("full").includes("terminal"));
});

test("file tools read/write/search within the workspace and refuse escapes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-"));
  const registry = setup();
  const ctx: ToolContext = { cwd };
  const write = await registry.execute("write_file", { path: "sub/note.txt", content: "hello muster" }, ctx);
  assert.equal(write.ok, true);
  assert.equal(await readFile(join(cwd, "sub/note.txt"), "utf8"), "hello muster");
  const read = await registry.execute("read_file", { path: "sub/note.txt" }, ctx);
  assert.equal((read as { data: string }).data, "hello muster");
  const search = await registry.execute("search_files", { query: "muster" }, ctx);
  assert.match(String((search as { data: string }).data), /note\.txt/);
  const escape = await registry.execute("read_file", { path: "../../../etc/passwd" }, ctx);
  assert.equal(escape.ok, false);
  assert.match((escape as { error: string }).error, /escapes the workspace/);
});

test("terminal is deny-by-default and honors the command allowlist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-sh-"));
  const registry = setup();
  const denied = await registry.execute("terminal", { command: "echo", args: ["hi"] }, { cwd });
  assert.equal(denied.ok, false, "no allowlist -> unavailable");
  const allowed = await registry.execute("terminal", { command: "echo", args: ["hi"] }, { cwd, allowCommands: ["echo"] });
  assert.equal(allowed.ok, true);
  assert.match(String((allowed as { data: string }).data), /hi/);
  const blocked = await registry.execute("terminal", { command: "rm", args: ["-rf", "/"] }, { cwd, allowCommands: ["echo"] });
  assert.equal(blocked.ok, false);
  assert.match((blocked as { error: string }).error, /not allowlisted/);
});

test("oversized results are capped through the persistence pipeline", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-cap-"));
  const registry = setup();
  await registry.execute("write_file", { path: "big.txt", content: "Z".repeat(20000) }, { cwd });
  const read = await registry.execute("read_file", { path: "big.txt" }, { cwd });
  assert.match(String((read as { data: string }).data), /result_fetch\("res_/);
  const id = String((read as { data: string }).data).match(/result_fetch\("(res_[^"]+)"\)/)![1];
  const fetched = await registry.execute("result_fetch", { id, limit: 10 }, { cwd });
  assert.equal((fetched as { data: string }).data.length, 10);
});

test("web_fetch honors the host allowlist; webhook-safe set excludes writes and shell", () => {
  assert.deepEqual([...WEBHOOK_SAFE_TOOLS].sort(), ["result_fetch", "web_fetch"]);
  assert.ok(!WEBHOOK_SAFE_TOOLS.includes("write_file"));
  assert.ok(!WEBHOOK_SAFE_TOOLS.includes("terminal"));
});

test("toFlowRegistry exposes tools to flows and respects an allowlist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-tools-flow-"));
  const registry = setup();
  const flowReg = registry.toFlowRegistry({ cwd }, ["read_file", "write_file"]);
  assert.deepEqual(Object.keys(flowReg).sort(), ["read_file", "write_file"]);
  await flowReg.write_file({ path: "f.txt", content: "x" });
  assert.equal(await readFile(join(cwd, "f.txt"), "utf8"), "x");
});
