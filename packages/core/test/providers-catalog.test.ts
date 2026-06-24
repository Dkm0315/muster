import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PROVIDER_PRESETS,
  addPresetProvider,
  completeChat,
  ensureDefaultConfig,
  findProviderPreset,
  loadConfig,
  renderProviderPresets,
} from "../src/index.js";

test("provider presets cover cloud, aggregator, local, and CLI categories", () => {
  const categories = new Set(PROVIDER_PRESETS.map((preset) => preset.category));
  assert.deepEqual([...categories].sort(), ["aggregator", "cli", "cloud", "local"]);
  for (const id of ["openai", "anthropic", "xai", "kimi", "deepseek", "groq", "openrouter", "codex-cli", "vllm"]) {
    assert.ok(findProviderPreset(id), `preset missing: ${id}`);
  }
  const ids = PROVIDER_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length, "preset ids must be unique");
  for (const preset of PROVIDER_PRESETS) {
    if (preset.category === "cloud" || preset.category === "aggregator") {
      assert.ok(preset.apiKeyEnv, `${preset.id}: cloud presets must document their API key env var`);
      assert.ok(preset.baseUrl?.startsWith("https://"), `${preset.id}: cloud presets must use https`);
    }
  }
});

test("addPresetProvider persists the provider with overrides", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-presets-"));
  await ensureDefaultConfig(cwd);
  const added = await addPresetProvider("kimi", { model: "kimi-latest" }, cwd);
  assert.equal(added.kind, "openai-compatible");
  assert.equal(added.defaultModel, "kimi-latest");
  const config = await loadConfig(cwd);
  assert.equal(config.providers.kimi?.baseUrl, "https://api.moonshot.ai/v1");
});

test("addPresetProvider rejects unknown presets with guidance", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-presets-bad-"));
  await ensureDefaultConfig(cwd);
  await assert.rejects(() => addPresetProvider("not-a-provider", {}, cwd), /provider presets/);
});

test("renderProviderPresets lists every preset and the escape hatches", () => {
  const output = renderProviderPresets();
  for (const preset of PROVIDER_PRESETS) {
    assert.ok(output.includes(preset.id), `presets table missing ${preset.id}`);
  }
  assert.match(output, /add-openai-compatible/);
  assert.match(output, /--runtime claude-code/);
});

test("anthropic provider fails fast with actionable guidance when the key is missing", async () => {
  const saved = process.env.HYBROWCLAW_TEST_ANTHROPIC_KEY;
  delete process.env.HYBROWCLAW_TEST_ANTHROPIC_KEY;
  await assert.rejects(
    () => completeChat({
      provider: { id: "anthropic", kind: "anthropic", apiKeyEnv: "HYBROWCLAW_TEST_ANTHROPIC_KEY", defaultModel: "claude-sonnet-4-6" },
      route: { provider: "anthropic", model: "claude-sonnet-4-6" },
      messages: [{ role: "user", content: "hi" }],
    }),
    /HYBROWCLAW_TEST_ANTHROPIC_KEY.*claude-code/s,
  );
  if (saved) process.env.HYBROWCLAW_TEST_ANTHROPIC_KEY = saved;
});
