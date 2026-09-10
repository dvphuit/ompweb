import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ToolOutputBlock, countOutputLines, formatOutputSize } = await jiti.import("./MessageView-tool-output.tsx");

// Locale dictionaries resolve to English during SSR, but a missing key renders
// as the key itself — accept both so these tests track behavior, not wording.
const LINES = String.raw`(24 lines|messageView\.toolOutputLines\.other)`;
const EXPAND = String.raw`(Expand|messageView\.expand)`;

function lines(count, prefix = "line") {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

test("short output renders in full with copy and full-output actions", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: "line one\nline two",
    toolName: "read",
    status: "success",
  }));

  assert.match(html, /data-tool-output="true"/);
  assert.match(html, /line two/);
  // No preview state, so no expand/collapse control is offered.
  assert.doesNotMatch(html, /data-collapsed="true"/);
  assert.match(html, /tool-output-action/);
});

test("long output opens as a collapsed preview with line, size, exit, and duration metadata", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: lines(24),
    toolName: "bash",
    status: "success",
    exitCode: 0,
    duration: 3,
  }));

  assert.match(html, /data-collapsed="true"/);
  assert.match(html, new RegExp(LINES));
  assert.match(html, /(exit 0|messageView\.toolOutputExit)/);
  assert.match(html, /3s/);
  assert.match(html, /tool-output-status" data-status="success"/);
  // Preview keeps the first lines only…
  assert.match(html, /line 8/);
  assert.doesNotMatch(html, /line 9\b/);
  assert.doesNotMatch(html, /line 24/);
  // …and reports how much is hidden behind Expand.
  assert.match(html, new RegExp(String.raw`(\+16 more lines|messageView\.toolOutputMoreLines)`));
  assert.match(html, new RegExp(EXPAND));
});

test("failed output opens expanded but stays height-capped", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: lines(40, "error line"),
    toolName: "bash",
    status: "error",
    exitCode: 1,
  }));

  assert.match(html, /data-collapsed="false"/);
  assert.match(html, /data-error="true"/);
  assert.match(html, /tool-output-status" data-status="error"/);
  assert.match(html, /(exit 1|messageView\.toolOutputExit)/);
  // The whole payload is in the DOM; the cap is the body's max-height.
  assert.match(html, /error line 40/);
});

test("failed output without an explicit code reports exit 1", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: "boom",
    toolName: "bash",
    status: "error",
  }));

  assert.match(html, /(exit 1|messageView\.toolOutputExit)/);
});

test("running output shows no exit status", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: "partial output",
    toolName: "bash",
    status: "running",
  }));

  assert.match(html, /tool-output-status" data-status="running"/);
  assert.doesNotMatch(html, /exit /);
});

test("empty output renders the no-output placeholder", () => {
  const html = renderToStaticMarkup(React.createElement(ToolOutputBlock, {
    text: "",
    toolName: "bash",
    status: "success",
    isEmpty: true,
  }));

  assert.match(html, /(no output|messageView\.noOutput)/);
});

test("line counting and size formatting stay predictable", () => {
  assert.equal(countOutputLines(""), 0);
  assert.equal(countOutputLines("one"), 1);
  assert.equal(countOutputLines("one\ntwo\nthree"), 3);
  assert.equal(formatOutputSize(0), "0 B");
  assert.equal(formatOutputSize(512), "512 B");
  assert.equal(formatOutputSize(2048), "2.0 KB");
  assert.equal(formatOutputSize(5 * 1024 * 1024), "5.0 MB");
});
