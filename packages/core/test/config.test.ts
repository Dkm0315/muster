import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addCodexCliProvider, addOpenAICompatibleProvider, ensureDefaultConfig, loadConfig, setRuntimeProvider } from "../src/index.js";

test("addOpenAICompatibleProvider persists a provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-config-"));
  await ensureDefaultConfig(cwd);

  await addOpenAICompatibleProvider(
    {
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1/",
      defaultModel: "openai/gpt-5-mini",
      apiKeyEnv: "OPENROUTER_API_KEY"
    },
    cwd
  );

  const config = await loadConfig(cwd);
  assert.equal(config.providers.openrouter?.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(config.providers.openrouter?.defaultModel, "openai/gpt-5-mini");
  assert.equal(config.providers.openrouter?.apiKeyEnv, "OPENROUTER_API_KEY");
});

test("addOpenAICompatibleProvider rejects unsafe provider ids", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-config-"));
  await ensureDefaultConfig(cwd);

  await assert.rejects(
    addOpenAICompatibleProvider(
      {
        id: "../bad",
        baseUrl: "http://localhost:11434/v1",
        defaultModel: "llama3.1"
      },
      cwd
    ),
    /Provider id/
  );
});

test("addCodexCliProvider persists a local Codex CLI provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-config-"));
  await ensureDefaultConfig(cwd);

  await addCodexCliProvider({ id: "codex", defaultModel: "o4-mini" }, cwd);

  const config = await loadConfig(cwd);
  assert.equal(config.providers.codex?.kind, "codex-cli");
  assert.equal(config.providers.codex?.defaultModel, "o4-mini");
});

test("setRuntimeProvider repoints runtime routes to a provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-config-"));
  await ensureDefaultConfig(cwd);
  await addCodexCliProvider({ id: "codex", defaultModel: "o4-mini" }, cwd);

  await setRuntimeProvider({ runtimeId: "native", providerId: "codex" }, cwd);

  const config = await loadConfig(cwd);
  assert.equal(config.runtimes.native?.provider, "codex");
  assert.equal(config.runtimes.native?.routes.architecture?.provider, "codex");
  assert.equal(config.runtimes.native?.routes.architecture?.model, "o4-mini");
});
