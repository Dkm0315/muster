import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, loadCapabilityPack, parseFlow, runFlow } from "../src/index.js";
import type { CapabilityToolContext, FlowToolRegistry } from "../src/index.js";

const offlineConfig = defaultConfig();

const ENTRYPOINT_SOURCE = `export const tools = {
  greet: async (args, context) => ({
    message: "hello " + args.name,
    hasFetch: typeof context.fetch === "function",
    site: context.config.PACK_SITE_URL ?? null,
  }),
};
`;

async function writeFixturePack(overrides: Record<string, unknown> = {}, manifestName = "muster.capability.json"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "muster-pack-"));
  const digest = `sha256:${createHash("sha256").update(ENTRYPOINT_SOURCE).digest("hex")}`;
  const manifest = {
    schemaVersion: 1,
    id: "test-pack",
    name: "Test Pack",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "index.mjs",
    permissions: [],
    sandbox: "none",
    evals: ["evals/smoke.json"],
    digest,
    ...overrides,
  };
  await writeFile(join(dir, manifestName), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "index.mjs"), ENTRYPOINT_SOURCE);
  return dir;
}

test("loadCapabilityPack registers namespaced tools that run inside a flow", async () => {
  const dir = await writeFixturePack();
  const registry: FlowToolRegistry = {};
  const loaded = await loadCapabilityPack(dir, { registry });
  assert.equal(loaded.manifest.id, "test-pack");
  assert.deepEqual(loaded.toolNames, ["test-pack__greet"]);
  assert.equal(typeof registry["test-pack__greet"], "function");

  const cwd = await mkdtemp(join(tmpdir(), "muster-pack-flow-"));
  const flow = parseFlow({
    id: "pack-flow",
    steps: [
      { id: "greet", kind: "tool", tool: "test-pack__greet", args: { name: "dhairya" } },
      { id: "echoed", kind: "tool", tool: "test-pack__greet", args: { name: "{{greet.message}}" } },
    ],
  });
  const result = await runFlow(flow, { config: offlineConfig, registry, cwd });
  assert.equal(result.status, "completed");
  assert.equal((result.outputs.greet as { message: string }).message, "hello dhairya");
  assert.equal((result.outputs.echoed as { message: string }).message, "hello hello dhairya");
});

test("loadCapabilityPack accepts the manifest.json fallback name", async () => {
  const dir = await writeFixturePack({}, "manifest.json");
  const registry: FlowToolRegistry = {};
  const loaded = await loadCapabilityPack(dir, { registry });
  assert.deepEqual(loaded.toolNames, ["test-pack__greet"]);
});

test("loadCapabilityPack refuses invalid manifests with the inspector's blockers", async () => {
  const dir = await writeFixturePack({ id: "Bad Id", version: "not-semver" });
  await assert.rejects(loadCapabilityPack(dir, { registry: {} }), /blocked[\s\S]*kebab-case[\s\S]*semver/);
});

test("high-risk packs require the explicit allowHighRisk flag", async () => {
  const dir = await writeFixturePack({
    permissions: ["secrets"],
    sandbox: "workspace_write",
    secrets: ["PACK_SITE_URL"],
  });
  await assert.rejects(loadCapabilityPack(dir, { registry: {} }), /high-risk[\s\S]*--allow-high-risk/);

  const registry: FlowToolRegistry = {};
  const loaded = await loadCapabilityPack(dir, {
    registry,
    allowHighRisk: true,
    env: { PACK_SITE_URL: "https://example.test" },
  });
  assert.deepEqual(loaded.toolNames, ["test-pack__greet"]);
  const output = (await registry["test-pack__greet"]({ name: "x" })) as { site: string | null };
  assert.equal(output.site, "https://example.test", "declared secrets flow into context.config");
});

test("packs without the network permission get a context without fetch (contractual v1 enforcement)", async () => {
  const noNetwork = await writeFixturePack();
  const withNetwork = await writeFixturePack({ id: "net-pack", permissions: ["network"] });
  const registry: FlowToolRegistry = {};
  await loadCapabilityPack(noNetwork, { registry });
  await loadCapabilityPack(withNetwork, { registry });

  const offline = (await registry["test-pack__greet"]({ name: "a" })) as { hasFetch: boolean };
  assert.equal(offline.hasFetch, false, "no network permission -> no fetch in context");
  const online = (await registry["net-pack__greet"]({ name: "a" })) as { hasFetch: boolean };
  assert.equal(online.hasFetch, true, "network permission -> fetch handed in via context");
});

test("entrypoints without a tools record are refused", async () => {
  const dir = await writeFixturePack({ digest: undefined });
  await writeFile(join(dir, "index.mjs"), "export const notTools = {};\n");
  await assert.rejects(loadCapabilityPack(dir, { registry: {} }), /must export a non-empty `tools` record/);

  const dir2 = await writeFixturePack({ entrypoint: "bad.mjs", digest: undefined });
  await writeFile(join(dir2, "bad.mjs"), "export const tools = { \"bad-name!\": async () => ({}) };\n");
  await assert.rejects(loadCapabilityPack(dir2, { registry: {} }), /tool name "bad-name!"/);
});

test("the tool context is frozen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "muster-pack-frozen-"));
  await writeFile(join(dir, "muster.capability.json"), JSON.stringify({
    schemaVersion: 1,
    id: "frozen-pack",
    name: "Frozen Pack",
    version: "0.1.0",
    kind: "tool",
    entrypoint: "index.mjs",
    permissions: [],
    sandbox: "none",
  }));
  await writeFile(join(dir, "index.mjs"), `export const tools = {
  probe: async (_args, context) => ({ frozen: Object.isFrozen(context) && Object.isFrozen(context.config) }),
};
`);
  const registry: FlowToolRegistry = {};
  await loadCapabilityPack(dir, { registry });
  const output = (await registry["frozen-pack__probe"]({})) as { frozen: boolean };
  assert.equal(output.frozen, true);
});

test("plugin policy denies explicit deny entries before registration", async () => {
  const dir = await writeFixturePack();
  const registry: FlowToolRegistry = {};

  await assert.rejects(
    loadCapabilityPack(dir, {
      registry,
      pluginPolicy: {
        allow: ["test-pack"],
        deny: ["test-pack"],
      },
    }),
    /denied by plugins\.deny/,
  );

  assert.equal(registry["test-pack__greet"], undefined);
});

test("plugin policy allowlist blocks packs not explicitly allowed", async () => {
  const dir = await writeFixturePack();

  await assert.rejects(
    loadCapabilityPack(dir, {
      registry: {},
      pluginPolicy: {
        allow: ["other-pack"],
      },
    }),
    /not present in plugins\.allow/,
  );
});

test("plugin policy disabled entries block packs before import", async () => {
  const dir = await writeFixturePack();

  await assert.rejects(
    loadCapabilityPack(dir, {
      registry: {},
      pluginPolicy: {
        entries: {
          "test-pack": { enabled: false },
        },
      },
    }),
    /disabled by plugins\.entries/,
  );
});

test("plugin policy load paths constrain pack directories", async () => {
  const dir = await writeFixturePack();

  await assert.rejects(
    loadCapabilityPack(dir, {
      registry: {},
      pluginPolicy: {
        load: {
          paths: [join(tmpdir(), "different-pack-root")],
        },
      },
    }),
    /not present in plugins\.load\.paths/,
  );
});

test("plugin policy enforces exclusive slot ownership", async () => {
  const dir = await writeFixturePack({ slot: "memory" });
  const registry: FlowToolRegistry = {};
  const slotClaims: Record<string, string> = {};

  await assert.rejects(
    loadCapabilityPack(dir, {
      registry,
      pluginPolicy: {
        slots: {
          memory: "memory-core",
        },
      },
      slotClaims,
    }),
    /slot "memory" is assigned to "memory-core"/,
  );

  const loaded = await loadCapabilityPack(dir, {
    registry,
    pluginPolicy: {
      slots: {
        memory: "test-pack",
      },
    },
    slotClaims,
  });
  assert.deepEqual(loaded.toolNames, ["test-pack__greet"]);
  assert.deepEqual(slotClaims, { memory: "test-pack" });

  const rival = await writeFixturePack({ id: "rival-pack", slot: "memory" });
  await assert.rejects(
    loadCapabilityPack(rival, {
      registry,
      pluginPolicy: {
        slots: {
          memory: "rival-pack",
        },
      },
      slotClaims,
    }),
    /slot "memory" is already claimed by "test-pack"/,
  );
});

// type-level sanity: CapabilityToolContext is exported for pack authors
const _typeProbe: CapabilityToolContext = { config: {} };
void _typeProbe;
