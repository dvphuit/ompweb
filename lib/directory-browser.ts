import * as fsPromises from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(getWindowsDriveCandidates().map(async (drive) => {
    try {
      const driveStat = await fsPromises.stat(drive.path);
      return driveStat.isDirectory() ? drive : null;
    } catch {
      return null;
    }
  }));
  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/")) return path.resolve(homedir(), directory.slice(2));
  return path.resolve(directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = /^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
    ? path.win32
    : directory.startsWith("/") ? path.posix : path;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  return fsPromises.realpath(normalizeDirectory(directory));
}

/**
 * A directory whose name starts with `.` is a hidden (dot-prefixed) entry on
 * every OS — `.git`, `.cache`, or a whole workspace like `~/projects/.secrets`.
 * `.` and `..` are path components rather than listings, so they never match.
 */
export function isHiddenDirectoryName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

/**
 * Query-param form of the "show hidden folders" toggle. Anything besides the
 * truthy spellings — including a missing parameter — keeps hidden directories
 * out of the listing, so the picker defaults to `false`.
 */
export function parseShowHiddenParam(value: string | null | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export interface DirectoryListing {
  /** Entries the caller should render, already sorted by name. */
  directories: BrowsableDirectory[];
  /** Dot-prefixed entries left out of `directories` (0 when showing hidden). */
  hiddenCount: number;
}

/**
 * Split a raw listing by the picker's "hidden dirs (`. prefix`)" option. The
 * count is returned alongside the visible entries so the UI can hint that more
 * folders exist behind the toggle without a second filesystem walk.
 */
export function partitionHiddenDirectories(
  entries: readonly BrowsableDirectory[],
  includeHidden: boolean,
): DirectoryListing {
  if (includeHidden) return { directories: [...entries], hiddenCount: 0 };
  const directories = entries.filter((entry) => !isHiddenDirectoryName(entry.name));
  return { directories, hiddenCount: entries.length - directories.length };
}

/**
 * Raw listing of readable subdirectories, hidden (dot-prefixed) ones included.
 * Whether they reach the UI is the caller's decision — see
 * `partitionHiddenDirectories`.
 */
export async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  // Keep the directory argument opaque to Next's NFT build tracer. This is a
  // user-selected path and must only be inspected at request time; tracing it
  // as a static glob would walk the entire Windows profile during `next build`.
  const readDirectory = Reflect.get(fsPromises, "readdir") as typeof fsPromises.readdir;
  const entries = await readDirectory(directory, { withFileTypes: true });
  // Skip broken, inaccessible, or non-directory symlinks.
  const candidates = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return { name: entry.name, path: path.join(directory, entry.name) };
    }
    if (!entry.isSymbolicLink()) return null;

    try {
      const entryPath = path.join(directory, entry.name);
      const realEntryPath = await fsPromises.realpath(entryPath);
      const entryStat = await fsPromises.stat(realEntryPath);
      if (!entryStat.isDirectory()) return null;
      return { name: entry.name, path: entryPath };
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((entry): entry is BrowsableDirectory => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
