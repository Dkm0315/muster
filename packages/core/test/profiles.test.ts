import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activeProfile,
  addMemory,
  createProfile,
  defaultConfig,
  listMemory,
  listProfiles,
  loadConfig,
  profileDataDir,
  profilesRoot,
  saveConfig,
  useProfile,
  validateProfileName,
} from "../src/index.js";

test("default profile resolves to the legacy data directory for backwards compatibility", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-"));
  assert.equal(activeProfile(cwd), "default");
  assert.equal(profileDataDir(cwd), join(cwd, ".muster", "data"));
});

test("profiles isolate memory completely", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-iso-"));
  await createProfile("tenant-a", cwd);
  await createProfile("tenant-b", cwd);

  await useProfile("tenant-a", cwd);
  await addMemory({
    summary: "tenant-a secret roadmap",
    provenance: ["test"],
    scopes: [{ kind: "tenant", id: "a" }],
  }, cwd);

  await useProfile("tenant-b", cwd);
  const tenantBMemory = await listMemory(cwd);
  assert.equal(tenantBMemory.length, 0, "profile B must not see profile A memory");

  await useProfile("tenant-a", cwd);
  const tenantAMemory = await listMemory(cwd);
  assert.equal(tenantAMemory.length, 1);
});

test("profile listing includes default plus created profiles, sorted", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-list-"));
  await createProfile("zeta", cwd);
  await createProfile("alpha", cwd);
  assert.deepEqual(await listProfiles(cwd), ["alpha", "default", "zeta"]);
});

test("useProfile refuses profiles that do not exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-missing-"));
  await assert.rejects(() => useProfile("ghost", cwd), /does not exist/);
});

test("profile names are validated strictly", () => {
  assert.throws(() => validateProfileName("Bad Name"), /Invalid profile name/);
  assert.throws(() => validateProfileName("UPPER"), /Invalid profile name/);
  assert.throws(() => validateProfileName(""), /Invalid profile name/);
  assert.doesNotThrow(() => validateProfileName("oxygen-hr-uat"));
});

test("config writes isolate per profile and never leak into the shared default", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-config-"));
  // Baseline shared default config.
  await saveConfig(defaultConfig(), cwd);

  await createProfile("alpha", cwd);
  await useProfile("alpha", cwd);

  // Customize the alpha profile's config with a provider only it should have.
  const base = defaultConfig();
  await saveConfig(
    { ...base, providers: { ...base.providers, alphaonly: { id: "alphaonly", kind: "codex-cli", defaultModel: "x", timeoutMs: 1000 } } },
    cwd,
  );

  // The scoped config must now exist (was the bug: it never did, so writes hit the shared config).
  assert.ok(existsSync(join(profilesRoot(cwd), "alpha", "config.json")), "scoped config.json is created on write");

  // alpha sees its own provider...
  await useProfile("alpha", cwd);
  assert.ok((await loadConfig(cwd)).providers.alphaonly, "alpha profile sees its own provider");

  // ...but the shared default is untouched (true isolation).
  await useProfile("default", cwd);
  assert.equal((await loadConfig(cwd)).providers.alphaonly, undefined, "default profile is not polluted by alpha's config");
});
