import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { invalidateModelsCache } from "@/lib/models-cache";
import { logoutProvider } from "@/lib/omp/auth-broker";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

async function handleLogout(provider: string): Promise<NextResponse> {
  try {
    await logoutProvider(provider);
    invalidateModelsCache();
    disposeUtilityRpc();
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    const code = (error as { code?: string })?.code ?? "logout_failed";
    return NextResponse.json({ error: errorMessage(error), code }, { status });
  }
}

export async function POST(_req: Request, { params }: Params) {
  const { provider } = await params;
  return handleLogout(provider);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  return handleLogout(provider);
}
