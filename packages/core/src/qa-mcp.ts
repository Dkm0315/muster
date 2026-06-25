import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connectMcpServer, type McpServerConfig } from "./mcp.js";
import { mcpOAuthStatus, removeMcpOAuthToken, writeMcpOAuthToken } from "./mcp-oauth.js";
import type { RuntimeDoctorStatus } from "./runtime-doctor.js";

export interface QaMcpAuthCaseResult {
  readonly id: string;
  readonly status: RuntimeDoctorStatus;
  readonly summary: string;
  readonly detail?: string;
}

export interface QaMcpAuthFailureResult {
  readonly suite: "mcp_auth_failure";
  readonly status: RuntimeDoctorStatus;
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly casesPath: string;
  readonly serverLogPath: string;
  readonly cases: readonly QaMcpAuthCaseResult[];
  readonly summary: string;
}

interface ServerLog {
  readonly authorization?: string;
  readonly method?: string;
}

export async function runMcpAuthFailureQa(input: {
  readonly artifactDir: string;
  readonly cwd?: string;
  readonly serverName?: string;
}): Promise<QaMcpAuthFailureResult> {
  const cwd = input.cwd ?? process.cwd();
  const serverName = input.serverName ?? "qa-oauth";
  const artifactDir = input.artifactDir;
  await mkdir(artifactDir, { recursive: true });
  await removeMcpOAuthToken(serverName, cwd);

  const logs: ServerLog[] = [];
  const server = createServer((request, response) => handleFakeMcpRequest(request, response, logs));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start MCP auth QA server.");
  const config: McpServerConfig = {
    transport: { kind: "http", url: `http://127.0.0.1:${address.port}/mcp` },
    auth: "oauth",
    oauth: { setupUrl: "https://example.invalid/mcp-setup" },
    limits: { toolTimeoutMs: 1000 },
  };

  const cases: QaMcpAuthCaseResult[] = [];
  try {
    cases.push(await expectFailedConnect("missing_token", serverName, config, cwd, /requires OAuth login/));
    await writeMcpOAuthToken(serverName, { accessToken: "expired-token", expiresAt: Date.now() - 1000 }, cwd);
    cases.push(await expectFailedConnect("expired_token", serverName, config, cwd, /requires OAuth login/));
    await writeMcpOAuthToken(serverName, { accessToken: "bad-token", expiresAt: Date.now() + 60_000 }, cwd);
    cases.push(await expectFailedConnect("invalid_token", serverName, config, cwd, /MCP HTTP 401/));
    await writeMcpOAuthToken(serverName, { accessToken: "good-token", expiresAt: Date.now() + 60_000, scope: "tools:read" }, cwd);
    cases.push(await expectReadyConnect("valid_token", serverName, config, cwd));
    const removed = await removeMcpOAuthToken(serverName, cwd);
    const status = await mcpOAuthStatus(serverName, cwd);
    cases.push({
      id: "logout_recovery",
      status: removed.removed && !status.authenticated ? "passed" : "failed",
      summary: removed.removed && !status.authenticated ? "logout removes token and status returns unauthenticated" : "logout did not clear OAuth state",
      detail: `removed=${removed.removed} authenticated=${status.authenticated}`,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const status: RuntimeDoctorStatus = cases.every((item) => item.status === "passed") ? "passed" : "failed";
  const summary = status === "passed"
    ? "MCP OAuth failure and recovery paths verified without external credentials"
    : "MCP OAuth failure suite found regressions";
  const manifestPath = join(artifactDir, "manifest.json");
  const casesPath = join(artifactDir, "cases.jsonl");
  const serverLogPath = join(artifactDir, "server-log.jsonl");
  await writeFile(manifestPath, `${JSON.stringify({ kind: "muster-qa", suite: "mcp_auth_failure", status, summary, caseCount: cases.length, artifacts: { cases: "cases.jsonl", serverLog: "server-log.jsonl" } }, null, 2)}\n`, "utf8");
  await writeFile(casesPath, `${cases.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await writeFile(serverLogPath, `${logs.map((item) => JSON.stringify(item)).join("\n")}${logs.length ? "\n" : ""}`, "utf8");
  return { suite: "mcp_auth_failure", status, artifactDir, manifestPath, casesPath, serverLogPath, cases, summary };
}

async function expectFailedConnect(id: string, serverName: string, config: McpServerConfig, cwd: string, expected: RegExp): Promise<QaMcpAuthCaseResult> {
  const handle = await connectMcpServer(serverName, config, cwd);
  try {
    const detail = handle.error ?? "";
    const ok = handle.status === "failed" && expected.test(detail);
    return { id, status: ok ? "passed" : "failed", summary: ok ? `${id} failed with expected recovery error` : `${id} did not fail as expected`, detail };
  } finally {
    handle.close();
  }
}

async function expectReadyConnect(id: string, serverName: string, config: McpServerConfig, cwd: string): Promise<QaMcpAuthCaseResult> {
  const handle = await connectMcpServer(serverName, config, cwd);
  try {
    const ok = handle.status === "ready" && handle.tools.some((tool) => tool.name === "echo");
    return { id, status: ok ? "passed" : "failed", summary: ok ? "valid token reaches MCP tool listing" : "valid token did not produce a ready MCP handle", detail: `status=${handle.status} tools=${handle.tools.map((tool) => tool.name).join(",") || "none"} error=${handle.error ?? "-"}` };
  } finally {
    handle.close();
  }
}

function handleFakeMcpRequest(request: IncomingMessage, response: ServerResponse, logs: ServerLog[]): void {
  const authorization = request.headers.authorization;
  let raw = "";
  request.on("data", (chunk) => { raw += chunk.toString(); });
  request.on("end", () => {
    const method = parseMethod(raw);
    logs.push({ authorization, method });
    if (authorization !== "Bearer good-token") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    if (method === "tools/list") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "echo", description: "Echo test tool", inputSchema: { type: "object" } }] } }));
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
  });
}

function parseMethod(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { method?: unknown };
    return typeof parsed.method === "string" ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}
