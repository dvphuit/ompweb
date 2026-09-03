// Pure mapping for tool type → CSS var + icon name.
// Extracted from components/MessageView.tsx for reuse (ChatMinimap, dialogs)
// and testability. No React/lucide imports here — icon name is a string key.

export type ToolVarName =
  | "--tool-read"
  | "--tool-write"
  | "--tool-edit"
  | "--tool-bash"
  | "--tool-search"
  | "--tool-todo"
  | "--tool-task"
  | "--tool-ask"
  | "--tool-hub"
  | "--tool-irc"
  | "--tool-generic";

export type ToolIconName =
  | "FileText"
  | "FilePlus"
  | "Pencil"
  | "Terminal"
  | "Search"
  | "FolderSearch"
  | "ListTodo"
  | "Bot"
  | "MessageCircleQuestion"
  | "Plug"
  | "Wrench"
  | "Hash";

export interface ToolDisplay {
  iconName: ToolIconName;
  varName: ToolVarName;
}

export function normalizeToolKey(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutParen = raw.split("(")[0].trim();
  const afterDouble = withoutParen.includes("__") ? (withoutParen.split("__").pop() ?? withoutParen) : withoutParen;
  const afterDot = afterDouble.includes(".") ? (afterDouble.split(".").pop() ?? afterDouble) : afterDouble;
  const afterSlash = afterDot.includes("/") ? (afterDot.split("/").pop() ?? afterDot) : afterDot;
  const afterColon = afterSlash.includes(":") ? (afterSlash.split(":").pop() ?? afterSlash) : afterSlash;
  const cleaned = afterColon.split("|")[0].trim();
  return cleaned;
}

export function getToolDisplay(toolName: string): ToolDisplay {
  const key = normalizeToolKey(toolName);
  // omp 18.1.3+ renders the IRC tool as "#" (was "irc") — keep web glyph in sync with TUI's ASCII_SYMBOLS.
  if (key === "irc") return { iconName: "Hash", varName: "--tool-irc" };
  if (key === "read" || key === "cat" || key === "view") return { iconName: "FileText", varName: "--tool-read" };
  if (key === "write") return { iconName: "FilePlus", varName: "--tool-write" };
  if (key === "edit" || key === "apply_patch" || key === "patch") return { iconName: "Pencil", varName: "--tool-edit" };
  if (key === "bash" || key === "shell" || key === "exec" || key === "terminal" || key === "sh") return { iconName: "Terminal", varName: "--tool-bash" };
  if (key === "grep" || key === "search") return { iconName: "Search", varName: "--tool-search" };
  if (key === "glob" || key === "find" || key === "ls" || key === "glob_search" || key === "list") return { iconName: "FolderSearch", varName: "--tool-search" };
  if (key === "todo") return { iconName: "ListTodo", varName: "--tool-todo" };
  if (key === "task" || key === "agent" || key === "subagent") return { iconName: "Bot", varName: "--tool-task" };
  if (key === "ask" || key === "question" || key === "confirm") return { iconName: "MessageCircleQuestion", varName: "--tool-ask" };
  if (key === "hub" || key === "mcp") return { iconName: "Plug", varName: "--tool-hub" };
  if (key.endsWith("read") || key.endsWith("_read") || key.endsWith(".read")) return { iconName: "FileText", varName: "--tool-read" };
  if (key.includes("edit")) return { iconName: "Pencil", varName: "--tool-edit" };
  if (key.includes("write")) return { iconName: "FilePlus", varName: "--tool-write" };
  if (key.includes("bash") || key.includes("shell") || key.includes("terminal")) return { iconName: "Terminal", varName: "--tool-bash" };
  if (key.includes("grep") || key.includes("search") || key.includes("glob") || key.includes("find")) return { iconName: "FolderSearch", varName: "--tool-search" };
  if (key.includes("todo")) return { iconName: "ListTodo", varName: "--tool-todo" };
  if (key.includes("task")) return { iconName: "Bot", varName: "--tool-task" };
  if (key.includes("irc")) return { iconName: "Hash", varName: "--tool-irc" };
  return { iconName: "Wrench", varName: "--tool-generic" };
}

export function getToolFilePath(input: Record<string, unknown>): string | null {
  const p = input.path;
  if (typeof p === "string" && p) return p;
  const fp = input.file_path;
  if (typeof fp === "string" && fp) return fp;
  return null;
}
