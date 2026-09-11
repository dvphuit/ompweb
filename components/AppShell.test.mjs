import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("top bar surfaces selected model output capacity without provider quota claims", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /modelCapacity?.maxTokens/);
  assert.match(source, /tooltipMaxOutput/);
  assert.doesNotMatch(source, /provider quota|remaining allowance|reset time/i);
});

test("session info popover uses a viewport-bounded responsive layout", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /min\(720px, calc\(100vw - 24px\)\)/);
  assert.match(source, /className="session-info-layout"/);
  assert.match(source, /\.session-info-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
  assert.doesNotMatch(source, /\.session-info-layout\s*\{[^}]*grid-template-columns:[^;}]*1\.25fr/s);
  assert.match(source, /\.session-info-identity-row dd\s*\{[^}]*overflow-wrap: anywhere;/s);
});

test("session info popover renders colored metric cards without wrapping counts", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /const metricCard = \(title: string, sectionRows: MetricRow\[\]\)/);
  assert.match(source, /\[\.\.\.tokenRows, \.\.\.extraTokenRows\]/);
  assert.match(source, /className="session-info-layout"/);
});

test("top bar renders 3-zone layout with center breadcrumb and a unified status cluster", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /className="shell-topbar-breadcrumb"/);
  assert.match(source, /className="shell-metric-pill/);
  assert.match(source, /activeTopPanel === "status"/);
  assert.doesNotMatch(source, /toggleTopPanel\("(usage|session)"\)/);
});

test("sidebar drag scales pointer deltas by the interface zoom", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // clientX is viewport pixels while --sidebar-width is zoomed layout pixels;
  // without the correction the edge overshoots at 110/120% scale.
  assert.match(source, /--ui-scale/);
  assert.match(source, /\(ev\.clientX - startX\) \/ uiScale/);
});
