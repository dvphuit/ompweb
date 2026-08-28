import { comparableProjectPath } from "./comparable-path";
import type { ManagedProject, SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

// ============================================================================
// Pure ordering/grouping helpers shared between the sidebar and unit tests.
// All keys are canonical projectRoot paths (worktrees collapse into their main
// repo via resolveProject), so worktree sessions group under their project.
// ============================================================================

/** Sort projects by explicit order, registration time, then path. */
export function sortManagedProjects(projects: ManagedProject[]): ManagedProject[] {
  return [...projects].sort((a, b) => {
    const aManual = a.sortOrder !== undefined;
    const bManual = b.sortOrder !== undefined;
    if (aManual !== bManual) return aManual ? -1 : 1;
    if (aManual && bManual && a.sortOrder !== b.sortOrder) return a.sortOrder! - b.sortOrder!;
    const aHas = a.addedAt !== undefined;
    const bHas = b.addedAt !== undefined;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      const byAdded = b.addedAt!.localeCompare(a.addedAt!);
      if (byAdded !== 0) return byAdded;
    }
    return a.path.localeCompare(b.path);
  });
}

export interface SidebarSessionIndex {
  byId: ReadonlyMap<string, SessionInfo>;
  projectRootByComparableCwd: ReadonlyMap<string, string>;
  projectKeyBySessionId: ReadonlyMap<string, string>;
  sessionsByProjectKey: ReadonlyMap<string, readonly SessionInfo[]>;
}

/** Build all session lookup maps in one source-order pass. */
export function buildSidebarSessionIndex(sessions: readonly SessionInfo[]): SidebarSessionIndex {
  const byId = new Map<string, SessionInfo>();
  const projectRootByComparableCwd = new Map<string, string>();
  const projectKeyBySessionId = new Map<string, string>();
  const buckets = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const workspace = workspaceKeyOf(session);
    const projectKey = workspace ? comparableProjectPath(session.projectKey ?? workspace) : "";
    if (!byId.has(session.id)) byId.set(session.id, session);
    if (session.cwd && !projectRootByComparableCwd.has(comparableProjectPath(session.cwd))) {
      projectRootByComparableCwd.set(comparableProjectPath(session.cwd), session.projectRoot ?? session.cwd);
    }
    if (session.id && projectKey && !projectKeyBySessionId.has(session.id)) projectKeyBySessionId.set(session.id, projectKey);
    if (projectKey) {
      const bucket = buckets.get(projectKey);
      if (bucket) bucket.push(session);
      else buckets.set(projectKey, [session]);
    }
  }
  return {
    byId,
    projectRootByComparableCwd,
    projectKeyBySessionId,
    sessionsByProjectKey: buckets,
  };
}

/** Running/unread session counts per indexed project. */
export function projectActivityCounts(
  index: SidebarSessionIndex,
  runningIds: Iterable<string>,
  unreadIds: Iterable<string>,
): Map<string, { running: number; unread: number }> {
  const result = new Map<string, { running: number; unread: number }>();
  for (const key of index.sessionsByProjectKey.keys()) result.set(key, { running: 0, unread: 0 });
  const tally = (ids: Iterable<string>, field: "running" | "unread") => {
    for (const id of ids) {
      const key = index.projectKeyBySessionId.get(id);
      if (!key) continue;
      const counts = result.get(key);
      if (counts) counts[field] += 1;
    }
  };
  tally(runningIds, "running");
  tally(unreadIds, "unread");
  return result;
}

/** Group indexed sessions under exact project paths, preserving source order.
 * A session whose canonical project key is not comparable to a project path
 * still gets the same exact-key fallback as the former array implementation. */
export function groupSessionsByProject(
  projects: readonly ManagedProject[],
  index: SidebarSessionIndex,
): Map<string, SessionInfo[]> {
  const grouped = new Map<string, SessionInfo[]>();
  const bucketByKey = new Map<string, SessionInfo[]>();
  for (const project of projects) {
    const bucket: SessionInfo[] = [];
    grouped.set(project.path, bucket);
    bucketByKey.set(comparableProjectPath(project.path), bucket);
  }
  for (const [key, sessions] of index.sessionsByProjectKey) {
    const bucket = bucketByKey.get(key) ?? grouped.get(key);
    if (bucket) bucket.push(...sessions);
  }
  return grouped;
}
