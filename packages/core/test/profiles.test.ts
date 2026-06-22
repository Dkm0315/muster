import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activeProfile,
  addMemory,
  cloneProfile,
  createProfile,
  defaultConfig,
  listMemory,
  listProfiles,
  loadConfig,
  profileDataDir,
  profilesRoot,
  saveConfig,
  stateRoot,
  useProfile,
  validateProfileName,
} from "../src/index.js";

test("default profile resolves to the legacy data directory for backwards compatibility", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-profiles-"));
  assert.equal(activeProfile(cwd), "default");
  assert.equal(profileDataDir(cwd), join(cwd, ".muster", "data"));
});

test("state root falls back to HOME when cwd is not writable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-unwritable-cwd-"));
  const home = await mkdtemp(join(tmpdir(), "muster-home-"));
  const priorHome = process.env.HOME;
  try {
    await chmod(cwd, 0o555);
    process.env.HOME = home;
    assert.equal(stateRoot(cwd), home);
    assert.equal(profileDataDir(cwd), join(home, ".muster", "data"));
  } finally {
    process.env.HOME = priorHome;
    await chmod(cwd, 0o755).catch(() => {});
  }
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

test("cloneProfile copies config + memory, is independent, and refuses overwrite / missing source", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "muster-clone-"));
  await saveConfig(defaultConfig(), cwd);
  await createProfile("src", cwd);
  await useProfile("src", cwd);
  const base = defaultConfig();
  await saveConfig(
    { ...base, providers: { ...base.providers, srconly: { id: "srconly", kind: "codex-cli", defaultModel: "x", timeoutMs: 1000 } } },
    cwd,
  );
  await addMemory({ summary: "CLONE_MARKER_42", provenance: ["test"], scopes: [{ kind: "user", id: "me" }] }, cwd);

  await cloneProfile("src", "dst", cwd);

  // the clone carries the source's config + memory
  await useProfile("dst", cwd);
  assert.ok((await loadConfig(cwd)).providers.srconly, "clone inherits source provider");
  assert.ok((await listMemory(cwd)).some((m) => m.summary.includes("CLONE_MARKER_42")), "clone inherits source memory");

  // editing the clone does not touch the source
  await saveConfig(
    { ...base, providers: { ...base.providers, dstonly: { id: "dstonly", kind: "codex-cli", defaultModel: "y", timeoutMs: 1 } } },
    cwd,
  );
  await useProfile("src", cwd);
  assert.equal((await loadConfig(cwd)).providers.dstonly, undefined, "source is unaffected by edits to the clone");

  // guards
  await assert.rejects(() => cloneProfile("src", "dst", cwd), /already exists/);
  await assert.rejects(() => cloneProfile("ghost", "newone", cwd), /does not exist/);
});
