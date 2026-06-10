import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_AGENT_RULES, createProfile, loadAgentRules, useProfile } from "../src/index.js";

test("default agent rules encode the four disciplines plus exact-blocker reporting", () => {
  assert.match(DEFAULT_AGENT_RULES, /No silent assumptions/);
  assert.match(DEFAULT_AGENT_RULES, /No over-engineering/);
  assert.match(DEFAULT_AGENT_RULES, /No orthogonal changes/);
  assert.match(DEFAULT_AGENT_RULES, /Verify before claiming/);
  assert.match(DEFAULT_AGENT_RULES, /cannot verify/);
});

test("loadAgentRules falls back to defaults when no AGENTS.md exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rules-"));
  const rules = await loadAgentRules(cwd);
  assert.equal(rules.source, "default");
  assert.equal(rules.text, DEFAULT_AGENT_RULES);
});

test("workspace AGENTS.md overrides the defaults", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rules-ws-"));
  await writeFile(join(cwd, "AGENTS.md"), "Workspace rule: always answer in French.");
  const rules = await loadAgentRules(cwd);
  assert.equal(rules.source, "workspace");
  assert.match(rules.text, /French/);
});

test("profile AGENTS.md takes precedence over workspace rules", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-rules-profile-"));
  await writeFile(join(cwd, "AGENTS.md"), "Workspace rule.");
  await createProfile("strict", cwd);
  await mkdir(join(cwd, ".muster", "profiles", "strict"), { recursive: true });
  await writeFile(join(cwd, ".muster", "profiles", "strict", "AGENTS.md"), "Profile rule: strict mode.");
  await useProfile("strict", cwd);
  const rules = await loadAgentRules(cwd);
  assert.equal(rules.source, "profile");
  assert.match(rules.text, /strict mode/);
});
