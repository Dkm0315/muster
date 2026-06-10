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

export async function createProfile(name: string, cwd = process.cwd()): Promise<string> {
  validateProfileName(name);
  if (name === DEFAULT_PROFILE) throw new Error("The default profile always exists; no need to create it.");
  const dir = join(profilesRoot(cwd), name);
  await mkdir(join(dir, "data"), { recursive: true });
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
