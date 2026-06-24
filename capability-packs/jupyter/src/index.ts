import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface JupyterToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "http://127.0.0.1:8888";
const MAX_NOTEBOOK_BYTES = 1_200_000;
const MAX_CELLS = 40;

function stringArg(args: JsonRecord, key: string, fallback = ""): string {
  return typeof args[key] === "string" && String(args[key]).trim() ? String(args[key]).trim() : fallback;
}

function numberArg(args: JsonRecord, key: string, fallback: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function token(args: JsonRecord, context: JupyterToolContext): string | undefined {
  return stringArg(args, "token") || context.config.JUPYTER_TOKEN;
}

function workspacePath(input: string, fallback: string): string {
  const cwd = process.cwd();
  const raw = input || fallback;
  const target = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
  const rel = relative(cwd, target);
  if (rel.startsWith("..") || rel === ".." || rel.split("/").includes("..")) {
    throw new Error("jupyter pack paths must stay inside the current workspace.");
  }
  if (!target.endsWith(".ipynb")) throw new Error("jupyter notebook paths must end with .ipynb.");
  return target;
}

function baseUrlArg(args: JsonRecord): string {
  const value = stringArg(args, "baseUrl", DEFAULT_BASE_URL);
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("baseUrl must be http or https.");
  return url.toString().replace(/\/$/, "");
}

function apiUrl(baseUrl: string, path: string, accessToken?: string): URL {
  const url = new URL(path, `${baseUrl}/`);
  if (accessToken) url.searchParams.set("token", accessToken);
  return url;
}

async function jupyterJson(context: JupyterToolContext, baseUrl: string, path: string, accessToken?: string): Promise<{ ok: true; data: unknown; status: number } | { ok: false; status?: number; error: string; hint?: string }> {
  if (typeof context.fetch !== "function") return { ok: false, error: "Jupyter pack has no network access: the loader did not grant fetch." };
  let response: Response;
  try {
    response = await context.fetch(apiUrl(baseUrl, path, accessToken), {
      headers: accessToken ? { Authorization: `token ${accessToken}` } : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach Jupyter at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Start JupyterLab with `jupyter-lab --no-browser --port=8888 --notebook-dir=$PWD/notebooks` or pass baseUrl.",
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
      ok: false,
      status: response.status,
      error: typeof data === "string" ? data : `Jupyter returned HTTP ${response.status}.`,
      hint: response.status === 403 || response.status === 401 ? "Set JUPYTER_TOKEN or pass token for token-protected Jupyter servers." : undefined,
    };
  }
  return { ok: true, data, status: response.status };
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sourceText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("");
  return typeof value === "string" ? value : "";
}

function compactText(value: string, max = 240): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

export async function jupyter_setup_plan(args: JsonRecord, context: JupyterToolContext): Promise<JsonRecord> {
  const notebookDir = stringArg(args, "notebookDir", "notebooks");
  const port = numberArg(args, "port", 8888, 65535);
  const accessToken = token(args, context);
  return {
    source: "Hermes bundles data-science/jupyter-live-kernel and delegates live execution to hamelsmu/hamelnb.",
    readyWhen: [
      "uv is installed.",
      "JupyterLab is installed, for example `uv tool install jupyterlab`.",
      "A local Jupyter server is running.",
      "For live execution parity, hamelnb is cloned and its jupyter_live_kernel.py helper is available.",
    ],
    commands: [
      "which uv",
      "uv tool install jupyterlab",
      `mkdir -p ${notebookDir}`,
      `jupyter-lab --no-browser --port=${port} --notebook-dir=$PWD/${notebookDir}${accessToken ? " --ServerApp.token=$JUPYTER_TOKEN" : ""}`,
      "git clone https://github.com/hamelsmu/hamelnb.git ~/.agent-skills/hamelnb",
      "uv run ~/.agent-skills/hamelnb/skills/jupyter-live-kernel/scripts/jupyter_live_kernel.py servers --compact",
    ],
    musterTools: [
      "jupyter_server_check checks the running server and sessions.",
      "jupyter_scratch_notebook creates a safe workspace .ipynb.",
      "jupyter_notebook_summary summarizes cells and outputs without executing code.",
    ],
    urls: [
      "https://github.com/hamelsmu/hamelnb",
      "https://github.com/NousResearch/hermes-agent/blob/main/skills/data-science/jupyter-live-kernel/SKILL.md",
      "https://jupyterlab.readthedocs.io/",
    ],
    tokenConfigured: Boolean(accessToken),
  };
}

export async function jupyter_server_check(args: JsonRecord, context: JupyterToolContext): Promise<JsonRecord> {
  const baseUrl = baseUrlArg(args);
  const accessToken = token(args, context);
  const status = await jupyterJson(context, baseUrl, "/api/status", accessToken);
  const sessions = await jupyterJson(context, baseUrl, "/api/sessions", accessToken);
  return {
    baseUrl,
    tokenConfigured: Boolean(accessToken),
    reachable: status.ok || sessions.ok,
    status: status.ok ? status.data : { error: status.error, status: status.status, hint: status.hint },
    sessions: sessions.ok ? asArray(sessions.data).map((item) => {
      const record = asRecord(item);
      const kernel = asRecord(record.kernel);
      const notebook = asRecord(record.notebook);
      return {
        id: asString(record.id),
        path: asString(record.path) ?? asString(notebook.path),
        name: asString(record.name) ?? asString(notebook.name),
        kernel: asString(kernel.name),
        kernelId: asString(kernel.id),
      };
    }) : { error: sessions.error, status: sessions.status, hint: sessions.hint },
  };
}

export async function jupyter_scratch_notebook(args: JsonRecord): Promise<JsonRecord> {
  const path = workspacePath(stringArg(args, "path"), "notebooks/scratch.ipynb");
  const name = stringArg(args, "name", "scratch");
  const notebook = {
    cells: [{
      cell_type: "code",
      execution_count: null,
      id: "muster-scratch",
      metadata: {},
      outputs: [],
      source: [`# ${name}\n`],
    }],
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", pycodemirror_mode: { name: "ipython", version: 3 }, version: "3" },
      muster: { createdBy: "muster-jupyter-pack" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(notebook, null, 2)}\n`, "utf8");
  return {
    path,
    relativePath: relative(process.cwd(), path),
    next: [
      "Start JupyterLab if needed.",
      "Open the notebook in JupyterLab or attach hamelnb live-kernel execution to it.",
      "Run jupyter_notebook_summary after edits to inspect cells and outputs.",
    ],
  };
}

export async function jupyter_notebook_summary(args: JsonRecord): Promise<JsonRecord> {
  const path = workspacePath(stringArg(args, "path"), "notebooks/scratch.ipynb");
  const file = await stat(path);
  if (!file.isFile()) throw new Error("jupyter_notebook_summary path must point to a notebook file.");
  if (file.size > MAX_NOTEBOOK_BYTES) throw new Error(`Notebook is too large to summarize safely (${file.size} bytes).`);
  const raw = await readFile(path, "utf8");
  const notebook = asRecord(JSON.parse(raw));
  const cells = asArray(notebook.cells).slice(0, MAX_CELLS).map((cell, index) => {
    const record = asRecord(cell);
    const outputs = asArray(record.outputs);
    return {
      index,
      id: asString(record.id),
      type: asString(record.cell_type),
      executionCount: typeof record.execution_count === "number" ? record.execution_count : null,
      source: compactText(sourceText(record.source)),
      outputs: outputs.length,
      outputPreview: compactText(outputs.map((output) => {
        const out = asRecord(output);
        return sourceText(out.text) || sourceText(asRecord(out.data)["text/plain"]) || asString(out.ename) || "";
      }).filter(Boolean).join(" ")),
    };
  });
  return {
    path,
    relativePath: relative(process.cwd(), path),
    nbformat: notebook.nbformat,
    nbformatMinor: notebook.nbformat_minor,
    cellCount: asArray(notebook.cells).length,
    truncated: asArray(notebook.cells).length > MAX_CELLS,
    cells,
  };
}

export const tools = {
  jupyter_setup_plan,
  jupyter_server_check,
  jupyter_scratch_notebook,
  jupyter_notebook_summary,
};
