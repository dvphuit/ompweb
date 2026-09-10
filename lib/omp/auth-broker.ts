import { execFile } from "child_process";
import { promisify } from "util";
import { errorMessage } from "../errors";
import { resolveOmpBin } from "./omp-cli";

const execFileAsync = promisify(execFile);

const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id);
}

/** Remove a stored API-key credential via `omp auth-broker logout <provider>`.
 * Shared by `/api/auth/logout/[provider]` and `/api/auth/api-key/[provider]`
 * (previously duplicated in both routes). */
export async function logoutProvider(provider: string): Promise<void> {
  if (!isValidProviderId(provider)) {
    throw Object.assign(new Error(`Invalid provider id "${provider}"`), { status: 400, code: "invalid_provider" });
  }
  const bin = resolveOmpBin();
  if (!bin) throw Object.assign(new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN."), { status: 500, code: "omp_not_found" });
  try {
    await execFileAsync(bin, ["auth-broker", "logout", provider, "--json"], {
      timeout: 30_000,
      maxBuffer: 1 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
    });
  } catch (error) {
    // `auth-broker logout` is idempotent — a missing credential is not a failure.
    if (/not logged in|not found|no credential/i.test(errorMessage(error))) return;
    throw error;
  }
}
