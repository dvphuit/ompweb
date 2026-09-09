import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DEFAULT_THEME_PRESET, THEME_PRESETS, nextThemePreference, normalizeThemePreset, resolveTheme } = await jiti.import("./useTheme.ts");

test("cycles explicit and system theme preferences", () => {
  assert.equal(nextThemePreference("light"), "dark");
  assert.equal(nextThemePreference("dark"), "system");
  assert.equal(nextThemePreference("system"), "light");
});

test("resolves system theme from the operating system preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("exposes unique color presets and falls back for invalid stored values", () => {
  assert.deepEqual(THEME_PRESETS.map((preset) => preset.id), ["signal", "coral", "mint", "electric"]);
  assert.equal(new Set(THEME_PRESETS.map((preset) => preset.id)).size, THEME_PRESETS.length);
  assert.equal(normalizeThemePreset("mint"), "mint");
  assert.equal(normalizeThemePreset("obsidian"), "electric");
  assert.equal(normalizeThemePreset("emerald"), "mint");
  assert.equal(normalizeThemePreset("ember"), "coral");
  assert.equal(normalizeThemePreset("unknown"), DEFAULT_THEME_PRESET);
  assert.equal(normalizeThemePreset(null), DEFAULT_THEME_PRESET);
  for (const preset of THEME_PRESETS) {
    assert.ok(preset.preview.light.bg);
    assert.ok(preset.preview.dark.bg);
    assert.ok(preset.preview.light.accent);
    assert.ok(preset.preview.dark.accent);
  }
});
