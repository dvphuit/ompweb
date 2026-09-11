import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const slashCommands = await jiti.import("./ChatInput-slash-commands.ts");
const { toSlashCommandInfo } = await jiti.import("@/hooks/useAgentSession-stream");

const {
  ACTION_SLASH_COMMAND_NAMES,
  BUILTIN_SLASH_COMMAND_DEFS,
  CLIENT_BUILTIN_COMMAND_NAMES,
  isActionSlashCommand,
  slashCommandMatchesQuery,
  slashMatchRank,
} = slashCommands;

test("the client's builtin set covers the web commands and the session commands", () => {
  const names = BUILTIN_SLASH_COMMAND_DEFS.map((def) => def.name);
  assert.deepEqual(names.slice(0, 10), ["goal", "plan", "review", "fix", "test", "explain", "simplify", "commit", "advisor", "loop"]);
  assert.deepEqual(names.slice(10), ["compact", "reload", "name", "session", "copy"]);
  assert.deepEqual([...ACTION_SLASH_COMMAND_NAMES], ["compact", "reload", "name", "session", "copy"]);
  for (const name of names) assert.ok(CLIENT_BUILTIN_COMMAND_NAMES.has(name));
  // Every session command is a client builtin, so the palette never advertises
  // a command that dispatch cannot execute.
  for (const name of ACTION_SLASH_COMMAND_NAMES) assert.ok(isActionSlashCommand(name));
  assert.equal(isActionSlashCommand("goal"), false);
  assert.equal(isActionSlashCommand("unknown"), false);
  assert.equal(isActionSlashCommand(null), false);
});

test("external commands keep their argument hint and aliases", () => {
  const info = toSlashCommandInfo({
    name: "deploy",
    description: "Ship the build",
    aliases: ["deploy", "dply", ""],
    input: { hint: "<env>" },
    source: "extension",
  });

  assert.equal(info.argumentHint, "<env>");
  // The primary name is never repeated as an alias, and empty aliases drop.
  assert.deepEqual(info.aliases, ["dply"]);
  assert.equal(info.source, "extension");
});

test("commands without optional metadata stay minimal", () => {
  const info = toSlashCommandInfo({ name: "tdd", description: "Test first", input: { hint: "  " }, source: "skill" });

  assert.equal("argumentHint" in info, false);
  assert.equal("aliases" in info, false);
  assert.equal(info.source, "skill");
  // omp's own TUI-only builtins are dropped: the client ships a working
  // equivalent for every name it intercepts.
  assert.equal(toSlashCommandInfo({ name: "compact", description: "x", source: "builtin" }), null);
});

test("the palette matches aliases and ranks them ahead of description hits", () => {
  const command = { name: "review", description: "Review code for bugs", aliases: ["audit", "rev"], source: "builtin" };

  assert.equal(slashCommandMatchesQuery(command, "audit"), true);
  assert.equal(slashCommandMatchesQuery(command, "AUDIT"), true);
  assert.equal(slashCommandMatchesQuery(command, "revie"), true);
  assert.equal(slashCommandMatchesQuery(command, "for bugs"), true);
  assert.equal(slashCommandMatchesQuery(command, "zzz"), false);

  assert.equal(slashMatchRank(command, "review"), 0);
  assert.equal(slashMatchRank(command, "rev"), 1);
  // Alias prefix outranks a description substring.
  assert.equal(slashMatchRank(command, "audi"), 2);
  assert.equal(slashMatchRank(command, "for bugs"), 3);
  assert.equal(slashMatchRank(command, "nothing"), 4);
});
