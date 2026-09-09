import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import {
  type ModelDefinition,
  type ProviderConfig,
  serializeModelsConfig,
  validateModelsConfig,
} from "@/lib/omp/models-config";
import { type OmpModel, runIsolatedUtilityCommand } from "@/lib/omp/rpc-utility";
import { isRecord } from "@/lib/type-guards";

export const dynamic = "force-dynamic";

// Registry resolution (spawn + model discovery), not a completion round-trip.
const TEST_TIMEOUT_MS = 60_000;
const MAX_MODEL_TEST_REQUEST_BYTES = 512 * 1024;

export async function POST(req: Request) {
  let tempDir: string | undefined;

  try {
    const body = await parseJsonWithinLimit<{ providerName?: unknown; provider?: unknown; model?: unknown }>(req, MAX_MODEL_TEST_REQUEST_BYTES);
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required", code: "provider_name_required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required", code: "provider_required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required", code: "model_required" }, { status: 400 });
    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required", code: "model_id_required" }, { status: 400 });

    const config = { providers: { [providerName]: { ...(body.provider as ProviderConfig), models: [{ ...(body.model as ModelDefinition), id: modelId }] } } };
    try {
      validateModelsConfig(config);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }

    // Isolated throwaway agent dir: the spawned omp sees only this candidate
    // config (no stored credentials, no models.db cache) and never touches
    // ~/.omp. Profile/XDG overrides are cleared so the redirect always wins
    // (the omp child still honors profiles even though omp-web ignores them).
    tempDir = mkdtempSync(join(tmpdir(), "omp-web-model-test-"));
    writeFileSync(join(tempDir, "models.yml"), serializeModelsConfig(config), "utf8");
    const startedAt = Date.now();
    const { models } = await runIsolatedUtilityCommand<{ models: OmpModel[] }>(
      { type: "get_available_models" },
      {
        env: { PI_CODING_AGENT_DIR: tempDir, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: "" },
        timeoutMs: TEST_TIMEOUT_MS,
        signal: req.signal,
      },
    );
    const latencyMs = Date.now() - startedAt;

    const found = models.find((m) => m.provider === providerName && m.id === modelId);
    if (!found) {
      return NextResponse.json({
        ok: false,
        error: `Model ${providerName}/${modelId} did not resolve — check the API key and provider config`,
        code: "model_test_unresolved",
        latencyMs,
      });
    }

    return NextResponse.json({
      ok: true,
      latencyMs,
      responseText: `${found.provider}/${found.id} resolved (configuration only; credentials were not contacted)`,
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ ok: false, error: "Model test request is too large", code: "request_too_large" }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "Invalid JSON request body", code: "invalid_json" }, { status: 400 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
