/**
 * Client-side preference for the directory picker used when adding a workspace
 * (localStorage). Kept out of `lib/directory-browser.ts` because that module
 * imports `fs/promises` and must never reach the browser bundle; kept out of
 * the native OMP config because it is an ompweb UI behavior, not an agent one.
 */

const SHOW_HIDDEN_KEY = "omp-web:directory-picker-show-hidden";

/** Default: dot-prefixed folders (`.git`, `.cache`) stay out of the listing. */
export function getShowHiddenDirectories(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SHOW_HIDDEN_KEY) === "true";
  } catch {
    // storage unavailable (private mode etc.) — use the default
    return false;
  }
}

export function setShowHiddenDirectories(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SHOW_HIDDEN_KEY, value ? "true" : "false");
  } catch {
    // storage unavailable — the preference simply won't persist
  }
}
