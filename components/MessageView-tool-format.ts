import { formatCompactNumber } from "@/lib/format";
import { isRecord } from "@/lib/type-guards";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

export function formatToolCommand(block: ToolCallContent): string {
  const input = block.input;
  if (input && typeof input.command === "string") return input.command;
  if (input && typeof input.path === "string") return `${block.toolName} ${input.path}`;
  if (input && typeof input.file_path === "string") return `${block.toolName} ${input.file_path}`;
  if (input && typeof input.query === "string") return `${block.toolName} ${input.query}`;
  try {
    return `${block.toolName} ${JSON.stringify(input)}`;
  } catch {
    return block.toolName;
  }
}

export function formatToolOutput(text: string, toolName: string): string {
  if (!isReadToolName(toolName)) return text;
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*\d+:\s?/, ""))
    .join("\n");
}

export function isReadToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "read" || name.endsWith(".read") || name.endsWith("_read");
}

export function getToolResultMeta(result: ToolResultMessage | undefined): string | null {
  if (!result || !isRecord(result.details)) return null;
  const details = result.details;
  const usage = isRecord(details.usage) ? details.usage : details;
  const readNumber = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  };
  const input = readNumber("input", "inputTokens", "input_tokens");
  const output = readNumber("output", "outputTokens", "output_tokens");
  const cacheRead = readNumber("cacheRead", "cache_read", "cacheReadTokens");
  const cacheWrite = readNumber("cacheWrite", "cache_write", "cacheWriteTokens");
  const parts = [
    input ? `in ${formatCompactNumber(input)}` : null,
    output ? `out ${formatCompactNumber(output)}` : null,
    cacheRead ? `cache R ${formatCompactNumber(cacheRead)}` : null,
    cacheWrite ? `cache W ${formatCompactNumber(cacheWrite)}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
