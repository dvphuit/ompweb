"use client";

import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useI18n } from "@/lib/i18n";

/** Output longer than this many lines opens as a collapsed preview. */
export const TOOL_OUTPUT_COLLAPSE_LINES = 10;
/** Lines kept visible inside the collapsed preview. */
export const TOOL_OUTPUT_PREVIEW_LINES = 8;

export type ToolOutputStatus = "running" | "success" | "error";

/** Byte length via TextEncoder (multi-byte output would be miscounted by
 * `String.length`). Falls back to the character count where TextEncoder is
 * unavailable (very old browsers; it exists in every supported runtime). */
function byteLength(text: string): number {
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).length;
}

/** "812 B / 12.4 KB / 1.1 MB" — one decimal keeps the meta row short. */
export function formatOutputSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function countOutputLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

/** Exit status shown in the meta row: running has none yet, a failed tool
 * without an explicit code is reported as 1. */
function exitLabel(
  status: ToolOutputStatus,
  exitCode: number | undefined | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (status === "running") return null;
  const code = typeof exitCode === "number" ? exitCode : status === "error" ? 1 : 0;
  return t("messageView.toolOutputExit", { code });
}

const STATUS_LABEL_KEY: Record<ToolOutputStatus, string> = {
  running: "messageView.toolStatusRunning",
  success: "messageView.toolStatusSuccess",
  error: "messageView.toolStatusError",
};

/**
 * Tool/command output block: a mono status header (state · lines · size · exit
 * · duration) over a density-limited body. Long output opens as a preview so a
 * run of tool calls cannot flood the transcript; failures open expanded but
 * stay height-capped, and every block can be copied or opened in full.
 */
export function ToolOutputBlock({
  text,
  toolName,
  status,
  duration,
  exitCode,
  isEmpty = false,
}: {
  text: string;
  toolName: string;
  status: ToolOutputStatus;
  /** Wall-clock seconds reported by the transcript. */
  duration?: number;
  exitCode?: number | null;
  isEmpty?: boolean;
}) {
  const { t, tn } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const [fullOpen, setFullOpen] = useState(false);
  // null = follow the automatic rule (long output previews, errors expand).
  const [override, setOverride] = useState<boolean | null>(null);

  const lineCount = countOutputLines(text);
  // Errors open on the relevant part but stay height-capped; long success
  // output previews behind an explicit Expand.
  const autoCollapsed = lineCount > TOOL_OUTPUT_COLLAPSE_LINES && status !== "error";
  const collapsed = override ?? autoCollapsed;

  const displayed = collapsed && !isEmpty
    ? text.split("\n").slice(0, TOOL_OUTPUT_PREVIEW_LINES).join("\n")
    : text;
  const hiddenLines = Math.max(0, lineCount - TOOL_OUTPUT_PREVIEW_LINES);
  const size = formatOutputSize(byteLength(text));
  const exit = exitLabel(status, exitCode, t);

  return (
    <div className="tool-output" data-status={status}>
      <div className="tool-output-head">
        <span className="tool-output-status" data-status={status}>
          {t(STATUS_LABEL_KEY[status])}
        </span>
        <span className="tool-output-meta">
          <span className="tool-output-meta-item">
            {tn("messageView.toolOutputLines", lineCount)}
          </span>
          <span className="tool-output-meta-item">{size}</span>
          {exit && <span className="tool-output-meta-item">{exit}</span>}
          {duration !== undefined && (
            <span className="tool-output-meta-item">{t("messageView.durationSeconds", { seconds: duration })}</span>
          )}
        </span>
        <span className="tool-output-actions">
          {(autoCollapsed || lineCount > TOOL_OUTPUT_PREVIEW_LINES) && (
            <button
              type="button"
              className="composer-control composer-control-tiny tool-output-action"
              onClick={() => setOverride(collapsed ? false : true)}
              aria-expanded={!collapsed}
              title={collapsed ? t("messageView.expand") : t("messageView.collapse")}
            >
              {collapsed ? t("messageView.expand") : t("messageView.collapse")}
            </button>
          )}
          <button
            type="button"
            className="composer-control composer-control-tiny tool-output-action"
            onClick={() => copy(text)}
            disabled={isEmpty}
            title={t("messageView.toolOutputCopy")}
            aria-label={t("messageView.toolOutputCopy")}
          >
            {copied ? t("messageView.copied") : t("messageView.copy")}
          </button>
          <button
            type="button"
            className="composer-control composer-control-tiny tool-output-action"
            onClick={() => setFullOpen(true)}
            disabled={isEmpty}
            title={t("messageView.toolOutputOpenFull")}
            aria-label={t("messageView.toolOutputOpenFull")}
          >
            {t("messageView.toolOutputFull")}
          </button>
        </span>
      </div>
      <div
        className="tool-output-body"
        data-collapsed={collapsed}
        data-error={status === "error"}
      >
        <pre className="tool-call-output-text" data-tool-output="true">
          {isEmpty ? t("messageView.noOutput") : displayed}
        </pre>
        {collapsed && !isEmpty && <div className="tool-output-fade" aria-hidden />}
      </div>
      {collapsed && !isEmpty && hiddenLines > 0 && (
        <button
          type="button"
          className="tool-output-more"
          onClick={() => setOverride(false)}
        >
          {tn("messageView.toolOutputMoreLines", hiddenLines)}
        </button>
      )}
      {fullOpen && typeof document !== "undefined" && createPortal(
        <ToolOutputDialog
          text={text}
          toolName={toolName}
          status={status}
          onClose={() => setFullOpen(false)}
        />,
        document.body,
      )}
    </div>
  );
}

function ToolOutputDialog({
  text,
  toolName,
  status,
  onClose,
}: {
  text: string;
  toolName: string;
  status: ToolOutputStatus;
  onClose: () => void;
}) {
  const { t, tn } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="tool-output-dialog"
      aria-label={t("messageView.toolOutputDialogLabel", { tool: toolName })}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The window-level Escape handler aborts a running agent — closing
        // this viewer must not stop the run.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="tool-output-dialog-head">
        <span className="tool-output-status" data-status={status}>
          {t(STATUS_LABEL_KEY[status])}
        </span>
        <span className="tool-output-dialog-title">{toolName}</span>
        <span className="tool-output-meta">
          <span className="tool-output-meta-item">
            {tn("messageView.toolOutputLines", countOutputLines(text))}
          </span>
          <span className="tool-output-meta-item">{formatOutputSize(byteLength(text))}</span>
        </span>
        <span className="tool-output-actions">
          <button
            type="button"
            className="composer-control composer-control-tiny"
            onClick={() => copy(text)}
            title={t("messageView.toolOutputCopy")}
          >
            {copied ? t("messageView.copied") : t("messageView.copy")}
          </button>
          <button
            type="button"
            className="composer-control composer-control-tiny"
            onClick={onClose}
            title={t("messageView.close")}
            aria-label={t("messageView.close")}
          >
            {t("messageView.close")}
          </button>
        </span>
      </div>
      <pre className="tool-output-dialog-body">{text}</pre>
    </dialog>
  );
}
