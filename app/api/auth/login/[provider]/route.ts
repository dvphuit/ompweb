import { homedir } from "os";
import { errorMessage } from "@/lib/errors";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { invalidateModelsCache } from "@/lib/models-cache";
import { enableProvider } from "@/lib/omp/model-roles";
import { buildLoginUiResponse, mapLoginUiRequest, type LoginPendingDialog } from "@/lib/omp/login-protocol";
import { RpcProcess, type RpcFrame } from "@/lib/omp/rpc-process";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";

const MAX_LOGIN_REQUEST_BYTES = 16 * 1024;
export const dynamic = "force-dynamic";

/**
 * Interactive login over a dedicated `omp --mode rpc-ui` process. omp drives
 * the flow with extension_ui_request frames: `open_url` carries the OAuth URL
 * (+ an optional short loopback `launchUrl` copy target), `input` asks for
 * the pasted code/redirect URL, `select` offers a choice, `confirm` asks a
 * yes/no question, and `notify` reports progress.
 * The SSE stream keeps pi-web's event names (auth, prompt_request,
 * select_request, confirm_request, progress, success, error, cancelled) so
 * the client flow is familiar; the POST handler feeds the user's answer back
 * as an extension_ui_response frame.
 */

// Extensions stay ENABLED (mirroring the shared utility process): they can
// register login providers, and a login child without them would disagree
// with the provider list the web UI shows.
const LOGIN_EXTRA_ARGS = ["--no-session", "--no-skills", "--no-lsp"];
const READY_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const HEARTBEAT_MS = 30_000;

interface PendingLogin {
  provider: string;
  submit: (value: string) => void;
}

// Registry survives dev-server hot reload; the SSE stream registers its token,
// the POST handler resolves it.
declare global {
  var __ompLoginRegistry: Map<string, PendingLogin> | undefined;
}

function getLoginRegistry(): Map<string, PendingLogin> {
  if (!globalThis.__ompLoginRegistry) globalThis.__ompLoginRegistry = new Map();
  return globalThis.__ompLoginRegistry;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL, auth code,
// selected option, or confirm answer ("true"/"false")
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  let body: { token?: unknown; code?: unknown };
  try {
    body = await parseJsonWithinLimit(req, MAX_LOGIN_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return Response.json({ error: status === 413 ? "Login request is too large" : "Invalid JSON request body", code: status === 413 ? "request_too_large" : "invalid_json" }, { status });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const code = typeof body.code === "string" ? body.code : "";

  if (!token || !code) {
    return Response.json({ error: "token and code required", code: "login_token_code_required" }, { status: 400 });
  }
  const pending = getLoginRegistry().get(token);
  if (!pending) {
    return Response.json({ error: "No pending login for token", code: "login_no_pending" }, { status: 404 });
  }
  if (pending.provider !== provider) {
    return Response.json({ error: "Token does not match provider", code: "login_token_mismatch" }, { status: 400 });
  }

  pending.submit(code);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for the login flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const registry = getLoginRegistry();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // OAuth flows sit idle while the user is in the browser; keep the SSE
      // connection alive past proxy/Next idle timeouts.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      // Only one login dialog is ever pending: omp's login flow is strictly
      // sequential (open_url, then input/select/confirm, then the command
      // resolves). The user may paste the code before omp's input request
      // arrives (the auth event shows the paste box immediately) — buffer one
      // value. The buffer is an *input* answer: it waits for the next input
      // dialog even if a select/confirm arrives first, so an early paste can
      // never be misdelivered as a choice the user never saw.
      let pendingDialog: LoginPendingDialog | null = null;
      let bufferedValue: string | null = null;

      let proc: RpcProcess | null = null;
      const answerDialog = (dialog: LoginPendingDialog, value: string) => {
        proc?.sendFrame(buildLoginUiResponse(dialog, value));
      };
      const handleFrame = (frame: RpcFrame) => {
        if (frame.type !== "extension_ui_request") return;
        if (frame.method === "cancel") {
          // The dialog the browser is showing is dead (e.g. the loopback
          // OAuth callback completed while the paste box was open). Clear it
          // and move the UI back to a waiting state instead of leaving a
          // stale prompt on screen.
          if (pendingDialog !== null && frame.targetId === pendingDialog.id) {
            pendingDialog = null;
            send({ type: "dialog_cancelled" });
          }
          return;
        }
        const mapped = mapLoginUiRequest(frame, token);
        if (!mapped?.event) return;
        if (mapped.pending) {
          if (mapped.pending.kind === "input" && bufferedValue !== null) {
            const value = bufferedValue;
            bufferedValue = null;
            answerDialog(mapped.pending, value);
          } else {
            pendingDialog = mapped.pending;
            send(mapped.event);
          }
        } else {
          send(mapped.event);
        }
      };

      try {
        proc = new RpcProcess({ cwd: homedir(), extraArgs: LOGIN_EXTRA_ARGS, onFrame: handleFrame });
      } catch (error) {
        send({ type: "error", message: errorMessage(error) });
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch {}
        return;
      }
      const child = proc;

      registry.set(token, {
        provider,
        submit: (value: string) => {
          if (pendingDialog !== null) {
            const dialog = pendingDialog;
            pendingDialog = null;
            answerDialog(dialog, value);
          } else {
            bufferedValue = value;
          }
        },
      });

      const cleanup = () => {
        registry.delete(token);
        clearInterval(heartbeat);
        void child.dispose();
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        const ready = await child.waitReady(READY_TIMEOUT_MS);
        await child.negotiateProtocol(ready);
        await child.sendCommand({ type: "login", providerId: provider }, LOGIN_TIMEOUT_MS);
        enableProvider(provider);
        invalidateModelsCache();
        disposeUtilityRpc();
        send({ type: "success" });
      } catch (error) {
        if (req.signal.aborted) {
          send({ type: "cancelled" });
        } else {
          send({ type: "error", message: errorMessage(error) });
        }
      } finally {
        cleanup();
        closed = true;
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
