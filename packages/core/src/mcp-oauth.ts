import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { profileHomeDir } from "./profiles.js";

export interface McpOAuthTokenRecord {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType?: string;
  readonly expiresAt?: number;
  readonly scope?: string;
  readonly obtainedAt: number;
}

export interface McpOAuthStatus {
  readonly server: string;
  readonly tokenPath: string;
  readonly authenticated: boolean;
  readonly expired: boolean;
  readonly expiresAt?: number;
  readonly scope?: string;
}

const TOKEN_DIR = "mcp-oauth";

function safeServerName(name: string): string {
  return name.replace(/[^\w-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 128) || "default";
}

export function mcpOAuthTokenPath(server: string, cwd = process.cwd()): string {
  return join(profileHomeDir(cwd), TOKEN_DIR, `${safeServerName(server)}.json`);
}

export async function readMcpOAuthToken(server: string, cwd = process.cwd()): Promise<McpOAuthTokenRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(mcpOAuthTokenPath(server, cwd), "utf8")) as unknown;
    if (!isRecord(parsed) || typeof parsed.accessToken !== "string" || !parsed.accessToken.trim()) return undefined;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : undefined,
      expiresAt: typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : undefined,
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
      obtainedAt: typeof parsed.obtainedAt === "number" && Number.isFinite(parsed.obtainedAt) ? parsed.obtainedAt : 0,
    };
  } catch {
    return undefined;
  }
}

export async function writeMcpOAuthToken(
  server: string,
  token: Omit<McpOAuthTokenRecord, "obtainedAt"> & { readonly obtainedAt?: number },
  cwd = process.cwd(),
): Promise<string> {
  const target = mcpOAuthTokenPath(server, cwd);
  await mkdir(dirname(target), { recursive: true });
  await chmod(dirname(target), 0o700).catch(() => undefined);
  const record: McpOAuthTokenRecord = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenType: token.tokenType ?? "Bearer",
    expiresAt: token.expiresAt,
    scope: token.scope,
    obtainedAt: token.obtainedAt ?? Date.now(),
  };
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600).catch(() => undefined);
  return target;
}

export async function mcpOAuthStatus(server: string, cwd = process.cwd()): Promise<McpOAuthStatus> {
  const tokenPath = mcpOAuthTokenPath(server, cwd);
  const token = await readMcpOAuthToken(server, cwd);
  const expired = Boolean(token?.expiresAt && token.expiresAt <= Date.now());
  return {
    server,
    tokenPath,
    authenticated: Boolean(token && !expired),
    expired,
    expiresAt: token?.expiresAt,
    scope: token?.scope,
  };
}

export async function removeMcpOAuthToken(server: string, cwd = process.cwd()): Promise<{ readonly removed: boolean; readonly tokenPath: string }> {
  const tokenPath = mcpOAuthTokenPath(server, cwd);
  const existed = Boolean(await readMcpOAuthToken(server, cwd));
  await rm(tokenPath, { force: true });
  return { removed: existed, tokenPath };
}

export async function mcpOAuthAuthorizationHeader(server: string, cwd = process.cwd()): Promise<string | undefined> {
  const token = await readMcpOAuthToken(server, cwd);
  if (!token) return undefined;
  if (token.expiresAt && token.expiresAt <= Date.now()) return undefined;
  return `${token.tokenType ?? "Bearer"} ${token.accessToken}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
