/** Small platform-neutral primitives used by the worker-reachable engine. */

import { sha256HexSync } from "./snapshot/codec.js";

let fallbackCounter = 0;

/** A UUID v4 without a dependency on Node's `crypto` module. */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject !== undefined && typeof cryptoObject.getRandomValues === "function") {
    cryptoObject.getRandomValues(bytes);
  } else {
    // This path is only a last resort for hosts without Web Crypto. Mix a
    // monotonic counter with the current time; uniqueness is all callers need.
    const seed = `${Date.now()}-${fallbackCounter++}-${Math.random()}`;
    const digest = sha256HexSync(seed);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Decode base64 using Web APIs (and no Node Buffer global). */
export function decodeBase64(value: string): Uint8Array {
  if (typeof globalThis.atob !== "function") {
    throw new Error("base64 decoding is unavailable in this host");
  }
  const text = globalThis.atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Encode bytes as base64 using Web APIs (and no Node Buffer global). */
export function encodeBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== "function") {
    throw new Error("base64 encoding is unavailable in this host");
  }
  let text = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    text += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return globalThis.btoa(text);
}

// MD5 is used only for the opaque checksum attribute on generated attack
// rows. Keeping this tiny implementation here preserves the existing wire
// values while avoiding a Node-only crypto import in browser workers.
const MD5_S: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K: readonly number[] = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const rotl32 = (value: number, shift: number): number => ((value << shift) | (value >>> (32 - shift))) >>> 0;

/** Lowercase hexadecimal MD5 of UTF-8 text. */
export function md5Hex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.byteLength * 8;
  const paddedLength = (Math.floor((bytes.byteLength + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 8, bitLength >>> 0, true);
  lengthView.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = new DataView(padded.buffer, offset, 64).getUint32(i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = (b + rotl32((a + f + MD5_K[i]! + words[g]!) >>> 0, MD5_S[i]!)) >>> 0;
      a = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);
  view.setUint32(0, a0, true);
  view.setUint32(4, b0, true);
  view.setUint32(8, c0, true);
  view.setUint32(12, d0, true);
  return [...out].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
