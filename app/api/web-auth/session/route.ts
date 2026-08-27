import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import {
  checkWebAuthRateLimit,
  clearWebAuthFailures,
  createWebSession,
  isValidWebPassword,
  isWebPasswordEnabled,
  OMP_WEB_SESSION_COOKIE,
  OMP_WEB_SESSION_MAX_AGE_SECONDS,
  recordWebAuthFailure,
} from "@/lib/web-auth";

const MAX_PASSWORD_REQUEST_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!isWebPasswordEnabled()) {
    return NextResponse.json({ error: "Password protection is disabled" }, { status: 404 });
  }

  const rateLimit = checkWebAuthRateLimit();
  if (!rateLimit.allowed) {
    const response = NextResponse.json({ error: "Too many login attempts", code: "rate_limited" }, { status: 429 });
    if (rateLimit.retryAfterSeconds) response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  let body: { password?: unknown };
  try {
    body = await parseJsonWithinLimit(request, MAX_PASSWORD_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "Invalid password request" }, { status });
  }
  if (typeof body.password !== "string" || !isValidWebPassword(body.password)) {
    const failure = recordWebAuthFailure();
    const response = NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    if (failure.retryAfterSeconds) response.headers.set("Retry-After", String(failure.retryAfterSeconds));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  clearWebAuthFailures();
  const response = NextResponse.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set({
    name: OMP_WEB_SESSION_COOKIE,
    value: createWebSession(process.env.OMP_WEB_PASSWORD!),
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: OMP_WEB_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
