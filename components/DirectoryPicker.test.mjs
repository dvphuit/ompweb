import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { buildBrowseQuery } = await jiti.import("./DirectoryPicker.tsx");

test("hidden folders are off by default and only requested when on", () => {
  // The initial listing sends no flag at all — the server default is off.
  assert.equal(buildBrowseQuery(undefined, false), "");
  assert.equal(buildBrowseQuery("/home/alex/project", false), "?path=%2Fhome%2Falex%2Fproject");
  // Opting in adds the flag and keeps the path.
  assert.equal(buildBrowseQuery(undefined, true), "?hidden=1");
  assert.equal(buildBrowseQuery("/home/alex/.dotfiles", true), "?path=%2Fhome%2Falex%2F.dotfiles&hidden=1");
});

test("the picker owns the toggle: default off, remembered, re-lists on change", async () => {
  const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

  // Off by default, and the state the checkbox is driven from.
  assert.match(source, /const \[showHidden, setShowHidden\] = useState\(false\);/);
  assert.match(source, /checked=\{showHidden\}/);
  // The stored preference is applied on mount (hydration-safe), not as an init.
  assert.match(source, /const stored = getShowHiddenDirectories\(\);/);
  assert.match(source, /setShowHiddenDirectories\(next\);/);
  // Flipping the option re-reads the folder on screen and keeps the typed path,
  // because the listing itself depends on the flag.
  assert.match(source, /keepPathInput: true/);
  // Raw listings include dot-prefixed folders; only this endpoint's split hides
  // them, so a hand-typed hidden path still validates and opens.
  assert.match(source, /setHiddenCount\(data\.hiddenCount \?\? 0\);/);
});

test("i18n: every directoryPicker key is translated in ja and zh-CN", async () => {
  const dicts = {};
  for (const locale of ["en", "ja", "zh-CN"]) {
    dicts[locale] = JSON.parse(await readFile(new URL(`../lib/i18n/locales/${locale}.json`, import.meta.url), "utf8"));
  }
  const keys = Object.keys(dicts.en).filter((key) => key.startsWith("directoryPicker."));
  assert.ok(keys.includes("directoryPicker.showHidden"), "missing the hidden-dirs label");
  assert.ok(keys.includes("directoryPicker.showHiddenHint"), "missing the hidden-dirs hint");
  assert.ok(keys.includes("directoryPicker.hiddenFolders.one"), "missing the singular hidden count");
  assert.ok(keys.includes("directoryPicker.hiddenFolders.other"), "missing the plural hidden count");
  for (const key of keys) {
    for (const locale of ["ja", "zh-CN"]) {
      assert.ok(dicts[locale][key], `Missing ${locale} translation for ${key}`);
    }
  }
  // Count interpolation drives the plural form.
  assert.match(dicts.en["directoryPicker.hiddenFolders.other"], /\{count\}/);
});
