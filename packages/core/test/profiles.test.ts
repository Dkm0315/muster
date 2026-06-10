import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activeProfile,
  addMemory,
  createProfile,
  listMemory,
  listProfiles,
  profileDataDir,
  useProfile,
  validateProfileName,
} from "../src/index.js";

test("default profile resolves to the legacy data directory for backwards compatibility", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-profiles-"));
  assert.equal(activeProfile(cwd), "default");
  assert.equal(profileDataDir(cwd), join(cwd, ".hybrowclaw", "data"));
});

test("profiles isolate memory completely", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-profiles-iso-"));
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
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-profiles-list-"));
  await createProfile("zeta", cwd);
  await createProfile("alpha", cwd);
  assert.deepEqual(await listProfiles(cwd), ["alpha", "default", "zeta"]);
});

test("useProfile refuses profiles that do not exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "hybrowclaw-profiles-missing-"));
  await assert.rejects(() => useProfile("ghost", cwd), /does not exist/);
});

test("profile names are validated strictly", () => {
  assert.throws(() => validateProfileName("Bad Name"), /Invalid profile name/);
  assert.throws(() => validateProfileName("UPPER"), /Invalid profile name/);
  assert.throws(() => validateProfileName(""), /Invalid profile name/);
  assert.doesNotThrow(() => validateProfileName("oxygen-hr-uat"));
});
