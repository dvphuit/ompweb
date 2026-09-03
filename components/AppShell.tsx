"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ToastProvider } from "./ui/toast";
import { toast } from "./ui/toast";
import { ChatWindow } from "./ChatWindow";
import { TabBar, type Tab } from "./TabBar";
import { BranchNavigator } from "./BranchNavigator";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ArrowDown, ArrowUp, ArrowUpRight, Bot, Check, CheckCheck, Copy, Database, DollarSign, Gauge, Hash, History, Menu, Moon, PanelLeft, Percent, Sun, Terminal, User, Wand2, Wrench, Zap } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { formatCompactNumber, formatPercent, getCacheHitRate } from "@/lib/format";
import { translate, useI18n } from "@/lib/i18n";
import { formatApiError } from "@/lib/i18n/api-error";
import { useIsMobile } from "@/hooks/useIsMobile";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { comparableProjectPath } from "@/lib/comparable-path";
import { showCompletionNotification } from "@/lib/browser-notifications";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo, GenerationSpeedInfo } from "@/lib/pi-types";
import type { SettingsTab } from "./SettingsTabs";
import { SettingsConfig } from "./SettingsConfig";
import { ArchiveBrowser } from "./ArchiveBrowser";
import { publishSessionsChanged } from "@/lib/session-change-bus";
import { ContextMenuProvider } from "./ContextMenuContext";
// The settings shell is part of the app bundle so opening it does not fetch or compile a modal chunk. The file viewer remains on demand.
const FileViewer = dynamic(() => import("./FileViewer").then((m) => m.FileViewer), {
  ssr: false,
  loading: () => <PanelLoadingFallback />,
});

// Resizable desktop sidebar: the width is stored on the container as the
// --sidebar-width CSS variable (globals.css) and persisted between sessions.
const SIDEBAR_WIDTH_STORAGE_KEY = "omp-web:sidebar-width";
const TOOL_CALLS_COLLAPSED_STORAGE_KEY = "omp-web:tool-calls-collapsed";
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_DEFAULT_WIDTH = 260;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function loadSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const width = raw ? Number(raw) : NaN;
    return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), {
  ssr: false,
});

function PanelLoadingFallback() {
  const { t } = useI18n();
  return (
    <div role="status" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
      {t("appShell.loading")}
    </div>
  );
}


type SessionCopyField = "file" | "id";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { isDark, preference, toggleTheme } = useTheme();
  const { t, locale } = useI18n();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [explorerRefreshing, setExplorerRefreshing] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [archiveBrowserOpen, setArchiveBrowserOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_WIDTH);
  const [toolCallsDefaultCollapsed, setToolCallsDefaultCollapsed] = useState(true);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  // Active drag handlers so an unmount mid-drag can detach them.
  const sidebarResizeHandlersRef = useRef<{ onMove: (ev: MouseEvent) => void; onUp: () => void } | null>(null);
  // DOM element + live width during a drag (see handleSidebarResizeStart).
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const pendingSidebarWidthRef = useRef<number>(SIDEBAR_DEFAULT_WIDTH);
  useEffect(() => {
    setSidebarWidth(loadSidebarWidth());
    try {
      setToolCallsDefaultCollapsed(window.localStorage.getItem(TOOL_CALLS_COLLAPSED_STORAGE_KEY) !== "false");
    } catch {
      // Keep the compact default when storage is unavailable.
    }
  }, []);
  const handleToolCallsDefaultCollapsedChange = useCallback((collapsed: boolean) => {
    setToolCallsDefaultCollapsed(collapsed);
    try {
      window.localStorage.setItem(TOOL_CALLS_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // The preference still applies for this page load.
    }
  }, []);
  // Persist the committed width (after each change; skipped mid-drag, then
  // written once the drag ends). The first run is skipped so the mount-time
  // default cannot overwrite the stored width before it is loaded.
  const sidebarWidthMountedRef = useRef(false);
  useEffect(() => {
    if (!sidebarWidthMountedRef.current) {
      sidebarWidthMountedRef.current = true;
      return;
    }
    if (sidebarResizing) return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // ignore storage quota / privacy-mode errors
    }
  }, [sidebarWidth, sidebarResizing]);
  const [ompUpdateAvailable, setOmpUpdateAvailable] = useState(false);
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  // Chrome does not blur a focused descendant when a subtree becomes
  // aria-hidden + inert (e.g. tapping a session button closes the mobile
  // drawer), which leaves focus trapped where assistive tech cannot see it.
  // Blur synchronously in the same commit so the AX tree never observes a
  // focused element inside the hidden sidebar.
  useLayoutEffect(() => {
    if (sidebarOpen || !mobileSidebarReady) return;
    const container = sidebarContainerRef.current;
    const active = document.activeElement;
    if (container && active instanceof HTMLElement && container.contains(active)) {
      active.blur();
    }
  }, [sidebarOpen, mobileSidebarReady]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const systemPromptLoaderRef = useRef<(() => Promise<void>) | null>(null);
  const systemPromptLoadIdRef = useRef(0);
  const systemBtnRef = useRef<HTMLButtonElement>(null);
  const sessionStatsBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
    setSystemPromptLoading(false);
  }, []);

  const handleSystemPromptLoaderChange = useCallback((loader: (() => Promise<void>) | null) => {
    systemPromptLoadIdRef.current += 1;
    systemPromptLoaderRef.current = loader;
    setSystemPromptLoading(false);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [modelCapacity, setModelCapacity] = useState<{ contextWindow?: number; maxTokens?: number } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);
  const handleModelCapacityChange = useCallback((capacity: { contextWindow?: number; maxTokens?: number } | null) => {
    setModelCapacity(capacity);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session") => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  // Generation speed — current live t/s and the session average.
  const [generationSpeed, setGenerationSpeed] = useState<GenerationSpeedInfo | null>(null);
  const handleGenerationSpeedChange = useCallback((speed: GenerationSpeedInfo | null) => {
    setGenerationSpeed(speed);
  }, []);
  const handleSystemPromptToggle = useCallback(() => {
    const opening = activeTopPanel !== "system";
    toggleTopPanel("system");
    if (!opening || systemPromptLoading || systemPrompt !== null) return;

    const load = systemPromptLoaderRef.current;
    if (!load) return;
    const loadId = ++systemPromptLoadIdRef.current;
    setSystemPromptLoading(true);
    void load().catch((error) => {
      console.error("Failed to load system prompt:", error);
    }).finally(() => {
      if (systemPromptLoadIdRef.current === loadId) setSystemPromptLoading(false);
    });
  }, [activeTopPanel, systemPrompt, systemPromptLoading, toggleTopPanel]);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }, []);

  const changeSidebarWidth = useCallback((delta: number) => {
    setSidebarWidth((prev) => clampSidebarWidth(prev + delta));
  }, []);

  const handleSidebarResizeKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      changeSidebarWidth(-10);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      changeSidebarWidth(10);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      resetSidebarWidth();
    }
  }, [changeSidebarWidth, resetSidebarWidth]);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setSidebarResizing(true);
    const onMove = (ev: MouseEvent) => {
      const next = clampSidebarWidth(startWidth + (ev.clientX - startX));
      // Write the CSS variable straight to the DOM: the flex row follows the
      // pointer without re-rendering the whole AppShell on every mousemove.
      sidebarContainerRef.current?.style.setProperty("--sidebar-width", `${next}px`);
      pendingSidebarWidthRef.current = next;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      sidebarResizeHandlersRef.current = null;
      setSidebarResizing(false);
      // Commit the final width so state and the persisted value agree with
      // what the user actually dragged to.
      setSidebarWidth(pendingSidebarWidthRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    pendingSidebarWidthRef.current = startWidth;
    sidebarResizeHandlersRef.current = { onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isMobile, sidebarWidth]);

  // If the app unmounts mid-drag, remove the window listeners and restore the
  // body cursor; otherwise the handlers leak and body stays cursor:col-resize.
  useEffect(() => () => {
    const handlers = sidebarResizeHandlersRef.current;
    if (!handlers) return;
    window.removeEventListener("mousemove", handlers.onMove);
    window.removeEventListener("mouseup", handlers.onUp);
    sidebarResizeHandlersRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Dismiss the system/session dropdowns on outside click or Escape. The
  // Escape handler stops propagation so the global Esc (abort agent) does not
  // fire while a panel is open; clicks on the trigger buttons themselves are
  // ignored here — their onClick toggles the panel.
  useEffect(() => {
    // The branch panel manages its own outside-click and Escape dismissal.
    if (!activeTopPanel || activeTopPanel === "branches") return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-top-panel]")) return;
      if (systemBtnRef.current?.contains(event.target as Node)) return;
      if (sessionStatsBtnRef.current?.contains(event.target as Node)) return;
      setActiveTopPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setActiveTopPanel(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string; code?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error || data.code ? formatApiError(data) : `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd) return;
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    // Compare case-folded: the same folder can be spelled with different
    // casing (Windows/NTFS) between the session's projectRoot and the
    // sidebar's resolved project root.
    const newProject = projectRoot ?? cwd;
    const sessionProject = selectedSession ? (selectedSession.projectRoot ?? selectedSession.cwd) : null;
    if (sessionProject && comparableProjectPath(sessionProject) === comparableProjectPath(newProject)) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemPromptLoading(false);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    if (document.visibilityState !== "hidden" || !("Notification" in window)) return;

    const targetSession = selectedSession;
    const notify = () => {
      showCompletionNotification(
        targetSession?.name ?? translate("appShell.sessionComplete"),
        translate("appShell.taskFinished"),
        () => {
          window.focus();
          if (targetSession) handleSelectSession(targetSession);
        },
      );
    };
    if (Notification.permission === "granted") notify();
    else if (Notification.permission === "default") {
      void Notification.requestPermission().then((permission) => { if (permission === "granted") notify(); });
    }
  }, [handleSelectSession, selectedSession]);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string; code?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || body.code ? formatApiError(body) : `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshing(true);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleExplorerRefreshDone = useCallback(() => {
    setExplorerRefreshing(false);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);
  const handleArchiveRestored = useCallback(async (sessionId: string) => {
    setArchiveBrowserOpen(false);
    publishSessionsChanged([sessionId]);
    setRefreshKey((k) => k + 1);

    const selectRestoredSession = async (attemptsLeft = 5): Promise<void> => {
      try {
        const res = await fetch("/api/sessions");
        if (res.ok) {
          const data = (await res.json()) as { sessions?: SessionInfo[] };
          const found = data.sessions?.find((s) => s.id === sessionId);
          if (found) {
            handleSelectSession(found, false);
            return;
          }
        }
      } catch {
        // network error / abort
      }

      if (attemptsLeft > 0) {
        setTimeout(() => void selectRestoredSession(attemptsLeft - 1), 300);
      } else {
        router.replace(`?session=${encodeURIComponent(sessionId)}`, { scroll: false });
      }
    };

    void selectRestoredSession();
  }, [handleSelectSession, router]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceSessionId?: string | null) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId }];
      if (!sourceSessionId || existing.sourceSessionId === sourceSessionId) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId } : t);
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    // Compute everything from the current list outside the updaters: no side
    // effect inside a state updater, and no stale-closure read (the callback
    // is recreated whenever fileTabs changes, but a batched double-close
    // would still have read the pre-close list from the closure).
    const next = fileTabs.filter((t) => t.id !== tabId);
    setFileTabs(next);
    if (next.length === 0) setRightPanelOpen(false);
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      return next.length > 0 ? next[next.length - 1].id : null;
    });
  }, [fileTabs]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);
  const handleCloseOtherTabs = useCallback((tabId: string) => {
    setFileTabs((prev) => prev.filter((t) => t.id === tabId));
    setActiveFileTabId(tabId);
  }, []);

  const handleCloseTabsToRight = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const next = prev.slice(0, idx + 1);
      setActiveFileTabId((cur) => (next.some((t) => t.id === cur) ? cur : tabId));
      return next;
    });
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setFileTabs([]);
    setRightPanelOpen(false);
    setActiveFileTabId(null);
  }, []);

  const handleQuoteInChat = useCallback((text: string) => {
    const quoted = text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    chatInputRef.current?.insertText(`${quoted}\n\n`);
  }, []);

  const handleForkSession = useCallback(async (sessionId: string, entryId?: string) => {
    const targetId = sessionId || selectedSession?.id;
    if (!targetId) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(targetId)}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryId ? { entryId } : {}),
      });
      if (!res.ok) throw new Error("Fork failed");
      const data = await res.json() as { id?: string; session?: SessionInfo };
      if (data.session) {
        handleSelectSession(data.session);
      } else if (data.id) {
        router.replace(`?session=${encodeURIComponent(data.id)}`, { scroll: false });
      }
    } catch {
      toast.error(t("sessionSidebar.forkFailed"));
    }
  }, [selectedSession?.id, handleSelectSession, router, t]);
  const handleRenameSession = useCallback(async (sessionId: string, currentName: string) => {
    const newName = window.prompt(t("sessionSidebar.rename") || "Enter new session name:", currentName);
    if (newName === null || newName.trim() === currentName) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error("Rename failed");
      setRefreshKey((k) => k + 1);
    } catch {
      toast.error(t("sessionSidebar.renameFailed") || "Rename failed");
    }
  }, [t]);


  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: "POST" });
      if (!response.ok) throw new Error("Session archive failed");
      handleSessionDeleted(sessionId);
    } catch {
      toast.error(t("sessionSidebar.archiveFailed"));
    }
  }, [handleSessionDeleted, t]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Session deletion failed");
      handleSessionDeleted(sessionId);
    } catch {
      toast.error(t("sessionSidebar.deleteFailed"));
    }
  }, [handleSessionDeleted, t]);

  const handleExportSession = useCallback((sessionId: string) => {
    window.open(`/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1`, "_blank", "noopener,noreferrer");
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  }, []);

  const handleHideProject = useCallback(async (projectPath: string) => {
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath }),
      });
      if (res.ok) {
        setRefreshKey((k) => k + 1);
      }
    } catch {
      // ignore
    }
  }, []);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - omp web` : "omp web";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <>
      <CommandPalette
        onSelectSession={handleSelectSession}
        onNewSession={() => handleNewSession(`palette-${Date.now()}`, activeCwd ?? "")}
        currentModel={null}
      />
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        optimisticSession={selectedSession?.path === "" ? selectedSession : null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        explorerRefreshing={explorerRefreshing}
        onExplorerRefreshDone={handleExplorerRefreshDone}
        onAtMention={handleAtMention}
        onOpenSettings={() => setSettingsTab("general")}
        onOpenArchive={() => setArchiveBrowserOpen(true)}
        updateAvailable={ompUpdateAvailable}
      />
    </>
  );

  return (
    <>
    <ToastProvider>
    <ContextMenuProvider
      actions={{
        onNewSession: (cwd) => handleNewSession(`new-${Date.now()}`, cwd || activeCwd || ""),
        onOpenCommandPalette: handleOpenCommandPalette,
        onToggleSidebar: handleSidebarToggle,
        onOpenSettings: (tab) => setSettingsTab((tab as SettingsTab) || "general"),
        onSelectSession: (sessionId) => {
          router.replace(`?session=${encodeURIComponent(sessionId)}`, { scroll: false });
        },
        onRenameSession: handleRenameSession,
        onForkSession: handleForkSession,
        onArchiveSession: handleArchiveSession,
        onDeleteSession: handleDeleteSession,
        onExportSession: handleExportSession,
        onOpenFile: (filePath, fileName) => handleOpenFile(filePath, fileName || getFileName(filePath)),
        onCloseTab: handleCloseFileTab,
        onCloseOtherTabs: handleCloseOtherTabs,
        onCloseTabsToRight: handleCloseTabsToRight,
        onCloseAllTabs: handleCloseAllTabs,
        onInsertMention: (text) => chatInputRef.current?.insertText(text),
        onQuoteInChat: handleQuoteInChat,
        onHideProject: handleHideProject,
        activeCwd,
      }}
    >
    <style>{`
      .session-info-popover {
        position: relative;
        overflow: hidden;
        box-sizing: border-box;
        padding: 16px;
        background: var(--bg-panel);
      }
      .session-info-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
        min-width: 0;
        color: var(--text-muted);
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.45;
      }
      .session-info-identity,
      .session-info-metric-card {
        min-width: 0;
        overflow: hidden;
      }
      .session-info-title,
      .session-info-section-title {
        margin: 0;
        color: var(--text);
        font-weight: 700;
      }
      .session-info-title {
        margin-bottom: 12px;
        font-size: 13px;
      }
      .session-info-section-title {
        margin-bottom: 8px;
        font-size: 12px;
      }
      .session-info-identity-list,
      .session-info-metric-list {
        margin: 0;
      }
      .session-info-identity-row {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 26px;
        gap: 8px;
        align-items: start;
        padding: 7px 0;
      }
      .session-info-identity-row dt,
      .session-info-metric-row dt {
        min-width: 0;
        color: var(--text-dim);
        overflow-wrap: anywhere;
      }
      .session-info-identity-row dd {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
      }
      .session-info-copy {
        display: inline-flex;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: transparent;
        color: var(--text-dim);
        cursor: pointer;
      }
      .session-info-copy:hover,
      .session-info-copy[data-copied] {
        background: var(--bg-hover);
        color: var(--accent);
      }
      .session-info-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;
        min-width: 0;
      }
      .session-info-metric-card {
        padding: 11px;
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        background: var(--bg-subtle);
      }
      .session-info-metric-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) max-content;
        gap: 8px;
        padding: 3px 0;
      }
      .session-info-metric-row dd {
        margin: 0;
        color: var(--text);
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
      }
      .session-info-empty {
        color: var(--text-muted);
        font-size: 12px;
        font-style: italic;
      }
      @media (max-width: 680px) {
        .session-info-popover { padding: 14px; }
      }
      @media (max-width: 420px) {
        .session-info-metrics { grid-template-columns: 1fr; }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "color-mix(in srgb, var(--text) 28%, transparent)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity var(--dur-slow) var(--ease-out-warm)",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarContainerRef}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizing ? " sidebar-resizing" : ""}`}
        aria-hidden={mobileSidebarReady && !sidebarOpen ? true : undefined}
        inert={mobileSidebarReady && !sidebarOpen ? true : undefined}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
          // Desktop-only: the width is user-adjustable via the resize handle.
          ...(!isMobile ? { "--sidebar-width": `${sidebarWidth}px` } : {}),
        }}
      >
        {sidebarContent}
      </div>

      {/* Resize handle — desktop only, hidden while the sidebar is closed */}
      {!isMobile && sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("appShell.resizeSidebar")}
          tabIndex={0}
          onMouseDown={handleSidebarResizeStart}
          onDoubleClick={resetSidebarWidth}
          onKeyDown={handleSidebarResizeKey}
          title={t("appShell.resizeSidebarTitle")}
          style={{
            width: 5,
            flexShrink: 0,
            marginLeft: -5,
            cursor: "col-resize",
            background: "transparent",
            zIndex: 205,
            outline: "none",
            transition: "background var(--dur-fast) var(--ease-out-warm)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 35%, transparent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          onFocus={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 35%, transparent)"; }}
          onBlur={(e) => { e.currentTarget.style.background = "transparent"; }}
        />
      )}

      {/* Center: chat */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar: compact icon-led control bar */}
        <div ref={topBarRef} className="shell-topbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: isMobile ? 44 : 36, background: "var(--bg-panel)" }}>
        {/* Utility group: sidebar, theme, language */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%", paddingLeft: isMobile ? 4 : 8 }}>
          <button
            onClick={handleSidebarToggle}
            title={sidebarOpen ? t("appShell.hideSidebar") : t("appShell.showSidebar")}
            aria-label={sidebarOpen ? t("appShell.hideSidebar") : t("appShell.showSidebar")}
            className="shell-toolbar-btn ui-focus-ring"
          >
            {sidebarOpen ? <PanelLeft size={16} strokeWidth={1.8} aria-hidden="true" /> : <Menu size={16} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            title={preference === "system" ? t("appShell.systemTheme") : (isDark ? t("appShell.switchToSystemTheme") : t("appShell.switchToDarkMode"))}
            aria-label={preference === "system" ? t("appShell.systemTheme") : (isDark ? t("appShell.switchToSystemTheme") : t("appShell.switchToDarkMode"))}
            aria-pressed={isDark}
            className="shell-toolbar-btn ui-focus-ring"
          >
            {isDark ? <Sun size={16} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={16} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <LanguageSwitcher />
        </div>
        {showChat && (
          <>
            <div className="shell-toolbar-divider" aria-hidden="true" />
            {/* Session controls: history, generate title, branches, system */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%" }}>
              <button
                onClick={handleViewFullHistory}
                disabled={!selectedSession}
                title={selectedSession ? t("appShell.fullHistory") : t("appShell.fullHistoryUnavailable")}
                aria-label={t("appShell.fullHistory")}
                className="shell-toolbar-btn ui-focus-ring"
              >
                <History size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {(() => {
                const hasMessages = Boolean(
                  selectedSession
                  && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
                );
                const disabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                const isSuccess = autoNameStatus.kind === "success";
                const isError = autoNameStatus.kind === "error";
                const label = autoNameStatus.kind === "naming"
                  ? t("appShell.generating")
                  : isSuccess
                    ? t("appShell.titleUpdated")
                    : isError
                      ? t("appShell.generationFailed")
                      : t("appShell.generateTitle");
                const title = !selectedSession
                  ? t("appShell.titleGenUnavailable")
                  : !hasMessages
                    ? t("appShell.titleGenNeedsMessage")
                    : isError
                      ? autoNameStatus.message
                      : t("appShell.generateSessionTitle");

                return (
                  <button
                    type="button"
                    onClick={() => void handleAutoName()}
                    disabled={disabled}
                    title={title}
                    aria-label={label}
                    className="shell-toolbar-btn ui-focus-ring"
                    style={{ opacity: autoNameStatus.kind === "naming" ? 1 : undefined }}
                  >
                    {autoNameStatus.kind === "naming" ? (
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : isSuccess ? (
                      <Check size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--accent)" }} />
                    ) : isError ? (
                      <Wand2 size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--status-error)" }} />
                    ) : (
                      <Wand2 size={16} strokeWidth={1.8} aria-hidden="true" />
                    )}
                  </button>
                );
              })()}
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              <button
                ref={systemBtnRef}
                onClick={handleSystemPromptToggle}
                title={t("appShell.system")}
                aria-label={t("appShell.system")}
                aria-pressed={activeTopPanel === "system"}
                className="shell-toolbar-btn ui-focus-ring"
              >
                <Terminal size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: systemPrompt ? "var(--accent)" : undefined }} />
              </button>
            </div>
          </>
        )}
          {/* Session stats and generation speed — right-aligned in top bar */}
          {showChat && (sessionStats || contextUsage || modelCapacity || generationSpeed) && (() => {
            const tok = sessionStats?.tokens;
            const c = sessionStats?.cost ?? 0;
            const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;
            const cacheHitRate = tok ? getCacheHitRate(tok.input, tok.cacheRead) : null;
            const cacheRateStr = cacheHitRate !== null ? formatPercent(cacheHitRate) : null;
            const cacheRateColor = cacheHitRate === null ? "var(--text-muted)" : cacheHitRate >= 75 ? "var(--status-success)" : cacheHitRate >= 50 ? "var(--status-warning)" : "var(--status-error)";
            const currentSpeedStr = generationSpeed?.current !== null && generationSpeed?.current !== undefined
              ? `${generationSpeed.current.toFixed(1)} t/s`
              : null;
            const averageSpeedStr = generationSpeed?.average !== null && generationSpeed?.average !== undefined
              ? `AVG ${generationSpeed.average.toFixed(1)} t/s`
              : null;

            let ctxColor = "var(--text-muted)";
            let ctxStr: string | null = null;
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              if (pct !== null && pct > 90) ctxColor = "var(--status-error)";
              else if (pct !== null && pct > 70) ctxColor = "var(--status-warning)";
              else if (pct !== null && pct <= 35) ctxColor = "var(--status-success)";
              ctxStr = pct !== null ? `${formatPercent(pct)} / ${formatCompactNumber(contextUsage.contextWindow)}` : `? / ${formatCompactNumber(contextUsage.contextWindow)}`;
            }
            const tooltipParts: string[] = [];
            if (tok) {
              tooltipParts.push(t("appShell.tooltipInput", { value: tok.input.toLocaleString(locale) }));
              tooltipParts.push(t("appShell.tooltipOutput", { value: tok.output.toLocaleString(locale) }));
              tooltipParts.push(t("appShell.tooltipCacheRead", { value: tok.cacheRead.toLocaleString(locale) }));
              tooltipParts.push(t("appShell.tooltipCacheWrite", { value: tok.cacheWrite.toLocaleString(locale) }));
              if (cacheRateStr) tooltipParts.push(t("appShell.tooltipCacheRate", { percent: cacheRateStr }));
              if (c > 0) tooltipParts.push(t("appShell.tooltipCost", { value: c.toFixed(4) }));
            }
            if (modelCapacity?.maxTokens) tooltipParts.push(t("appShell.tooltipMaxOutput", { tokens: modelCapacity.maxTokens.toLocaleString(locale) }));
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              tooltipParts.push(t("appShell.tooltipContext", {
                percent: pct !== null ? pct.toFixed(1) + "%" : t("appShell.unknown"),
                tokens: contextUsage.contextWindow.toLocaleString(locale),
              }));
            }
            if (currentSpeedStr) tooltipParts.push(t("appShell.tooltipCurrentSpeed", { value: currentSpeedStr }));
            if (averageSpeedStr) tooltipParts.push(t("appShell.tooltipAverageSpeed", { value: averageSpeedStr }));
            const tooltip = tooltipParts.join("  |  ");

            return (
              <button
                ref={sessionStatsBtnRef}
                type="button"
                onClick={() => toggleTopPanel("session")}
                title={tooltip || t("appShell.sessionInfo")}
                aria-label={t("appShell.sessionInfo")}
                aria-pressed={activeTopPanel === "session"}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  paddingLeft: isMobile ? 0 : 12,
                  // Reserve the corner for the always-visible file-panel
                  // toggle: on mobile it is 44px wide and would otherwise
                  // cover the session-stats button entirely.
                  paddingRight: isMobile ? (rightPanelOpen ? 0 : 44) : rightPanelOpen ? 12 : 48,
                  height: "100%",
                  minWidth: isMobile ? 44 : 0,
                  overflow: "hidden",
                  background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                  border: "none",
                  fontSize: 11, color: "var(--text-muted)",
                  whiteSpace: "nowrap", cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                  transition: "color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
                }}
                onMouseEnter={(e) => {
                  if (activeTopPanel !== "session") e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = activeTopPanel === "session" ? "var(--bg-selected)" : "none";
                  e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)";
                }}
              >
                {isMobile && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
                {!isMobile && tok && tok.input > 0 && (
                  <span title={t("appShell.tooltipInput", { value: tok.input.toLocaleString(locale) })} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--status-renamed)" }}>
                    <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
                    {formatCompactNumber(tok.input)}
                  </span>
                )}
                {!isMobile && tok && tok.output > 0 && (
                  <span title={t("appShell.tooltipOutput", { value: tok.output.toLocaleString(locale) })} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)" }}>
                    <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
                    {formatCompactNumber(tok.output)}
                  </span>
                )}
                {!isMobile && tok && tok.cacheRead > 0 && (
                  <span title={t("appShell.tooltipCacheRead", { value: tok.cacheRead.toLocaleString(locale) })} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--status-success)" }}>
                    <Database size={12} strokeWidth={1.8} aria-hidden="true" />
                    {formatCompactNumber(tok.cacheRead)}
                  </span>
                )}
                {!isMobile && modelCapacity?.maxTokens && (
                  <span title={t("appShell.tooltipMaxOutput", { tokens: modelCapacity.maxTokens.toLocaleString(locale) })} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                    <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden="true" />
                    {formatCompactNumber(modelCapacity.maxTokens)}
                  </span>
                )}
                {!isMobile && cacheRateStr && (
                  <span title={t("appShell.tooltipCacheRate", { percent: cacheRateStr })} style={{ display: "flex", alignItems: "center", gap: 4, color: cacheRateColor }}>
                    <Percent size={12} strokeWidth={1.8} aria-hidden="true" />
                    {cacheRateStr}
                  </span>
                )}
                {ctxStr && (
                  <span title={contextUsage?.contextWindow ? t("appShell.tooltipContext", { percent: contextUsage.percent !== null ? contextUsage.percent.toFixed(1) + "%" : t("appShell.unknown"), tokens: contextUsage.contextWindow.toLocaleString(locale) }) : undefined} style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Gauge size={12} strokeWidth={1.8} aria-hidden="true" />
                    {ctxStr}
                  </span>
                )}
                {!isMobile && costStr && (
                  <span title={sessionStats?.cost ? t("appShell.tooltipCost", { value: sessionStats.cost.toFixed(4) }) : undefined} style={{ display: "flex", alignItems: "center", gap: 2, color: "var(--text)", fontWeight: 500 }}>
                    <DollarSign size={12} strokeWidth={1.8} aria-hidden="true" />
                    {costStr}
                  </span>
                )}
                {!isMobile && currentSpeedStr && (
                  <span title={t("appShell.tooltipCurrentSpeed", { value: currentSpeedStr })} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--status-success)", fontWeight: 600 }}>
                    <Zap size={12} strokeWidth={1.8} aria-hidden="true" />
                    {currentSpeedStr}
                  </span>
                )}
                {!isMobile && averageSpeedStr && (
                  <span title={t("appShell.tooltipAverageSpeed", { value: averageSpeedStr })} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
                    {averageSpeedStr}
                  </span>
                )}
              </button>
            );
          })()}
          {/* Top panel dropdown — shared, only one active at a time. The
              branch panel renders inside BranchNavigator itself; never mount
              an empty fixed layer for it (it would sit over the top-bar
              region and swallow clicks). */}
          {(activeTopPanel === "system" || activeTopPanel === "session") && topPanelPos && (
            <div data-top-panel className="dropdown-surface" style={{
              position: "fixed",
              top: topPanelPos.top,
              right: isMobile ? 8 : 12,
              left: "auto",
              width: activeTopPanel === "session"
                ? "min(720px, calc(100vw - 24px))"
                : "min(560px, calc(100vw - 24px))",
              minWidth: 0,
              maxHeight: `min(70vh, calc(100dvh - ${topPanelPos.top}px - 12px))`,
              overflowY: "auto",
              overflowX: "hidden",
              boxSizing: "border-box",
              zIndex: 500,
            }}>
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("appShell.systemPromptEmpty")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {systemPromptLoading ? t("appShell.systemPromptLoading") : t("appShell.systemPromptLoadHint")}
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover">
                  {sessionStats ? (() => {
                    const sessionRows = [
                      ...(sessionStats.sessionName ? [{ label: t("appShell.statName"), value: sessionStats.sessionName, copyField: null }] : []),
                      { label: t("appShell.statFile"), value: sessionStats.sessionFile ?? t("appShell.inMemory"), copyField: "file" as const },
                      { label: t("appShell.statId"), value: sessionStats.sessionId, copyField: "id" as const },
                    ];
                    type MetricRow = { label: string; value: string; icon?: React.ReactNode; color?: string };
                    const messageRows: MetricRow[] = [
                      { label: t("appShell.statUser"), value: sessionStats.userMessages.toLocaleString(locale), icon: <User size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--text-dim)" },
                      { label: t("appShell.statAssistant"), value: sessionStats.assistantMessages.toLocaleString(locale), icon: <Bot size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--text-dim)" },
                      { label: t("appShell.statToolCalls"), value: sessionStats.toolCalls.toLocaleString(locale), icon: <Wrench size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--text-dim)" },
                      { label: t("appShell.statToolResults"), value: sessionStats.toolResults.toLocaleString(locale), icon: <CheckCheck size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--text-dim)" },
                      { label: t("appShell.statTotal"), value: sessionStats.totalMessages.toLocaleString(locale), icon: <Hash size={12} strokeWidth={1.8} aria-hidden="true" /> },
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const cacheHitRate = getCacheHitRate(sessionStats.tokens.input, sessionStats.tokens.cacheRead);
                    const cacheRateColor = cacheHitRate === null ? "var(--text-muted)" : cacheHitRate >= 75 ? "var(--status-success)" : cacheHitRate >= 50 ? "var(--status-warning)" : "var(--status-error)";
                    let ctxColor: string | undefined;
                    if (ctx?.contextWindow) {
                      const pct = ctx.percent;
                      if (pct !== null && pct > 90) ctxColor = "var(--status-error)";
                      else if (pct !== null && pct > 70) ctxColor = "var(--status-warning)";
                      else if (pct !== null && pct <= 35) ctxColor = "var(--status-success)";
                      else ctxColor = "var(--text)";
                    }
                    const tokenRows: MetricRow[] = [
                      { label: t("appShell.statInput"), value: sessionStats.tokens.input.toLocaleString(locale), icon: <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />, color: "var(--status-renamed)" },
                      { label: t("appShell.statOutput"), value: sessionStats.tokens.output.toLocaleString(locale), icon: <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />, color: "var(--accent)" },
                      ...(sessionStats.tokens.cacheRead > 0 ? [{ label: t("appShell.statCacheRead"), value: sessionStats.tokens.cacheRead.toLocaleString(locale), icon: <Database size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--status-success)" } as MetricRow] : []),
                      ...(sessionStats.tokens.cacheWrite > 0 ? [{ label: t("appShell.statCacheWrite"), value: sessionStats.tokens.cacheWrite.toLocaleString(locale), icon: <Database size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--status-modified)" } as MetricRow] : []),
                      { label: t("appShell.statTotal"), value: sessionStats.tokens.total.toLocaleString(locale), icon: <Hash size={12} strokeWidth={1.8} aria-hidden="true" /> },
                    ];
                    const extraTokenRows: MetricRow[] = [
                      ...(cacheHitRate !== null ? [{ label: t("appShell.statCacheRate"), value: formatPercent(cacheHitRate), icon: <Percent size={12} strokeWidth={1.8} aria-hidden="true" />, color: cacheRateColor } as MetricRow] : []),
                      ...(ctx?.contextWindow ? [{ label: t("appShell.statContext"), value: `${ctx.percent !== null ? formatPercent(ctx.percent) : "?"} / ${formatCompactNumber(ctx.contextWindow)}`, icon: <Gauge size={12} strokeWidth={1.8} aria-hidden="true" />, color: ctxColor } as MetricRow] : []),
                      ...(sessionStats.cost > 0 ? [{ label: t("appShell.statCost"), value: `$${sessionStats.cost.toFixed(4)}`, icon: <DollarSign size={12} strokeWidth={1.8} aria-hidden="true" /> } as MetricRow] : []),
                      ...(generationSpeed?.current != null ? [{ label: "Speed", value: `${generationSpeed.current.toFixed(1)} t/s`, icon: <Zap size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--status-success)" } as MetricRow] : []),
                      ...(modelCapacity?.maxTokens ? [{ label: "Max Output", value: formatCompactNumber(modelCapacity.maxTokens), icon: <ArrowUpRight size={12} strokeWidth={1.8} aria-hidden="true" />, color: "var(--text-dim)" } as MetricRow] : []),
                    ];
                    const metricCard = (title: string, sectionRows: MetricRow[]) => (
                      <section className="session-info-metric-card">
                        <h3 className="session-info-section-title">{title}</h3>
                        <dl className="session-info-metric-list">
                          {sectionRows.map((row) => (
                            <div key={`${title}:${row.label}`} className="session-info-metric-row">
                              <dt style={{ display: "flex", alignItems: "center", gap: 6, color: row.color ? undefined : "var(--text-dim)" }}>
                                {row.icon ? <span style={{ display: "inline-flex", color: row.color ?? "var(--text-dim)", flexShrink: 0 }}>{row.icon}</span> : null}
                                <span>{row.label}</span>
                              </dt>
                              <dd style={row.color ? { color: row.color } : undefined}>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    );
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      const label = copied
                        ? t("appShell.copied")
                        : field === "file"
                          ? t("appShell.copyFilePath")
                          : t("appShell.copySessionId");
                      return (
                        <button
                          type="button"
                          className="session-info-copy ui-focus-ring"
                          data-copied={copied || undefined}
                          title={label}
                          aria-label={label}
                          onClick={() => handleCopySessionField(field, value)}
                        >
                          {copied
                            ? <Check size={13} strokeWidth={2} aria-hidden="true" />
                            : <Copy size={13} strokeWidth={1.8} aria-hidden="true" />}
                        </button>
                      );
                    };

                    return (
                      <div className="session-info-layout">
                        <section className="session-info-identity">
                          <h2 className="session-info-title">{t("appShell.sectionSessionInfo")}</h2>
                          <dl className="session-info-identity-list">
                            {sessionRows.map((row) => (
                              <div key={`session-info:${row.label}`} className="session-info-identity-row">
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                                {row.copyField
                                  ? copyButton(row.copyField, row.value)
                                  : <span aria-hidden="true" />}
                              </div>
                            ))}
                          </dl>
                        </section>
                        <div className="session-info-metrics">
                          {metricCard(t("appShell.sectionMessages"), messageRows)}
                          {metricCard(t("appShell.sectionTokens"), [...tokenRows, ...extraTokenRows])}
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="session-info-empty">
                      {t("appShell.sessionInfoLoadHint")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onOpenFile={handleOpenLinkedFile}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSystemPromptLoaderChange={handleSystemPromptLoaderChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onModelCapacityChange={handleModelCapacityChange}
              onGenerationSpeedChange={handleGenerationSpeedChange}
              toolCallsDefaultCollapsed={toolCallsDefaultCollapsed}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--text)" }}>{t("appShell.openingWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--status-error)" }}>{t("appShell.unableToOpenWorkspace")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : !showPlaceholder ? (
            <PanelLoadingFallback />
          ) : (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 16 }}>
                <span className="display-serif">{t("appShell.selectSessionHint")}</span>
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                  <div className="display-serif" style={{ fontSize: 20, color: "var(--text)", marginBottom: 8 }}>{t("appShell.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("appShell.getStartedStep1")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>
                    {(() => {
                      // One translatable sentence; the {models} slot is rendered
                      // as the emphasized button name so word order stays free.
                      const [before, after] = t("appShell.getStartedStep2").split("{models}");
                      return (
                        <>
                          {before}
                          <strong style={{ color: "var(--text)" }}>{t("appShell.models")}</strong>
                          {after}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </main>

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>

        </div>

        {/* Keep open viewers mounted so switching tabs preserves scroll and preview state. */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {fileTabs.length > 0 ? fileTabs.map((tab) => (
            <div key={tab.id} style={{ display: tab.id === activeFileTabId ? "block" : "none", height: "100%" }}>
              <FileViewer
                filePath={tab.filePath}
                cwd={activeCwd ?? undefined}
                sourceSessionId={tab.sourceSessionId}
                gitRefreshKey={explorerRefreshKey}
                onMentionLines={tab.id === activeFileTabId && rightPanelOpen ? handleFileLineMention : undefined}
                onOpenFile={(filePath) => handleOpenFile(
                  filePath,
                  getFileName(filePath),
                  tab.sourceSessionId,
                )}
              />
            </div>
          )) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
              {t("appShell.noFileOpen")}
            </div>
          )}
        </div>
      </div>
    </div>
    {/* File panel toggle — always visible at top-right */}
    <button
      onClick={() => setRightPanelOpen((v) => !v)}
      title={rightPanelOpen ? t("appShell.hideFilePanel") : t("appShell.showFilePanel")}
      aria-label={rightPanelOpen ? t("appShell.hideFilePanel") : t("appShell.showFilePanel")}
      style={{
        position: "fixed", top: 0, right: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: isMobile ? 44 : 36, height: isMobile ? 44 : 36, padding: 0,
        background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
        color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", transition: "color var(--dur-fast) var(--ease-out-warm)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
    {settingsTab && <SettingsConfig activeTab={settingsTab} toolCallsDefaultCollapsed={toolCallsDefaultCollapsed} onToolCallsDefaultCollapsedChange={handleToolCallsDefaultCollapsedChange} cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd} sessionId={selectedSession?.id ?? null} onModelsSaved={() => setModelsRefreshKey((k) => k + 1)} onPluginsReloaded={() => setSessionKey((k) => k + 1)} onOmpUpdateAvailabilityChange={setOmpUpdateAvailable} onSelectTab={setSettingsTab} onClose={() => setSettingsTab(null)} />}
    {archiveBrowserOpen && (
      <ArchiveBrowser
        open={archiveBrowserOpen}
        onClose={() => setArchiveBrowserOpen(false)}
        onRestored={handleArchiveRestored}
      />
    )}
    </ContextMenuProvider>
    </ToastProvider>
    </>
  );
}
