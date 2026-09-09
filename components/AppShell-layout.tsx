"use client";

import { useI18n } from "@/lib/i18n";

export function projectLabel(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

// Resizable desktop sidebar: the width is stored on the container as the
// --sidebar-width CSS variable (globals.css) and persisted between sessions.
export const SIDEBAR_WIDTH_STORAGE_KEY = "omp-web:sidebar-width";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 260;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function loadSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const width = raw ? Number(raw) : NaN;
    return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function PanelLoadingFallback() {
  const { t } = useI18n();
  return (
    <div role="status" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
      {t("appShell.loading")}
    </div>
  );
}
