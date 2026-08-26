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
