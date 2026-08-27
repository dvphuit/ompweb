import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { calculateMenuPosition, calculateSubmenuPosition } = await jiti.import("../../lib/context-menu-position.ts");

test("calculateMenuPosition: positions menu at click coordinates when within viewport", () => {
  const pos = calculateMenuPosition({
    clickX: 100,
    clickY: 150,
    menuWidth: 200,
    menuHeight: 180,
    viewportWidth: 1024,
    viewportHeight: 768,
    padding: 8,
  });

  assert.equal(pos.x, 100);
  assert.equal(pos.y, 150);
  assert.equal(pos.flippedX, false);
  assert.equal(pos.flippedY, false);
});

test("calculateMenuPosition: flips / shifts on right edge collision", () => {
  const pos = calculateMenuPosition({
    clickX: 950,
    clickY: 100,
    menuWidth: 200,
    menuHeight: 150,
    viewportWidth: 1000,
    viewportHeight: 800,
    padding: 8,
  });

  assert.equal(pos.flippedX, true);
  assert.equal(pos.x, 750); // 950 - 200
  assert.equal(pos.y, 100);
});

test("calculateMenuPosition: flips / shifts on bottom edge collision", () => {
  const pos = calculateMenuPosition({
    clickX: 200,
    clickY: 700,
    menuWidth: 180,
    menuHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 750,
    padding: 10,
  });

  assert.equal(pos.flippedY, true);
  assert.equal(pos.x, 200);
  assert.equal(pos.y, 500); // 700 - 200
});

test("calculateMenuPosition: handles bottom-right corner collision simultaneously", () => {
  const pos = calculateMenuPosition({
    clickX: 980,
    clickY: 740,
    menuWidth: 200,
    menuHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 800,
    padding: 8,
  });

  assert.equal(pos.flippedX, true);
  assert.equal(pos.flippedY, true);
  assert.equal(pos.x, 780);
  assert.equal(pos.y, 540);
});

test("calculateMenuPosition: clamps to padding on very small viewports", () => {
  const pos = calculateMenuPosition({
    clickX: 5,
    clickY: 5,
    menuWidth: 300,
    menuHeight: 300,
    viewportWidth: 250,
    viewportHeight: 250,
    padding: 10,
  });

  assert.equal(pos.x, 10);
  assert.equal(pos.y, 10);
});

test("calculateSubmenuPosition: opens to the right of parent rect by default", () => {
  const parentRect = { left: 100, top: 200, right: 300, bottom: 230 };
  const pos = calculateSubmenuPosition({
    parentRect,
    submenuWidth: 180,
    submenuHeight: 140,
    viewportWidth: 1000,
    viewportHeight: 800,
    padding: 8,
  });

  assert.equal(pos.x, 302); // right + 2
  assert.equal(pos.y, 196); // top - 4
  assert.equal(pos.flippedX, false);
  assert.equal(pos.flippedY, false);
});

test("calculateSubmenuPosition: flips to the left when right side overflows", () => {
  const parentRect = { left: 850, top: 200, right: 980, bottom: 230 };
  const pos = calculateSubmenuPosition({
    parentRect,
    submenuWidth: 180,
    submenuHeight: 140,
    viewportWidth: 1000,
    viewportHeight: 800,
    padding: 8,
  });

  assert.equal(pos.flippedX, true);
  assert.equal(pos.x, 668); // parentRect.left - submenuWidth - 2 = 850 - 180 - 2
});

test("calculateSubmenuPosition: shifts up when bottom overflows", () => {
  const parentRect = { left: 100, top: 700, right: 300, bottom: 730 };
  const pos = calculateSubmenuPosition({
    parentRect,
    submenuWidth: 180,
    submenuHeight: 150,
    viewportWidth: 1000,
    viewportHeight: 800,
    padding: 10,
  });

  assert.equal(pos.flippedY, true);
  assert.equal(pos.y, 640); // viewportHeight - submenuHeight - padding = 800 - 150 - 10
});

test("i18n: all contextMenu keys exist across en, ja, and zh-CN", () => {
  const en = JSON.parse(readFileSync(new URL("../../lib/i18n/locales/en.json", import.meta.url), "utf-8"));
  const ja = JSON.parse(readFileSync(new URL("../../lib/i18n/locales/ja.json", import.meta.url), "utf-8"));
  const zh = JSON.parse(readFileSync(new URL("../../lib/i18n/locales/zh-CN.json", import.meta.url), "utf-8"));

  const contextMenuKeys = Object.keys(en).filter((k) => k.startsWith("contextMenu."));

  assert.ok(contextMenuKeys.length >= 25, `Expected at least 25 contextMenu keys, found ${contextMenuKeys.length}`);

  for (const key of contextMenuKeys) {
    assert.ok(ja[key], `Missing ja translation for ${key}`);
    assert.ok(zh[key], `Missing zh-CN translation for ${key}`);
  }
});
