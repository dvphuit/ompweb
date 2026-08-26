"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AtSign,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderTree,
  List,
  Loader2,
} from "lucide-react";
import { getFileIcon } from "./FileIcons";
import { Tooltip } from "./ui/primitives";
import { translate, useI18n } from "@/lib/i18n";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onRefreshDone?: () => void;
}

export interface FileExplorerHandle {
  openUploadPicker?: () => void;
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = translate("fileExplorer.loadFailed", { status: res.status });
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(translate("fileExplorer.gitStatusFailed", { status: res.status }));
  return res.json() as Promise<GitStatusResponse>;
}

const GIT_STATUS_LABEL_KEYS: Record<GitFileStatusKind, string> = {
  modified: "fileExplorer.gitModified",
  added: "fileExplorer.gitAdded",
  deleted: "fileExplorer.gitDeleted",
  renamed: "fileExplorer.gitRenamed",
  untracked: "fileExplorer.gitUntracked",
  conflict: "fileExplorer.gitConflict",
};

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--status-modified)",
  added: "var(--status-success)",
  deleted: "var(--status-error)",
  renamed: "var(--status-renamed)",
  untracked: "var(--status-success)",
  conflict: "var(--status-error)",
};


function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  staticMode,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  staticMode?: boolean;
}){
  const { t } = useI18n();
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (staticMode) {
      setChildren(node.children ?? []);
      setLoaded(node.loaded ?? true);
    }
  }, [node.children, node.loaded, staticMode]);

  const loadChildren = useCallback(async (force = false) => {
    if (staticMode) return;
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, staticMode]);

  // Re-fetch children when the tree refreshes. Open directories re-fetch in
  // place; collapsed directories are marked stale so the next expand re-fetches
  // instead of showing a listing captured before the refresh.
  useEffect(() => {
    if (staticMode) return;
    if (open) {
      if (loaded) loadChildren(true);
    } else {
      setLoaded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  // Keyboard activation (Enter/Space + Arrow navigation) for tree items
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    } else if (event.key === "ArrowRight") {
      if (node.isDir) {
        event.preventDefault();
        if (!open) {
          onToggleExpanded(node.fullPath, true);
          if (!loaded) loadChildren();
        } else {
          const next = event.currentTarget.parentElement?.querySelector<HTMLDivElement>('[role="group"] [role="treeitem"]');
          next?.focus();
        }
      }
    } else if (event.key === "ArrowLeft") {
      if (node.isDir && open) {
        event.preventDefault();
        onToggleExpanded(node.fullPath, false);
      } else {
        const parentTreeItem = event.currentTarget.closest('[role="group"]')?.parentElement?.querySelector<HTMLDivElement>(':scope > [role="treeitem"]');
        parentTreeItem?.focus();
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const tree = event.currentTarget.closest('[role="tree"]');
      if (!tree) return;
      const allItems = Array.from(tree.querySelectorAll<HTMLDivElement>('[role="treeitem"]'))
        .filter((item) => !item.closest('[inert]'));
      const idx = allItems.indexOf(event.currentTarget);
      if (idx !== -1) {
        const nextIdx = event.key === "ArrowDown" ? Math.min(allItems.length - 1, idx + 1) : Math.max(0, idx - 1);
        allItems[nextIdx]?.focus();
      }
    }
  }, [node.isDir, node.fullPath, open, loaded, loadChildren, onToggleExpanded, handleClick]);

  const mentionLabel = t("fileExplorer.insertPathIntoChat");

  return (
    <div>
      <div
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={(e) => { if (e.target === e.currentTarget) setFocused(true); }}
        onBlur={() => setFocused(false)}
        role="treeitem"
        tabIndex={0}
        aria-selected={highlighted}
        aria-expanded={node.isDir ? open : undefined}
        aria-label={node.isDir ? (node.name + " (folder" + (open ? ", expanded" : ", collapsed") + ")") : (node.name + " (file)")}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: "var(--radius-control)",
          userSelect: "none",
          boxShadow: focused ? "inset 0 0 0 1px color-mix(in srgb, var(--accent) 70%, transparent)" : "none",
          outline: "none",
          transition: `background var(--dur-fast) var(--ease-out-warm)`,
        }}
      >
        {node.isDir && (
          <ChevronRight
            size={10}
            strokeWidth={2}
            color="var(--text-dim)"
            style={{
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "none",
              transition: `transform var(--dur-med) var(--ease-out-warm)`,
            }}
            aria-hidden="true"
          />
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: node.isDir ? "var(--text-muted)" : "var(--text-dim)" }}>
          {node.isDir ? (
            open ? <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" /> : <Folder size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            getFileIcon(node.name, 14)
          )}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.fullPath}
        >
          {node.name}
        </span>
        {highlighted && (
          <span
            title={t("fileExplorer.newlyUploaded")}
            aria-label={t("fileExplorer.newlyUploaded")}
            style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: "var(--accent)" }}
          />
        )}
        {!hovered && !node.isDir && gitStatus && (
          <span
            title={`${t(GIT_STATUS_LABEL_KEYS[gitStatus.status])}${gitStatus.insertions !== undefined || gitStatus.deletions !== undefined ? ` (+${gitStatus.insertions ?? 0} -${gitStatus.deletions ?? 0})` : ""}`}
            aria-label={`${t(GIT_STATUS_LABEL_KEYS[gitStatus.status])}${gitStatus.insertions !== undefined || gitStatus.deletions !== undefined ? ` (+${gitStatus.insertions ?? 0} -${gitStatus.deletions ?? 0})` : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              flexShrink: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 14,
                textAlign: "center",
                color: GIT_STATUS_COLORS[gitStatus.status],
                fontSize: 11,
              }}
            >
              {gitStatus.code}
            </span>
            {(gitStatus.insertions !== undefined || gitStatus.deletions !== undefined) &&
              !(gitStatus.insertions === 0 && gitStatus.deletions === 0) && (
                <>
                  {gitStatus.insertions !== undefined && gitStatus.insertions > 0 && (
                    <span style={{ color: "var(--status-success)" }}>+{gitStatus.insertions}</span>
                  )}
                  {gitStatus.deletions !== undefined && gitStatus.deletions > 0 && (
                    <span style={{ color: "var(--status-error)" }}>-{gitStatus.deletions}</span>
                  )}
                </>
              )}
          </span>
        )}
        {!hovered && containsGitChanges && (
          <span
            title={t("fileExplorer.containsChangedFiles")}
            aria-label={t("fileExplorer.containsChangedFiles")}
            style={{
              width: 6,
              height: 6,
              flexShrink: 0,
              borderRadius: "50%",
              background: "var(--status-modified)",
            }}
          />
        )}
        {loading && (
          <Loader2 size={10} strokeWidth={2} color="var(--text-dim)" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true" />
        )}
        {onAtMention && hovered && (
          <Tooltip content={mentionLabel}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
              }}
              aria-label={mentionLabel}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "0 8px",
                height: 20,
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
                transition: `background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)`,
              }}
            >
              <AtSign size={11} strokeWidth={2.2} aria-hidden="true" />
              {t("fileExplorer.mention")}
            </button>
          </Tooltip>
        )}
      </div>
      {node.isDir && (
        <div role="group" inert={!open ? true : undefined} className={"accordion-flow " + (open ? "is-open" : "")}>
          <div className="accordion-flow-inner">
            {children.map((child) => (
              <TreeNode
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={onToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
                staticMode={staticMode}
              />
            ))}
            {children.length === 0 && loaded && (
              <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
                {t("fileExplorer.emptyDir")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChangedListRow({
  status,
  cwd,
  onOpenFile,
  onAtMention,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const relative = getRelativeFilePath(status.filePath, cwd);
  const fileName = getFileName(status.filePath);
  const gitStatus = status;
  return (
    <div
      onClick={() => onOpenFile(status.filePath, fileName)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="treeitem"
      aria-selected={false}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenFile(status.filePath, fileName);
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
        paddingLeft: 8,
        paddingRight: 8,
        height: 24,
        cursor: "pointer",
        background: hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: "var(--radius-control)",
        userSelect: "none",
        transition: `background var(--dur-fast) var(--ease-out-warm)`,
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-dim)" }}>
        {getFileIcon(fileName, 14)}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
        title={relative}
      >
        {relative}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        <span
          title={t(GIT_STATUS_LABEL_KEYS[gitStatus.status])}
          style={{
            width: 14,
            textAlign: "center",
            color: GIT_STATUS_COLORS[gitStatus.status],
            fontSize: 11,
          }}
        >
          {gitStatus.code}
        </span>
        {(gitStatus.insertions !== undefined || gitStatus.deletions !== undefined) &&
          !(gitStatus.insertions === 0 && gitStatus.deletions === 0) && (
            <>
              {gitStatus.insertions !== undefined && gitStatus.insertions > 0 && (
                <span style={{ color: "var(--status-success)" }}>+{gitStatus.insertions}</span>
              )}
              {gitStatus.deletions !== undefined && gitStatus.deletions > 0 && (
                <span style={{ color: "var(--status-error)" }}>-{gitStatus.deletions}</span>
              )}
            </>
          )}
      </span>
      {onAtMention && hovered && (
        <Tooltip content={t("fileExplorer.insertPathIntoChat")}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(relative, false);
            }}
            aria-label={t("fileExplorer.insertPathIntoChat")}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <AtSign size={11} strokeWidth={2.2} aria-hidden="true" />
            {t("fileExplorer.mention")}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function FileExplorer({
  cwd,
  onOpenFile,
  refreshKey,
  onAtMention,
  onRefreshDone,
}: Props) {
  const { t } = useI18n();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "changes">("all");
  const [changesView, setChangesView] = useState<"tree" | "list">("tree");
  const [changedExpandedPaths, setChangedExpandedPaths] = useState<Set<string>>(new Set());
  const prevCwdRef = useRef<string | null>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const changedRoots = useMemo(() => {
    if (gitFiles.length === 0) return [] as FileNode[];
    const map = new Map<string, FileNode>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      const normalizedFile = normalizeFilePathSlashes(status.filePath);
      if (normalizedFile !== normalizedCwd && !normalizedFile.startsWith(`${normalizedCwd}/`)) continue;
      const rel = normalizedFile === normalizedCwd ? "" : normalizedFile.slice(normalizedCwd.length + 1);
      if (!rel) continue;
      const parts = rel.split("/").filter(Boolean);
      let cur = normalizedCwd;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        cur = joinFilePath(cur, part);
        if (!map.has(cur)) {
          map.set(cur, {
            name: part,
            fullPath: cur,
            isDir: !isLast,
            size: 0,
            children: !isLast ? [] : undefined,
            loaded: !isLast ? true : undefined,
          });
        } else {
          const node = map.get(cur)!;
          if (!isLast && !node.isDir) {
            node.isDir = true;
            node.children = [];
            node.loaded = true;
          }
        }
      }
    }
    const roots: FileNode[] = [];
    const nodes = Array.from(map.values()).sort((a, b) => a.fullPath.length - b.fullPath.length);
    for (const node of nodes) {
      const parentPath = getFileDirectory(node.fullPath);
      const parent = map.get(parentPath);
      if (parent && parent.children) {
        if (!parent.children.some((c) => c.fullPath === node.fullPath)) parent.children.push(node);
      } else if (parentPath === normalizedCwd) {
        roots.push(node);
      }
    }
    const sortNodes = (list: FileNode[]) => {
      list.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of list) if (n.children) sortNodes(n.children);
    };
    sortNodes(roots);
    return roots;
  }, [gitFiles, cwd]);

  const sortedGitFiles = useMemo(() => [...gitFiles].sort((a, b) => a.filePath.localeCompare(b.filePath)), [gitFiles]);

  useEffect(() => {
    const allDirs = new Set<string>();
    const collect = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.isDir) {
          allDirs.add(n.fullPath);
          if (n.children) collect(n.children);
        }
      }
    };
    collect(changedRoots);
    setChangedExpandedPaths(allDirs);
  }, [changedRoots]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const handleToggleChangedExpanded = useCallback((fullPath: string, open: boolean) => {
    setChangedExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);



  // Keep the refresh-done callback in a ref so its identity cannot re-trigger
  // the fetch effect below (AppShell re-renders on every session boundary).
  const onRefreshDoneRef = useRef(onRefreshDone);
  onRefreshDoneRef.current = onRefreshDone;

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
      setHighlightedPaths(new Set());
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); onRefreshDoneRef.current?.(); });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)
      .then((status) => {
        if (!cancelled) setGitFiles(status.isGitRepository ? status.files : []);
      })
      .catch(() => {
        if (!cancelled) setGitFiles([]);
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  return (
    <div style={{ minHeight: "100%" }}>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          aria-selected={activeTab === "all"}
          role="tab"
          style={{
            flex: 1,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: activeTab === "all" ? "var(--bg-selected)" : "transparent",
            border: "none",
            borderBottom: activeTab === "all" ? "2px solid var(--accent)" : "2px solid transparent",
            color: activeTab === "all" ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            transition: `background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)`,
          }}
        >
          {t("fileExplorer.tabAll")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("changes")}
          aria-selected={activeTab === "changes"}
          role="tab"
          style={{
            flex: 1,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: activeTab === "changes" ? "var(--bg-selected)" : "transparent",
            border: "none",
            borderBottom: activeTab === "changes" ? "2px solid var(--accent)" : "2px solid transparent",
            color: activeTab === "changes" ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            transition: `background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)`,
          }}
        >
          {t("fileExplorer.tabChanges")}
          {gitFiles.length > 0 && (
            <span
              style={{
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                background: activeTab === "changes" ? "var(--accent)" : "var(--bg-hover)",
                color: activeTab === "changes" ? "white" : "var(--text-muted)",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {gitFiles.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "all" ? (
        <div role="tree" aria-label={t("sessionSidebar.explorer")} style={{ padding: "2px 4px" }}>
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("fileExplorer.loadingFiles")}</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--status-error)" }}>{error}</div>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
              />
            ))
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("fileExplorer.noFilesFound")}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {gitFiles.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
                padding: "4px 6px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => setChangesView("tree")}
                  aria-pressed={changesView === "tree"}
                  title={t("fileExplorer.viewTree")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 8px",
                    height: 22,
                    background: changesView === "tree" ? "var(--bg-selected)" : "transparent",
                    border: "none",
                    color: changesView === "tree" ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <FolderTree size={12} strokeWidth={2} aria-hidden="true" />
                  {t("fileExplorer.viewTree")}
                </button>
                <button
                  type="button"
                  onClick={() => setChangesView("list")}
                  aria-pressed={changesView === "list"}
                  title={t("fileExplorer.viewList")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 8px",
                    height: 22,
                    background: changesView === "list" ? "var(--bg-selected)" : "transparent",
                    border: "none",
                    borderLeft: "1px solid var(--border)",
                    color: changesView === "list" ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <List size={12} strokeWidth={2} aria-hidden="true" />
                  {t("fileExplorer.viewList")}
                </button>
              </div>
            </div>
          )}
          <div role="tree" aria-label={t("fileExplorer.tabChanges")} style={{ padding: "2px 4px" }}>
            {gitFiles.length === 0 ? (
              <div style={{ padding: "12px 12px", fontSize: 11, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.5 }}>
                {t("fileExplorer.workingTreeClean")}
              </div>
            ) : changesView === "tree" ? (
              changedRoots.length === 0 ? (
                <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("fileExplorer.noChangedFiles")}</div>
              ) : (
                changedRoots.map((node) => (
                  <TreeNode
                    key={node.fullPath}
                    node={node}
                    depth={0}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                    onAtMention={onAtMention}
                    expandedPaths={changedExpandedPaths}
                    onToggleExpanded={handleToggleChangedExpanded}
                    refreshToken={refreshToken}
                    highlightedPaths={highlightedPaths}
                    gitStatusByPath={gitStatusByPath}
                    changedDirectoryPaths={changedDirectoryPaths}
                    staticMode
                  />
                ))
              )
            ) : sortedGitFiles.length === 0 ? (
              <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("fileExplorer.noChangedFiles")}</div>
            ) : (
              sortedGitFiles.map((status) => (
                <ChangedListRow
                  key={status.filePath}
                  status={status}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onAtMention={onAtMention}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
