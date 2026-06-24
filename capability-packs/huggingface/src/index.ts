export interface HuggingFaceToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface HuggingFaceError {
  readonly error: string;
  readonly status?: number;
  readonly hint?: string;
}

interface HuggingFaceCallOk {
  readonly ok: true;
  readonly data: unknown;
}

type HuggingFaceCallResult = HuggingFaceCallOk | (HuggingFaceError & { readonly ok?: undefined });

function token(context: HuggingFaceToolContext): string | undefined {
  return context.config.HF_TOKEN || context.config.HUGGINGFACE_TOKEN;
}

function stringArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : fallback;
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  return typeof record[name] === "string" ? record[name] as string : undefined;
}

function numberField(record: Record<string, unknown>, name: string): number | undefined {
  return typeof record[name] === "number" && Number.isFinite(record[name]) ? record[name] as number : undefined;
}

function boolField(record: Record<string, unknown>, name: string): boolean | undefined {
  return typeof record[name] === "boolean" ? record[name] as boolean : undefined;
}

function stringList(value: unknown, max = 12): string[] {
  return arrayField(value).filter((item): item is string => typeof item === "string").slice(0, max);
}

function headers(context: HuggingFaceToolContext): Record<string, string> {
  const accessToken = token(context);
  return {
    Accept: "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function repoIdArg(args: Record<string, unknown>, name = "repoId"): string | HuggingFaceError {
  const repoId = stringArg(args, name);
  return repoId ? repoId : { error: `huggingface tool requires "${name}" such as "google/gemma-2-2b" or "lhoestq/demo1".` };
}

function hfHint(status: number): string | undefined {
  if (status === 401) return "Set HF_TOKEN or HUGGINGFACE_TOKEN from https://huggingface.co/settings/tokens for private or gated Hub resources.";
  if (status === 403) return "Your Hugging Face token may not have access to this private or gated repository. Accept the model/dataset terms in the browser if required.";
  if (status === 404) return "Check the repo id and repo type. Dataset ids use the dataset endpoint; model ids use the model endpoint.";
  if (status === 429) return "Hugging Face rate limited this request; retry with a token or back off.";
  return undefined;
}

async function hfRequest(
  context: HuggingFaceToolContext,
  path: string,
  query?: URLSearchParams,
): Promise<HuggingFaceCallResult> {
  if (typeof context.fetch !== "function") return { error: "Hugging Face pack has no network access: the loader did not grant fetch." };
  const url = new URL(`https://huggingface.co${path}`);
  if (query) {
    for (const [key, value] of query) url.searchParams.append(key, value);
  }
  let response: Response;
  try {
    response = await context.fetch(url, { headers: headers(context) });
  } catch (error) {
    return { error: `Hugging Face request failed before a response: ${error instanceof Error ? error.message : String(error)}` };
  }
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const record = asRecord(data);
    const message = stringField(record, "error") ?? stringField(record, "message") ?? (text || `HTTP ${response.status}`);
    return { error: message, status: response.status, hint: hfHint(response.status) };
  }
  return { ok: true, data };
}

function modelSummary(value: unknown): Record<string, unknown> {
  const item = asRecord(value);
  const cardData = asRecord(item.cardData);
  return {
    id: stringField(item, "id") ?? stringField(item, "modelId"),
    author: stringField(item, "author"),
    pipelineTag: stringField(item, "pipeline_tag") ?? stringField(item, "pipelineTag"),
    tags: stringList(item.tags, 10),
    downloads: numberField(item, "downloads") ?? 0,
    likes: numberField(item, "likes") ?? 0,
    private: boolField(item, "private") ?? false,
    gated: stringField(item, "gated") ?? boolField(item, "gated") ?? false,
    license: stringField(cardData, "license"),
    lastModified: stringField(item, "lastModified"),
    url: `https://huggingface.co/${encodeURIComponent(stringField(item, "id") ?? stringField(item, "modelId") ?? "").replace(/%2F/g, "/")}`,
  };
}

function datasetSummary(value: unknown): Record<string, unknown> {
  const item = asRecord(value);
  const cardData = asRecord(item.cardData);
  return {
    id: stringField(item, "id"),
    author: stringField(item, "author"),
    tags: stringList(item.tags, 10),
    downloads: numberField(item, "downloads") ?? 0,
    likes: numberField(item, "likes") ?? 0,
    private: boolField(item, "private") ?? false,
    gated: stringField(item, "gated") ?? boolField(item, "gated") ?? false,
    license: stringField(cardData, "license"),
    lastModified: stringField(item, "lastModified"),
    url: `https://huggingface.co/datasets/${encodeURIComponent(stringField(item, "id") ?? "").replace(/%2F/g, "/")}`,
  };
}

export async function hf_models_search(
  args: Record<string, unknown>,
  context: HuggingFaceToolContext,
): Promise<Record<string, unknown> | HuggingFaceError> {
  const query = stringArg(args, "query");
  if (!query) return { error: 'hf_models_search requires "query".' };
  const params = new URLSearchParams({ search: query, limit: String(positiveLimit(args.limit, 10, 50)) });
  const task = stringArg(args, "task");
  if (task) params.set("pipeline_tag", task);
  const sort = stringArg(args, "sort", "downloads");
  if (sort) params.set("sort", sort);
  params.set("direction", "-1");
  const result = await hfRequest(context, "/api/models", params);
  if (!result.ok) return result;
  return {
    query,
    task: task || undefined,
    authenticated: Boolean(token(context)),
    models: arrayField(result.data).map(modelSummary),
  };
}

export async function hf_model_info(
  args: Record<string, unknown>,
  context: HuggingFaceToolContext,
): Promise<Record<string, unknown> | HuggingFaceError> {
  const repoId = repoIdArg(args);
  if (typeof repoId !== "string") return repoId;
  const result = await hfRequest(context, `/api/models/${encodeURIComponent(repoId).replace(/%2F/g, "/")}`);
  if (!result.ok) return result;
  const summary = modelSummary(result.data);
  const data = asRecord(result.data);
  return {
    ...summary,
    siblings: arrayField(data.siblings).map((file) => {
      const record = asRecord(file);
      return { rfilename: stringField(record, "rfilename"), size: numberField(record, "size") };
    }).filter((file) => file.rfilename),
    sha: stringField(data, "sha"),
  };
}

export async function hf_datasets_search(
  args: Record<string, unknown>,
  context: HuggingFaceToolContext,
): Promise<Record<string, unknown> | HuggingFaceError> {
  const query = stringArg(args, "query");
  if (!query) return { error: 'hf_datasets_search requires "query".' };
  const params = new URLSearchParams({ search: query, limit: String(positiveLimit(args.limit, 10, 50)), sort: "downloads", direction: "-1" });
  const result = await hfRequest(context, "/api/datasets", params);
  if (!result.ok) return result;
  return {
    query,
    authenticated: Boolean(token(context)),
    datasets: arrayField(result.data).map(datasetSummary),
  };
}

export async function hf_dataset_info(
  args: Record<string, unknown>,
  context: HuggingFaceToolContext,
): Promise<Record<string, unknown> | HuggingFaceError> {
  const repoId = repoIdArg(args);
  if (typeof repoId !== "string") return repoId;
  const result = await hfRequest(context, `/api/datasets/${encodeURIComponent(repoId).replace(/%2F/g, "/")}`);
  if (!result.ok) return result;
  const summary = datasetSummary(result.data);
  const data = asRecord(result.data);
  return {
    ...summary,
    siblings: arrayField(data.siblings).map((file) => {
      const record = asRecord(file);
      return { rfilename: stringField(record, "rfilename"), size: numberField(record, "size") };
    }).filter((file) => file.rfilename),
    sha: stringField(data, "sha"),
  };
}

export async function hf_download_guidance(
  args: Record<string, unknown>,
  _context: HuggingFaceToolContext,
): Promise<Record<string, unknown> | HuggingFaceError> {
  const repoId = repoIdArg(args);
  if (typeof repoId !== "string") return repoId;
  const repoType = stringArg(args, "repoType", "model");
  if (repoType !== "model" && repoType !== "dataset" && repoType !== "space") {
    return { error: 'hf_download_guidance requires repoType to be "model", "dataset", or "space".' };
  }
  const revision = stringArg(args, "revision");
  const localDir = stringArg(args, "localDir");
  const command = [
    "hf download",
    repoId,
    repoType === "model" ? "" : `--repo-type ${repoType}`,
    revision ? `--revision ${shellWord(revision)}` : "",
    localDir ? `--local-dir ${shellWord(localDir)}` : "",
  ].filter(Boolean).join(" ");
  return {
    repoId,
    repoType,
    command,
    auth: "Set HF_TOKEN or run `hf auth login` for private/gated resources.",
    install: "Install the modern CLI with `curl -LsSf https://hf.co/cli/install.sh | bash -s`.",
    safety: "Large downloads should be explicit; inspect repo siblings first with hf_model_info or hf_dataset_info.",
  };
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

export const tools = {
  hf_models_search,
  hf_model_info,
  hf_datasets_search,
  hf_dataset_info,
  hf_download_guidance,
};
