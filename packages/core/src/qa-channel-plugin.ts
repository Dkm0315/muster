import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  disableBuiltinPlugin,
  enableBuiltinPlugin,
  listBuiltinMcpServers,
  listBuiltinPlugins,
  type BuiltinPluginCatalogEntry,
} from "./builtin-catalog.js";
import { ensureDefaultConfig, loadConfig } from "./config.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaChannelPluginSetupCase {
  readonly id: string;
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
}

export interface QaChannelPluginSetupResult {
  readonly suite: "channel_plugin_setup";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly catalogPath: string;
  readonly cases: readonly QaChannelPluginSetupCase[];
  readonly summary: string;
}

export async function runChannelPluginSetupQa(input: {
  readonly artifactDir: string;
}): Promise<QaChannelPluginSetupResult> {
  const artifactDir = input.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  const cwd = join(artifactDir, "workspace");
  await mkdir(cwd, { recursive: true });
  await ensureDefaultConfig(cwd);

  const plugins = listBuiltinPlugins();
  const mcps = listBuiltinMcpServers();
  const cases: QaChannelPluginSetupCase[] = [];

  cases.push(caseCatalogCoverage(plugins, mcps));
  cases.push(caseSetupGuidance(plugins, "frappe-federated-bridge", { needsSetupUrl: true }));
  cases.push(caseSetupGuidance(plugins, "web-frameworks", { needsPack: true }));
  cases.push(caseSetupGuidance(plugins, "google-workspace", { needsSetupUrl: true, needsMcp: true }));
  cases.push(caseSetupGuidance(plugins, "slack", { needsChannel: true, needsSetupUrl: true }));
  cases.push(await caseHighRiskRefusal(cwd, plugins));
  cases.push(await caseEnableDisablePolicy(cwd, "web-frameworks"));
  cases.push(caseMcpInstallGuidance(mcps));

  const status: RuntimeDoctorStatus = cases.every((testCase) => testCase.status === "passed") ? "passed" : "failed";
  const summary = status === "passed"
    ? "Channel/plugin setup catalog, setup guidance, unsafe-plugin refusal, and enable/disable policy verified"
    : "Channel/plugin setup QA found missing setup guidance or policy regressions";
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const catalogPath = join(artifactDir, "catalog.json");
  await writeFile(casesPath, `${cases.map((testCase) => JSON.stringify(testCase)).join("\n")}\n`, "utf8");
  await writeFile(catalogPath, `${JSON.stringify({
    plugins: plugins.map((plugin) => catalogPluginSnapshot(plugin)),
    mcpServers: mcps.map((mcp) => ({
      id: mcp.id,
      category: mcp.category,
      auth: mcp.auth ?? "none",
      setupUrls: mcp.setupUrls ?? [],
      installable: Boolean(mcp.install),
      requiresEnv: mcp.requiresEnv ?? [],
      requiresAnyEnv: mcp.requiresAnyEnv ?? [],
    })),
  }, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "muster-qa",
    suite: "channel_plugin_setup",
    status,
    summary,
    caseCount: cases.length,
    artifacts: { cases: "cases.jsonl", catalog: "catalog.json", workspace: "workspace" },
  }, null, 2)}\n`, "utf8");

  return { suite: "channel_plugin_setup", status, artifactDir, manifestPath, casesPath, catalogPath, cases, summary };
}

function caseCatalogCoverage(
  plugins: readonly BuiltinPluginCatalogEntry[],
  mcps: ReturnType<typeof listBuiltinMcpServers>,
): QaChannelPluginSetupCase {
  const requiredPlugins = [
    "web-search",
    "github",
    "google-workspace",
    "notion",
    "slack",
    "teams",
    "google-chat",
    "frappe-federated-bridge",
    "web-frameworks",
    "browser",
    "mcp-bridge",
  ];
  const requiredMcps = ["git", "browser", "github", "google-drive", "notion", "parallel-search"];
  const pluginIds = new Set(plugins.flatMap((plugin) => [plugin.id, ...(plugin.aliases ?? [])]));
  const mcpIds = new Set(mcps.map((mcp) => mcp.id));
  const missingPlugins = requiredPlugins.filter((id) => !pluginIds.has(id));
  const missingMcps = requiredMcps.filter((id) => !mcpIds.has(id));
  const status: RuntimeDoctorStatus = missingPlugins.length || missingMcps.length ? "failed" : "passed";
  return {
    id: "catalog_core_surfaces",
    status,
    summary: status === "passed"
      ? "core web, channel, Frappe, Playwright, and MCP surfaces are discoverable"
      : "core integration catalog surfaces are missing",
    evidence: { pluginCount: plugins.length, mcpCount: mcps.length, missingPlugins, missingMcps },
  };
}

function caseSetupGuidance(
  plugins: readonly BuiltinPluginCatalogEntry[],
  id: string,
  expectation: { readonly needsSetupUrl?: boolean; readonly needsMcp?: boolean; readonly needsChannel?: boolean; readonly needsPack?: boolean },
): QaChannelPluginSetupCase {
  const plugin = plugins.find((candidate) => candidate.id === id || candidate.aliases?.includes(id));
  const missing: string[] = [];
  if (!plugin) missing.push("plugin");
  if (expectation.needsSetupUrl && !plugin?.setup?.setupUrls?.length) missing.push("setup_url");
  if (expectation.needsMcp && !(plugin?.setup?.mcpServers?.length || plugin?.setup?.defaultMcpServers?.length)) missing.push("mcp_guidance");
  if (expectation.needsChannel && !plugin?.setup?.channels?.length) missing.push("channel_guidance");
  if (expectation.needsPack && !plugin?.packPath) missing.push("pack_path");
  const status: RuntimeDoctorStatus = missing.length ? "failed" : "passed";
  return {
    id: `setup_guidance_${id}`,
    status,
    summary: status === "passed" ? `${id} exposes guided setup metadata` : `${id} is missing setup metadata`,
    evidence: {
      id,
      missing,
      actionability: plugin?.actionability,
      setupUrls: plugin?.setup?.setupUrls ?? [],
      channels: plugin?.setup?.channels ?? [],
      mcpServers: [...(plugin?.setup?.defaultMcpServers ?? []), ...(plugin?.setup?.mcpServers ?? [])],
      packPath: plugin?.packPath,
    },
  };
}

async function caseHighRiskRefusal(cwd: string, plugins: readonly BuiltinPluginCatalogEntry[]): Promise<QaChannelPluginSetupCase> {
  const highRisk = plugins.find((plugin) => plugin.risk === "high");
  if (!highRisk) {
    return { id: "high_risk_refusal", status: "failed", summary: "no high-risk plugin exists to test refusal", evidence: {} };
  }
  let refused = false;
  let message = "";
  try {
    await enableBuiltinPlugin(highRisk.id, cwd);
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  return {
    id: "high_risk_refusal",
    status: refused && message.includes("--allow-high-risk") ? "passed" : "failed",
    summary: refused ? "high-risk plugin enable requires an explicit flag" : "high-risk plugin enabled without explicit flag",
    evidence: { plugin: highRisk.id, refused, message },
  };
}

async function caseEnableDisablePolicy(cwd: string, pluginId: string): Promise<QaChannelPluginSetupCase> {
  const enabled = await enableBuiltinPlugin(pluginId, cwd, { allowHighRisk: true });
  const enabledConfig = await loadConfig(cwd);
  await disableBuiltinPlugin(pluginId, cwd);
  const disabledConfig = await loadConfig(cwd);
  const wasAllowed = enabledConfig.plugins?.allow?.includes(enabled.id) ?? false;
  const wasEnabled = enabledConfig.plugins?.entries?.[enabled.id]?.enabled === true;
  const isDisabled = disabledConfig.plugins?.entries?.[enabled.id]?.enabled === false;
  const allowRemoved = !(disabledConfig.plugins?.allow?.includes(enabled.id) ?? false);
  const packPathLoaded = enabled.packPath ? (enabledConfig.plugins?.load?.paths ?? []).some((path) => path.includes(enabled.packPath!)) : true;
  const status: RuntimeDoctorStatus = wasAllowed && wasEnabled && isDisabled && allowRemoved && packPathLoaded ? "passed" : "failed";
  return {
    id: "enable_disable_policy",
    status,
    summary: status === "passed" ? "plugin enable/disable updates allowlist, entry state, and pack load path" : "plugin enable/disable policy state is inconsistent",
    evidence: { plugin: enabled.id, wasAllowed, wasEnabled, isDisabled, allowRemoved, packPathLoaded },
  };
}

function caseMcpInstallGuidance(mcps: ReturnType<typeof listBuiltinMcpServers>): QaChannelPluginSetupCase {
  const required = ["browser", "github", "notion", "parallel-search"];
  const entries = required.map((id) => mcps.find((mcp) => mcp.id === id));
  const missing = required.filter((_, index) => !entries[index]);
  const withoutSetup = entries.filter((entry) => entry && !entry.install && !entry.setupUrls?.length).map((entry) => entry!.id);
  const oauthWithoutUrl = entries.filter((entry) => entry?.auth === "oauth" && !entry.setupUrls?.length).map((entry) => entry!.id);
  const status: RuntimeDoctorStatus = missing.length || withoutSetup.length || oauthWithoutUrl.length ? "failed" : "passed";
  return {
    id: "mcp_install_guidance",
    status,
    summary: status === "passed" ? "key MCP entries expose install specs or setup URLs" : "key MCP entries lack install/setup guidance",
    evidence: { missing, withoutSetup, oauthWithoutUrl },
  };
}

function catalogPluginSnapshot(plugin: BuiltinPluginCatalogEntry): Record<string, unknown> {
  return {
    id: plugin.id,
    aliases: plugin.aliases ?? [],
    category: plugin.category,
    source: plugin.source,
    risk: plugin.risk,
    actionability: plugin.actionability,
    slot: plugin.slot,
    packPath: plugin.packPath,
    setup: plugin.setup ?? {},
  };
}
