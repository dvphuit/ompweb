import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-attachments.ts");
}

const image = { type: "image", mimeType: "image/png", data: "YWJj" };

/** Base64 payload decoding to exactly `bytes`. */
function imageOfBytes(bytes) {
  const wholeTriplets = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const suffix = remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return { type: "image", mimeType: "image/png", data: `${"AAAA".repeat(wholeTriplets)}${suffix}` };
}

test("calculates padded base64 byte lengths and rejects invalid data", async () => {
  const { getBase64DecodedByteLength } = await loadSubject();

  assert.equal(getBase64DecodedByteLength("YQ=="), 1);
  assert.equal(getBase64DecodedByteLength("YWI="), 2);
  assert.equal(getBase64DecodedByteLength("YWJj"), 3);
  assert.equal(getBase64DecodedByteLength("not base64!"), null);
});

test("rejects invalid, oversized, and too many image attachments", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES, validateAgentImages } = await loadSubject();
  const oversizedData = "AAAA".repeat(Math.ceil((MAX_ATTACHED_IMAGE_BYTES + 1) / 3));

  assert.equal(validateAgentImages([image]), null);
  assert.match(validateAgentImages([{ ...image, mimeType: "text/plain" }]), /valid base64 image/);
  assert.match(validateAgentImages([{ ...image, data: oversizedData }]), /1 MB per message/);
  assert.match(validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image)), /at most/);
});

test("accepts several screenshots that stay inside the aggregate budget", async () => {
  const { MAX_TOTAL_ATTACHED_IMAGE_BYTES, validateAgentImages, validateOutgoingPrompt } = await loadSubject();
  const images = Array.from({ length: 4 }, () => imageOfBytes(MAX_TOTAL_ATTACHED_IMAGE_BYTES / 8));

  assert.equal(validateAgentImages(images), null);
  assert.equal(validateOutgoingPrompt("Compare these screenshots", images), null);
});

test("rejects images that individually fit but together exceed the aggregate budget", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, validateAgentImages, validateOutgoingPrompt } = await loadSubject();
  const half = imageOfBytes(MAX_ATTACHED_IMAGE_BYTES * 0.6);
  const images = [half, half];

  assert.equal(validateAgentImages([half]), null, "each image alone is within the per-image cap");
  assert.match(validateAgentImages(images), /1 MB per message/);
  assert.match(validateOutgoingPrompt("two big shots", images), /1 MB per message/);
});

test("rejects a prompt whose wire frame would exceed omp's 1 MiB per-message limit", async () => {
  const {
    MAX_AGENT_WIRE_FRAME_BYTES,
    MAX_TOTAL_ATTACHED_IMAGE_BYTES,
    getAgentRequestByteLength,
    validateOutgoingPrompt,
  } = await loadSubject();
  const images = [imageOfBytes(MAX_TOTAL_ATTACHED_IMAGE_BYTES)];
  // The full image budget base64-inflates close to (but under) the 1 MiB wire
  // ceiling; a short prompt still fits, an 8 MiB text prompt obviously does not.
  const withinBudget = "x".repeat(1024);
  const overWire = "x".repeat(MAX_AGENT_WIRE_FRAME_BYTES);

  assert.ok(getAgentRequestByteLength(withinBudget, images) > MAX_TOTAL_ATTACHED_IMAGE_BYTES);
  assert.equal(validateOutgoingPrompt(withinBudget, images), null);
  assert.match(validateOutgoingPrompt(overWire, images), /at most about 1 MB/);
  assert.match(validateOutgoingPrompt(overWire), /at most about 1 MB/);
});

test("a few small images plus a long prompt is rejected when the combined frame exceeds 1 MiB", async () => {
  const { validateOutgoingPrompt } = await loadSubject();
  // Each image is 100 KiB decoded (~137 KiB base64 + per-entry overhead); five
  // of them are ~684 KiB on the wire, so 400 KiB of prose pushes the frame past
  // 1 MiB even though no per-image or aggregate-image rule trips.
  const images = Array.from({ length: 5 }, () => imageOfBytes(100 * 1024));
  assert.equal(validateOutgoingPrompt("ok", images), null);
  assert.match(validateOutgoingPrompt("x".repeat(400 * 1024), images), /at most about 1 MB/);
});

test("validates the expanded web slash prompt rather than its shorter command text", async () => {
  const { MAX_AGENT_WIRE_FRAME_BYTES, validateOutgoingPrompt } = await loadSubject();
  const { expandWebSlashCommand } = await import("./web-slash-commands.ts");
  const commandPrefix = "/goal ";
  // Estimator overhead: COMMAND_ENVELOPE_BYTES (256) + JSON quotes (2); leave
  // 100 bytes so the ~140-byte fixed goal wrapper pushes expansion over the wire.
  const raw = `${commandPrefix}${"x".repeat(MAX_AGENT_WIRE_FRAME_BYTES - 256 - 2 - commandPrefix.length - 100)}`;
  const expansion = expandWebSlashCommand(raw);

  assert.equal(validateOutgoingPrompt(raw), null, "the raw slash command fits");
  assert.equal(expansion.kind, "expand");
  assert.match(validateOutgoingPrompt(expansion.prompt), /too large to send/);
});
