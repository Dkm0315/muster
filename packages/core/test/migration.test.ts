import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyOpenclawProfile, loadConfig, scanMigrationSource, useProfile } from "../src/index.js";

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
  // The report must be honest: the channel is profile-specific, but the agent/
  // memory/flows/extensions it lists are instance-wide (shared), not part of the
  // selected profile — otherwise "--profile telegram" looks like it migrates 10 assets.
  assert.equal(
    report.recommendedNextActions.some(
      (a) => a.includes("telegram") && a.includes("profile-specific") && a.includes("instance-wide"),
    ),
    true,
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

const APPLY_SECRET = "SUPER_SECRET_123";

const APPLY_OPENCLAW_CONFIG = {
  agents: {
    defaults: {
      skills: ["incident-triage"],
      model: "anthropic/claude-opus-4-8",
      workspace: "frappe-ops",
      models: {
        "anthropic/claude-opus-4-8": { alias: "opus", agentRuntime: { id: "claude-cli" } },
        "openai/gpt-5.5": { alias: "codex", agentRuntime: { id: "codex" } },
      },
    },
    list: [{ id: "telegram", skills: ["incident-triage", "frappe-ops"] }],
  },
  channels: {
    telegram: {
      enabled: true,
      dmPolicy: "allow",
      botToken: APPLY_SECRET,
      commands: {
        hello: { description: "Say hello" },
        status: {},
        deploy: { prompt: "Deploy the selected site. Args: {args}" },
      },
    },
    whatsapp: {
      enabled: true,
      botToken: "another-secret-wa-token",
    },
  },
  gateway: { mode: "remote", auth: { token: "gateway-secret-token" } },
  skills: {
    load: { extraDirs: ["./skills/shared"], includeHomeDirs: false },
    entries: {
      "incident-triage": {
        enabled: true,
        apiKey: { source: "env", id: "INCIDENT_API_KEY" },
        config: { endpoint: "https://incident.example.test", token: "skill-secret" },
      },
    },
  },
  tools: {
    allow: ["web_fetch"],
    deny: ["terminal"],
    entries: {
      "jira.lookup": { enabled: true, config: { baseUrl: "https://jira.example.test", password: "jira-secret" } },
    },
  },
  mcp: {
    servers: {
      jira: {
        transport: { kind: "stdio", command: "node", args: ["jira.mjs"], env: { JIRA_TOKEN: "secret-token" } },
        tools: { include: ["issue_search"] },
        limits: { toolTimeoutMs: 5000 },
      },
    },
  },
  plugins: {
    allow: ["frappe-agent"],
    slots: { erp: "frappe-agent" },
    entries: { "frappe-agent": { enabled: true, config: { site: "main", token: "plugin-secret" } } },
  },
  devices: {
    entries: {
      "phone-1": { surfaceId: "telegram:bot", accountId: "primary", scopes: ["messages:send"] },
    },
  },
};

test("applyOpenclawProfile materializes exactly one runnable, redacted profile", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-home-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-cwd-"));
  await writeOpenclawConfig(home, APPLY_OPENCLAW_CONFIG);

  const result = await applyOpenclawProfile({ homeDir: home, profile: "telegram", outProfile: "tg", cwd });

  // Exactly one profile created beyond default.
  const { listProfiles } = await import("../src/index.js");
  const profiles = await listProfiles(cwd);
  assert.deepEqual(profiles, ["default", "tg"]);

  // Selectivity: whatsapp excluded, codex agent entry excluded.
  assert.equal(result.outProfile, "tg");
  assert.equal(result.channel, "telegram");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-opus-4-8");
  assert.equal(result.runtime, "claude-code");
  assert.equal(result.commandsMigrated, 3);
  assert.equal(result.skillsCarried, 2);
  assert.equal(result.toolsCarried, 4);
  assert.equal(result.pluginsCarried, 3);
  assert.equal(result.devicesCarried, 1);
  assert.ok(result.excludedChannels.includes("whatsapp"));
  assert.equal(result.excludedAgents, 1);
  assert.equal(result.tokenEnvRef, "TELEGRAM_BOT_TOKEN");

  // The written config is loadable via loadConfig and routes to claude-code.
  await useProfile("tg", cwd);
  const config = await loadConfig(cwd);
  assert.equal(config.routing.defaultRuntime, "claude-code");
  assert.ok(config.runtimes["claude-code"]);
  assert.equal(config.runtimes["claude-code"]?.routes.simple_qa?.model, "claude-opus-4-8");
  assert.deepEqual(config.agents?.defaults?.skills, ["incident-triage"]);
  assert.deepEqual(config.agents?.list?.[0], { id: "telegram", skills: ["incident-triage", "frappe-ops"] });
  assert.deepEqual(config.skills?.load?.extraDirs, ["./skills/shared"]);
  assert.equal(config.skills?.entries?.["incident-triage"]?.apiKey && typeof config.skills.entries["incident-triage"].apiKey === "object" ? config.skills.entries["incident-triage"].apiKey.id : undefined, "INCIDENT_API_KEY");
  assert.equal(config.skills?.entries?.["incident-triage"]?.config?.endpoint, "https://incident.example.test");
  assert.equal(config.skills?.entries?.["incident-triage"]?.config?.token, "${TOKEN}");
  assert.deepEqual(config.tools?.allow, ["web_fetch"]);
  assert.deepEqual(config.tools?.deny, ["terminal"]);
  assert.equal(config.tools?.entries?.["jira-lookup"]?.enabled, true);
  assert.equal(config.tools?.entries?.["jira-lookup"]?.config?.password, "${PASSWORD}");
  assert.equal(config.tools?.mcp?.servers?.jira?.transport.kind, "stdio");
  assert.deepEqual(
    config.tools?.mcp?.servers?.jira?.transport.kind === "stdio" ? config.tools.mcp.servers.jira.transport.env : undefined,
    { JIRA_TOKEN: "${JIRA_TOKEN}" },
  );
  assert.deepEqual(config.plugins?.allow, ["frappe-agent"]);
  assert.equal(config.plugins?.entries?.["frappe-agent"]?.enabled, false);
  assert.equal(config.plugins?.entries?.["frappe-agent"]?.config?.token, "${TOKEN}");

  // The redaction guarantee: the secret value appears NOWHERE in the written file.
  const { readFile: readFileAsync } = await import("node:fs/promises");
  const writtenRaw = await readFileAsync(result.configPath, "utf8");
  assert.equal(writtenRaw.includes(APPLY_SECRET), false, "botToken secret leaked into materialized config");
  assert.equal(writtenRaw.includes("another-secret-wa-token"), false, "other channel secret leaked");
  assert.equal(writtenRaw.includes("gateway-secret-token"), false, "gateway auth token leaked");
  assert.equal(writtenRaw.includes("skill-secret"), false, "skill secret leaked");
  assert.equal(writtenRaw.includes("jira-secret"), false, "tool secret leaked");
  assert.equal(writtenRaw.includes("secret-token"), false, "mcp env secret leaked");
  assert.equal(writtenRaw.includes("plugin-secret"), false, "plugin secret leaked");
  // The placeholder env reference IS present where the token would be.
  assert.ok(writtenRaw.includes("${TELEGRAM_BOT_TOKEN}"), "placeholder env reference missing");
  const gatewayRaw = await readFile(join(cwd, ".muster", "gateway.json"), "utf8");
  assert.equal(gatewayRaw.includes(APPLY_SECRET), false, "botToken secret leaked into gateway config");
  const gateway = JSON.parse(gatewayRaw) as {
    commands?: { entries?: Record<string, { prompt?: string; description?: string; surfaces?: string[]; source?: string; sourceChannel?: string }> };
    devices?: { entries?: Record<string, { source?: string; approved?: boolean; scopes?: string[] }> };
  };
  assert.equal(gateway.commands?.entries?.deploy?.prompt, "Deploy the selected site. Args: {args}");
  assert.deepEqual(gateway.commands?.entries?.deploy?.surfaces, ["telegram"]);
  assert.equal(gateway.commands?.entries?.deploy?.source, "openclaw");
  assert.equal(gateway.commands?.entries?.deploy?.sourceChannel, "telegram");
  assert.equal(gateway.devices?.entries?.["phone-1"]?.source, "openclaw");
  assert.equal(gateway.devices?.entries?.["phone-1"]?.approved, false);
  assert.deepEqual(gateway.devices?.entries?.["phone-1"]?.scopes, ["messages:send"]);

  // Applying again onto the same --out must refuse rather than clobber the profile.
  await assert.rejects(
    () => applyOpenclawProfile({ homeDir: home, profile: "telegram", outProfile: "tg", cwd }),
    /already exists/,
  );
});

test("applyOpenclawProfile throws for a missing channel, listing names without secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-missing-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-missing-cwd-"));
  await writeOpenclawConfig(home, APPLY_OPENCLAW_CONFIG);

  await assert.rejects(
    () => applyOpenclawProfile({ homeDir: home, profile: "slack", outProfile: "sl", cwd }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /not found/);
      assert.match(message, /telegram/);
      assert.match(message, /whatsapp/);
      assert.equal(message.includes(APPLY_SECRET), false, "secret leaked into not-found error");
      return true;
    },
  );
});

test("applyOpenclawProfile throws on malformed openclaw.json without echoing file contents", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-malformed-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-malformed-cwd-"));
  await mkdir(join(home, ".openclaw"), { recursive: true });
  await writeFile(
    join(home, ".openclaw", "openclaw.json"),
    '{ "channels": { "telegram": { "botToken": "sk-LEAKED-APPLY-9999" } not json ]\n',
  );

  await assert.rejects(
    () => applyOpenclawProfile({ homeDir: home, profile: "telegram", outProfile: "tg", cwd }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes("sk-LEAKED-APPLY-9999"), false, "malformed-config secret leaked into error");
      assert.match(message, /Could not read or parse/);
      return true;
    },
  );
});

test("applyOpenclawProfile maps a codex channel to the full-power codex runtime (faithful, not Claude)", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-codex-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-codex-cwd-"));
  await writeOpenclawConfig(home, {
    agents: { defaults: { model: "openai/gpt-5.4", workspace: "w", models: { "openai/gpt-5.4": { agentRuntime: { id: "codex" } } } } },
    channels: { ops: { enabled: true } },
  });
  const result = await applyOpenclawProfile({ homeDir: home, profile: "ops", outProfile: "ops-mig", cwd });
  // A codex source must run on muster's first-class `codex` runtime (full native
  // power via `codex exec`), preserving the user's provider — NEVER remapped to
  // claude-code/anthropic. Provider stays the subscription codex-cli.
  assert.equal(result.runtime, "codex");
  assert.equal(result.provider, "codex");
  await useProfile("ops-mig", cwd);
  const cfg = await loadConfig(cwd);
  assert.equal(cfg.routing.defaultRuntime, "codex");
  assert.equal(cfg.providers.codex?.kind, "codex-cli");
  assert.equal(cfg.providers.codex?.defaultModel, "gpt-5.4");
  assert.equal(cfg.providers.codex?.apiKeyEnv, undefined, "codex-cli (subscription) needs no API key env");
  // Faithful identity carried from the source channel (so the agent knows it's
  // muster), describing the real provider/runtime — never a Claude default.
  assert.equal(cfg.identity?.name, "ops-mig");
  assert.match(cfg.identity?.description ?? "", /OpenClaw "ops" channel/);
  assert.match(cfg.identity?.description ?? "", /gpt-5\.4 via the codex runtime/);
});

test("applyOpenclawProfile maps a non-codex openai channel to openai-compatible with the right key env", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-oai-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-oai-cwd-"));
  await writeOpenclawConfig(home, {
    agents: { defaults: { model: "openai/gpt-4o", workspace: "w", models: { "openai/gpt-4o": { agentRuntime: { id: "acpx" } } } } },
    channels: { web: { enabled: true } },
  });
  const result = await applyOpenclawProfile({ homeDir: home, profile: "web", outProfile: "web-mig", cwd });
  assert.equal(result.runtime, "native");
  assert.equal(result.provider, "openai");
  await useProfile("web-mig", cwd);
  const cfg = await loadConfig(cwd);
  assert.equal(cfg.providers.openai?.kind, "openai-compatible");
  assert.equal(cfg.providers.openai?.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(cfg.providers.openai?.baseUrl, "https://api.openai.com/v1");
});

test("applyOpenclawProfile: a non-anthropic model with NO explicit runtime maps to native, not claude-code", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-noruntime-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-noruntime-cwd-"));
  // openai model, but agents.defaults has no `models` map -> no agentRuntime.
  await writeOpenclawConfig(home, {
    agents: { defaults: { model: "openai/gpt-4o", workspace: "w" } },
    channels: { web: { enabled: true } },
  });
  const result = await applyOpenclawProfile({ homeDir: home, profile: "web", outProfile: "web2", cwd });
  assert.equal(result.runtime, "native", "a non-anthropic model must not be forced onto claude-code");
  assert.equal(result.provider, "openai");
  await useProfile("web2", cwd);
  assert.equal((await loadConfig(cwd)).providers.openai?.kind, "openai-compatible");
});

test("applyOpenclawProfile: an anthropic model with NO explicit runtime still maps to claude-code", async () => {
  const home = await mkdtemp(join(tmpdir(), "muster-apply-anth-"));
  const cwd = await mkdtemp(join(tmpdir(), "muster-apply-anth-cwd-"));
  await writeOpenclawConfig(home, {
    agents: { defaults: { model: "anthropic/claude-opus-4-8", workspace: "w" } },
    channels: { tg: { enabled: true } },
  });
  const result = await applyOpenclawProfile({ homeDir: home, profile: "tg", outProfile: "tg2", cwd });
  assert.equal(result.runtime, "claude-code");
  assert.equal(result.provider, "anthropic");
});
