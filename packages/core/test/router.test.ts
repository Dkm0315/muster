import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig, planRun } from "../src/index.js";

test("planRun chooses one runtime and classifies architecture prompts", () => {
  const config = defaultConfig();
  const plan = planRun(config, {
    prompt: "Design the architecture for a universal AI harness"
  });

  assert.equal(plan.runtimeId, "native");
  assert.equal(plan.taskKind, "architecture");
  assert.equal(plan.route.provider, "codex");
  assert.equal(plan.route.reasoning, "high");
});

test("sensitive prompts stay on configured Codex default unless local is explicitly configured", () => {
  const config = defaultConfig();
  const plan = planRun(config, {
    prompt: "Analyze these private customer logs",
    sensitive: true
  });

  assert.equal(plan.runtimeId, "native");
  assert.equal(plan.sensitive, true);
  assert.equal(plan.route.provider, "codex");
});

test("planRun rejects routes that reference missing providers", () => {
  const config = defaultConfig();
  const broken = {
    ...config,
    runtimes: {
      ...config.runtimes,
      native: {
        ...config.runtimes.native,
        routes: {
          ...config.runtimes.native.routes,
          architecture: {
            provider: "missing",
            model: "ghost-model",
            reasoning: "high" as const
          }
        }
      }
    }
  };

  assert.throws(
    () =>
      planRun(broken, {
        prompt: "Design the architecture"
      }),
    /missing provider/
  );
});
