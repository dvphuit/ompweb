import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseAgentFrontmatter, writeAgent } = await jiti.import("./agents-service.ts");

const payload = { description: "A test agent", body: "Do the task." };

test("renaming an agent replaces the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omp-agents-test-"));
  try {
    writeAgent(dir, "Scout", payload);
    writeAgent(dir, "Renamed", payload, "Scout");
    const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
    assert.deepEqual(names, ["Renamed.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("allows symlinked ancestors but rejects a symlink scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-agents-scope-test-"));
  const target = join(root, "target");
  const alias = join(root, "alias");
  const scopeLink = join(root, "scope-link");
  try {
    await mkdir(target);
    await symlink(target, alias, "dir");
    const nested = join(alias, "nested");
    await mkdir(nested);
    writeAgent(nested, "scout", payload);
    assert.equal((await readdir(join(target, "nested"))).includes("scout.md"), true);
    await symlink(target, scopeLink, "dir");
    assert.throws(() => writeAgent(scopeLink, "other", payload), /regular directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses agent frontmatter with an optional UTF-8 BOM", () => {
  const parsed = parseAgentFrontmatter("\uFEFF---\nname: scout\ndescription: Test\n---\nPrompt");
  assert.equal(parsed.frontmatter.name, "scout");
  assert.equal(parsed.body, "Prompt");
});
