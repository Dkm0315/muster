import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatMessage, ModelRoute, ProviderConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ChatCompletionRequest {
  readonly provider: ProviderConfig;
  readonly route: ModelRoute;
  readonly messages: ChatMessage[];
}

export async function completeChat(request: ChatCompletionRequest): Promise<string> {
  const { provider, route, messages } = request;
  if (provider.kind === "codex-cli") {
    return completeWithCodexCli(provider, route, messages);
  }
  if (provider.kind !== "openai-compatible" && provider.kind !== "openai") {
    throw new Error(`Provider kind is not implemented in v0: ${provider.kind}`);
  }
  const baseUrl = provider.baseUrl ?? "https://api.openai.com/v1";
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : process.env.OPENAI_API_KEY;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: route.model,
      messages,
      stream: false
    }),
    signal: AbortSignal.timeout(provider.timeoutMs ?? 120_000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Provider request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

async function completeWithCodexCli(provider: ProviderConfig, route: ModelRoute, messages: ChatMessage[]): Promise<string> {
  const prompt = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const { stdout } = await execFileAsync("codex", ["-q", "-m", route.model || provider.defaultModel, prompt], {
    timeout: provider.timeoutMs ?? 120_000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}
