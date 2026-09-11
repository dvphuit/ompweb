import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, filterModelOptions } = await jiti.import("./ChatInput.tsx");
const { setDraft, clearDraft } = await jiti.import("@/lib/draft-store");

test("shows Queue instead of Stop for typed text during a run", () => {
  const draftKey = "chat-input-queue-action-test";
  setDraft(draftKey, { value: "Continue after the current run", images: [], files: [] });
  try {
    const html = renderToStaticMarkup(
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onFollowUp() {},
        isStreaming: true,
        draftKey,
      }),
    );

    assert.match(html, />(Queue|chatInput\.queue)</);
    assert.match(html, /title="(Queue this message after the agent finishes|chatInput\.queueMessage)"/);
    assert.doesNotMatch(html, />(Stop|chatInput\.stop)</);
  } finally {
    clearDraft(draftKey);
  }
});

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  // en.json is assembled from locale parts; before assembly the key renders as-is.
  assert.match(html, /(Model error|chatInput\.modelError)/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      modelError: "Invalid models.json schema",
      modelList: [],
      modelNames: {},
    }),
  );

  assert.match(html, />(No models|chatInput\.noModels)</);
  assert.match(html, /title="Model setup: (No models|chatInput\\.noModels)"/);
});


test("renders goal, planning, and advisor indicators at the composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
      modelNames: {},
      activeGoal: { objective: "Ship the active goal bar", startedAt: 1000 },
      onClearGoal() {},
      activePlan: { objective: "Plan the implementation" },
      advisorEnabled: true,
      onAdvisorChange() {},
    }),
  );

  assert.match(html, /Ship the active goal bar/);
  assert.match(html, /(Goal active|chatInput\.goalActive)/);
  assert.doesNotMatch(html, /(Goal completed|chatInput\.goalCompleted)/);
  assert.match(html, /(Planning in progress|chatInput\.planningInProgress)/);
  // The per-chat advisor toggle renders pressed with its disable title.
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /title="(Disable advisor for this chat|chatInput\.advisorDisableTitle|Advisor: [^"]*)"/);
  assert.match(html, /(Finish goal|chatInput\.clearGoal)/);
});

test("renders completed goal status when finished", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
      modelNames: {},
      activeGoal: { objective: "Ship the active goal bar", startedAt: 1000, completedAt: 61000 },
      onClearGoal() {},
    }),
  );

  assert.match(html, /Ship the active goal bar/);
  assert.match(html, /(Goal completed|chatInput\.goalCompleted)/);
  assert.match(html, /1m/);
  assert.match(html, /(Finish goal|chatInput\.clearGoal)/);
});

test("renders the compact toolbar action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onCompact() {},
      isStreaming: false,
    }),
  );

  assert.match(html, /title="(Compact context|chatInput\.compactContext)"/);
});

test("shows the advisor thunder indicator with the reviewing model and reasoning", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      advisorActive: true,
      advisorModel: { name: "GPT-5.6 Luna", reasoning: "xhigh" },
    }),
  );

  assert.match(html, /aria-label="[^"]*GPT-5\.6 Luna[^"]*xhigh[^"]*"/);
});

test("filters model options by display name, identifier, and provider", () => {
  const options = [
    { provider: "OpenAI", modelId: "gpt-5.2", name: "GPT-5.2" },
    { provider: "Anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  ];

  assert.deepEqual(filterModelOptions(options, "sonnet", "en"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "5.2", "en"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "OPENAI", "en"), [options[0]]);
  assert.equal(filterModelOptions(options, "   ", "en"), options);
});
async function loadComposerSlice(start, end) {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from > 0 && to > from, `could not locate the ${start} region`);
  return source.slice(from, to);
}

test("queued slash commands gate /advisor behind the per-chat toggle", async () => {
  const sendQueued = await loadComposerSlice("const sendQueued = useCallback", "const primaryActionQueuesMessage");
  const guard = sendQueued.indexOf('commandName === "advisor" && !advisorEnabled');
  const dispatch = sendQueued.indexOf("onBuiltinCommand?.(msg, {");

  assert.ok(guard > 0, "advisor guard missing from sendQueued");
  assert.ok(dispatch > guard, "advisor guard must run before the command is dispatched");
});

test("queued slash commands run through the shared dispatcher", async () => {
  const sendQueued = await loadComposerSlice("const sendQueued = useCallback", "const primaryActionQueuesMessage");
  // Expansion lives in the dispatcher now, so goal/plan state and `/goal clear`
  // apply while a run is active; the composer only supplies the queue transport.
  assert.match(sendQueued, /deliver: \(prompt\) => \{ onPromptWithStreamingBehavior\?\.\(prompt, streamingBehavior\); \}/);
  assert.doesNotMatch(sendQueued, /expandWebSlashCommand\(msg\)/, "the composer must not expand commands itself");
  // Session commands are omp's to execute, so they keep their raw slash form.
  assert.match(sendQueued, /isActionSlashCommand\(commandName\)/);
});

test("attachments keep slash commands working", async () => {
  const handleSend = await loadComposerSlice("const handleSend = useCallback", "const slashQuery =");
  assert.match(handleSend, /const hasAttachments = attachedImages\.length > 0 \|\| attachedTextFiles\.length > 0;/);
  // A session command cannot carry an attachment: refuse instead of leaking
  // "/compact" to the model as a message the user never meant to send.
  assert.match(handleSend, /chatInput\.commandNoAttachments/);
  // Dispatch is keyed on command ownership, not on the attachment state, and
  // the dispatcher is consulted for both — the composer only supplies the
  // delivery so the files ride along.
  assert.match(handleSend, /isClientOwnedSlashCommand\(commandName\)/);
  assert.match(handleSend, /onBuiltinCommand\(msg, hasAttachments \? \{/);
  // The advisor toggle gates every path, including the composer-only ones.
  const advisorGate = handleSend.indexOf('=== "advisor" && !advisorEnabled');
  const attachmentGate = handleSend.indexOf("if (hasAttachments && isActionSlashCommand(commandName)) {");
  assert.ok(advisorGate > 0 && attachmentGate > advisorGate, "the advisor gate must run before the attachment handling");
});

test("a composer without the session hook still expands its own commands", async () => {
  const handleSend = await loadComposerSlice("const handleSend = useCallback", "const slashQuery =");
  // No dispatcher means no goal/plan state, but literal "/goal …" text must
  // never reach the model: the composer expands, reports usage, or declines.
  const fallback = handleSend.slice(handleSend.indexOf("if (!onBuiltinCommand) {"), handleSend.indexOf("} else {"));
  assert.ok(fallback.length > 20, "missing the no-dispatcher fallback");
  assert.match(fallback, /onSend\(expandedBody \?\? expansion\.prompt/);
  assert.match(fallback, /reportCommandUsage\(expansion\)/);
  // omp's own commands are deliberately left untouched.
  assert.match(handleSend, /if \(rejectsOversizedPrompt\(composedMessage, attachedImages\)\) return;/);
});

test("palette defers to user-defined commands instead of shadowing them", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // A user command named /review or /copy outranks the client's copy…
  assert.match(source, /\.filter\(\(def\) => !userCommandNames\.has\(def\.name\.toLowerCase\(\)\)\)/);
  // …so its palette entry is no longer dropped.
  assert.doesNotMatch(source, /if \(CLIENT_BUILTIN_COMMAND_NAMES\.has\(command\.name\)\) return \[\];/);
  // omp's own TUI-only builtins are still hidden behind the client equivalent.
  assert.match(source, /if \(CLIENT_BUILTIN_COMMAND_NAMES\.has\(command\.name\.toLowerCase\(\)\)\) return \[\];/);
});

test("i18n: all chatInput keys exist across en, ja, and zh-CN", async () => {
  const { readFile } = await import("node:fs/promises");
  const dicts = {};
  for (const locale of ["en", "ja", "zh-CN"]) {
    dicts[locale] = JSON.parse(await readFile(new URL(`../lib/i18n/locales/${locale}.json`, import.meta.url), "utf8"));
  }
  const keys = Object.keys(dicts.en).filter((key) => key.startsWith("chatInput."));
  assert.ok(keys.length >= 140, `expected at least 140 chatInput keys, found ${keys.length}`);
  for (const key of keys) {
    for (const locale of ["ja", "zh-CN"]) {
      assert.ok(dicts[locale][key], `Missing ${locale} translation for ${key}`);
    }
  }
});

test("renders single queued prompt in compact bar", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      queuedMessages: {
        followUp: ["First follow-up task"],
        steering: [],
      },
    }),
  );

  assert.match(html, /First follow-up task/);
  assert.match(html, />(Edit|chatInput\.queuedEdit)</);
  assert.match(html, />(Delete|chatInput\.queuedDelete)</);
  assert.match(html, />(Steer|chatInput\.queuedSteerAction)</);
});

test("renders multiple queued prompts with count and expand action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      queuedMessages: {
        followUp: ["First task", "Second task"],
        steering: ["Priority steer"],
      },
    }),
  );

  // Square count badge (never a pill) carries the queued total.
  assert.match(html, /class="queue-count">3</);
  // The expand affordance is a real button: short label, full sentence as title.
  assert.match(html, /title="(Show all queued prompts|chatInput\.expandQueued)"/);
  assert.match(html, />(Expand|Show all|chatInput\.expandQueued)</);
  assert.match(html, /First task/);
});

test("model picker dropdown source uses scale-immune anchored positioning", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  // Ensures the model picker dropdown is anchored with CSS positioning (bottom: calc(100% + 6px), left: 0)
  // and doesn't rely on raw viewport getBoundingClientRect measurements that break when html zoom is applied.
  assert.doesNotMatch(source, /setModelDropdownRect/);
  assert.match(source, /bottom:\s*isMobile\s*\?\s*8\s*:\s*["']calc\(100%\s*\+\s*6px\)["']/);
});

test("renders the unified model setup trigger when a picker handler is provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: false,
      toolPreset: "full",
      onToolPresetChange() {},
    }),
  );

  assert.match(html, /aria-label="Model setup: full"/);
  assert.match(html, /aria-haspopup="dialog"/);
});

test("model setup trigger is absent without any picker handler", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: false,
    }),
  );

  assert.doesNotMatch(html, /Model setup/);
});

test("renders live status bar attached to the composer top edge when statusText is provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      statusText: "Waiting for model...",
    }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /Waiting for model\.\.\./);
  assert.match(html, /live-status-dot/);
});

test("omits live status bar when statusText is absent or null", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: false,
      statusText: null,
    }),
  );

  assert.doesNotMatch(html, /role="status"/);
  assert.doesNotMatch(html, /Waiting for model/);
});

test("renders both queued prompts and attached status bar together", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      statusText: "Waiting for model...",
      queuedMessages: {
        steer: [],
        followUp: ["Next prompt to run"],
      },
    }),
  );

  assert.match(html, /Next prompt to run/);
  assert.match(html, /Waiting for model\.\.\./);
  assert.match(html, /live-status-dot/);
});

test("palette keeps queueable commands visible during a run", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // Prompt-composing commands work while a run is active (the dispatcher expands
  // them into the queue), so they must stay listed; only session commands drop.
  assert.doesNotMatch(
    source,
    /\[\.\.\.\(isStreaming \? \[\] : builtinSlashCommands\)/,
    "hiding every builtin during a run leaves the palette empty",
  );
  assert.match(source, /const visibleBuiltinCommands = isStreaming/);
  assert.match(source, /!isActionSlashCommand\(command\.name\)/);
});
