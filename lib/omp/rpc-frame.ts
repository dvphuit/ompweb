/**
 * Framing for OMP's NDJSON RPC transport.
 *
 * IMPORTANT — framing is asymmetric (upstream docs/rpc.md,
 * coding-agent/src/modes/rpc/rpc-input.ts and rpc-frame.ts):
 *
 *   - INBOUND (omp stdout -> web): protocol v2 may split an oversized event
 *     into `rpc_chunk` physical frames (`chunkId`/`index`/`count`/`byteLength`,
 *     base64 `data`, 256 KiB payload per physical line, 1 MiB envelope, 64 MiB
 *     logical cap). RpcFrameDecoder reassembles them.
 *   - OUTBOUND (web -> omp stdin): each command MUST be exactly one
 *     newline-terminated JSON object. omp's stdin reader calls JSON.parse per
 *     line and has NO chunk reassembler. The official TS/Python clients write
 *     stdin the same way. Sending `rpc_chunk` frames that way yields
 *     "Unknown command: rpc_chunk" error responses (with no correlation id)
 *     while the original command hangs until its ack timeout, after which the
 *     session gets recycled.
 *
 * Therefore encodeRpcFrames() below never chunks: an oversized outbound frame
 * throws RpcFrameTooLargeError synchronously, so callers fail fast (HTTP 400 /
 * composer preflight) instead of hanging and destroying the session.
 */
import { isRecord } from "../type-guards";

export const MAX_RPC_FRAME_BYTES = 1024 * 1024;
export const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
export const MAX_RPC_PAYLOAD_BYTES = 256 * 1024;

export type RpcProtocolVersion = 1 | 2;
export type RpcFrameRecord = { type: string; [key: string]: unknown };

/**
 * Thrown when an outbound command's JSONL line would exceed the 1 MiB
 * physical stdin frame limit. omp cannot reassemble such a frame on input, so
 * it must never be written; callers map this to a 400-class user error.
 */
export class RpcFrameTooLargeError extends Error {
  readonly frameBytes: number;
  readonly maxBytes: number;

  constructor(frameBytes: number, maxBytes: number) {
    super(
      `RPC frame is ${frameBytes} bytes which exceeds the ${maxBytes}-byte outbound stdin limit ` +
        "(omp reads stdin as one JSON object per line and does not reassemble chunks)",
    );
    this.name = "RpcFrameTooLargeError";
    this.frameBytes = frameBytes;
    this.maxBytes = maxBytes;
  }
}

interface PendingChunks {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Buffer[];
  receivedBytes: number;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function lineByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8") + 1;
}

function decodeBase64(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error("invalid RPC chunk data");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("invalid RPC chunk data");
  return bytes;
}

/** Decodes complete logical frames from parsed JSONL records (omp stdout). */
export class RpcFrameDecoder {
  private pending: PendingChunks | undefined;

  push(value: unknown): RpcFrameRecord | undefined {
    if (!isRecord(value) || value.type !== "rpc_chunk") {
      if (this.pending) throw new Error("RPC chunk sequence interrupted");
      if (!isRecord(value) || typeof value.type !== "string") throw new Error("RPC frame must be an object");
      return value as RpcFrameRecord;
    }
    const { chunkId, index, count, byteLength } = value;
    if (
      typeof chunkId !== "string" || chunkId.length === 0 || chunkId.length > 128 ||
      !isSafeInteger(index) || !isSafeInteger(count) || !isSafeInteger(byteLength) ||
      index < 0 || count < 2 || count > Math.ceil(MAX_RPC_REASSEMBLED_BYTES / MAX_RPC_PAYLOAD_BYTES) ||
      index >= count || byteLength < MAX_RPC_FRAME_BYTES || byteLength > MAX_RPC_REASSEMBLED_BYTES
    ) throw new Error("invalid RPC chunk metadata");

    const bytes = decodeBase64(value.data);
    if (bytes.byteLength > MAX_RPC_PAYLOAD_BYTES) throw new Error("RPC chunk payload exceeds the transport limit");
    if (!this.pending) {
      if (index !== 0) throw new Error("RPC chunk sequence must start at index 0");
      this.pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
    }
    const pending = this.pending;
    if (pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index) {
      throw new Error("RPC chunk sequence mismatch");
    }
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex++;
    if (pending.receivedBytes > pending.byteLength) throw new Error("RPC chunk sequence exceeds declared length");
    if (pending.nextIndex < pending.count) return undefined;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("RPC chunk sequence length mismatch");

    this.pending = undefined;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks));
    const frame: unknown = JSON.parse(json);
    if (!isRecord(frame) || typeof frame.type !== "string") throw new Error("RPC frame must be an object");
    return frame as RpcFrameRecord;
  }
}

/**
 * Serialize ONE outbound command/response as a single JSONL line.
 *
 * omp stdin has no chunk reassembly, so this never splits a frame regardless
 * of the negotiated protocol version. Frames over MAX_RPC_FRAME_BYTES
 * (including the trailing newline) throw RpcFrameTooLargeError.
 */
export function encodeRpcFrames(frame: RpcFrameRecord): string[] {
  const json = JSON.stringify(frame);
  const bytes = lineByteLength(json);
  if (bytes > MAX_RPC_FRAME_BYTES) {
    throw new RpcFrameTooLargeError(bytes, MAX_RPC_FRAME_BYTES);
  }
  return [`${json}\n`];
}

/** Convenience wrapper: serialize a single outbound frame as one JSONL line. */
export function encodeRpcFrame(frame: RpcFrameRecord): string {
  return encodeRpcFrames(frame)[0];
}

/**
 * Produce `rpc_chunk` physical lines EXACTLY as omp chunks oversized events
 * on stdout (protocol v2). omp-web never sends these to stdin — this is the
 * decoder's inverse, used by tests to simulate inbound chunked events.
 */
export function encodeInboundRpcChunks(frame: RpcFrameRecord, chunkId = "event"): string[] {
  const json = JSON.stringify(frame);
  const source = Buffer.from(json, "utf8");
  // omp only emits rpc_chunk when the physical line would exceed 1 MiB.
  if (source.byteLength + 1 <= MAX_RPC_FRAME_BYTES) return [`${json}\n`];
  const count = Math.ceil(source.byteLength / MAX_RPC_PAYLOAD_BYTES);
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = {
      type: "rpc_chunk",
      chunkId,
      index,
      count,
      byteLength: source.byteLength,
      data: source
        .subarray(index * MAX_RPC_PAYLOAD_BYTES, (index + 1) * MAX_RPC_PAYLOAD_BYTES)
        .toString("base64"),
    };
    const line = JSON.stringify(chunk);
    if (lineByteLength(line) > MAX_RPC_FRAME_BYTES) throw new Error("RPC chunk exceeds the transport limit");
    lines.push(`${line}\n`);
  }
  return lines;
}
