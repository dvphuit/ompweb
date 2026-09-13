import type { RpcFrame } from "./rpc-process";

/**
 * Pure mapping between omp's `extension_ui_request` frames (emitted by the
 * `login` RPC command) and the login SSE events the browser understands.
 *
 * omp drives the whole flow over extension UI: `open_url` carries the OAuth
 * URL (+ an optional short loopback `launchUrl` copy target), `input` asks
 * for the pasted code/redirect URL, `select` offers a choice (auth method,
 * account), `confirm` asks a yes/no question, and `notify` reports progress.
 * The SSE stream keeps pi-web's event names (`auth`, `prompt_request`,
 * `select_request`, `progress`, ...) so the client flow stays familiar.
 */

export type LoginDialogKind = "input" | "select" | "confirm";

export interface LoginPendingDialog {
  kind: LoginDialogKind;
  id: string;
}

export interface LoginMappedRequest {
  /** SSE payload to send, or null when the frame carries no login UI. */
  event: Record<string, unknown> | null;
  /** Dialog the browser must answer, or null for fire-and-forget frames. */
  pending: LoginPendingDialog | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Map one omp `extension_ui_request` frame to the SSE event the login stream
 * should emit. Returns null for non-UI frames and for methods that carry no
 * login surface (`setStatus`, `setWidget`, ...). `cancel` is stateful — it
 * targets the pending dialog — so the route handles it directly instead.
 */
export function mapLoginUiRequest(frame: RpcFrame, token: string): LoginMappedRequest | null {
  if (frame.type !== "extension_ui_request") return null;
  const method = frame.method;

  if (method === "open_url") {
    const fullUrl = asString(frame.url) ?? "";
    const launchUrl = asString(frame.launchUrl);
    const instructions = asString(frame.instructions);
    // Upstream marks launchUrl (a short loopback URL that 302-redirects to
    // the full authorization URL) as the copy target, while the hyperlink
    // itself carries the full URL for click-through.
    const url = fullUrl || launchUrl || "";
    if (!url) {
      // No usable link — surface the text as progress instead of emitting an
      // auth event with an empty anchor the user can never see or open.
      if (!instructions) return null;
      return { event: { type: "progress", message: instructions }, pending: null };
    }
    return {
      event: {
        type: "auth",
        url,
        launchUrl: launchUrl && launchUrl !== url ? launchUrl : null,
        instructions,
        token,
      },
      pending: null,
    };
  }

  if (method === "input") {
    const id = asString(frame.id);
    if (!id) return null;
    return {
      event: {
        type: "prompt_request",
        message: asString(frame.title) || "Enter the authorization code",
        placeholder: asString(frame.placeholder),
        token,
      },
      pending: { kind: "input", id },
    };
  }

  if (method === "select") {
    const id = asString(frame.id);
    if (!id) return null;
    // omp sends option labels as `options: string[]` with an optional
    // positionally-aligned `optionDetails` array carrying descriptions.
    const options = Array.isArray(frame.options)
      ? frame.options.filter((option): option is string => typeof option === "string")
      : [];
    const details = Array.isArray(frame.optionDetails) ? frame.optionDetails : [];
    return {
      event: {
        type: "select_request",
        message: asString(frame.title) || "Choose an option",
        options: options.map((option, index) => {
          const detail = details[index] as { description?: unknown } | undefined;
          const description = detail && typeof detail.description === "string" ? detail.description : "";
          return { id: option, label: description ? `${option} — ${description}` : option };
        }),
        token,
      },
      pending: { kind: "select", id },
    };
  }

  if (method === "confirm") {
    const id = asString(frame.id);
    if (!id) return null;
    const message = [asString(frame.title), asString(frame.message)].filter(Boolean).join("\n")
      || "Confirm to continue";
    return {
      event: { type: "confirm_request", message, token },
      pending: { kind: "confirm", id },
    };
  }

  if (method === "notify") {
    const message = asString(frame.message);
    if (!message) return null;
    return { event: { type: "progress", message }, pending: null };
  }

  return null;
}

/**
 * Build the `extension_ui_response` answering a pending login dialog. `input`
 * and `select` resolve with the submitted string (for `select` that is the
 * chosen option); `confirm` resolves with a boolean derived from the
 * `"true"`/`"false"` option id the browser posts back.
 */
export function buildLoginUiResponse(dialog: LoginPendingDialog, value: string): RpcFrame {
  if (dialog.kind === "confirm") {
    return { type: "extension_ui_response", id: dialog.id, confirmed: value === "true" };
  }
  return { type: "extension_ui_response", id: dialog.id, value };
}
