import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { THEME_PRESETS, DEFAULT_THEME_PRESET } = await jiti.import("../hooks/useTheme.ts");

test("SettingsConfig defines search indexing and controls for appearance and color presets", async () => {
  const source = await readFile(new URL("./SettingsConfig.tsx", import.meta.url), "utf8");

  assert.match(source, /id:\s*"appearance"/);
  assert.match(source, /id:\s*"color-theme"/);
  assert.match(source, /searchId="appearance"/);
  assert.match(source, /data-search-id="color-theme"/);
  assert.match(source, /ThemePresetSetting/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio"/);

  assert.equal(THEME_PRESETS.length, 6);
  assert.equal(THEME_PRESETS[0].id, DEFAULT_THEME_PRESET);
  for (const preset of THEME_PRESETS) {
    assert.ok(preset.name, `Preset ${preset.id} must have a display name`);
    assert.ok(preset.preview.light.bg, `Preset ${preset.id} must define light preview background`);
    assert.ok(preset.preview.dark.bg, `Preset ${preset.id} must define dark preview background`);
  }
});
