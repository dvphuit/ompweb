import type { HTMLAttributes } from "react";
import { FileCode } from "lucide-react";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { isLikelyFilePath, resolveLocalFileHref } from "@/lib/file-links";

/** Build the `code` renderer shared by MarkdownBody and FileViewer's
 * ReactMarkdown configs (the two previously inlined near-identical copies).
 *
 * `inlineClassName` pins inline code to a surface style (MarkdownBody's
 * "markdown-inline-code"); when omitted the incoming className is passed
 * through (FileViewer). `defaultPreview`/`isStreaming` thread the mermaid
 * and code-block props each host needs. */
export function markdownCodeRenderer(options: {
  isStreaming?: boolean;
  defaultPreview?: boolean;
  inlineClassName?: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  return function Code({ className, children, ...props }: HTMLAttributes<HTMLElement> & { node?: unknown }) {
    delete (props as { node?: unknown }).node;
    const lang = className?.replace("language-", "").toLowerCase() ?? "";
    const raw = String(children);
    const isBlock = className?.includes("language-") || raw.includes("\n");
    if (isBlock) {
      if (lang === "mermaid") {
        return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={options.isStreaming} defaultPreview={options.defaultPreview} />;
      }
      return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={options.isStreaming} />;
    }

    if (typeof children === "string" && options.onOpenFile) {
      const text = children.trim();
      if (isLikelyFilePath(text)) {
        const resolvedPath = resolveLocalFileHref(text, options.cwd);
        if (resolvedPath) {
          return (
            <button
              type="button"
              className="markdown-file-pill"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                options.onOpenFile?.(resolvedPath);
              }}
              title={`Open ${text}`}
              aria-label={`Open file ${text}`}
            >
              <FileCode size={11} className="markdown-file-pill-icon" aria-hidden="true" />
              <span>{children}</span>
            </button>
          );
        }
      }
    }

    return (
      <code className={options.inlineClassName ?? className} {...props}>
        {children}
      </code>
    );
  };
}
