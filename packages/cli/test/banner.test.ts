import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBanner } from "../src/banner.js";

test("banner contains the MUSTER wordmark and tagline", () => {
  const out = renderBanner();
  assert.match(out, /█/, "block letters present");
  assert.match(out, /the agent harness you can audit/);
});

test("NO_COLOR yields plain text with no ANSI escapes", () => {
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const out = renderBanner();
    assert.ok(!out.includes("\x1b["), "no ANSI escapes under NO_COLOR");
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = prev;
  }
});
