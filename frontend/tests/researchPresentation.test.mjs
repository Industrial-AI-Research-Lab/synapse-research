import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAutoRefreshResearch } from "../src/app/research/researchPresentation.ts";

test("auto-refresh waits for a manual decision unless auto mode is on", () => {
  assert.equal(shouldAutoRefreshResearch("running"), true);
  assert.equal(shouldAutoRefreshResearch("awaiting_approval"), false);
  assert.equal(shouldAutoRefreshResearch("awaiting_approval", true), true);
  assert.equal(shouldAutoRefreshResearch("completed", true), false);
});
