import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resolveOmpBin } from "@/lib/omp/omp-cli";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function isValidProviderId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id);
}

async function runLogout(provider: string): Promise<void> {
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
    const message = error instanceof Error ? error.message : String(error);
    // `auth-broker logout` is idempotent — missing credential is not a failure
    if (/not logged in|not found|no credential/i.test(message)) return;
    throw error;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  try {
    await runLogout(provider);
    invalidateModelsCache();
    disposeUtilityRpc();
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number })?.status ?? 500;
    const code = (error as { code?: string })?.code ?? "logout_failed";
    return NextResponse.json({ error: message, code }, { status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  try {
    await runLogout(provider);
    invalidateModelsCache();
    disposeUtilityRpc();
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number })?.status ?? 500;
    const code = (error as { code?: string })?.code ?? "logout_failed";
    return NextResponse.json({ error: message, code }, { status });
  }
}
