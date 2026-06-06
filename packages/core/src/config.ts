import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HybrowClawConfig, ProviderConfig } from "./types.js";

export const CONFIG_DIR = ".hybrowclaw";
export const CONFIG_FILE = "config.json";

export function defaultConfig(): HybrowClawConfig {
  return {
    version: 1,
    providers: {
      local: {
        id: "local",
        kind: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        defaultModel: "llama3.1",
        timeoutMs: 120_000
      }
    },
    runtimes: {
      native: {
        id: "native",
        enabled: true,
        provider: "local",
        routes: {
          simple_qa: { provider: "local", model: "llama3.1", reasoning: "low" },
          research: { provider: "local", model: "llama3.1", reasoning: "medium" },
          architecture: { provider: "local", model: "llama3.1", reasoning: "high" },
          private_analysis: { provider: "local", model: "llama3.1", reasoning: "medium" }
        }
      }
    },
    routing: {
      oneRuntimePerRun: true,
      defaultRuntime: "native",
      preferLocalForSensitive: true,
      maxCostUsdPerRun: 1,
      approvalRequiredAboveUsd: 3
    }
  };
}

export function configPath(cwd = process.cwd()): string {
  return join(cwd, CONFIG_DIR, CONFIG_FILE);
}

export async function ensureDefaultConfig(cwd = process.cwd()): Promise<string> {
  const target = configPath(cwd);
  await mkdir(dirname(target), { recursive: true });
  try {
    await readFile(target, "utf8");
    return target;
  } catch {
    await writeFile(target, `${JSON.stringify(defaultConfig(), null, 2)}\n`, "utf8");
    return target;
  }
}

export async function loadConfig(cwd = process.cwd()): Promise<HybrowClawConfig> {
  const raw = await readFile(configPath(cwd), "utf8");
  const parsed = JSON.parse(raw) as HybrowClawConfig;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported HybrowClaw config version: ${String(parsed.version)}`);
  }
  return parsed;
}

export async function saveConfig(config: HybrowClawConfig, cwd = process.cwd()): Promise<void> {
  const target = configPath(cwd);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function addOpenAICompatibleProvider(
  input: {
    readonly id: string;
    readonly baseUrl: string;
    readonly defaultModel: string;
    readonly apiKeyEnv?: string;
  },
  cwd = process.cwd()
): Promise<HybrowClawConfig> {
  validateProviderId(input.id);
  validateBaseUrl(input.baseUrl);
  if (!input.defaultModel.trim()) {
    throw new Error("Provider default model cannot be empty.");
  }
  const config = await loadConfig(cwd);
  const provider: ProviderConfig = {
    id: input.id,
    kind: "openai-compatible",
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    defaultModel: input.defaultModel,
    apiKeyEnv: input.apiKeyEnv,
    timeoutMs: 120_000
  };
  const next: HybrowClawConfig = {
    ...config,
    providers: {
      ...config.providers,
      [provider.id]: provider
    }
  };
  await saveConfig(next, cwd);
  return next;
}

export async function addCodexCliProvider(
  input: {
    readonly id: string;
    readonly defaultModel: string;
  },
  cwd = process.cwd()
): Promise<HybrowClawConfig> {
  validateProviderId(input.id);
  if (!input.defaultModel.trim()) {
    throw new Error("Provider default model cannot be empty.");
  }
  const config = await loadConfig(cwd);
  const provider: ProviderConfig = {
    id: input.id,
    kind: "codex-cli",
    defaultModel: input.defaultModel,
    timeoutMs: 120_000
  };
  const next: HybrowClawConfig = {
    ...config,
    providers: {
      ...config.providers,
      [provider.id]: provider
    }
  };
  await saveConfig(next, cwd);
  return next;
}

export async function setRuntimeProvider(
  input: {
    readonly runtimeId: string;
    readonly providerId: string;
    readonly model?: string;
  },
  cwd = process.cwd()
): Promise<HybrowClawConfig> {
  const config = await loadConfig(cwd);
  const runtime = config.runtimes[input.runtimeId];
  if (!runtime) throw new Error(`Runtime not found: ${input.runtimeId}`);
  const provider = config.providers[input.providerId];
  if (!provider) throw new Error(`Provider not found: ${input.providerId}`);
  const model = input.model ?? provider.defaultModel;
  const next: HybrowClawConfig = {
    ...config,
    runtimes: {
      ...config.runtimes,
      [input.runtimeId]: {
        ...runtime,
        provider: provider.id,
        routes: Object.fromEntries(
          Object.entries(runtime.routes).map(([taskKind, route]) => [
            taskKind,
            {
              ...route,
              provider: provider.id,
              model
            }
          ])
        )
      }
    }
  };
  await saveConfig(next, cwd);
  return next;
}

function validateProviderId(id: string): void {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(id)) {
    throw new Error("Provider id must start with a letter and contain only lowercase letters, numbers, underscores, or dashes.");
  }
}

function validateBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid provider base URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider base URL must use http or https.");
  }
}
