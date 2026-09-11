import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./directory-picker-prefs.ts");
}

/** Install a fake `window` (only `localStorage` is read) for one test. */
async function withWindow(storage, run) {
  const previous = globalThis.window;
  globalThis.window = storage === null ? undefined : { localStorage: storage };
  try {
    await run();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("hidden folders stay hidden by default", async () => {
  const { getShowHiddenDirectories } = await loadSubject();
  await withWindow(fakeStore(), async () => {
    assert.equal(getShowHiddenDirectories(), false);
  });
});

test("the preference round-trips through storage", async () => {
  const { getShowHiddenDirectories, setShowHiddenDirectories } = await loadSubject();
  const store = fakeStore();
  await withWindow(store, async () => {
    setShowHiddenDirectories(true);
    assert.equal(getShowHiddenDirectories(), true);
    setShowHiddenDirectories(false);
    assert.equal(getShowHiddenDirectories(), false);
  });
  // Only the picker's own key is touched, never the rest of localStorage.
  assert.deepEqual([...store.data.keys()], ["omp-web:directory-picker-show-hidden"]);
});

test("unusable or unfamiliar storage falls back to the default", async () => {
  const { getShowHiddenDirectories, setShowHiddenDirectories } = await loadSubject();

  // SSR: no window at all.
  await withWindow(null, async () => {
    assert.equal(getShowHiddenDirectories(), false);
    setShowHiddenDirectories(true);
  });

  // Corrupt or unexpected values are not "on".
  await withWindow(fakeStore({ "omp-web:directory-picker-show-hidden": "maybe" }), async () => {
    assert.equal(getShowHiddenDirectories(), false);
  });

  // Private-mode storage that throws on every access.
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); },
  };
  await withWindow(blocked, async () => {
    assert.equal(getShowHiddenDirectories(), false);
    assert.doesNotThrow(() => setShowHiddenDirectories(true));
  });
});
