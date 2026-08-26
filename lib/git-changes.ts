import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

function parseNumstatZ(output: string): Map<string, { insertions: number; deletions: number }> {
  const map = new Map<string, { insertions: number; deletions: number }>();
  const parts = output.split("\0");
  for (let i = 0; i < parts.length; ) {
    const header = parts[i];
    if (!header) {
      i++;
      continue;
    }
    const tab1 = header.indexOf("\t");
    const tab2 = header.indexOf("\t", tab1 + 1);
    if (tab1 === -1 || tab2 === -1) {
      i++;
      continue;
    }
    const insStr = header.slice(0, tab1);
    const delStr = header.slice(tab1 + 1, tab2);
    let filePath = header.slice(tab2 + 1);
    const isBinary = insStr === "-" || delStr === "-";
    if (filePath === "") {
      const oldPath = parts[i + 1] ?? "";
      const newPath = parts[i + 2] ?? "";
      filePath = newPath || oldPath;
      if (!isBinary && filePath) {
        const ins = Number(insStr);
        const del = Number(delStr);
        if (Number.isFinite(ins) && Number.isFinite(del)) map.set(filePath, { insertions: ins, deletions: del });
      }
      i += 3;
    } else {
      if (!isBinary) {
        const ins = Number(insStr);
        const del = Number(delStr);
        if (Number.isFinite(ins) && Number.isFinite(del)) map.set(filePath, { insertions: ins, deletions: del });
      }
      i++;
    }
  }
  return map;
}

async function readNumstatMap(repositoryRoot: string): Promise<Map<string, { insertions: number; deletions: number }>> {
  try {
    const output = await git(repositoryRoot, ["diff", "HEAD", "--numstat", "-z"]);
    return parseNumstatZ(output);
  } catch {
    try {
      const outCached = await git(repositoryRoot, ["diff", "--cached", "--numstat", "-z"]);
      const outUnstaged = await git(repositoryRoot, ["diff", "--numstat", "-z"]);
      const cached = parseNumstatZ(outCached);
      const unstaged = parseNumstatZ(outUnstaged);
      const merged = new Map<string, { insertions: number; deletions: number }>();
      for (const [k, v] of cached) merged.set(k, v);
      for (const [k, v] of unstaged) {
        const prev = merged.get(k);
        if (prev) merged.set(k, { insertions: prev.insertions + v.insertions, deletions: prev.deletions + v.deletions });
        else merged.set(k, v);
      }
      return merged;
    } catch {
      return new Map();
    }
  }
}

function countFileInsertions(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return undefined;
    const buffer = fs.readFileSync(filePath);
    if (hasNullByte(buffer)) return undefined;
    const content = buffer.toString("utf8");
    if (content.length === 0) return 0;
    const lines = content.split("\n");
    return content.endsWith("\n") ? lines.length - 1 : lines.length;
  } catch {
    return undefined;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return { isGitRepository: false, repositoryRoot: null, files: [] };
  }

  const [entries, numstatMap] = await Promise.all([
    readStatusEntries(repositoryRoot),
    readNumstatMap(repositoryRoot),
  ]);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    const gitPath = toGitPath(path.relative(repositoryRoot, filePath));
    let insertions: number | undefined;
    let deletions: number | undefined;
    const numstat = numstatMap.get(entry.path) ?? numstatMap.get(gitPath);
    if (numstat) {
      insertions = numstat.insertions;
      deletions = numstat.deletions;
    } else if (classified.status === "untracked" || classified.status === "added") {
      const counted = countFileInsertions(filePath);
      if (counted !== undefined) {
        insertions = counted;
        deletions = 0;
      }
    }
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      ...(insertions !== undefined ? { insertions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
    }];
  });

  return { isGitRepository: true, repositoryRoot, files };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}
