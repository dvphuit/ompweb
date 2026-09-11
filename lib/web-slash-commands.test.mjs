import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./web-slash-commands.ts");
}

test("exposes the expected command set with hints and arg requirements", async () => {
  const { WEB_SLASH_COMMANDS } = await loadSubject();
  const names = WEB_SLASH_COMMANDS.map((command) => command.name);

  assert.deepEqual(names, ["goal", "plan", "review", "fix", "test", "explain", "simplify", "commit", "advisor", "loop"]);
  assert.ok(WEB_SLASH_COMMANDS.every((command) => command.descriptionKey.startsWith("chatInput.cmd")));
  assert.ok(WEB_SLASH_COMMANDS.every((command) => command.argumentHintKey.startsWith("chatInput.cmd")));

  const required = new Set(WEB_SLASH_COMMANDS.filter((command) => command.requiresArgs).map((command) => command.name));
  assert.deepEqual(required, new Set(["goal", "plan", "fix", "test", "explain", "simplify", "loop"]));
});

test("lookup matches names case-insensitively but never by alias", async () => {
  const { getWebSlashCommand } = await loadSubject();
  assert.equal(getWebSlashCommand("goal")?.name, "goal");
  assert.equal(getWebSlashCommand("plan")?.name, "plan");
  // The palette filters case-insensitively, so a name typed from memory must
  // resolve the same way rather than fall through as literal slash text.
  assert.equal(getWebSlashCommand("GOAL")?.name, "goal");
  assert.equal(getWebSlashCommand("Plan")?.name, "plan");
  // Aliases remain out of scope: the client advertises names, not aliases.
  assert.equal(getWebSlashCommand("vibe"), undefined);
  assert.equal(getWebSlashCommand("goals"), undefined);
});

test("expansion ignores case and reports the canonical command name", async () => {
  const { expandWebSlashCommand } = await loadSubject();

  const upper = expandWebSlashCommand("/GOAL ship it");
  assert.equal(upper.kind, "expand");
  if (upper.kind === "expand") assert.match(upper.prompt, /ship it/);

  // Only the name is case-folded; the args reach the agent exactly as typed.
  const args = expandWebSlashCommand("/Review lib/Router.GOAL.ts");
  assert.equal(args.kind, "expand");
  if (args.kind === "expand") assert.ok(args.prompt.includes("lib/Router.GOAL.ts"));

  const usage = expandWebSlashCommand("/Goal");
  assert.equal(usage.kind, "usage-error");
  if (usage.kind === "usage-error") assert.equal(usage.command, "/goal");
});

test("required-arg commands embed the args verbatim", async () => {
  const { getWebSlashCommand } = await loadSubject();
  const goal = getWebSlashCommand("goal");
  assert.ok(goal);
  const prompt = goal.buildPrompt("ship the export feature");

  assert.match(prompt, /Work toward this goal for the rest of the session/);
  assert.ok(prompt.includes("ship the export feature"));
});

test("optional-arg commands degrade to a default when no args are given", async () => {
  const { getWebSlashCommand } = await loadSubject();
  const review = getWebSlashCommand("review");
  const commit = getWebSlashCommand("commit");
  assert.ok(review);
  assert.ok(commit);

  assert.match(review.buildPrompt(""), /current project state and recent changes/);
  assert.match(review.buildPrompt("lib/model-catalog.ts"), /Review lib\/model-catalog\.ts for bugs/);

  assert.match(commit.buildPrompt(""), /clear conventional commit message/);
  assert.match(commit.buildPrompt("feat: add catalog"), /commit the current changes with this message: "feat: add catalog"/);
});

test("advisor command reviews with or without a topic", async () => {
  const { getWebSlashCommand, expandWebSlashCommand } = await loadSubject();
  const advisor = getWebSlashCommand("advisor");
  assert.ok(advisor);

  assert.match(advisor.buildPrompt(""), /independent advisor reviewing the current work/);
  assert.match(advisor.buildPrompt("the retry logic"), /reviewing this work: the retry logic/);

  const expanded = expandWebSlashCommand("/advisor the retry logic");
  assert.equal(expanded.kind, "expand");
  if (expanded.kind === "expand") assert.match(expanded.prompt, /the retry logic/);
});

test("expansion expands web commands, rejects missing args, and passes others through", async () => {
  const { expandWebSlashCommand } = await loadSubject();

  const expanded = expandWebSlashCommand("/goal ship the export");
  assert.equal(expanded.kind, "expand");
  if (expanded.kind === "expand") assert.match(expanded.prompt, /ship the export/);

  const usage = expandWebSlashCommand("/goal ");
  assert.equal(usage.kind, "usage-error");
  if (usage.kind === "usage-error") {
    assert.equal(usage.command, "/goal");
    assert.equal(usage.argumentHintKey, "chatInput.cmdGoalArg");
  }

  // Plain messages and non-web commands are not the client's business.
  assert.equal(expandWebSlashCommand("just a message").kind, "not-web");
  assert.equal(expandWebSlashCommand("/compact").kind, "not-web");
  assert.equal(expandWebSlashCommand("/vibe go fast").kind, "not-web");
});

test("loop repeats a task up to the requested count", async () => {
  const { getWebSlashCommand, expandWebSlashCommand } = await loadSubject();
  const loop = getWebSlashCommand("loop");
  assert.ok(loop);

  const prompt = loop.buildPrompt("3 run the test suite");
  assert.match(prompt, /up to 3 attempts/);
  assert.ok(prompt.includes("run the test suite"));

  // A missing count defaults; an absurd count clamps so a typo cannot run away.
  assert.match(loop.buildPrompt("run the test suite"), /up to 3 attempts/);
  assert.match(loop.buildPrompt("999 run the test suite"), /up to 10 attempts/);

  const expanded = expandWebSlashCommand("/loop 2 fix the flake");
  assert.equal(expanded.kind, "expand");
  if (expanded.kind === "expand") assert.match(expanded.prompt, /up to 2 attempts/);

  assert.equal(expandWebSlashCommand("/loop ").kind, "usage-error");

  // A leading number is a count, so `/loop 4` asks for 4 attempts at nothing:
  // report usage instead of running a task literally named "4".
  assert.equal(expandWebSlashCommand("/loop 4").kind, "usage-error");
  // Zero attempts is not "three attempts"; `/loop 0 …` is a mistake, not a hint.
  assert.equal(expandWebSlashCommand("/loop 0 fix it").kind, "usage-error");
  assert.match(expandWebSlashCommand("/loop 1 fix it").prompt, /up to 1 attempt in total/);
  // A sign makes the token prose rather than a count, so it stays in the task.
  const signed = expandWebSlashCommand("/loop -3 fix it");
  assert.equal(signed.kind, "expand");
  if (signed.kind === "expand") assert.ok(signed.prompt.includes("-3 fix it"));
});
