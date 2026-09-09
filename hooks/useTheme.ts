"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ThemePreset = "signal" | "coral" | "mint" | "electric";
type Theme = "light" | "dark";

export type ThemePresetDefinition = {
  id: ThemePreset;
  name: string;
  preview: Record<Theme, { bg: string; panel: string; accent: string; text: string }>;
};

export const DEFAULT_THEME_PRESET: ThemePreset = "signal";
export const THEME_PRESETS: readonly ThemePresetDefinition[] = [
  { id: "signal", name: "Signal", preview: { light: { bg: "#F5F2EA", panel: "#FFFFFF", accent: "#FFD400", text: "#111111" }, dark: { bg: "#141414", panel: "#1C1C1C", accent: "#FFD400", text: "#F5F2EA" } } },
  { id: "coral", name: "Coral", preview: { light: { bg: "#FBF3EE", panel: "#FFFFFF", accent: "#FF7A59", text: "#1A1A1A" }, dark: { bg: "#161314", panel: "#1F1A1B", accent: "#FF7A59", text: "#FBF3EE" } } },
  { id: "mint", name: "Mint", preview: { light: { bg: "#EEF6F1", panel: "#FFFFFF", accent: "#5CE0A8", text: "#0F1A14" }, dark: { bg: "#0F1512", panel: "#161E1A", accent: "#5CE0A8", text: "#EEF6F1" } } },
  { id: "electric", name: "Electric", preview: { light: { bg: "#EEF1FB", panel: "#FFFFFF", accent: "#4F7CFF", text: "#0B0F1F" }, dark: { bg: "#0E1120", panel: "#151A2E", accent: "#6B90FF", text: "#EEF1FB" } } },
] as const;

const LEGACY_PRESET_MAP: Record<string, ThemePreset> = {
  obsidian: "electric",
  carbon: "signal",
  cyber: "electric",
  emerald: "mint",
  violet: "electric",
  amber: "signal",
  ember: "coral",
  graphite: "signal",
  ocean: "electric",
  forest: "mint",
  rose: "coral",
};
const STORAGE_KEY = "omp-theme";
const PRESET_STORAGE_KEY = "omp-theme-preset";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function storedPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}
export function normalizeThemePreset(value: string | null): ThemePreset {
  if (!value) return DEFAULT_THEME_PRESET;
  if (value in LEGACY_PRESET_MAP) return LEGACY_PRESET_MAP[value];
  return THEME_PRESETS.some((preset) => preset.id === value) ? (value as ThemePreset) : DEFAULT_THEME_PRESET;
}

function storedPreset(): ThemePreset {
  if (typeof window === "undefined") return DEFAULT_THEME_PRESET;
  try {
    return normalizeThemePreset(localStorage.getItem(PRESET_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PRESET;
  }
}


export function resolveTheme(preference: ThemePreference, prefersDark = false): Theme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  return preference === "light" ? "dark" : preference === "dark" ? "system" : "light";
}

function applyPreference(preference: ThemePreference): void {
  const dark = resolveTheme(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Theme selection remains usable when storage is unavailable.
  }
  listeners.forEach((cb) => cb());
}

function applyPreset(preset: ThemePreset): void {
  document.documentElement.dataset.themePreset = preset;
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, preset);
  } catch {
    // Theme selection remains usable when storage is unavailable.
  }
  listeners.forEach((cb) => cb());
}

function getServerSnapshot(): ThemePreference {
  return "system";
}
function getServerPresetSnapshot(): ThemePreset {
  return DEFAULT_THEME_PRESET;
}


type ToggleOrigin = { x: number; y: number };
function motionDurationMs(variable: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (raw.endsWith("ms")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }
  if (raw.endsWith("s")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value * 1000 : fallback;
  }
  return fallback;
}


export function useTheme() {
  const preference = useSyncExternalStore(subscribe, storedPreference, getServerSnapshot);
  const preset = useSyncExternalStore(subscribe, storedPreset, getServerPresetSnapshot);
  // The OS preference is browser-only. Deferring it until after hydration keeps
  // the initial client tree identical to the server's system/light snapshot.
  const [hydrated, setHydrated] = useState(false);
  const [osDark, setOsDark] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  // Track the OS color scheme in state so an OS light/dark flip changes the
  // snapshot and re-renders isDark consumers, even when the stored preference
  // itself ("system") is unchanged. Registered unconditionally at subscription
  // time: consumers on an explicit light/dark preference still keep osDark
  // fresh for when they switch back to system.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setOsDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const prefersDark = hydrated && osDark;
  const theme = resolveTheme(preference, prefersDark);

  // Own the DOM class after hydration. An explicit choice enforces the stored
  // preference (this also repairs a transient hydration mismatch: the first
  // client render uses the server "system" snapshot, so the branch below may
  // briefly apply the OS theme before the real preference arrives). "system"
  // follows the OS live.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (preference !== "system") {
      document.documentElement.classList.toggle("dark", preference === "dark");
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.classList.toggle("dark", media.matches);
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const applyWithTransition = useCallback((apply: () => void, origin?: ToggleOrigin) => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";
    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      const styles = getComputedStyle(document.documentElement);
      document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] }, {
        duration: motionDurationMs("--dur-theme", 450),
        easing: styles.getPropertyValue("--ease-out-warm").trim() || "ease-out",
        pseudoElement: "::view-transition-new(root)",
      });
    }).catch(() => {});
    transition.finished?.catch(() => {});
  }, []);

  const setTheme = useCallback((next: ThemePreference, origin?: ToggleOrigin) => {
    applyWithTransition(() => applyPreference(next), origin);
  }, [applyWithTransition]);

  const setPreset = useCallback((next: ThemePreset, origin?: ToggleOrigin) => {
    applyWithTransition(() => applyPreset(next), origin);
  }, [applyWithTransition]);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => setTheme(nextThemePreference(preference), origin), [preference, setTheme]);

  return { theme, preference, preset, isDark: theme === "dark", setTheme, setPreset, toggleTheme };
}
