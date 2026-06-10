import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  const manifestPath = join(path, "muster.capability.json");
  const raw = await readFile(manifestPath, "utf8");
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
