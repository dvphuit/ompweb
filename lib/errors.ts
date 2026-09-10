/** Dependency-free error utilities shared across the API routes and the
 * pure-Node libs (session parsing, RPC, git, worktrees, skills). */

/** Best-effort message extraction from an unknown thrown value. Replaces the
 * previously copy-pasted `error instanceof Error ? error.message : String(error)`
 * spread across ~30 files. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
