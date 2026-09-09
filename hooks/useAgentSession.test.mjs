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
