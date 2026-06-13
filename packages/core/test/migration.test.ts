import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanMigrationSource } from "../src/index.js";

test("openclaw scanner reports missing root safely", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-missing-"));
  const report = await scanMigrationSource("openclaw", { homeDir: home });

  assert.equal(report.exists, false);
  assert.equal(report.assets.length, 0);
  assert.equal(report.missingPaths.length, 1);
  assert.match(report.recommendedNextActions[0] ?? "", /Nothing to migrate/);
});

test("hermes scanner discovers memory and provider assets", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-hermes-"));
  await mkdir(join(home, ".hermes", "memory"), { recursive: true });
  await writeFile(join(home, ".hermes", "memory", "project.md"), "remember this\n");
  await writeFile(join(home, ".hermes", "providers.json"), "{}\n");

  const report = await scanMigrationSource("hermes", { homeDir: home });

  assert.equal(report.exists, true);
  assert.equal(report.assets.some((asset) => asset.kind === "memory"), true);
  assert.equal(report.assets.some((asset) => asset.kind === "provider"), true);
  assert.equal(report.recommendedNextActions.includes("Run doctor and generated evals after migration."), true);
});

test("pi scanner marks historical flows as archive-only", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-pi-"));
  await mkdir(join(home, ".pi", "agents"), { recursive: true });
  await mkdir(join(home, ".pi", "flows"), { recursive: true });
  await writeFile(join(home, ".pi", "agents", "architect.md"), "# Architect\n");
  await writeFile(join(home, ".pi", "flows", "run.json"), "{}\n");

  const report = await scanMigrationSource("pi", { homeDir: home });

  assert.equal(report.exists, true);
  assert.equal(report.assets.some((asset) => asset.kind === "agent" && asset.importMode === "map"), true);
  assert.equal(report.assets.some((asset) => asset.kind === "workflow" && asset.importMode === "archive_only"), true);
  assert.equal(report.archiveOnlyNotes.length, 1);
});

const FIXTURE_TELEGRAM_TOKEN = "1234567890:AA-super-secret-bot-token-VALUE-do-not-leak";

async function writeOpenclawConfig(home: string, config: unknown): Promise<void> {
  await mkdir(join(home, ".openclaw"), { recursive: true });
  await writeFile(join(home, ".openclaw", "openclaw.json"), `${JSON.stringify(config, null, 2)}\n`);
}

const SAMPLE_OPENCLAW_CONFIG = {
  agents: { defaults: { model: "claude-sonnet-4-5", workspace: "frappe-ops" } },
  channels: {
    telegram: {
      enabled: true,
      botToken: FIXTURE_TELEGRAM_TOKEN,
      commands: { hello: {}, status: {} }
    },
    discord: { enabled: false }
  },
  gateway: { mode: "remote", auth: { token: "another-secret-gateway-token" } },
  plugins: { entries: { "frappe-agent": {} } }
};

test("openclaw scanner surfaces channel assets from openclaw.json", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-openclaw-channels-"));
  await writeOpenclawConfig(home, SAMPLE_OPENCLAW_CONFIG);

  const report = await scanMigrationSource("openclaw", { homeDir: home });

  assert.equal(report.exists, true);
  const channels = report.assets.filter((asset) => asset.kind === "channel");
  assert.equal(channels.length, 2);
  const telegram = channels.find((asset) => asset.path.endsWith("channels.telegram"));
  assert.ok(telegram);
  assert.equal(telegram?.importMode, "map");
  assert.match(telegram?.note ?? "", /OpenClaw telegram channel\/profile \(model claude-sonnet-4-5, 2 custom commands\)/);
  // agents.defaults surfaced as an agent asset with the exact model id.
  const agent = report.assets.find((asset) => asset.kind === "agent" && asset.importMode === "map");
  assert.ok(agent);
  assert.match(agent?.note ?? "", /claude-sonnet-4-5/);
  // available channel names listed when no profile is selected.
  assert.equal(
    report.recommendedNextActions.some((a) => a.includes("telegram") && a.includes("discord")),
    true
  );
});

test("openclaw scanner --profile selects only one channel", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-openclaw-profile-"));
  await writeOpenclawConfig(home, SAMPLE_OPENCLAW_CONFIG);

  const report = await scanMigrationSource("openclaw", { homeDir: home, profile: "telegram" });

  const channels = report.assets.filter((asset) => asset.kind === "channel");
  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.path.endsWith("channels.telegram"), true);
  assert.equal(
    report.recommendedNextActions.some((a) => a.includes('Only the "telegram" channel')),
    true
  );
});

test("openclaw scanner reports no false missing for absent legacy files", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-openclaw-nomissing-"));
  await writeOpenclawConfig(home, SAMPLE_OPENCLAW_CONFIG);

  const report = await scanMigrationSource("openclaw", { homeDir: home });

  const missing = report.missingPaths.join("\n");
  for (const phantom of ["config.json", "skills", "tools", "mcp.json"]) {
    assert.equal(missing.includes(phantom), false, `phantom path ${phantom} must not be reported missing`);
  }
});

test("openclaw scanner handles malformed openclaw.json without throwing or leaking secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-openclaw-malformed-"));
  await mkdir(join(home, ".openclaw"), { recursive: true });
  // Malformed JSON that contains a secret: V8's JSON.parse error message embeds a
  // snippet of the source, so the parse-error path must NOT echo error.message.
  await writeFile(
    join(home, ".openclaw", "openclaw.json"),
    '{ "channels": { "telegram": { "botToken": "sk-LEAKED-SECRET-9999" } this is : not json ]\n'
  );

  const report = await scanMigrationSource("openclaw", { homeDir: home });

  assert.equal(report.exists, true);
  assert.equal(report.assets.some((asset) => asset.kind === "channel"), false);
  assert.equal(
    report.assets.some((asset) => asset.kind === "config" && /could not be parsed/.test(asset.note)),
    true
  );
  assert.equal(
    JSON.stringify(report).includes("sk-LEAKED-SECRET-9999"),
    false,
    "a secret in a malformed config must not leak through the parse-error note"
  );
});

test("openclaw scanner never leaks secret values into the report", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-openclaw-secret-"));
  await writeOpenclawConfig(home, SAMPLE_OPENCLAW_CONFIG);

  const report = await scanMigrationSource("openclaw", { homeDir: home, profile: "telegram" });

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(FIXTURE_TELEGRAM_TOKEN), false, "telegram botToken leaked into report");
  assert.equal(serialized.includes("another-secret-gateway-token"), false, "gateway auth token leaked into report");
});
