export interface VllmToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_METRICS_URL = "http://127.0.0.1:9090/metrics";
const DEFAULT_MODEL = "meta-llama/Llama-3-8B-Instruct";

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function numberArg(args: JsonRecord, key: string, fallback: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function booleanArg(args: JsonRecord, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function apiKey(args: JsonRecord, context: VllmToolContext): string | undefined {
  return stringArg(args, "apiKey") || context.config.VLLM_API_KEY;
}

function cleanBaseUrl(value: string): string {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("baseUrl must be http or https.");
  return url.toString().replace(/\/$/, "");
}

function joinApi(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  return new URL(path.replace(/^\//, ""), `${normalized}/`);
}

function safeShellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : JSON.stringify(value);
}

function modelFromRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringField(record: JsonRecord, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function numberField(record: JsonRecord, key: string): number | undefined {
  return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : undefined;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function launchCommand(args: JsonRecord): string {
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const port = numberArg(args, "port", 8000, 65535);
  const host = stringArg(args, "host", "127.0.0.1");
  const tensorParallel = numberArg(args, "tensorParallelSize", 1, 256);
  const gpuMemory = numberArg(args, "gpuMemoryUtilization", 90, 99) / 100;
  const maxModelLen = numberArg(args, "maxModelLen", 8192, 1_000_000);
  const quantization = stringArg(args, "quantization");
  const flags = [
    "vllm serve",
    safeShellWord(model),
    "--host", safeShellWord(host),
    "--port", String(port),
    "--gpu-memory-utilization", String(gpuMemory),
    "--max-model-len", String(maxModelLen),
    tensorParallel > 1 ? `--tensor-parallel-size ${tensorParallel}` : "",
    quantization ? `--quantization ${safeShellWord(quantization)}` : "",
    booleanArg(args, "enablePrefixCaching", true) ? "--enable-prefix-caching" : "",
    booleanArg(args, "enableMetrics", true) ? "--enable-metrics" : "",
  ].filter(Boolean);
  return flags.join(" ");
}

export async function vllm_setup_plan(args: JsonRecord): Promise<JsonRecord> {
  const model = stringArg(args, "model", DEFAULT_MODEL);
  const port = numberArg(args, "port", 8000, 65535);
  return {
    source: "Hermes bundles skills/mlops/inference/vllm for high-throughput OpenAI-compatible serving.",
    install: ["pip install vllm", "python -m vllm.entrypoints.openai.api_server --help"],
    launch: launchCommand(args),
    verify: [
      `curl http://127.0.0.1:${port}/v1/models`,
      `muster plugins check vllm`,
      "Use vllm_server_check to inspect the OpenAI-compatible model list.",
      "Use vllm_metrics_summary when Prometheus metrics are enabled.",
    ],
    model,
    openAiCompatibleBaseUrl: `http://127.0.0.1:${port}/v1`,
    productionChecklist: [
      "Choose tensor parallelism based on GPU count.",
      "Set gpu-memory-utilization lower if model loading OOMs.",
      "Enable prefix caching for repeated prompts.",
      "Monitor TTFT, running requests, and GPU/KV cache utilization.",
      "Keep vLLM as a local no-key provider when running on localhost; use VLLM_API_KEY only if you enable server auth.",
    ],
    urls: ["https://docs.vllm.ai", "https://github.com/vllm-project/vllm"],
  };
}

export async function vllm_server_check(args: JsonRecord, context: VllmToolContext): Promise<JsonRecord> {
  if (typeof context.fetch !== "function") return { reachable: false, error: "vLLM pack has no network access: the loader did not grant fetch." };
  const baseUrl = cleanBaseUrl(stringArg(args, "baseUrl", DEFAULT_BASE_URL));
  const key = apiKey(args, context);
  let response: Response;
  try {
    response = await context.fetch(joinApi(baseUrl, "/models"), {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
      hint: "Start vLLM with `vllm serve <model> --port 8000` or pass baseUrl.",
    };
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!response.ok) {
    return {
      baseUrl,
      reachable: false,
      status: response.status,
      error: typeof data === "string" ? data : `HTTP ${response.status}`,
      hint: response.status === 401 || response.status === 403 ? "Set VLLM_API_KEY or pass apiKey if this vLLM server requires authentication." : undefined,
    };
  }
  const models = arrayField(modelFromRecord(data).data).map((item) => {
    const record = modelFromRecord(item);
    return {
      id: stringField(record, "id"),
      object: stringField(record, "object"),
      ownedBy: stringField(record, "owned_by"),
      created: numberField(record, "created"),
    };
  }).filter((model) => model.id);
  return {
    baseUrl,
    reachable: true,
    authenticated: Boolean(key),
    modelCount: models.length,
    models,
    providerHint: `muster provider add-openai-compatible vllm ${baseUrl} ${models[0]?.id ?? "<model-id>"}`,
  };
}

export async function vllm_metrics_summary(args: JsonRecord, context: VllmToolContext): Promise<JsonRecord> {
  if (typeof context.fetch !== "function") return { reachable: false, error: "vLLM pack has no network access: the loader did not grant fetch." };
  const metricsUrl = stringArg(args, "metricsUrl", DEFAULT_METRICS_URL);
  const url = new URL(metricsUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("metricsUrl must be http or https.");
  let response: Response;
  try {
    response = await context.fetch(url);
  } catch (error) {
    return { metricsUrl, reachable: false, error: error instanceof Error ? error.message : String(error), hint: "Start vLLM with --enable-metrics and expose the metrics port." };
  }
  const text = await response.text();
  if (!response.ok) return { metricsUrl, reachable: false, status: response.status, error: text || `HTTP ${response.status}` };
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const pick = (name: string) => {
    const line = lines.find((candidate) => candidate.startsWith(name));
    if (!line) return undefined;
    const match = /(?:^|\s)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(line);
    return match ? Number(match[1]) : undefined;
  };
  return {
    metricsUrl,
    reachable: true,
    runningRequests: pick("vllm:num_requests_running"),
    waitingRequests: pick("vllm:num_requests_waiting"),
    gpuCacheUsage: pick("vllm:gpu_cache_usage_perc"),
    timeToFirstTokenSeconds: pick("vllm:time_to_first_token_seconds_sum"),
    vllmMetricLines: lines.filter((line) => line.startsWith("vllm:")).slice(0, 20),
    truncated: lines.filter((line) => line.startsWith("vllm:")).length > 20,
  };
}

export async function vllm_provider_config(args: JsonRecord): Promise<JsonRecord> {
  const baseUrl = cleanBaseUrl(stringArg(args, "baseUrl", DEFAULT_BASE_URL));
  const model = stringArg(args, "model", DEFAULT_MODEL);
  return {
    provider: "vllm",
    model,
    baseUrl,
    apiKey: stringArg(args, "apiKeyEnv", "EMPTY"),
    commands: [
      `muster provider add-openai-compatible vllm ${baseUrl} ${safeShellWord(model)}`,
      "muster runtime set --provider vllm",
    ],
    openclawParity: "Local no-key vLLM providers should stay selectable when configured with an OpenAI-compatible base URL.",
    configShape: {
      providers: {
        vllm: {
          kind: "openai-compatible",
          baseUrl,
          defaultModel: model,
        },
      },
    },
  };
}

export const tools = {
  vllm_setup_plan,
  vllm_server_check,
  vllm_metrics_summary,
  vllm_provider_config,
};
