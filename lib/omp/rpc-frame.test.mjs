import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  encodeRpcFrames,
  encodeInboundRpcChunks,
  MAX_RPC_FRAME_BYTES,
  RpcFrameTooLargeError,
  RpcFrameDecoder,
} = await jiti.import("./rpc-frame.ts");

test("outbound frames are always a single JSONL line, even under protocol v2", () => {
  const frame = { type: "prompt", id: "w1", message: "hello", images: [] };
  const lines = encodeRpcFrames(frame, 2, "web-1");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], `${JSON.stringify(frame)}\n`);
  // omp's stdin reader JSON.parses each line: it must get the command verbatim.
  assert.deepEqual(JSON.parse(lines[0]), frame);
});

test("outbound encoding rejects frames over 1 MiB with RpcFrameTooLargeError", () => {
  // omp has no inbound chunk reassembler; an oversized command must fail fast
  // instead of being split into rpc_chunk frames omp would reject as
  // "Unknown command: rpc_chunk" while the real command hangs until timeout.
  const frame = { type: "prompt", id: "w1", message: "x".repeat(MAX_RPC_FRAME_BYTES) };
  assert.throws(
    () => encodeRpcFrames(frame, 2, "web-1"),
    (error) => {
      assert.ok(error instanceof RpcFrameTooLargeError);
      assert.ok(error.frameBytes > MAX_RPC_FRAME_BYTES);
      assert.equal(error.maxBytes, MAX_RPC_FRAME_BYTES);
      return true;
    },
  );
  // v1 never chunked either.
  assert.throws(() => encodeRpcFrames(frame, 1, "web-1"), RpcFrameTooLargeError);
});

test("frames just under the 1 MiB line limit (newline included) still encode", () => {
  // MAX_RPC_FRAME_BYTES counts the physical line including "\n".
  const envelopeBytes = Buffer.byteLength(JSON.stringify({ type: "prompt", message: "" }), "utf8") + 1;
  const message = "x".repeat(MAX_RPC_FRAME_BYTES - envelopeBytes);
  const frame = { type: "prompt", message };
  const lines = encodeRpcFrames(frame);
  assert.equal(lines.length, 1);
  assert.equal(Buffer.byteLength(lines[0], "utf8"), MAX_RPC_FRAME_BYTES);
});

test("inbound: RpcFrameDecoder reassembles an oversized v2 event frame", () => {
  const frame = { type: "message_end", text: "x".repeat(MAX_RPC_FRAME_BYTES) };
  const encoded = encodeInboundRpcChunks(frame, "event-1");
  assert.ok(encoded.length > 1, "fixture should actually produce multiple chunks");

  const decoder = new RpcFrameDecoder();
  let decoded;
  for (const line of encoded) decoded = decoder.push(JSON.parse(line));
  assert.deepEqual(decoded, frame);
});

test("inbound: decoder rejects out-of-order chunks", () => {
  const frame = { type: "message_end", text: "x".repeat(MAX_RPC_FRAME_BYTES) };
  const encoded = encodeInboundRpcChunks(frame, "event-2");
  const decoder = new RpcFrameDecoder();
  assert.throws(() => decoder.push(JSON.parse(encoded[1])), /start at index 0/);
});
