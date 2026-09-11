import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// useAgentSession.ts owns the chat state machine. These are source-contract
// tests pinning the two navigation-sensitive advisor/new-chat behaviors.

test("abandoned new-chat send delivers the prompt without promoting", async () => {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  // Spawning takes seconds; navigating away mid-spawn unmounts the sender.
  // Promoting then would yank the fresh chat into the old session's history.
  assert.match(source, /const ownerGone = !hookAliveRef\.current/);
  assert.match(source, /if \(!ownerGone\) promoteNewSession\(1, message\)/);
  // Attaching an EventSource on a dead instance leaks it: unmount cleanup
  // already ran, so nothing would ever close the stream.
  assert.match(source, /if \(!ownerGone\) \{\s*\n\s*await ensureEventsConnected\(sid\);/);
});

test("fork carries the advisor choice to the new session id", async () => {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  // The forked child keeps its spawn flags; without propagation the toggle
  // flips off on switch and the next prompt respawns without --advisor.
  assert.match(source, /setSessionAdvisorSpawn\(newSessionId, true\)/);
  assert.match(source, /omp-advisor-enabled:\$\{newSessionId\}/);
});

const DISPATCHER_SLICE = {
  start: "const handleBuiltinSlashCommand",
  end: "const toPiImages",
};

async function loadDispatcher() {
  const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
  const start = source.indexOf(DISPATCHER_SLICE.start);
  const end = source.indexOf(DISPATCHER_SLICE.end);
  assert.ok(start > 0 && end > start, "could not locate the slash-command dispatcher");
  return source.slice(start, end);
}

test("queued slash commands share the dispatcher's semantics", async () => {
  const dispatcher = await loadDispatcher();
  // The composer supplies the transport (queue); the dispatcher keeps ownership
  // of expansion, so a command typed during a run behaves like an idle one.
  assert.match(dispatcher, /options\?: BuiltinSlashCommandOptions/);
  assert.match(dispatcher, /if \(options\?\.deliver\) \{/);
  // Command verbs resolve before the transport is chosen: `/goal clear` must
  // clear the goal while running, not ask the agent for a goal named "clear".
  const clearGoal = dispatcher.indexOf("handleClearGoal();");
  const queueBranch = dispatcher.indexOf("if (options?.deliver) {");
  assert.ok(clearGoal > 0 && queueBranch > clearGoal, "goal verbs must run before the transport is selected");
  // A rejected prompt (oversized, …) must not leave a stale goal/plan chip.
  assert.match(dispatcher, /const rollbackModeState = \(\) => \{/);
  assert.match(dispatcher, /if \(promptError\) \{\s*\n\s*rollbackModeState\(\);/);
  // Both transports take the same expanded body, so neither can drift.
  assert.match(dispatcher, /await options\.deliver\(expansion\.prompt\);/);
  assert.match(dispatcher, /const sent = await handleSend\(expansion\.prompt\);/);
});

test("a user-defined command outranks the client's look-alike", async () => {
  const dispatcher = await loadDispatcher();
  const userWins = dispatcher.indexOf("slashCommands.some((command) => command.name.toLowerCase() === commandName)");
  const switchStart = dispatcher.indexOf("switch (commandName)");
  assert.ok(userWins > 0, "the dispatcher must defer to extension/prompt/skill commands");
  assert.ok(userWins < switchStart, "the check must run before any client command case");
});

test("slash command names are matched case-insensitively", async () => {
  const dispatcher = await loadDispatcher();
  // One parser for the composer, the dispatcher, and the expansion, so the
  // three cannot disagree about what a slash line contains.
  assert.match(dispatcher, /const parsed = parseSlashCommandLine\(text\);/);
  assert.match(dispatcher, /const \{ name: commandName, args \} = parsed;/);
  assert.ok(!dispatcher.includes("text.match(/^"), "the dispatcher must not re-parse the command line");
});

test("/copy works on insecure origins", async () => {
  const dispatcher = await loadDispatcher();
  // navigator.clipboard only exists on secure origins, and omp-web is routinely
  // served over plain http on a LAN address; copyText() has the execCommand path.
  assert.match(dispatcher, /await copyText\(textToCopy\);/);
  assert.doesNotMatch(dispatcher, /navigator\.clipboard\.writeText\(textToCopy\)/);
});
