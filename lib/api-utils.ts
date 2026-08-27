import { NextResponse } from "next/server";
import { resolveSessionPath } from "./session-reader";

const SESSION_NOT_FOUND = { error: "Session not found", code: "session_not_found" } as const;

/** Resolve a session id to its file path, or a 404 JSON response. Replaces the
 * repeated `resolveSessionPath(id)` + "Session not found" guard across routes. */
export async function resolveSessionPathOr404(
  id: string,
): Promise<{ filePath: string } | { response: NextResponse }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return { response: NextResponse.json(SESSION_NOT_FOUND, { status: 404 }) };
  return { filePath };
}

/** Uniform JSON error body used by most API routes. */
function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = error.status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function apiErrorResponse(error: unknown, status = 500): NextResponse {
  // Don't leak internal stacks/paths to the browser — log server-side and return generic.
  console.error("[api]", error);
  // Preserve an explicit rate-limit status, but never infer it from arbitrary
  // error text: user-controlled paths and provider messages can contain "429".
  const rawMessage = String(error);
  const errorStatus = getErrorStatus(error);
  const isRateLimitedError = status === 429 || errorStatus === 429;
  if (isRateLimitedError) {
    return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
  }
  const message = status >= 500 ? "Internal server error" : rawMessage;
  return NextResponse.json({ error: message }, { status });
}
