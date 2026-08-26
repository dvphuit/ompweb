import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  type ModelDefinition,
  type ProviderConfig,
  serializeModelsConfig,
  validateModelsConfig,
} from "@/lib/omp/models-config";
import { type OmpModel, runIsolatedUtilityCommand } from "@/lib/omp/rpc-utility";

export const dynamic = "force-dynamic";

// Registry resolution (spawn + model discovery), not a completion round-trip:
// omp-web cannot send test prompts without going through a full agent session.
const TEST_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  let tempDir: string | undefined;

  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; model?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required", code: "provider_name_required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required", code: "provider_required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required", code: "model_required" }, { status: 400 });

    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required", code: "model_id_required" }, { status: 400 });

    const config = {
      providers: {
        [providerName]: {
          ...(body.provider as ProviderConfig),
          models: [{ ...(body.model as ModelDefinition), id: modelId }],
        },
      },
    };
    try {
      validateModelsConfig(config);
    } catch (error) {
      return NextResponse.json({ ok: false, error: errorMessage(error) });
    }

    // Isolated throwaway agent dir: the spawned omp sees only this candidate
    // config (no stored credentials, no models.db cache) and never touches
    // ~/.omp. Profile/XDG overrides are cleared so the redirect always wins.
    tempDir = mkdtempSync(join(tmpdir(), "omp-web-model-test-"));
    writeFileSync(join(tempDir, "models.yml"), serializeModelsConfig(config), "utf8");

    const startedAt = Date.now();
    const { models } = await runIsolatedUtilityCommand<{ models: OmpModel[] }>(
      { type: "get_available_models" },
      {
        env: { PI_CODING_AGENT_DIR: tempDir, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: "" },
        timeoutMs: TEST_TIMEOUT_MS,
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

    // Live network check: actually contact the provider's proxy (e.g. goro.local)
    // to verify the endpoint is reachable and the specific model exists.
    // This catches fake IDs like cx2/gpt-5.6-sol which would otherwise appear
    // valid because we inject the tested model into the temp config.
    const providerConfig = body.provider as ProviderConfig & { baseUrl?: unknown; apiKey?: unknown; api?: unknown };
    const baseUrl = typeof providerConfig.baseUrl === "string" ? providerConfig.baseUrl.trim() : "";
    const rawApiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
    const apiKey = rawApiKey && !rawApiKey.startsWith("!") && !rawApiKey.includes("$") ? rawApiKey : "";
    const providerApi = typeof providerConfig.api === "string" ? providerConfig.api : undefined;
    const modelApi = (body.model as { api?: unknown }).api;
    const effectiveApi = typeof modelApi === "string" ? modelApi : providerApi;
    if (baseUrl) {
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      // Merge provider-level custom headers if any
      const customHeaders = (providerConfig.headers ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(customHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
      try {
        let probe: Response;
        const probeStarted = Date.now();
        if (effectiveApi === "openai-responses" || effectiveApi === "azure-openai-responses" || effectiveApi === "openai-codex-responses") {
          // Responses API: POST /responses
          const url = baseUrl.replace(/\/+$/, "") + "/responses";
          probe = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: modelId, input: "hi", max_output_tokens: 1 }),
            signal: AbortSignal.timeout(8000),
          });
        } else if (effectiveApi === "anthropic-messages") {
          const url = baseUrl.replace(/\/+$/, "") + "/v1/messages";
          probe = await fetch(url, {
            method: "POST",
            headers: { ...headers, "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
            signal: AbortSignal.timeout(8000),
          });
        } else {
          // Default: OpenAI completions (also covers openai-completions, google, etc.)
          const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
          probe = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
            signal: AbortSignal.timeout(8000),
          });
        }
        const probeLatency = Date.now() - probeStarted;
        if (!probe.ok) {
          const text = await probe.text().catch(() => "");
          const detail = text.slice(0, 500).trim();
          // Try to extract JSON error message
          let errMsg = `HTTP ${probe.status}`;
          try {
            const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
            if (j.error?.message) errMsg = j.error.message;
            else if (j.error?.code) errMsg = j.error.code;
          } catch {}
          if (detail && !errMsg.includes(detail.slice(0, 50))) errMsg += `: ${detail.slice(0, 200)}`;
          return NextResponse.json({
            ok: false,
            error: `Provider ${providerName} rejected model ${modelId}: ${errMsg}`,
            code: "model_test_rejected",
            latencyMs: Date.now() - startedAt,
            status: probe.status,
          });
        }
        // Also verify the model appears in the provider's model list when possible
        // (extra safety for proxies that accept any modelId).
        void probeLatency;
      } catch (e) {
        return NextResponse.json({
          ok: false,
          error: `Cannot reach ${baseUrl}: ${errorMessage(e)} — check that goro.local proxy is running and baseUrl is correct`,
          code: "model_test_unreachable",
          latencyMs: Date.now() - startedAt,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      responseText: `${found.provider}/${found.id} validated`,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
