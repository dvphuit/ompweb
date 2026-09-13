import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mapLoginUiRequest, buildLoginUiResponse } = await jiti.import("./login-protocol.ts");

test("open_url maps to an auth event with the copy-target launchUrl", () => {
  const mapped = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_1",
    method: "open_url",
    url: "https://provider.example/authorize?code=abc",
    launchUrl: "http://127.0.0.1:1455/launch",
    instructions: "Open the link, then paste the redirect URL.",
  }, "tok");
  assert.deepEqual(mapped, {
    event: {
      type: "auth",
      url: "https://provider.example/authorize?code=abc",
      launchUrl: "http://127.0.0.1:1455/launch",
      instructions: "Open the link, then paste the redirect URL.",
      token: "tok",
    },
    pending: null,
  });
});

test("open_url falls back to launchUrl when the full URL is missing", () => {
  const mapped = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_1",
    method: "open_url",
    launchUrl: "http://127.0.0.1:1455/launch",
  }, "tok");
  assert.equal(mapped.event.type, "auth");
  assert.equal(mapped.event.url, "http://127.0.0.1:1455/launch");
  assert.equal(mapped.event.launchUrl, null);
});

test("open_url without any link degrades to progress instead of an empty anchor", () => {
  const withText = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_1",
    method: "open_url",
    instructions: "Check your email for the code.",
  }, "tok");
  assert.deepEqual(withText, {
    event: { type: "progress", message: "Check your email for the code." },
    pending: null,
  });
  assert.equal(mapLoginUiRequest({ type: "extension_ui_request", id: "ui_1", method: "open_url" }, "tok"), null);
});

test("input maps to a prompt_request with defaults", () => {
  const mapped = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_2",
    method: "input",
    title: "Paste the redirect URL",
    placeholder: "http://localhost:1455/auth/callback?code=…",
  }, "tok");
  assert.deepEqual(mapped, {
    event: {
      type: "prompt_request",
      message: "Paste the redirect URL",
      placeholder: "http://localhost:1455/auth/callback?code=…",
      token: "tok",
    },
    pending: { kind: "input", id: "ui_2" },
  });
  const bare = mapLoginUiRequest({ type: "extension_ui_request", id: "ui_2", method: "input" }, "tok");
  assert.equal(bare.event.message, "Enter the authorization code");
  assert.equal(bare.event.placeholder, null);
});

test("select maps omp string options to id/label pairs with descriptions", () => {
  const mapped = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_3",
    method: "select",
    title: "Choose a login method",
    options: ["OAuth", "API key"],
    optionDetails: [{ description: "Recommended" }, {}],
  }, "tok");
  assert.deepEqual(mapped, {
    event: {
      type: "select_request",
      message: "Choose a login method",
      options: [
        { id: "OAuth", label: "OAuth — Recommended" },
        { id: "API key", label: "API key" },
      ],
      token: "tok",
    },
    pending: { kind: "select", id: "ui_3" },
  });
});

test("confirm maps to a confirm_request joining title and message", () => {
  const mapped = mapLoginUiRequest({
    type: "extension_ui_request",
    id: "ui_4",
    method: "confirm",
    title: "Overwrite credential?",
    message: "An account is already connected.",
  }, "tok");
  assert.deepEqual(mapped, {
    event: {
      type: "confirm_request",
      message: "Overwrite credential?\nAn account is already connected.",
      token: "tok",
    },
    pending: { kind: "confirm", id: "ui_4" },
  });
});

test("notify maps to progress; non-UI frames are ignored", () => {
  assert.deepEqual(
    mapLoginUiRequest({ type: "extension_ui_request", id: "ui_5", method: "notify", message: "Waiting…" }, "tok"),
    { event: { type: "progress", message: "Waiting…" }, pending: null },
  );
  assert.equal(
    mapLoginUiRequest({ type: "extension_ui_request", id: "ui_5", method: "notify" }, "tok"),
    null,
  );
  for (const method of ["cancel", "setStatus", "setWidget", "setTitle", "set_editor_text", "custom"]) {
    assert.equal(
      mapLoginUiRequest({ type: "extension_ui_request", id: "ui_9", method }, "tok"),
      null,
      method,
    );
  }
  assert.equal(mapLoginUiRequest({ type: "notice", message: "hi" }, "tok"), null);
  assert.equal(mapLoginUiRequest({ type: "extension_ui_request", method: "input" }, "tok"), null);
});

test("login answers resolve with value, except confirm which resolves confirmed", () => {
  assert.deepEqual(
    buildLoginUiResponse({ kind: "input", id: "ui_2" }, "https://localhost/cb?code=x"),
    { type: "extension_ui_response", id: "ui_2", value: "https://localhost/cb?code=x" },
  );
  assert.deepEqual(
    buildLoginUiResponse({ kind: "select", id: "ui_3" }, "OAuth"),
    { type: "extension_ui_response", id: "ui_3", value: "OAuth" },
  );
  assert.deepEqual(
    buildLoginUiResponse({ kind: "confirm", id: "ui_4" }, "true"),
    { type: "extension_ui_response", id: "ui_4", confirmed: true },
  );
  assert.deepEqual(
    buildLoginUiResponse({ kind: "confirm", id: "ui_4" }, "false"),
    { type: "extension_ui_response", id: "ui_4", confirmed: false },
  );
});
