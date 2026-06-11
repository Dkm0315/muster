import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Gateway-local config (.muster/gateway.json): bearer token + adapter bot tokens. */
export interface GatewayConfig {
  readonly token: string;
  readonly port?: number;
  readonly telegram?: { readonly botToken: string };
  readonly slack?: { readonly botToken: string };
  readonly discord?: {
    readonly botToken: string;
    /** Application public key (hex, developer portal) for ed25519 interaction verification. */
    readonly publicKey?: string;
  };
  readonly whatsapp?: {
    readonly accessToken: string;
    readonly verifyToken: string;
    readonly phoneNumberId: string;
    /** Graph API version segment; defaults to v19.0. */
    readonly apiVersion?: string;
  };
  readonly gchat?: { readonly verificationToken?: string };
  readonly teams?: { readonly hmacSecret?: string };
}

export const DEFAULT_GATEWAY_PORT = 7460;

export function gatewayConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".muster", "gateway.json");
}

/** Create .muster/gateway.json with a fresh bearer token; reuse if present. */
export async function initGatewayConfig(cwd = process.cwd()): Promise<{ path: string; config: GatewayConfig; created: boolean }> {
  const path = gatewayConfigPath(cwd);
  try {
    const existing = await loadGatewayConfig(cwd);
    return { path, config: existing, created: false };
  } catch {
    const config: GatewayConfig = { token: randomBytes(24).toString("hex"), port: DEFAULT_GATEWAY_PORT };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return { path, config, created: true };
  }
}

export async function loadGatewayConfig(cwd = process.cwd()): Promise<GatewayConfig> {
  const raw = await readFile(gatewayConfigPath(cwd), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error("Gateway not initialized. Run: muster gateway init");
    }
    throw error;
  });
  const parsed = JSON.parse(raw) as Partial<GatewayConfig>;
  if (typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error(`Gateway config at ${gatewayConfigPath(cwd)} is missing a "token". Re-run: muster gateway init`);
  }
  return parsed as GatewayConfig;
}
