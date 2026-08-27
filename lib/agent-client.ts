// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

import { formatApiError } from "@/lib/i18n/api-error";

// Sessions whose per-chat advisor toggle is on: their lazily spawned omp
// process must start with --advisor. Keyed by session id because the spawn
// decision happens inside the route, which only sees id + query string.
const advisorSpawnSessions = new Set<string>();

export function setSessionAdvisorSpawn(sessionId: string, enabled: boolean) {
  if (enabled) advisorSpawnSessions.add(sessionId);
  else advisorSpawnSessions.delete(sessionId);
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const query = advisorSpawnSessions.has(sessionId) ? "?advisor=1" : "";
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  // Use text → json so 429 plain-text bodies are not lost when .json() fails.
  const rawText = await res.text().catch(() => "");
  let body: { success?: boolean; data?: T; error?: string; code?: string } = {};
  if (rawText) {
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      // Non-JSON response (e.g. 429 from proxy/rate-limiter): surface the text.
      if (!res.ok) {
        const text = rawText.trim().slice(0, 800);
        throw new Error(text || `HTTP ${res.status}`);
      }
    }
  }
  if (!res.ok || body.error) {
    // Routes attach a stable `code` for well-known failures; these messages are
    // surfaced to the user as notices, so localize before throwing.
    // For 429, ensure the server's Retry-After/message is not replaced by generic HTTP 429.
    if (!body.error && !body.code && res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const detail = retryAfter ? `Too many requests. Retry after ${retryAfter}s` : rawText.trim().slice(0, 800) || "Too many requests";
      throw new Error(detail);
    }
    throw new Error(
      body.error || body.code ? formatApiError(body) : `HTTP ${res.status}${rawText ? `: ${rawText.trim().slice(0, 300)}` : ""}`,
    );
  }
  return body.data as T;
}
