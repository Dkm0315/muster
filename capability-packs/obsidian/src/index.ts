import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ObsidianToolContext {
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface ObsidianError {
  readonly error: string;
  readonly hint?: string;
}

function stringArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : fallback;
}

function rawStringArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof args[name] === "string" ? String(args[name]) : fallback;
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function expandHome(value: string): string {
  return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function defaultVaultPath(): string {
  return join(homedir(), "Documents", "Obsidian Vault");
}

function vaultPath(args: Record<string, unknown>, context: ObsidianToolContext): string {
  return resolve(expandHome(stringArg(args, "vaultPath") || context.config.OBSIDIAN_VAULT_PATH || defaultVaultPath()));
}

function relativePathForNote(args: Record<string, unknown>): string | ObsidianError {
  const explicitPath = stringArg(args, "notePath");
  const notePath = explicitPath || titleToNotePath(stringArg(args, "title"));
  if (!notePath) return { error: 'obsidian tool requires "notePath" or "title".' };
  return explicitPath ? notePath : notePath.endsWith(".md") ? notePath : `${notePath}.md`;
}

function titleToNotePath(title: string): string {
  if (!title) return "";
  return `${title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()}.md`;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveInsideVault(vault: string, notePath: string): string | ObsidianError {
  const target = resolve(vault, notePath);
  if (!isInside(vault, target)) {
    return {
      error: "Obsidian note path escapes the configured vault.",
      hint: "Pass a vault-relative markdown path such as Notes/Idea.md. Absolute paths must still resolve inside the vault.",
    };
  }
  if (extname(target).toLowerCase() !== ".md") {
    return { error: "Obsidian note tools only operate on markdown .md files." };
  }
  return target;
}

async function ensureVault(vault: string): Promise<ObsidianError | undefined> {
  try {
    const info = await stat(vault);
    if (!info.isDirectory()) return { error: "Configured Obsidian vault path is not a directory.", hint: vault };
    return undefined;
  } catch {
    return {
      error: "Configured Obsidian vault path does not exist.",
      hint: `Set OBSIDIAN_VAULT_PATH or pass vaultPath. Muster follows Hermes's fallback: ${defaultVaultPath()}`,
    };
  }
}

async function walkMarkdown(root: string, maxFiles: number): Promise<string[]> {
  const results: string[] = [];
  async function visit(dir: string): Promise<void> {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(full);
        if (results.length >= maxFiles) return;
      }
    }
  }
  await visit(root);
  return results;
}

function noteSummary(vault: string, path: string, content?: string): Record<string, unknown> {
  return {
    path: relative(vault, path).split(sep).join("/"),
    title: basename(path, ".md"),
    ...(content === undefined ? {} : { preview: content.replace(/\s+/g, " ").trim().slice(0, 240) }),
  };
}

export async function obsidian_vault_status(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return { ...missing, vaultPath: vault } as ObsidianError & { vaultPath: string };
  const notes = await walkMarkdown(vault, 10000);
  return { vaultPath: vault, exists: true, noteCount: notes.length };
}

export async function obsidian_notes_list(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return missing;
  const limit = positiveLimit(args.limit, 50, 500);
  const files = await walkMarkdown(vault, limit);
  return { vaultPath: vault, notes: files.map((file) => noteSummary(vault, file)), truncated: files.length >= limit };
}

export async function obsidian_note_read(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return missing;
  const notePath = relativePathForNote(args);
  if (typeof notePath !== "string") return notePath;
  const target = resolveInsideVault(vault, notePath);
  if (typeof target !== "string") return target;
  try {
    return { vaultPath: vault, path: relative(vault, target).split(sep).join("/"), markdown: await readFile(target, "utf8") };
  } catch {
    return { error: "Obsidian note not found.", hint: relative(vault, target).split(sep).join("/") };
  }
}

export async function obsidian_notes_search(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return missing;
  const query = stringArg(args, "query").toLowerCase();
  if (!query) return { error: 'obsidian_notes_search requires "query".' };
  const limit = positiveLimit(args.limit, 20, 100);
  const files = await walkMarkdown(vault, 10000);
  const matches: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    const haystack = `${relative(vault, file)}\n${content}`.toLowerCase();
    if (!haystack.includes(query)) continue;
    matches.push(noteSummary(vault, file, content));
    if (matches.length >= limit) break;
  }
  return { vaultPath: vault, query, matches, truncated: matches.length >= limit };
}

export async function obsidian_note_create(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return missing;
  const notePath = relativePathForNote(args);
  if (typeof notePath !== "string") return notePath;
  const target = resolveInsideVault(vault, notePath);
  if (typeof target !== "string") return target;
  const markdown = rawStringArg(args, "markdown");
  if (!markdown) return { error: 'obsidian_note_create requires "markdown".' };
  if (args.overwrite !== true) {
    try {
      await stat(target);
      return { error: "Obsidian note already exists.", hint: "Pass overwrite=true to replace it deliberately." };
    } catch {
      // expected for a new note
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return { vaultPath: vault, path: relative(vault, target).split(sep).join("/"), written: true };
}

export async function obsidian_note_append(
  args: Record<string, unknown>,
  context: ObsidianToolContext,
): Promise<Record<string, unknown> | ObsidianError> {
  const vault = vaultPath(args, context);
  const missing = await ensureVault(vault);
  if (missing) return missing;
  const notePath = relativePathForNote(args);
  if (typeof notePath !== "string") return notePath;
  const target = resolveInsideVault(vault, notePath);
  if (typeof target !== "string") return target;
  const markdown = rawStringArg(args, "markdown");
  if (!markdown) return { error: 'obsidian_note_append requires "markdown".' };
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    return { error: "Obsidian note not found.", hint: "Create the note first with obsidian_note_create." };
  }
  const separator = current.endsWith("\n") ? "" : "\n";
  await writeFile(target, `${current}${separator}${markdown.endsWith("\n") ? markdown : `${markdown}\n`}`, "utf8");
  return { vaultPath: vault, path: relative(vault, target).split(sep).join("/"), appended: true };
}

export const tools = {
  obsidian_vault_status,
  obsidian_notes_list,
  obsidian_note_read,
  obsidian_notes_search,
  obsidian_note_create,
  obsidian_note_append,
};
