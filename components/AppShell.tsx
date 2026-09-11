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
import { ArrowDown, ArrowUp, ArrowUpRight, Bot, Check, CheckCheck, ChevronDown, CircleCheck, Copy, Database, DollarSign, Folder, Gauge, Hash, History, Menu, Moon, PanelLeft, Percent, Sun, Terminal, User, Wand2, Wrench, Zap } from "lucide-react";
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
import {
  APP_UPDATE_COMPLETED_RELOAD_MS,
  APP_UPDATE_POLL_MS,
  APP_UPDATE_PREPARING_MIN_MS,
  APP_UPDATE_STOPPING_POLL_MS,
  APP_UPDATE_TIMEOUT_MS,
  APP_UPDATE_VISIBLE_STAGE_MIN_MS,
  AppUpdateTransportError,
  COMPLETED_APP_UPDATE_KEY,
  DISMISSED_APP_UPDATE_KEY,
  fetchAppUpdateJson,
  isExactLegacyTargetCompletion,
  sanitizeAppUpdateError,
  waitForAppUpdateDwell,
} from "./AppShell-app-update";
import {
  PanelLoadingFallback,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  loadSidebarWidth,
  projectLabel,
} from "./AppShell-layout";
import {
  formatProviderUsageReport,
  formatUsageReset,
  usageTone,
  useProviderUsage,
} from "./AppShell-provider-usage";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo, GenerationSpeedInfo } from "@/lib/pi-types";
import type { ProviderUsageContext } from "@/lib/provider-usage-types";
import type { SettingsTab } from "./SettingsTabs";
import { SettingsConfig } from "./SettingsConfig";
import {
  AppUpdateDialog,
  getAppUpdateStageIndex,
  getNextAppUpdateStage,
  getMonotonicAppUpdateStage,
  type AppUpdateInfo,
  type AppUpdatePhase,
  type AppUpdateStage,
} from "./AppUpdateDialog";
import { ArchiveBrowser } from "./ArchiveBrowser";
import { publishSessionsChanged } from "@/lib/session-change-bus";
import { ContextMenuProvider } from "./ContextMenuContext";
// The settings shell is part of the app bundle so opening it does not fetch or compile a modal chunk. The file viewer remains on demand.
const FileViewer = dynamic(() => import("./FileViewer").then((m) => m.FileViewer), {
  ssr: false,
  loading: () => <PanelLoadingFallback />,
});

const TOOL_CALLS_COLLAPSED_STORAGE_KEY = "omp-web:tool-calls-collapsed";
const PROVIDER_USAGE_VISIBLE_STORAGE_KEY = "omp-web:provider-usage-visible";

const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), {
  ssr: false,
});

type SessionCopyField = "file" | "id";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };
type TimerHandle = NodeJS.Timeout;

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
  const [providerUsageVisible, setProviderUsageVisible] = useState(true);
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
      setProviderUsageVisible(window.localStorage.getItem(PROVIDER_USAGE_VISIBLE_STORAGE_KEY) !== "false");
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
  const handleProviderUsageVisibleChange = useCallback((visible: boolean) => {
    setProviderUsageVisible(visible);
    try {
      window.localStorage.setItem(PROVIDER_USAGE_VISIBLE_STORAGE_KEY, String(visible));
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
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [appUpdateDialogOpen, setAppUpdateDialogOpen] = useState(false);
  const [appUpdatePhase, setAppUpdatePhase] = useState<AppUpdatePhase>("idle");
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const appUpdateAttemptRef = useRef<string | null>(null);
  const appUpdateStartInFlightRef = useRef(false);
  const appUpdateCompletingRef = useRef(false);
  const [appUpdateVisibleStage, setAppUpdateVisibleStage] = useState<AppUpdateStage | undefined>();
  const appUpdateVisibleStageRef = useRef<AppUpdateStage | undefined>(undefined);
  const appUpdateVisibleStageStartedAtRef = useRef<number | null>(null);
  const appUpdateCommittedAttemptRef = useRef<string | null>(null);
  const appUpdateRecoveryCommitAttemptRef = useRef<string | null>(null);
  const appUpdateStageFlowRef = useRef(0);
  const appUpdateAcknowledgementsRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const advanceAppUpdateVisibleStage = useCallback((next: AppUpdateStage) => {
    const visible = getMonotonicAppUpdateStage(appUpdateVisibleStageRef.current, next);
    if (visible === appUpdateVisibleStageRef.current) return;
    appUpdateVisibleStageRef.current = visible;
    appUpdateVisibleStageStartedAtRef.current = Date.now();
    setAppUpdateVisibleStage(visible);
  }, []);
  const resetAppUpdateVisibleStage = useCallback(() => {
    appUpdateVisibleStageRef.current = undefined;
    appUpdateStageFlowRef.current += 1;
    appUpdateVisibleStageStartedAtRef.current = null;
    appUpdateCommittedAttemptRef.current = null;
    appUpdateRecoveryCommitAttemptRef.current = null;
    setAppUpdateVisibleStage(undefined);
    setAppUpdate((current) => current?.appUpdateDrain
      ? { ...current, appUpdateDrain: undefined }
      : current);
  }, []);
  const showAppUpdateStagesThrough = useCallback(async (target: AppUpdateStage) => {
    const stageFlow = appUpdateStageFlowRef.current;
    const targetIndex = getAppUpdateStageIndex(target);
    if (appUpdateVisibleStageRef.current === undefined) {
      advanceAppUpdateVisibleStage(target);
      return;
    }
    while (true) {
      const current = appUpdateVisibleStageRef.current;
      if (current === undefined || getAppUpdateStageIndex(current) >= targetIndex) return;
      await waitForAppUpdateDwell(
        appUpdateVisibleStageStartedAtRef.current,
        current === "preparing" ? APP_UPDATE_PREPARING_MIN_MS : APP_UPDATE_VISIBLE_STAGE_MIN_MS,
      );
      if (appUpdateStageFlowRef.current !== stageFlow) return;
      const latest = appUpdateVisibleStageRef.current;
      if (latest === undefined || getAppUpdateStageIndex(latest) >= targetIndex) return;
      const next = getNextAppUpdateStage(latest);
      if (next === undefined) return;
      advanceAppUpdateVisibleStage(next);
    }
  }, [advanceAppUpdateVisibleStage]);
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
  const refreshAppUpdate = useCallback(async (force = false, autoOpen = false): Promise<AppUpdateInfo | null> => {
    const data = await fetchAppUpdateJson<AppUpdateInfo>(
      force ? "/api/app-update?force=1" : "/api/app-update",
      { cache: "no-store" },
    );
    if (
      autoOpen
      && (appUpdateStartInFlightRef.current || appUpdateAttemptRef.current !== null || appUpdateCompletingRef.current)
    ) return null;

    setAppUpdate(data);

    if (autoOpen && !data.selfUpdateStatus && data.updateAvailable && data.availableVersion) {
      if (data.selfUpdateSupported === true) {
        let dismissed: string | null = null;
        try { dismissed = window.localStorage.getItem(DISMISSED_APP_UPDATE_KEY); } catch {}
        if (dismissed !== data.availableVersion) {
          setAppUpdatePhase("idle");
          setAppUpdateError(null);
          setAppUpdateDialogOpen(true);
        }
      } else {
        const cmd = data.updateCommand || "npm install -g @kahme247/ompweb";
        toast.info(
          translate("appShell.appUpdateAvailable"),
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <div>{translate("appShell.updateVersion", { current: data.currentVersion ?? "?", available: data.availableVersion })}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <code style={{ background: "var(--bg-panel)", padding: "3px 7px", borderRadius: "var(--radius-control)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {cmd}
              </code>
              <button
                type="button"
                onClick={() => {
                  void copyText(cmd)
                    .then(() => toast.success(translate("appShell.commandCopied")))
                    .catch(() => toast.error(translate("appShell.commandCopyFailed")));
                }}
                style={{ padding: "3px 7px", border: "var(--bw) solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
              >
                {translate("appShell.copyCommand")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsTab("system");
                  toast.close("app-update-available");
                }}
                style={{ padding: "3px 7px", border: "var(--bw) solid var(--accent-strong)", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
              >
                {translate("settingsConfig.appUpdateAction")}
              </button>
            </div>
          </div>,
          { id: "app-update-available", timeout: 0 }
        );
      }
    }
    return data;
  }, []);

  const acknowledgeAppUpdate = useCallback((attemptId: string): Promise<boolean> => {
    const existing = appUpdateAcknowledgementsRef.current.get(attemptId);
    if (existing) return existing;
    const request = (async () => {
      try {
        const response = await fetch("/api/app-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "acknowledge", attemptId }),
        });
        return response.ok;
      } catch {
        return false;
      }
    })();
    appUpdateAcknowledgementsRef.current.set(attemptId, request);
    void request.then((acknowledged) => {
      if (!acknowledged && appUpdateAcknowledgementsRef.current.get(attemptId) === request) {
        appUpdateAcknowledgementsRef.current.delete(attemptId);
      }
    });
    return request;
  }, []);

  const showAppUpdateFailure = useCallback((error: unknown) => {
    appUpdateAttemptRef.current = null;
    appUpdateStartInFlightRef.current = false;
    appUpdateCommittedAttemptRef.current = null;
    setAppUpdateError(sanitizeAppUpdateError(error) || null);
    setAppUpdatePhase("failed");
    appUpdateStageFlowRef.current += 1;
    setAppUpdateDialogOpen(true);
  }, []);

  const submitAppUpdateCommit = useCallback((attemptId: string) => {
    void fetchAppUpdateJson<{ error?: string }>("/api/app-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "commit", attemptId }),
      keepalive: true,
    }, 202).then(() => {
      if (appUpdateAttemptRef.current === attemptId) {
        appUpdateCommittedAttemptRef.current = attemptId;
      }
    }).catch((error) => {
      if (error instanceof AppUpdateTransportError) {
        if (appUpdateRecoveryCommitAttemptRef.current === attemptId) {
          appUpdateRecoveryCommitAttemptRef.current = null;
        }
        return;
      }
      if (appUpdateAttemptRef.current !== attemptId) return;
      showAppUpdateFailure(error);
    });
  }, [showAppUpdateFailure]);

  const recoverPreparedAppUpdate = useCallback((data: AppUpdateInfo, attemptId: string) => {
    const status = data.selfUpdateStatus;
    if (
      status?.attemptId !== attemptId
      || status.state !== "prepared"
      || (status.stage !== "preparing" && status.stage !== "stopping")
    ) return;
    if (appUpdateRecoveryCommitAttemptRef.current === attemptId) return;
    appUpdateRecoveryCommitAttemptRef.current = attemptId;
    submitAppUpdateCommit(attemptId);
  }, [submitAppUpdateCommit]);

  const completeAppUpdate = useCallback(async (targetVersion: string) => {
    if (appUpdateCompletingRef.current) return;
    appUpdateCompletingRef.current = true;
    appUpdateAttemptRef.current = null;
    appUpdateCommittedAttemptRef.current = null;
    appUpdateStartInFlightRef.current = false;
    await showAppUpdateStagesThrough("finalizing");
    await waitForAppUpdateDwell(appUpdateVisibleStageStartedAtRef.current, APP_UPDATE_VISIBLE_STAGE_MIN_MS);
    setAppUpdateError(null);
    setAppUpdatePhase("completed");
    setAppUpdateDialogOpen(true);
    try {
      window.sessionStorage.setItem(COMPLETED_APP_UPDATE_KEY, JSON.stringify({ version: targetVersion }));
    } catch {}
    await new Promise<void>((resolve) => window.setTimeout(resolve, APP_UPDATE_COMPLETED_RELOAD_MS));
    appUpdateRecoveryCommitAttemptRef.current = null;
    window.location.reload();
  }, [showAppUpdateStagesThrough]);

  const handleTerminalAppUpdate = useCallback(async (
    data: AppUpdateInfo,
    attemptId: string,
    targetVersion: string,
  ): Promise<boolean> => {
    const status = data.selfUpdateStatus;
    if (status?.attemptId !== attemptId || status.cleanupReady !== true) return false;
    if (status.state === "failed") {
      if (!await acknowledgeAppUpdate(attemptId)) return false;
      showAppUpdateFailure(status.error);
      return true;
    }
    if (status.state === "succeeded" && data.currentVersion === targetVersion) {
      if (!await acknowledgeAppUpdate(attemptId)) return false;
      await completeAppUpdate(targetVersion);
      return true;
    }
    return false;
  }, [acknowledgeAppUpdate, completeAppUpdate, showAppUpdateFailure]);

  const monitorAppUpdate = useCallback(async (attemptId: string, targetVersion: string) => {
    if (appUpdateAttemptRef.current === attemptId) return;
    appUpdateAttemptRef.current = attemptId;
    const deadline = Date.now() + APP_UPDATE_TIMEOUT_MS;
    while (appUpdateAttemptRef.current === attemptId && Date.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(
        resolve,
        appUpdateVisibleStageRef.current === "stopping" ? APP_UPDATE_STOPPING_POLL_MS : APP_UPDATE_POLL_MS,
      ));
      try {
        const data = await refreshAppUpdate();
        if (!data) continue;
        const status = data.selfUpdateStatus;
        if (status?.attemptId === attemptId && status.stage !== undefined) {
          if (status.stage !== "preparing") appUpdateCommittedAttemptRef.current = attemptId;
          await showAppUpdateStagesThrough(status.stage);
        }
        recoverPreparedAppUpdate(data, attemptId);
        if (await handleTerminalAppUpdate(data, attemptId, targetVersion)) return;
        if (isExactLegacyTargetCompletion(data, targetVersion)) {
          // Legacy targets do not expose the status/acknowledge contract. Exact
          // version equality is the completion proof; updater artifacts expire
          // through the backend's terminal-status TTL instead of UI cleanup.
          await completeAppUpdate(targetVersion);
          return;
        }
      } catch (error) {
        if (error instanceof AppUpdateTransportError) {
          if (appUpdateCommittedAttemptRef.current === attemptId) {
            advanceAppUpdateVisibleStage("installing");
          }
          // Connection failures are expected after commit while the server is offline.
          continue;
        }
        showAppUpdateFailure(error);
        return;
      }
    }
    if (appUpdateAttemptRef.current === attemptId) {
      showAppUpdateFailure(t("appUpdateDialog.timeout"));
    }
  }, [advanceAppUpdateVisibleStage, completeAppUpdate, handleTerminalAppUpdate, recoverPreparedAppUpdate, refreshAppUpdate, showAppUpdateFailure, showAppUpdateStagesThrough, t]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(COMPLETED_APP_UPDATE_KEY);
      if (raw) {
        const completed = JSON.parse(raw) as { version?: unknown };
        window.sessionStorage.removeItem(COMPLETED_APP_UPDATE_KEY);
        if (typeof completed.version === "string") {
          toast.success(t("appUpdateDialog.completed", { version: completed.version }));
        }
      }
    } catch {}
  }, [t]);

  const proceedWithAppUpdate = useCallback(async () => {
    if (appUpdateStartInFlightRef.current) return;
    appUpdateStartInFlightRef.current = true;
    appUpdateCompletingRef.current = false;
    resetAppUpdateVisibleStage();
    advanceAppUpdateVisibleStage("preparing");
    setAppUpdatePhase("preparing");
    setAppUpdateError(null);
    try {
      const prepared = await fetchAppUpdateJson<{ attemptId?: string; targetVersion?: string }>("/api/app-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare" }),
      });
      if (!prepared.attemptId || !prepared.targetVersion) {
        throw new Error("Invalid update response");
      }
      submitAppUpdateCommit(prepared.attemptId);
      void monitorAppUpdate(prepared.attemptId, prepared.targetVersion);
      await showAppUpdateStagesThrough("stopping");
      if (appUpdateAttemptRef.current !== prepared.attemptId) return;
      setAppUpdatePhase("restarting");
    } catch (error) {
      showAppUpdateFailure(error);
    }
  }, [advanceAppUpdateVisibleStage, monitorAppUpdate, resetAppUpdateVisibleStage, showAppUpdateFailure, showAppUpdateStagesThrough, submitAppUpdateCommit]);

  const dismissAppUpdate = useCallback(() => {
    if (appUpdatePhase === "idle" && appUpdate?.availableVersion) {
      try { window.localStorage.setItem(DISMISSED_APP_UPDATE_KEY, appUpdate.availableVersion); } catch {}
      toast.info(t("appUpdateDialog.settingsLater"));
    }
    setAppUpdateDialogOpen(false);
    setAppUpdatePhase("idle");
    setAppUpdateError(null);
    appUpdateAttemptRef.current = null;
    resetAppUpdateVisibleStage();
  }, [appUpdate?.availableVersion, appUpdatePhase, resetAppUpdateVisibleStage, t]);

  const requestAppUpdateFromSettings = useCallback(() => {
    setSettingsTab(null);
    resetAppUpdateVisibleStage();
    setAppUpdateError(null);
    setAppUpdatePhase("idle");
    window.requestAnimationFrame(() => setAppUpdateDialogOpen(true));
  }, [resetAppUpdateVisibleStage]);
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
  const statusBtnRef = useRef<HTMLButtonElement>(null);

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
  const autoNameTimerRef = useRef<TimerHandle | undefined>(undefined);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  const archiveRetryTimerRef = useRef<TimerHandle | undefined>(undefined);
  useEffect(() => () => clearTimeout(archiveRetryTimerRef.current), []);
  useLayoutEffect(() => {
    activeSessionIdRef.current = selectedSession?.id ?? null;
  }, [selectedSession?.id]);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<TimerHandle | undefined>(undefined);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  const [providerUsageContext, setProviderUsageContext] = useState<ProviderUsageContext | null>(null);
  const handleProviderUsageContextChange = useCallback((context: ProviderUsageContext | null) => {
    setProviderUsageContext(context);
  }, []);
  const activeProvider = providerUsageContext?.provider ?? null;
  const activeModelId = providerUsageContext?.modelId ?? null;
  const providerUsageQuery = providerUsageVisible && activeProvider
    ? new URLSearchParams({ provider: activeProvider, ...(activeModelId ? { model: activeModelId } : {}) }).toString()
    : null;
  const { snapshot: providerUsage } =
    useProviderUsage(providerUsageQuery, 5 * 60_000);


  useEffect(() => {
    return () => {
      clearTimeout(sessionCopyTimerRef.current);
      clearTimeout(autoNameTimerRef.current);
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
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "status" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const toggleTopPanel = useCallback((panel: "branches" | "system" | "status") => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);
  const { snapshot: allProviderUsage, loading: allProviderUsageLoading, error: allProviderUsageError } =
    useProviderUsage(activeTopPanel === "status" && providerUsageVisible ? "" : null, 5 * 60_000);
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

  const openStatusPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("status");
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
    // Interface Scale (html[data-ui-scale] zoom) leaves clientX in viewport
    // pixels while the sidebar width is zoomed layout pixels: scale the drag
    // delta so the edge tracks the pointer at any zoom (same --ui-scale
    // ground truth as the zoom-aware menus in SessionSidebar-chrome).
    let uiScale = 1;
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
      const value = parseFloat(raw);
      if (Number.isFinite(value) && value > 0) uiScale = value;
    } catch {
      // SSR/unavailable: fall back to unscaled math.
    }
    setSidebarResizing(true);
    const onMove = (ev: MouseEvent) => {
      const next = clampSidebarWidth(startWidth + (ev.clientX - startX) / uiScale);
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


  // Dismiss the topbar dropdowns on outside click or Escape. The Escape
  // handler stops propagation so the global Esc (abort agent) does not fire
  // while a panel is open.
  useEffect(() => {
    // The branch panel manages its own outside-click and Escape dismissal.
    if (!activeTopPanel || activeTopPanel === "branches") return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-top-panel]")) return;
      if (systemBtnRef.current?.contains(event.target as Node)) return;
      if (statusBtnRef.current?.contains(event.target as Node)) return;
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
  // During the initial URL restore the sidebar adopts the restored cwd and
  // notifies us; that first onCwdChange must not bump sessionKey. We store the
  // expected cwd string and only skip when it matches, so a failure to fire
  // can't leave the suppression armed for the user's next genuine switch.
  const suppressCwdRef = useRef<string | null>(null);

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
        suppressCwdRef.current = data.cwd;
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
    // Skip only when the notification matches the cwd we're suppressing for.
    if (suppressCwdRef.current !== null && suppressCwdRef.current === cwd) {
      suppressCwdRef.current = null;
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
    // Re-picking the already-open session (sidebar double-click, palette
    // re-select, notification click) must not bump sessionKey: that remounts
    // ChatWindow, reconnects SSE, and drops the mid-run streaming view.
    if (!isRestore && session.id === selectedSession?.id) return;
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
      // onCwdChange effect firing after setSelectedCwd in the sidebar. We
      // arm the expected cwd (compared in handleCwdChange) rather than a
      // sticky flag so a missed notification can't suppress the next
      // genuine project switch.
      suppressCwdRef.current = session.cwd;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile, selectedSession?.id]);

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
    } else {
      // "denied": the OS blocks notifications, so surface the completion as an
      // in-app toast instead of leaving background completions silent.
      toast.info(targetSession?.name ?? translate("appShell.sessionComplete"), translate("appShell.taskFinished"));
    }
  }, [handleSelectSession, selectedSession]);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    clearTimeout(autoNameTimerRef.current);
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
      if (activeSessionIdRef.current !== sessionId) return;
      setRefreshKey((key) => key + 1);
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
    clearTimeout(autoNameTimerRef.current);
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
      // path === "" is the sidebar's optimistic-row marker; keep it so the
      // fork shows up immediately instead of waiting for a refresh.
      path: "",
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

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
  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleArchiveRestored = useCallback(async (sessionId: string) => {
    setArchiveBrowserOpen(false);
    publishSessionsChanged([sessionId]);
    setRefreshKey((k) => k + 1);

    // The poll must not yank the UI back to the restored session if the user
    // picks another one while we wait, and an untracked setTimeout chain would
    // keep retrying after unmount — so freeze the selection at start, bail out
    // of every attempt + the fallback when it changed, and track the timer.
    const sessionAtRestoreStart = activeSessionIdRef.current;
    const selectRestoredSession = async (attemptsLeft = 5): Promise<void> => {
      if (activeSessionIdRef.current !== sessionAtRestoreStart) return;
      try {
        const res = await fetch("/api/sessions");
        if (res.ok) {
          const data = (await res.json()) as { sessions?: SessionInfo[] };
          const found = data.sessions?.find((s) => s.id === sessionId);
          if (found) {
            if (activeSessionIdRef.current !== sessionAtRestoreStart) return;
            handleSelectSession(found, false);
            return;
          }
        }
      } catch {
        // network error / abort
      }

      if (attemptsLeft > 0) {
        archiveRetryTimerRef.current = setTimeout(() => void selectRestoredSession(attemptsLeft - 1), 300);
      } else if (activeSessionIdRef.current === sessionAtRestoreStart) {
        router.replace(`?session=${encodeURIComponent(sessionId)}`, { scroll: false });
      }
    };

    void selectRestoredSession();
  }, [handleSelectSession, router]);

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
        onNewSession={() => {
          // An empty cwd is truthy, so showChat would render the shell while
          // useAgentSession refuses to start — every send a silent no-op.
          // Fall back to the server's default cwd (~/omp-cwd-<date>) instead.
          if (activeCwd) {
            handleNewSession(`palette-${Date.now()}`, activeCwd);
            return;
          }
          void fetch("/api/default-cwd", { method: "POST" })
            .then(async (response) => {
              const data = (await response.json().catch(() => ({}))) as { cwd?: string };
              if (!response.ok || !data.cwd) throw new Error(`HTTP ${response.status}`);
              handleNewSession(`palette-${Date.now()}`, data.cwd);
            })
            .catch(() => toast.error(translate("errors.generic")));
        }}
        onToggleSidebar={handleSidebarToggle}
        onOpenSettings={(tab) => setSettingsTab(tab)}
        onOpenArchive={() => setArchiveBrowserOpen(true)}
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
        updateAvailable={Boolean(appUpdate?.updateAvailable) || ompUpdateAvailable}
      />
    </>
  );
  const currentProviderUsageReport = providerUsage?.reports[0] ?? null;
  const currentProviderUsageText = currentProviderUsageReport && !currentProviderUsageReport.noLimits
    ? formatProviderUsageReport(currentProviderUsageReport, "")
    : null;
  const currentProviderUsagePercents = currentProviderUsageReport ? [
    currentProviderUsageReport.fiveHour?.percent,
    currentProviderUsageReport.sevenDay?.percent,
    currentProviderUsageReport.monthly?.percent,
  ].filter((percent): percent is number => percent !== undefined) : [];
  const currentProviderUsageColor = currentProviderUsagePercents.length > 0
    ? usageTone(Math.max(...currentProviderUsagePercents))
    : "var(--text-muted)";

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
        border: var(--bw) solid var(--border);
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
        border: var(--bw) solid var(--border);
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
    <div style={{ display: "flex", height: "100%", flex: 1, overflow: "hidden", background: "var(--bg)" }}>
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
          borderRight: "var(--bw) solid var(--border)",
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
          className="sidebar-resize-handle"
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
          onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.background = "transparent"; }}
        />
      )}

      {/* Center: chat */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar: 3-zone segmented control bar */}
        <div ref={topBarRef} className="shell-topbar" style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          borderBottom: "var(--bw) solid var(--border)",
          height: isMobile ? 44 : 36,
          background: "var(--bg-panel)",
          padding: isMobile ? "0 4px" : "0 8px",
          gap: 8,
          minWidth: 0,
        }}>
          {/* Left Zone: Utility group (sidebar, theme, language) & session controls (history, branches, system) */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%", flexShrink: 0 }}>
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
            {showChat && (
              <>
                <div className="shell-toolbar-divider" aria-hidden="true" />
                <button
                  onClick={handleViewFullHistory}
                  disabled={!selectedSession}
                  title={selectedSession ? t("appShell.fullHistory") : t("appShell.fullHistoryUnavailable")}
                  aria-label={t("appShell.fullHistory")}
                  className="shell-toolbar-btn ui-focus-ring"
                >
                  <History size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
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
              </>
            )}
          </div>

          {/* Center Zone: Workspace & Session Breadcrumb + Auto-name action */}
          {showChat && (() => {
            const effectiveProject = selectedSession?.projectRoot ?? selectedSession?.cwd ?? activeCwd ?? "";
            const sessionTitle = selectedSession?.name || selectedSession?.firstMessage || t("appShell.newSession");
            const hasMessages = Boolean(
              selectedSession
              && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
            );
            const wandDisabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
            const wandIsSuccess = autoNameStatus.kind === "success";
            const wandIsError = autoNameStatus.kind === "error";
            const wandLabel = autoNameStatus.kind === "naming"
              ? t("appShell.generating")
              : wandIsSuccess
                ? t("appShell.titleUpdated")
                : wandIsError
                  ? t("appShell.generationFailed")
                  : t("appShell.generateTitle");
            const wandTooltip = !selectedSession
              ? t("appShell.titleGenUnavailable")
              : !hasMessages
                ? t("appShell.titleGenNeedsMessage")
                : wandIsError
                  ? autoNameStatus.message
                  : t("appShell.generateSessionTitle");

            return (
              <div
                className="shell-topbar-center"
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  maxWidth: "min(460px, calc(100% - 380px))",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                <div
                  className="shell-topbar-breadcrumb"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: "var(--radius-control)",
                    background: "var(--bg-subtle)",
                    border: "var(--bw) solid var(--border)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    maxWidth: "min(400px, 30vw)",
                    pointerEvents: "auto",
                    flexShrink: 1,
                  }}
                >
                  {effectiveProject ? (
                    <>
                      <Folder size={12} strokeWidth={1.8} style={{ opacity: 0.6, flexShrink: 0 }} aria-hidden="true" />
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--text)",
                          flexShrink: 0,
                          maxWidth: 120,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={effectiveProject}
                      >
                        {projectLabel(effectiveProject)}
                      </span>
                      <span style={{ color: "var(--text-dim)", flexShrink: 0, opacity: 0.5 }}>/</span>
                    </>
                  ) : null}
                  <span
                    style={{
                      color: "var(--text)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                    title={sessionTitle}
                  >
                    {sessionTitle}
                  </span>
                  {selectedSession && (
                    <button
                      type="button"
                      onClick={() => void handleAutoName()}
                      disabled={wandDisabled}
                      title={wandTooltip}
                      aria-label={wandLabel}
                      className="ui-focus-ring"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        padding: 0,
                        marginLeft: 2,
                        border: "none",
                        borderRadius: 4,
                        background: "transparent",
                        color: wandIsSuccess ? "var(--accent)" : wandIsError ? "var(--status-error)" : "var(--text-dim)",
                        cursor: wandDisabled ? "default" : "pointer",
                        flexShrink: 0,
                        opacity: autoNameStatus.kind === "naming" ? 1 : wandDisabled ? 0.35 : 0.75,
                        transition: "color var(--dur-fast), opacity var(--dur-fast)",
                      }}
                    >
                      {autoNameStatus.kind === "naming" ? (
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      ) : wandIsSuccess ? (
                        <Check size={12} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <Wand2 size={12} strokeWidth={1.8} aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Right Zone: unified status cluster (provider · context · cache · cost · live speed) */}
          <div
            data-topbar-right-group
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: "100%",
              paddingRight: isMobile ? (rightPanelOpen ? 0 : 44) : rightPanelOpen ? 8 : 44,
              flexShrink: 0,
            }}
          >
            {/* Single status cluster: provider · context · cache · cost · live speed */}
            {showChat && (() => {
              const tok = sessionStats?.tokens;
              const c = sessionStats?.cost ?? 0;
              const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;
              const cacheHitRate = tok ? getCacheHitRate(tok.input, tok.cacheRead) : null;
              const cacheRateStr = cacheHitRate !== null ? formatPercent(cacheHitRate) : null;

              let ctxColor = "var(--text-muted)";
              let ctxStr: string | null = null;
              if (contextUsage?.contextWindow) {
                const pct = contextUsage.percent;
                if (pct !== null && pct > 90) ctxColor = "var(--status-error)";
                else if (pct !== null && pct > 70) ctxColor = "var(--status-warning)";
                ctxStr = pct !== null ? `${formatPercent(pct)} / ${formatCompactNumber(contextUsage.contextWindow)}` : `? / ${formatCompactNumber(contextUsage.contextWindow)}`;
              }

              const showProvider = providerUsageVisible && Boolean(currentProviderUsageText);
              // At rest the session average is noise — surface speed only while generating.
              const liveSpeed = generationSpeed?.current ?? null;
              const liveSpeedStr = liveSpeed !== null ? `${liveSpeed.toFixed(1)} t/s` : null;
              if (!showProvider && !ctxStr && !cacheRateStr && !costStr && !liveSpeedStr) return null;

              const tooltipParts: string[] = [];
              if (showProvider) tooltipParts.push(t("appShell.tooltipProviderUsage", { value: currentProviderUsageText ?? "" }));
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
              if (liveSpeedStr) tooltipParts.push(t("appShell.tooltipCurrentSpeed", { value: liveSpeedStr }));
              const tooltip = tooltipParts.join("  |  ");

              return (
                <button
                  ref={statusBtnRef}
                  type="button"
                  data-provider-usage-trigger
                  onClick={() => toggleTopPanel("status")}
                  title={tooltip || t("appShell.statusPanel")}
                  aria-label={t("appShell.statusPanel")}
                  aria-pressed={activeTopPanel === "status"}
                  className="shell-metric-pill ui-focus-ring"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: "var(--radius-control)",
                    border: "var(--bw) solid var(--border)",
                    background: activeTopPanel === "status" ? "var(--bg-selected)" : "var(--bg-subtle)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    transition: "background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast)",
                  }}
                >
                  {showProvider && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: currentProviderUsageColor }}>
                      <Gauge size={13} strokeWidth={1.8} aria-hidden="true" />
                      {currentProviderUsageText}
                    </span>
                  )}
                  {ctxStr && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: ctxColor }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", color: "var(--text-muted)" }}>CTX</span>
                      {!isMobile && (
                        <span className="shell-ctx-bar" aria-hidden="true">
                          <span
                            className="shell-ctx-bar-fill"
                            style={{
                              width: `${Math.max(2, Math.min(100, contextUsage?.percent ?? 0))}%`,
                              background: ctxColor === "var(--text-muted)" ? "var(--accent)" : ctxColor,
                            }}
                          />
                        </span>
                      )}
                      {ctxStr}
                    </span>
                  )}
                  {!isMobile && cacheRateStr && (
                    <span className="shell-pill-extra" style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
                      <CircleCheck size={11} strokeWidth={1.8} aria-hidden="true" />
                      {cacheRateStr}
                    </span>
                  )}
                  {costStr && (
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>
                      {costStr}
                    </span>
                  )}
                  {liveSpeedStr && (
                    <span className="shell-pill-extra" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent)", fontWeight: 600 }}>
                      <Zap size={11} strokeWidth={2} aria-hidden="true" />
                      {liveSpeedStr}
                    </span>
                  )}
                  <ChevronDown size={11} strokeWidth={2} aria-hidden="true" style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                </button>
              );
            })()}
          </div>
          {(activeTopPanel === "system" || activeTopPanel === "status") && topPanelPos && (
            <div data-top-panel className="dropdown-surface" style={{
              position: "fixed",
              top: topPanelPos.top,
              right: isMobile ? 8 : 12,
              left: "auto",
              width: activeTopPanel === "status"
                ? "min(720px, calc(100vw - 24px))"
                : "min(560px, calc(100vw - 24px))",
              minWidth: 0,
              maxHeight: `min(70vh, calc(100dvh - ${topPanelPos.top}px - 12px))`,
              overflowY: "auto",
              overflowX: "hidden",
              boxSizing: "border-box",
              zIndex: 500,
            }}>
              {activeTopPanel === "status" && providerUsageVisible && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "var(--bw) solid var(--border)",
                  boxShadow: "var(--shadow-pop)",
                  padding: "14px 16px",
                  minWidth: isMobile ? undefined : 500,
                  maxWidth: "min(640px, calc(100vw - 24px))",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Gauge size={14} strokeWidth={2} style={{ color: "var(--accent)" }} aria-hidden="true" />
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t("appShell.sectionProviderUsage")}</div>
                    </div>
                    {allProviderUsageLoading && allProviderUsage && (
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("appShell.providerUsageLoading")}</span>
                    )}
                  </div>
                  {allProviderUsage?.reports.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, fontFamily: "var(--font-mono)" }}>
                      {allProviderUsage.reports.map((report, index) => {
                        const account = report.accountLabel ?? t("appShell.account", { number: report.accountIndex ?? index + 1 });
                        const key = `${report.provider}:${account}:${report.modelId ?? "all"}:${index}`;
                        return (
                          <div
                            key={key}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "var(--radius-card)",
                              background: "var(--bg-subtle)",
                              border: "var(--bw) solid var(--border)",
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {/* Card Header: Provider badge, account, plan, model */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{
                                  fontWeight: 700,
                                  fontSize: 11,
                                  color: "var(--text)",
                                  background: "var(--bg-panel)",
                                  border: "var(--bw) solid var(--border)",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                }}>
                                  {report.provider}
                                </span>
                                <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500 }}>
                                  {account}
                                </span>
                                {report.tier && (
                                  <span style={{ fontSize: 10, color: "var(--text-dim)", background: "var(--bg-panel)", border: "var(--bw) solid var(--border)", padding: "1px 5px", borderRadius: 3 }}>
                                    {report.tier}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
                                {report.plan && <span style={{ color: "var(--text-muted)" }}>{report.plan}</span>}
                                {report.modelId && <span>· {report.modelId}</span>}
                              </div>
                            </div>

                            {/* Quota Limits or Unlimited status */}
                            {report.noLimits ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)", padding: "2px 0" }}>
                                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                                <span>{t("appShell.providerUsageNoData")}</span>
                              </div>
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                                {report.fiveHour && (() => {
                                  const pct = Math.round(report.fiveHour.percent);
                                  const reset = report.fiveHour.resetMinutes !== undefined ? formatUsageReset(report.fiveHour.resetMinutes, "minutes") : null;
                                  const tone = usageTone(pct);
                                  return (
                                    <div style={{ background: "var(--bg-panel)", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "var(--bw) solid var(--border)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: 10 }}>
                                        <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>5h Window</span>
                                        <span style={{ color: tone, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                                      </div>
                                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: tone, borderRadius: 2, transition: "width 0.3s" }} />
                                      </div>
                                      {reset && <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4, textAlign: "right" }}>resets {reset}</div>}
                                    </div>
                                  );
                                })()}

                                {report.sevenDay && (() => {
                                  const pct = Math.round(report.sevenDay.percent);
                                  const reset = report.sevenDay.resetHours !== undefined ? formatUsageReset(report.sevenDay.resetHours, "hours") : null;
                                  const tone = usageTone(pct);
                                  return (
                                    <div style={{ background: "var(--bg-panel)", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "var(--bw) solid var(--border)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: 10 }}>
                                        <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>7d Window</span>
                                        <span style={{ color: tone, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                                      </div>
                                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: tone, borderRadius: 2, transition: "width 0.3s" }} />
                                      </div>
                                      {reset && <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4, textAlign: "right" }}>resets {reset}</div>}
                                    </div>
                                  );
                                })()}

                                {report.monthly && (() => {
                                  const pct = Math.floor(report.monthly.percent);
                                  const reset = report.monthly.resetHours !== undefined ? formatUsageReset(report.monthly.resetHours, "hours") : null;
                                  const tone = usageTone(pct);
                                  return (
                                    <div style={{ background: "var(--bg-panel)", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "var(--bw) solid var(--border)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: 10 }}>
                                        <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>Monthly</span>
                                        <span style={{ color: tone, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                                      </div>
                                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: tone, borderRadius: 2, transition: "width 0.3s" }} />
                                      </div>
                                      {reset && <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4, textAlign: "right" }}>resets {reset}</div>}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : allProviderUsageLoading ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>{t("appShell.providerUsageLoading")}</div>
                  ) : allProviderUsageError ? (
                    <div style={{ fontSize: 12, color: "var(--status-error)", fontStyle: "italic", padding: "8px 0" }}>{t("appShell.providerUsageUnavailable")}</div>
                  ) : allProviderUsage ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>{t("appShell.providerUsageNoData")}</div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>{t("appShell.providerUsageLoading")}</div>
                  )}
                </div>
              )}
              {activeTopPanel === "system" && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "var(--bw) solid var(--border)",
                  boxShadow: "var(--shadow-pop)",
                  minWidth: isMobile ? undefined : 420,
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
              {activeTopPanel === "status" && (
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
                    // Live rate while generating, session average at rest.
                    const statusSpeed = generationSpeed?.current ?? generationSpeed?.average ?? null;
                    const extraTokenRows: MetricRow[] = [
                      ...(cacheHitRate !== null ? [{ label: t("appShell.statCacheRate"), value: formatPercent(cacheHitRate), icon: <Percent size={12} strokeWidth={1.8} aria-hidden="true" />, color: cacheRateColor } as MetricRow] : []),
                      ...(ctx?.contextWindow ? [{ label: t("appShell.statContext"), value: `${ctx.percent !== null ? formatPercent(ctx.percent) : "?"} / ${formatCompactNumber(ctx.contextWindow)}`, icon: <Gauge size={12} strokeWidth={1.8} aria-hidden="true" />, color: ctxColor } as MetricRow] : []),
                      ...(sessionStats.cost > 0 ? [{ label: t("appShell.statCost"), value: `$${sessionStats.cost.toFixed(4)}`, icon: <DollarSign size={12} strokeWidth={1.8} aria-hidden="true" /> } as MetricRow] : []),
                      ...(statusSpeed != null ? [{ label: generationSpeed?.current != null ? "Speed" : "Avg speed", value: `${statusSpeed.toFixed(1)} t/s`, icon: <Zap size={12} strokeWidth={1.8} aria-hidden="true" />, color: generationSpeed?.current != null ? "var(--status-success)" : "var(--text-dim)" } as MetricRow] : []),
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
              onSessionStatsPanelOpen={openStatusPanel}
              onProviderUsageContextChange={handleProviderUsageContextChange}
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
          borderLeft: "var(--bw) solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "var(--bw) solid var(--border)", height: 36 }}>
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
        background: "var(--bg-panel)", border: "none", borderLeft: "var(--bw) solid var(--border)", borderBottom: "var(--bw) solid var(--border)",
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
    {settingsTab && <SettingsConfig activeTab={settingsTab} toolCallsDefaultCollapsed={toolCallsDefaultCollapsed} onToolCallsDefaultCollapsedChange={handleToolCallsDefaultCollapsedChange} providerUsageVisible={providerUsageVisible} onProviderUsageVisibleChange={handleProviderUsageVisibleChange} cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd} sessionId={selectedSession?.id ?? null} onModelsSaved={() => setModelsRefreshKey((k) => k + 1)} onPluginsReloaded={() => setSessionKey((k) => k + 1)} appUpdate={appUpdate} onRefreshAppUpdate={refreshAppUpdate} onOmpUpdateAvailabilityChange={setOmpUpdateAvailable} onRequestAppUpdate={requestAppUpdateFromSettings} onSelectTab={setSettingsTab} onClose={() => setSettingsTab(null)} />}
    <AppUpdateDialog open={appUpdateDialogOpen} update={appUpdate} phase={appUpdatePhase} visibleStage={appUpdateVisibleStage} error={appUpdateError} onProceed={() => void proceedWithAppUpdate()} onNotNow={dismissAppUpdate} />
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
