import { WEB_SLASH_COMMANDS } from "@/lib/web-slash-commands";

export type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill" | "ompBuiltin";

export type SlashCommandPaletteItem = {
  name: string;
  description?: string;
  /** Bracketed argument hint rendered after the command name, e.g. "[goal]". */
  argumentHint?: string;
  /** Alternate names an external command answers to (searchable, not inserted). */
  aliases?: string[];
  source: SlashCommandSource;
};

export function isDormantSkillCommand(command: SlashCommandPaletteItem, dormantNames: Set<string>): boolean {
  return command.source === "skill" && dormantNames.has(command.name);
}

export const BUILTIN_SLASH_COMMAND_DEFS: { name: string; descriptionKey: string; argumentHintKey?: string }[] = [
  // Web-native prompt-composing commands (goal/plan/... are TUI-only in omp and
  // never execute over the RPC prompt path — see lib/web-slash-commands.ts).
  ...WEB_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    descriptionKey: command.descriptionKey,
    argumentHintKey: command.argumentHintKey,
  })),
  { name: "compact", descriptionKey: "chatInput.cmdCompact" },
  { name: "reload", descriptionKey: "chatInput.cmdReload" },
  { name: "name", descriptionKey: "chatInput.cmdName" },
  { name: "session", descriptionKey: "chatInput.cmdSession" },
  { name: "copy", descriptionKey: "chatInput.cmdCopy" },
];

export const CLIENT_BUILTIN_COMMAND_NAMES = new Set(BUILTIN_SLASH_COMMAND_DEFS.map((def) => def.name));

/**
 * Commands that act on the session itself (they go through the RPC command
 * channel) as opposed to the prompt-composing web commands above. They are
 * listed separately because their rules differ: they must reach omp as raw
 * slash text so its own handlers run, and they cannot carry attachments.
 */
export const ACTION_SLASH_COMMAND_NAMES: readonly string[] = [
  "compact",
  "reload",
  "name",
  "session",
  "copy",
];

const ACTION_SLASH_COMMAND_LOOKUP = new Set(ACTION_SLASH_COMMAND_NAMES);

/** True when the command name is one the client executes itself over RPC. */
export function isActionSlashCommand(name: string | null): boolean {
  return name !== null && ACTION_SLASH_COMMAND_LOOKUP.has(name);
}

export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill", "ompBuiltin"];

export const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chatInput.groupBuiltin",
  extension: "chatInput.groupExtensions",
  prompt: "chatInput.groupPrompts",
  skill: "chatInput.groupSkills",
  ompBuiltin: "chatInput.groupOmpBuiltin",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
  ompBuiltin: 4,
};

export function slashMatchRank(command: SlashCommandPaletteItem, rawQuery: string): number {
  // The composer passes an already-lowercased query; folding here as well keeps
  // these helpers safe to call from anywhere.
  const query = rawQuery.toLowerCase();
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  // Aliases rank ahead of a description hit: typing one is a stronger signal
  // that the user means this command than a word that happens to appear in it.
  if ((command.aliases ?? []).some((alias) => alias.toLowerCase().startsWith(query))) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

/** True when the query matches a command's name, an alias, or its description. */
export function slashCommandMatchesQuery(command: SlashCommandPaletteItem, rawQuery: string): boolean {
  const query = rawQuery.toLowerCase();
  const haystacks = [command.name.toLowerCase(), ...(command.aliases ?? []).map((alias) => alias.toLowerCase())];
  return haystacks.some((entry) => entry.includes(query)) || (command.description?.toLowerCase().includes(query) ?? false);
}
