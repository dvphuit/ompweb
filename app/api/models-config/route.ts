import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { invalidateModelsCache } from "@/lib/models-cache";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";
import {
  ModelsConfigParseError,
  readModelsConfigFile,
  validateModelsConfig,
  writeModelsConfig,
  type ModelsFileConfig,
} from "@/lib/omp/models-config";

export const dynamic = "force-dynamic";

const MAX_MODELS_CONFIG_REQUEST_BYTES = 512 * 1024;

export async function GET() {
  const file = readModelsConfigFile();
  if (file.parseError) {
    return NextResponse.json({ providers: {}, parseError: file.parseError, path: file.path, code: "models_config_unparseable" });
  }
  return NextResponse.json(file.config);
}

// PUT /api/models-config[?overwrite=true]
// Refuses to write while models.yml is unparseable unless ?overwrite=true.
export async function PUT(req: Request) {
  try {
    const overwriteUnparseable = new URL(req.url).searchParams.get("overwrite") === "true";
    const body = await parseJsonWithinLimit<ModelsFileConfig>(req, MAX_MODELS_CONFIG_REQUEST_BYTES);
    try {
      validateModelsConfig(body);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    try {
      writeModelsConfig(body, { overwriteUnparseable });
    } catch (error) {
      if (error instanceof ModelsConfigParseError) {
        return NextResponse.json({ error: `${error.message} — fix it by hand; omp-web will not overwrite it`, code: "models_config_unparseable" }, { status: 409 });
      }
      throw error;
    }
    invalidateModelsCache();
    disposeUtilityRpc();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Request body too large", code: "request_too_large" }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON", code: "invalid_json" }, { status: 400 });
    return apiErrorResponse(error);
  }
}
