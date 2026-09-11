import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-web-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    try {
      await symlink(path.join(root, "project"), path.join(root, "linked-project"));
    } catch (error) {
      // Windows without Developer Mode/admin rights cannot create symlinks.
      if (error?.code === "EPERM") {
        t.skip("Creating symbolic links requires additional privileges on this platform");
        return;
      }
      throw error;
    }

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const { getBrowseStartDirectory, normalizeDirectory, resolveDirectory, shouldShowWindowsDrivePicker, getWindowsDriveCandidates } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.deepEqual(getWindowsDriveCandidates().at(0), { name: "A:", path: "A:\\" });
  assert.deepEqual(getWindowsDriveCandidates().at(-1), { name: "Z:", path: "Z:\\" });
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `omp-web-missing-${Date.now()}`)));
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});

test("classifies dot-prefixed directory names as hidden", async () => {
  const { isHiddenDirectoryName } = await loadSubject();

  assert.equal(isHiddenDirectoryName(".git"), true);
  assert.equal(isHiddenDirectoryName(".cache"), true);
  // A dotfile-style workspace whose whole name is the prefix.
  assert.equal(isHiddenDirectoryName(".omp"), true);
  assert.equal(isHiddenDirectoryName("project"), false);
  assert.equal(isHiddenDirectoryName("my.project"), false);
  // Path components, not listings.
  assert.equal(isHiddenDirectoryName("."), false);
  assert.equal(isHiddenDirectoryName(".."), false);
});

test("hidden dirs are omitted from the listing but counted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omp-web-browse-hidden-"));
  try {
    await mkdir(path.join(root, "project"));
    await mkdir(path.join(root, ".cache"));
    await mkdir(path.join(root, ".secrets"));

    const { listDirectories, partitionHiddenDirectories } = await loadSubject();
    const all = await listDirectories(root);
    // The raw listing keeps everything; the option decides what is shown.
    assert.deepEqual(all.map((entry) => entry.name), [".cache", ".secrets", "project"]);

    const off = partitionHiddenDirectories(all, false);
    assert.deepEqual(off.directories.map((entry) => entry.name), ["project"]);
    assert.equal(off.hiddenCount, 2);

    const on = partitionHiddenDirectories(all, true);
    assert.deepEqual(on.directories.map((entry) => entry.name), [".cache", ".secrets", "project"]);
    assert.equal(on.hiddenCount, 0);
    // The visible listing is a copy — filtering never mutates the caller's array.
    assert.notEqual(on.directories, all);
    assert.deepEqual(all.map((entry) => entry.name), [".cache", ".secrets", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the hidden-dirs query flag defaults to off", async () => {
  const { parseShowHiddenParam } = await loadSubject();

  // Missing / empty means the option's default.
  assert.equal(parseShowHiddenParam(null), false);
  assert.equal(parseShowHiddenParam(undefined), false);
  assert.equal(parseShowHiddenParam(""), false);
  assert.equal(parseShowHiddenParam("0"), false);
  assert.equal(parseShowHiddenParam("false"), false);
  // Anything a client or a hand-typed URL might reasonably send for "on".
  assert.equal(parseShowHiddenParam("1"), true);
  assert.equal(parseShowHiddenParam("true"), true);
  assert.equal(parseShowHiddenParam("yes"), true);
});
