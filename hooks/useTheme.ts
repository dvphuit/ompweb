"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ThemePreset = "obsidian" | "carbon" | "cyber" | "emerald" | "violet" | "amber";
type Theme = "light" | "dark";

export type ThemePresetDefinition = {
  id: ThemePreset;
  name: string;
  preview: Record<Theme, { bg: string; panel: string; accent: string; text: string }>;
};

export const DEFAULT_THEME_PRESET: ThemePreset = "obsidian";
export const THEME_PRESETS: readonly ThemePresetDefinition[] = [
  { id: "obsidian", name: "Obsidian", preview: { light: { bg: "#FFFFFF", panel: "#F8F8FA", accent: "#4F46E5", text: "#09090B" }, dark: { bg: "#09090B", panel: "#121215", accent: "#818CF8", text: "#F4F4F5" } } },
  { id: "carbon", name: "Carbon", preview: { light: { bg: "#FFFFFF", panel: "#F5F5F5", accent: "#171717", text: "#171717" }, dark: { bg: "#0A0A0A", panel: "#141414", accent: "#EDEDED", text: "#EDEDED" } } },
  { id: "cyber", name: "Cyber", preview: { light: { bg: "#FFFFFF", panel: "#F1F5F9", accent: "#0E7490", text: "#0F172A" }, dark: { bg: "#080B10", panel: "#0E131C", accent: "#22D3EE", text: "#F0F6FC" } } },
  { id: "emerald", name: "Emerald", preview: { light: { bg: "#FFFFFF", panel: "#F2F7F4", accent: "#047857", text: "#0D1F14" }, dark: { bg: "#090D0B", panel: "#101713", accent: "#34D399", text: "#EDF5F0" } } },
  { id: "violet", name: "Violet", preview: { light: { bg: "#FFFFFF", panel: "#FAF5FF", accent: "#7E22CE", text: "#1E1035" }, dark: { bg: "#0C0912", panel: "#151020", accent: "#A855F7", text: "#F5F0FF" } } },
  { id: "amber", name: "Amber", preview: { light: { bg: "#FFFFFF", panel: "#FFFBEB", accent: "#B45309", text: "#291C05" }, dark: { bg: "#0F0C08", panel: "#19140C", accent: "#FBBF24", text: "#FFFBF0" } } },
] as const;

const LEGACY_PRESET_MAP: Record<string, ThemePreset> = {
  ember: "obsidian",
  graphite: "carbon",
  ocean: "cyber",
  forest: "emerald",
  rose: "violet",
  amber: "amber",
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
  useEffect(() => { setHydrated(true); }, []);
  const prefersDark = hydrated && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.classList.toggle("dark", media.matches);
      listeners.forEach((cb) => cb());
    };
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
