import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  INITIAL_RUNTIME_CONTROLS,
  mergeRuntimeControls,
  runtimeControlPatch,
} = await jiti.import("./session-state.ts");

const fullState = {
  fastModeEnabled: true,
  fastModeActive: true,
  autoRetryEnabled: true,
  interruptMode: "wait",
  autoCompactionEnabled: false,
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
};

test("full projection preserves explicit values and omits absent fields", () => {
  assert.deepEqual(runtimeControlPatch(fullState, "full"), fullState);
  assert.deepEqual(runtimeControlPatch({ fastModeEnabled: false }, "full"), {
    fastModeEnabled: false,
    fastModeActive: undefined,
  });
});

test("fast projection clears activity and excludes unrelated controls", () => {
  assert.deepEqual(runtimeControlPatch({ fastModeActive: undefined, autoRetryEnabled: true }, "fast"), {
    fastModeActive: undefined,
  });
  assert.deepEqual(runtimeControlPatch({ fastModeEnabled: false, fastModeActive: false }, "fast"), {
    fastModeEnabled: false,
    fastModeActive: false,
  });
});

test("unchanged merge preserves identity while changes copy once", () => {
  const unchanged = mergeRuntimeControls(INITIAL_RUNTIME_CONTROLS, { autoRetryEnabled: false });
  assert.equal(unchanged, INITIAL_RUNTIME_CONTROLS);
  const changed = mergeRuntimeControls(INITIAL_RUNTIME_CONTROLS, { fastModeEnabled: true });
  assert.notEqual(changed, INITIAL_RUNTIME_CONTROLS);
  assert.deepEqual(changed, { ...INITIAL_RUNTIME_CONTROLS, fastModeEnabled: true });
});
