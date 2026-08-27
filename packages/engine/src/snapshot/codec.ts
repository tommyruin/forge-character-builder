/**
 * Snapshot codec — canonical JSON, SHA-256, gzip.
 *
 * Browser-compatible by design: the engine worker must serve both Node and
 * browser hosts, so this module uses only platform Web APIs (TextEncoder/
 * TextDecoder, crypto.subtle, CompressionStream/DecompressionStream) and never
 * node:crypto or Buffer. Every failure path rejects with SnapshotCodecError
 * carrying a machine-readable reason so controllers can map it to
 * snapshot-rejected or diagnostics warnings.
 */

import { SNAPSHOT_PARSER_VERSION } from "@forge-cb/api";

export type SnapshotCodecReason =
  | "corrupt"
  | "identity-mismatch"
  | "schema-mismatch"
  | "oversized"
  | "invalid-json"
  | "invalid-structure";

export class SnapshotCodecError extends Error {
  readonly reason: SnapshotCodecReason;

  constructor(reason: SnapshotCodecReason, message: string) {
    super(message);
    this.name = "SnapshotCodecError";
    this.reason = reason;
  }
}

export const CONTENT_COMPRESSED_LIMIT = 64 * 1024 * 1024;
export const CONTENT_DECOMPRESSED_LIMIT = 128 * 1024 * 1024;
export const CHARACTER_COMPRESSED_LIMIT = 4 * 1024 * 1024;
export const CHARACTER_DECOMPRESSED_LIMIT = 32 * 1024 * 1024;

/**
 * Parser schema version stamped into snapshot payloads. Bump on ANY change to
 * content parsing OR library finalization (proxies, normalization, generated
 * elements, supports tagging): snapshots store the finalized library, so a
 * stale version would resurrect pre-change output on every boot.
 * v2: improvement-option normalization tags the captured Feat clones.
 * v3: per-class Feat clones are ensured with full feat-select machinery.
 * v4: the internal ability score improvements carry "allow duplicate".
 * v5: generated spell scrolls carry per-level setters/descriptions,
 *     spellcasting blocks parse allowReplace, boolean attributes parse
 *     case-insensitively.
 * v7: Alignment, Deity and Proficiency elements classify as ruleset-shared.
 * v8: the bundled content moves under content/{core,srd-5.1,srd-5.2.1} and the
 *     SRD 5.1 subset is generated from the corpus; the value now lives in the
 *     wire contract as SNAPSHOT_PARSER_VERSION.
 */
export const PARSER_VERSION: string = SNAPSHOT_PARSER_VERSION;

const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deterministic JSON: object keys sorted lexicographically by UTF-16 code
 * unit, undefined object values dropped, undefined array elements as null,
 * non-finite numbers as null (JSON.stringify emits "null" for them too, but
 * writing it explicitly keeps non-finite numbers from leaking into payloads),
 * and tagged encodings for Map/Set: {"$map":[[k,v],...]} / {"$set":[...]}.
 *
 * Map keys are restricted to strings and numbers, and Map/Set members are
 * sorted by their canonical encoding, so two inputs with the same content
 * canonicalize identically regardless of construction or insertion order.
 * Circular structures and unsupported value types throw invalid-structure.
 */
export function canonicalStringify(value: unknown): string {
  return stringifyNode(value, new Set<object>());
}

function stringifyNode(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (type === "bigint" || type === "function" || type === "symbol" || value === undefined) {
    throw new SnapshotCodecError("invalid-structure", `cannot canonicalize a ${type} value`);
  }
  if (seen.has(value)) {
    throw new SnapshotCodecError("invalid-structure", "circular structure cannot be canonicalized");
  }
  seen.add(value);
  try {
    if (value instanceof Map) {
      const entries = [...value.entries()].map(
        ([key, entryValue]) => [canonicalMapKey(key), stringifyNode(entryValue, seen)] as const,
      );
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return `{"$map":[${entries.map(([key, entryValue]) => `[${key},${entryValue}]`).join(",")}]}`;
    }
    if (value instanceof Set) {
      const members = [...value].map((member) => stringifyNode(member, seen)).sort();
      return `{"$set":[${members.join(",")}]}`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((member) => (member === undefined ? "null" : stringifyNode(member, seen))).join(",")}]`;
    }
    if (!isPlainObject(value)) {
      throw new SnapshotCodecError("invalid-structure", "non-plain object cannot be canonicalized");
    }
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyNode(value[key], seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function canonicalMapKey(key: unknown): string {
  if (typeof key === "string") return JSON.stringify(key);
  if (typeof key === "number" && Number.isFinite(key)) return JSON.stringify(key);
  throw new SnapshotCodecError("invalid-structure", "Map keys must be strings or finite numbers");
}

/**
 * Inverse of canonicalStringify: restores tagged Map/Set encodings. A tag key
 * must be the object's only key; otherwise the object would be ambiguous
 * between a tagged value and a real object field.
 */
export function canonicalParse(json: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SnapshotCodecError("invalid-json", "payload is not valid JSON");
  }
  return parseNode(parsed);
}

function parseNode(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((member) => parseNode(member));
  if (!isPlainObject(value)) {
    throw new SnapshotCodecError("invalid-structure", "non-plain object in payload");
  }
  const keys = Object.keys(value);
  const hasMap = keys.includes("$map");
  const hasSet = keys.includes("$set");
  if (hasMap || hasSet) {
    if (keys.length !== 1) {
      throw new SnapshotCodecError("invalid-structure", "tagged encoding must be the object's only key");
    }
    if (hasMap) return parseMap(value.$map);
    return parseSet(value.$set);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = parseNode(value[key]);
  return out;
}

function parseMap(value: unknown): Map<string | number, unknown> {
  if (!Array.isArray(value)) {
    throw new SnapshotCodecError("invalid-structure", "$map must be an array of [key, value] pairs");
  }
  const map = new Map<string | number, unknown>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new SnapshotCodecError("invalid-structure", "$map entries must be [key, value] pairs");
    }
    const key = entry[0];
    if (typeof key !== "string" && typeof key !== "number") {
      throw new SnapshotCodecError("invalid-structure", "$map keys must be strings or numbers");
    }
    map.set(key, parseNode(entry[1]));
  }
  return map;
}

function parseSet(value: unknown): Set<unknown> {
  if (!Array.isArray(value)) {
    throw new SnapshotCodecError("invalid-structure", "$set must be an array");
  }
  return new Set(value.map((member) => parseNode(member)));
}

/** Lowercase hex SHA-256 of a byte array or UTF-8 string. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---- synchronous SHA-256 ----------------------------------------------------
//
// WebCrypto's subtle.digest is async-only, but the diagnostics recorder must
// stay readable immediately after a synchronous service import (the service's
// onImport hook fires synchronously and callers read diagnostics() without
// awaiting). This pure-JS implementation is browser-safe (no node:crypto, no
// Buffer) and pinned against the same vectors as sha256Hex.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr32(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/** Lowercase hex SHA-256 computed synchronously (browser-safe, no node:crypto). */
export function sha256HexSync(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const bitLength = bytes.byteLength * 8;
  const paddedLength = (Math.floor((bytes.byteLength + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array<number>(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15]!, 7) ^ rotr32(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr32(w[i - 2]!, 17) ^ rotr32(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export interface GzipResult {
  bytes: ArrayBuffer;
  compressedBytes: number;
  uncompressedBytes: number;
}

/**
 * gzip-compresses bytes, rejecting with "oversized" as soon as the compressed
 * output exceeds compressedLimit (the reader stops and cancels the stream, so
 * no unbounded buffering happens).
 */
export async function gzipToBuffer(bytes: Uint8Array, compressedLimit: number): Promise<GzipResult> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const chunks = await readWithLimit(stream, compressedLimit, "compressed output");
  const out = concatChunks(chunks);
  return {
    // the fresh allocation is always a plain ArrayBuffer, never SharedArrayBuffer
    bytes: out.buffer as ArrayBuffer,
    compressedBytes: out.byteLength,
    uncompressedBytes: bytes.byteLength,
  };
}

/**
 * Decompresses gzip bytes, rejecting with "oversized" when the compressed
 * input exceeds compressedLimit or the decompressed output exceeds
 * decompressedLimit, and "corrupt" when the gzip stream is invalid.
 */
export async function gunzipBounded(
  compressed: Uint8Array,
  compressedLimit: number,
  decompressedLimit: number,
): Promise<Uint8Array> {
  if (compressed.byteLength > compressedLimit) {
    throw new SnapshotCodecError(
      "oversized",
      `compressed input ${compressed.byteLength} bytes exceeds limit ${compressedLimit}`,
    );
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  let chunks: Uint8Array[];
  try {
    chunks = await readWithLimit(stream, decompressedLimit, "decompressed output");
  } catch (error) {
    if (error instanceof SnapshotCodecError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new SnapshotCodecError("corrupt", `gzip stream failed: ${detail}`);
  }
  return concatChunks(chunks);
}

async function readWithLimit(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  what: string,
): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return chunks;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // the oversized rejection is the error that matters
        }
        throw new SnapshotCodecError("oversized", `${what} ${total} bytes exceeds limit ${limit}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
