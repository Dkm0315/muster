import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FlowToolRegistry } from "./flow.js";

export type CapabilityPackKind = "tool" | "skill" | "agent" | "workflow" | "channel";
export type CapabilityPermission = "filesystem:read" | "filesystem:write" | "network" | "shell" | "browser" | "secrets" | "messages" | "git";
export type CapabilitySandbox = "none" | "read_only" | "workspace_write" | "network_limited" | "full_trust";

export interface CapabilityPackManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: CapabilityPackKind;
  readonly entrypoint: string;
  readonly description?: string;
  readonly permissions: CapabilityPermission[];
  readonly sandbox: CapabilitySandbox;
  readonly secrets?: string[];
  readonly evals?: string[];
  readonly digest?: string;
}

export interface CapabilityPackInspection {
  readonly path: string;
  readonly manifest?: CapabilityPackManifest;
  readonly status: "ready" | "blocked";
  readonly risk: "low" | "medium" | "high";
  readonly blockers: string[];
  readonly warnings: string[];
}

export async function inspectCapabilityPack(path: string): Promise<CapabilityPackInspection> {
  // Canonical manifest name first; "manifest.json" is accepted as a fallback
  // (capability-packs/* in this repo use it).
  let raw: string;
  try {
    raw = await readFile(join(path, "muster.capability.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    raw = await readFile(join(path, "manifest.json"), "utf8");
  }
  const parsed = JSON.parse(raw) as unknown;
  return inspectCapabilityManifest(path, parsed);
}

export function inspectCapabilityManifest(path: string, value: unknown): CapabilityPackInspection {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return { path, status: "blocked", risk: "high", blockers: ["Manifest must be a JSON object."], warnings };
  }

  if (value.schemaVersion !== 1) blockers.push("schemaVersion must be 1.");
  if (!isSafeId(value.id)) blockers.push("id must be lowercase kebab-case, 3-80 chars.");
  if (!isNonEmpty(value.name)) blockers.push("name is required.");
  if (!isSemverLike(value.version)) blockers.push("version must be semver-like.");
  if (!isKind(value.kind)) blockers.push("kind is invalid.");
  if (!isNonEmpty(value.entrypoint)) blockers.push("entrypoint is required.");
  if (!Array.isArray(value.permissions) || !value.permissions.every(isPermission)) blockers.push("permissions must be valid permission strings.");
  if (!isSandbox(value.sandbox)) blockers.push("sandbox is invalid.");
  if (Array.isArray(value.secrets) && !value.secrets.every(isEnvName)) blockers.push("secrets must be environment variable names.");
  if (Array.isArray(value.evals) && !value.evals.every(isNonEmpty)) blockers.push("evals must be non-empty paths.");

  const permissions = Array.isArray(value.permissions) ? value.permissions.filter(isPermission) : [];
  const sandbox = isSandbox(value.sandbox) ? value.sandbox : "none";
  if (permissions.includes("secrets") && (!Array.isArray(value.secrets) || !value.secrets.length)) {
    blockers.push("secrets permission requires declared secret environment variables.");
  }
  if (permissions.includes("shell") && sandbox !== "workspace_write" && sandbox !== "full_trust") {
    blockers.push("shell permission requires workspace_write or full_trust sandbox.");
  }
  if (sandbox === "full_trust") warnings.push("full_trust capability must be reviewed before enabling.");
  if (!Array.isArray(value.evals) || !value.evals.length) warnings.push("No eval fixtures declared.");
  if (!isNonEmpty(value.digest)) warnings.push("No signed digest declared.");

  const manifest = blockers.length
    ? undefined
    : ({
        schemaVersion: 1,
        id: value.id as string,
        name: value.name as string,
        version: value.version as string,
        kind: value.kind as CapabilityPackKind,
        entrypoint: value.entrypoint as string,
        description: typeof value.description === "string" ? value.description : undefined,
        permissions,
        sandbox,
        secrets: Array.isArray(value.secrets) ? value.secrets.filter(isEnvName) : undefined,
        evals: Array.isArray(value.evals) ? value.evals.filter(isNonEmpty) : undefined,
        digest: typeof value.digest === "string" ? value.digest : undefined
      } satisfies CapabilityPackManifest);

  return {
    path,
    manifest,
    status: blockers.length ? "blocked" : "ready",
    risk: riskFor(permissions, sandbox, blockers),
    blockers,
    warnings
  };
}

function riskFor(permissions: CapabilityPermission[], sandbox: CapabilitySandbox, blockers: string[]): CapabilityPackInspection["risk"] {
  if (blockers.length || sandbox === "full_trust" || permissions.includes("secrets") || permissions.includes("shell")) return "high";
  if (permissions.includes("filesystem:write") || permissions.includes("network") || sandbox === "workspace_write") return "medium";
  return "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{2,79}$/.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSemverLike(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value);
}

function isKind(value: unknown): value is CapabilityPackKind {
  return value === "tool" || value === "skill" || value === "agent" || value === "workflow" || value === "channel";
}

function isPermission(value: unknown): value is CapabilityPermission {
  return (
    value === "filesystem:read" ||
    value === "filesystem:write" ||
    value === "network" ||
    value === "shell" ||
    value === "browser" ||
    value === "secrets" ||
    value === "messages" ||
    value === "git"
  );
}

function isSandbox(value: unknown): value is CapabilitySandbox {
  return value === "none" || value === "read_only" || value === "workspace_write" || value === "network_limited" || value === "full_trust";
}

function isEnvName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z_][A-Z0-9_]*$/.test(value);
}

// --- capability-pack loader (HC-012) ---

/**
 * Execution context handed to every pack tool. Packs receive capabilities
 * explicitly through this object instead of reaching for ambient globals:
 * `fetch` is present only when the manifest declares the `network`
 * permission, and `config` exposes only the env vars declared in
 * `manifest.secrets`.
 *
 * v1 enforcement is CONTRACTUAL, not a sandbox: a malicious pack could still
 * import `node:http` or read `process.env` directly. The contract makes
 * well-behaved packs reviewable and testable; process-level sandboxing is a
 * later slice.
 */
export interface CapabilityToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export type CapabilityPackTool = (args: Record<string, unknown>, context: CapabilityToolContext) => Promise<unknown>;

export interface LoadedCapabilityPack {
  readonly manifest: CapabilityPackManifest;
  /** Namespaced tool names registered into the flow registry: `<packId>__<tool>`. */
  readonly toolNames: readonly string[];
  readonly warnings: readonly string[];
}

export interface LoadCapabilityPackOptions {
  /** Flow tool registry the pack tools are registered into. */
  readonly registry: FlowToolRegistry;
  /** High-risk packs (secrets/shell/full_trust) refuse to load without this. */
  readonly allowHighRisk?: boolean;
  /** Env source for `manifest.secrets`; defaults to process.env (injectable for tests). */
  readonly env?: Record<string, string | undefined>;
}

const PACK_TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Validates the pack manifest (inspectCapabilityPack), refuses invalid or
 * high-risk-without-flag packs, dynamically imports the entrypoint module
 * (must export `tools: Record<string, (args, context) => Promise<unknown>>`),
 * and registers each tool into the flow registry as `<packId>__<tool>` with a
 * frozen, permission-scoped context bound in.
 *
 * The entrypoint must be importable by the current runtime: plain JS always
 * works; TS entrypoints work when running under tsx (tests, `pnpm hc`).
 */
export async function loadCapabilityPack(dir: string, options: LoadCapabilityPackOptions): Promise<LoadedCapabilityPack> {
  const inspection = await inspectCapabilityPack(dir);
  if (inspection.status === "blocked" || !inspection.manifest) {
    throw new Error(`Capability pack at ${dir} is blocked:\n${inspection.blockers.map((blocker) => `- ${blocker}`).join("\n")}`);
  }
  if (inspection.risk === "high" && !options.allowHighRisk) {
    throw new Error(
      `Capability pack "${inspection.manifest.id}" is high-risk (permissions: ${inspection.manifest.permissions.join(", ") || "none"}; sandbox: ${inspection.manifest.sandbox}). Pass allowHighRisk (CLI: --allow-high-risk) to load it.`,
    );
  }
  const manifest = inspection.manifest;
  const entrypoint = isAbsolute(manifest.entrypoint) ? manifest.entrypoint : join(dir, manifest.entrypoint);
  let module: Record<string, unknown>;
  try {
    module = (await import(pathToFileURL(entrypoint).href)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Capability pack "${manifest.id}": failed to import entrypoint ${entrypoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tools = module.tools;
  if (typeof tools !== "object" || tools === null || Array.isArray(tools) || !Object.keys(tools).length) {
    throw new Error(`Capability pack "${manifest.id}": entrypoint must export a non-empty \`tools\` record.`);
  }
  for (const [name, fn] of Object.entries(tools as Record<string, unknown>)) {
    if (!PACK_TOOL_NAME_PATTERN.test(name)) {
      throw new Error(`Capability pack "${manifest.id}": tool name "${name}" must match ${PACK_TOOL_NAME_PATTERN}.`);
    }
    if (typeof fn !== "function") {
      throw new Error(`Capability pack "${manifest.id}": tool "${name}" must be a function.`);
    }
  }

  const env = options.env ?? process.env;
  const context: CapabilityToolContext = Object.freeze({
    // Permission gate: packs that do not declare `network` get no fetch.
    fetch: manifest.permissions.includes("network") ? globalThis.fetch.bind(globalThis) : undefined,
    config: Object.freeze(Object.fromEntries((manifest.secrets ?? []).map((name) => [name, env[name]]))),
  });

  const toolNames: string[] = [];
  for (const [name, fn] of Object.entries(tools as Record<string, CapabilityPackTool>)) {
    const namespaced = `${manifest.id}__${name}`;
    options.registry[namespaced] = (args) => fn(args, context);
    toolNames.push(namespaced);
  }
  return { manifest, toolNames, warnings: inspection.warnings };
}
