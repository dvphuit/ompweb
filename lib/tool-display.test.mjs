import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./tool-display.ts");
}

test("normalizeToolKey trims, lowercases and strips suffixes", async () => {
  const { normalizeToolKey } = await loadSubject();
  assert.equal(normalizeToolKey("  Read  "), "read");
  assert.equal(normalizeToolKey("bash (local)"), "bash");
  assert.equal(normalizeToolKey("mcp__read"), "read");
  assert.equal(normalizeToolKey("my.read"), "read");
  assert.equal(normalizeToolKey("path/to/read"), "read");
  assert.equal(normalizeToolKey("tool:read"), "read");
  assert.equal(normalizeToolKey("call_123|fc_456"), "call_123");
  assert.equal(normalizeToolKey("  GREP  "), "grep");
  assert.equal(normalizeToolKey(""), "");
  assert.equal(normalizeToolKey("  "), "");
});

test("normalizeToolKey handles nested separators", async () => {
  const { normalizeToolKey } = await loadSubject();
  assert.equal(normalizeToolKey("a.b/c:d__e|f (local)"), "e");
  assert.equal(normalizeToolKey("MCP__BASH"), "bash");
});

test("getToolDisplay maps known tools to correct var and icon", async () => {
  const { getToolDisplay } = await loadSubject();
  assert.deepEqual(getToolDisplay("read"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("READ"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("cat"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("write"), { iconName: "FilePlus", varName: "--tool-write" });
  assert.deepEqual(getToolDisplay("edit"), { iconName: "Pencil", varName: "--tool-edit" });
  assert.deepEqual(getToolDisplay("apply_patch"), { iconName: "Pencil", varName: "--tool-edit" });
  assert.deepEqual(getToolDisplay("bash"), { iconName: "Terminal", varName: "--tool-bash" });
  assert.deepEqual(getToolDisplay("shell"), { iconName: "Terminal", varName: "--tool-bash" });
  assert.deepEqual(getToolDisplay("bash (local)"), { iconName: "Terminal", varName: "--tool-bash" });
  assert.deepEqual(getToolDisplay("grep"), { iconName: "Search", varName: "--tool-search" });
  assert.deepEqual(getToolDisplay("glob"), { iconName: "FolderSearch", varName: "--tool-search" });
  assert.deepEqual(getToolDisplay("find"), { iconName: "FolderSearch", varName: "--tool-search" });
  assert.deepEqual(getToolDisplay("ls"), { iconName: "FolderSearch", varName: "--tool-search" });
  assert.deepEqual(getToolDisplay("todo"), { iconName: "ListTodo", varName: "--tool-todo" });
  assert.deepEqual(getToolDisplay("task"), { iconName: "Bot", varName: "--tool-task" });
  assert.deepEqual(getToolDisplay("ask"), { iconName: "MessageCircleQuestion", varName: "--tool-ask" });
  assert.deepEqual(getToolDisplay("hub"), { iconName: "Plug", varName: "--tool-hub" });
  assert.deepEqual(getToolDisplay("mcp"), { iconName: "Plug", varName: "--tool-hub" });
});

test("getToolDisplay handles mcp__ prefix and dot/slash/colon variants", async () => {
  const { getToolDisplay } = await loadSubject();
  assert.deepEqual(getToolDisplay("mcp__read"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("mcp__bash"), { iconName: "Terminal", varName: "--tool-bash" });
  assert.deepEqual(getToolDisplay("my.read"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("tool:grep"), { iconName: "Search", varName: "--tool-search" });
  assert.deepEqual(getToolDisplay("a/b/c__todo"), { iconName: "ListTodo", varName: "--tool-todo" });
});

test("getToolDisplay fallback for unknown tools", async () => {
  const { getToolDisplay } = await loadSubject();
  assert.deepEqual(getToolDisplay("unknown_tool_xyz"), { iconName: "Wrench", varName: "--tool-generic" });
  assert.deepEqual(getToolDisplay(""), { iconName: "Wrench", varName: "--tool-generic" });
});

test("getToolDisplay handles suffix _read and includes fallbacks", async () => {
  const { getToolDisplay } = await loadSubject();
  // suffix _read should map to read even with prefix
  assert.deepEqual(getToolDisplay("my_custom_read"), { iconName: "FileText", varName: "--tool-read" });
  assert.deepEqual(getToolDisplay("file_read"), { iconName: "FileText", varName: "--tool-read" });
  // includes fallbacks: e.g., write_file -> write
  assert.deepEqual(getToolDisplay("write_file"), { iconName: "FilePlus", varName: "--tool-write" });
  assert.deepEqual(getToolDisplay("my_edit_tool"), { iconName: "Pencil", varName: "--tool-edit" });
});

test("documents false-positive risk: credit contains edit", async () => {
  const { getToolDisplay } = await loadSubject();
  // Current logic uses key.includes("edit") → "credit" incorrectly maps to edit.
  // This test documents the gap; if fixed, update expectation to Wrench.
  const result = getToolDisplay("credit");
  // TODO: narrow includes to word boundaries to avoid this. Currently expects Pencil.
  assert.deepEqual(result, { iconName: "Pencil", varName: "--tool-edit" });
});
