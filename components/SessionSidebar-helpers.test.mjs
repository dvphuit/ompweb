import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionTimeBucket } = await jiti.import("./SessionSidebar-helpers.ts");

// Fixed "now": a Wednesday noon local time, so day boundaries are stable
// regardless of the machine's timezone or DST.
const NOW = new Date(2026, 8, 9, 12, 0, 0, 0).getTime();
const iso = (date) => date.toISOString();
const at = (dayOffset, hour = 12, minute = 0) => {
  const d = new Date(2026, 8, 9 + dayOffset, hour, minute, 0, 0);
  return iso(d);
};

test("buckets same-calendar-day timestamps as today", () => {
  assert.equal(sessionTimeBucket(at(0, 0, 1), NOW), "today");
  assert.equal(sessionTimeBucket(at(0, 11, 59), NOW), "today");
  assert.equal(sessionTimeBucket(at(0, 23, 59), NOW), "today");
});

test("buckets yesterday across the midnight boundary", () => {
  assert.equal(sessionTimeBucket(at(-1, 0, 0), NOW), "yesterday");
  assert.equal(sessionTimeBucket(at(-1, 23, 59), NOW), "yesterday");
});

test("buckets 2-6 days ago as week, 7+ days as older", () => {
  assert.equal(sessionTimeBucket(at(-2), NOW), "week");
  assert.equal(sessionTimeBucket(at(-6, 23, 59), NOW), "week");
  assert.equal(sessionTimeBucket(at(-7, 0, 0), NOW), "older");
  assert.equal(sessionTimeBucket(at(-30), NOW), "older");
  assert.equal(sessionTimeBucket(at(-400), NOW), "older");
});

test("treats future and invalid timestamps defensively", () => {
  assert.equal(sessionTimeBucket(at(1), NOW), "today");
  assert.equal(sessionTimeBucket("not-a-date", NOW), "older");
  assert.equal(sessionTimeBucket("", NOW), "older");
});
