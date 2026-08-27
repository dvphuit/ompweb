function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    return host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h === "0.0.0.0" || h === "[::]";
}

function originsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol !== ub.protocol || ua.port !== ub.port) return false;
    const ha = ua.hostname.toLowerCase();
    const hb = ub.hostname.toLowerCase();
    if (ha === hb) return true;
    return isLoopbackHostname(ha) && isLoopbackHostname(hb);
  } catch {
    return false;
  }
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin) return fetchSite !== "cross-site";

  const requestOrigin = getRequestOrigin(request);
  const originOrigin = canonicalOrigin(origin);
  if (!requestOrigin || !originOrigin) return false;
  return originsMatch(originOrigin, requestOrigin);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}
