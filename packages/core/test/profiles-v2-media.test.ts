import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addMemory,
  cloneProfile,
  createProfile,
  extractMediaTags,
  listMemory,
  profileHomeDir,
  subprocessEnvForProfile,
  useProfile,
} from "../src/index.js";

test("profileHomeDir isolates subprocess credentials per profile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-home-"));
  assert.match(profileHomeDir(cwd), /\.muster\/home$/);
  await createProfile("work", cwd);
  await useProfile("work", cwd);
  assert.match(profileHomeDir(cwd), /profiles\/work\/home$/);
  const env = subprocessEnvForProfile(cwd);
  assert.equal(env.HOME, profileHomeDir(cwd));
  assert.ok(env.PATH);
  assert.equal(Object.keys(env).length, 2, "only HOME and PATH — no ambient secrets leak");
});

test("cloneProfile copies config and memory but never sessions or ledgers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-clone-"));
  await addMemory({ summary: "durable fact", provenance: ["t"], scopes: [{ kind: "user", id: "u" }] }, cwd);
  await mkdir(join(cwd, ".muster"), { recursive: true });
  await writeFile(join(cwd, ".muster", "config.json"), JSON.stringify({ version: 1, providers: {}, runtimes: {}, routing: { oneRuntimePerRun: true, defaultRuntime: "native", preferLocalForSensitive: true } }));
  await writeFile(join(cwd, ".muster", "data", "tokens.jsonl"), '{"runId":"x"}\n');

  await cloneProfile("default", "twin", cwd);
  await useProfile("twin", cwd);
  const memory = await listMemory(cwd);
  assert.equal(memory.length, 1, "memory cloned");
  const config = JSON.parse(await readFile(join(cwd, ".muster", "profiles", "twin", "config.json"), "utf8"));
  assert.equal(config.version, 1, "config cloned");
  await assert.rejects(() => readFile(join(cwd, ".muster", "profiles", "twin", "data", "tokens.jsonl")), /ENOENT/);
});

test("extractMediaTags strips MEDIA lines into attachments and keeps prose clean", () => {
  const raw = "Here is your report.\nMEDIA:/tmp/out/report.xlsx\nAnd a chart:\n  MEDIA: https://example.com/chart.png\nDone.";
  const extracted = extractMediaTags(raw);
  assert.equal(extracted.media.length, 2);
  assert.deepEqual(extracted.media.map((item) => item.name), ["report.xlsx", "chart.png"]);
  assert.ok(!extracted.text.includes("MEDIA:"));
  assert.match(extracted.text, /Here is your report\./);
  assert.match(extracted.text, /Done\./);
  const none = extractMediaTags("plain reply");
  assert.deepEqual(none, { text: "plain reply", media: [] });
});
