import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const DEFAULT_PROFILE = "default";

export function musterRoot(cwd = process.cwd()): string {
  return join(cwd, ".muster");
}

export function profilePointerPath(cwd = process.cwd()): string {
  return join(musterRoot(cwd), "profile");
}

export function profilesRoot(cwd = process.cwd()): string {
  return join(musterRoot(cwd), "profiles");
}

export function validateProfileName(name: string): void {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid profile name "${name}". Use lowercase letters, digits, and dashes (max 40 chars).`);
  }
}

export function activeProfile(cwd = process.cwd()): string {
  try {
    const raw = readFileSync(profilePointerPath(cwd), "utf8").trim();
    return raw && PROFILE_NAME_PATTERN.test(raw) ? raw : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function profileDataDir(cwd = process.cwd(), profile = activeProfile(cwd)): string {
  if (profile === DEFAULT_PROFILE) return join(musterRoot(cwd), "data");
  return join(profilesRoot(cwd), profile, "data");
}

export function profileConfigPath(cwd = process.cwd(), profile = activeProfile(cwd)): string {
  if (profile !== DEFAULT_PROFILE) {
    const scoped = join(profilesRoot(cwd), profile, "config.json");
    if (existsSync(scoped)) return scoped;
  }
  return join(musterRoot(cwd), "config.json");
}

/**
 * Where config WRITES go. profileConfigPath falls back to the shared default
 * config when a profile has no scoped config yet (so a fresh profile inherits
 * the default until customized) — but writes must ALWAYS target the scoped path
 * for a non-default profile, otherwise the scoped config is never created and
 * the profile's config silently leaks into the shared default, breaking
 * isolation.
 */
export function profileConfigWritePath(cwd = process.cwd(), profile = activeProfile(cwd)): string {
  if (profile !== DEFAULT_PROFILE) return join(profilesRoot(cwd), profile, "config.json");
  return join(musterRoot(cwd), "config.json");
}

export async function createProfile(name: string, cwd = process.cwd()): Promise<string> {
  validateProfileName(name);
  if (name === DEFAULT_PROFILE) throw new Error("The default profile always exists; no need to create it.");
  const dir = join(profilesRoot(cwd), name);
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "workspace"), { recursive: true });
  return dir;
}

export async function listProfiles(cwd = process.cwd()): Promise<string[]> {
  const names = new Set<string>([DEFAULT_PROFILE]);
  try {
    for (const entry of await readdir(profilesRoot(cwd), { withFileTypes: true })) {
      if (entry.isDirectory() && PROFILE_NAME_PATTERN.test(entry.name)) names.add(entry.name);
    }
  } catch {
    // no profiles directory yet
  }
  return [...names].sort();
}

export async function useProfile(name: string, cwd = process.cwd()): Promise<void> {
  validateProfileName(name);
  if (name !== DEFAULT_PROFILE && !existsSync(join(profilesRoot(cwd), name))) {
    throw new Error(`Profile "${name}" does not exist. Create it first with: muster profile create ${name}`);
  }
  await mkdir(musterRoot(cwd), { recursive: true });
  await writeFile(profilePointerPath(cwd), `${name}\n`);
}

/**
 * Per-profile HOME for subprocess credential isolation: tools that shell out
 * (git/ssh/npm) get this as HOME so credentials can never leak across
 * profiles. Default profile uses .muster/home.
 */
export function profileHomeDir(cwd = process.cwd(), profile = activeProfile(cwd)): string {
  if (profile === DEFAULT_PROFILE) return join(musterRoot(cwd), "home");
  return join(profilesRoot(cwd), profile, "home");
}

export function subprocessEnvForProfile(cwd = process.cwd()): Record<string, string> {
  return { HOME: profileHomeDir(cwd), PATH: process.env.PATH ?? "" };
}

/**
 * The execution cwd for a native provider CLI (codex/claude). This is the
 * sandbox root the provider agent reads/writes within, and where its native
 * config is discovered (.claude/commands, AGENTS.md / prompts). It is kept
 * SEPARATE from the muster state root (where .muster/ lives) so a Telegram
 * user driving the agent can never reach the muster install root, gateway
 * token, or other profiles' configs — the cwd-escape we found live.
 * Default profile uses .muster/workspace.
 */
export function profileWorkspaceDir(cwd = process.cwd(), profile = activeProfile(cwd)): string {
  if (profile === DEFAULT_PROFILE) return join(musterRoot(cwd), "workspace");
  return join(profilesRoot(cwd), profile, "workspace");
}

/**
 * Clone personality + knowledge WITHOUT history: copies config, memory, and
 * skills; never sessions, episodes, or token ledgers.
 */
export async function cloneProfile(from: string, to: string, cwd = process.cwd()): Promise<void> {
  validateProfileName(to);
  if (to === DEFAULT_PROFILE) throw new Error("Cannot clone onto the default profile.");
  if (from !== DEFAULT_PROFILE && !existsSync(join(profilesRoot(cwd), from))) {
    throw new Error(`Source profile "${from}" does not exist.`);
  }
  if (existsSync(join(profilesRoot(cwd), to))) {
    throw new Error(`Profile "${to}" already exists; choose a new name.`);
  }
  const { cp, mkdir: mkdirAsync } = await import("node:fs/promises");
  const sourceData = profileDataDir(cwd, from);
  const sourceConfig = profileConfigPath(cwd, from);
  const targetRoot = join(profilesRoot(cwd), to);
  await mkdirAsync(join(targetRoot, "data"), { recursive: true });
  await mkdirAsync(join(targetRoot, "home"), { recursive: true });
  const copies: Array<[string, string]> = [
    [sourceConfig, join(targetRoot, "config.json")],
    [join(sourceData, "memory.jsonl"), join(targetRoot, "data", "memory.jsonl")],
    [join(musterRoot(cwd), "skills"), join(targetRoot, "skills")],
  ];
  for (const [source, target] of copies) {
    try {
      await cp(source, target, { recursive: true });
    } catch {
      // missing pieces (no memory yet, no skills yet) are fine
    }
  }
}
