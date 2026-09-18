import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  canonicalParse,
  sha256Hex,
  sha256HexSync,
  gzipToBuffer,
  gunzipBounded,
  SnapshotCodecError,
  CONTENT_COMPRESSED_LIMIT,
  CONTENT_DECOMPRESSED_LIMIT,
  CHARACTER_COMPRESSED_LIMIT,
  CHARACTER_DECOMPRESSED_LIMIT,
  PARSER_VERSION,
} from "./codec.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("canonicalStringify", () => {
  it("sorts object keys by UTF-16 code unit, independent of construction order", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify({ nested: { z: 1, y: { c: 3, b: 2 } } })).toBe('{"nested":{"y":{"b":2,"c":3},"z":1}}');
  });

  it("drops undefined object values and nulls undefined array elements", () => {
    expect(canonicalStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalStringify([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("nulls non-finite numbers instead of emitting invalid JSON", () => {
    expect(canonicalStringify({ a: NaN, b: Infinity, c: -Infinity })).toBe('{"a":null,"b":null,"c":null}');
    expect(canonicalStringify([NaN])).toBe("[null]");
  });

  it("tags Maps as sorted $map entries and Sets as sorted $set entries", () => {
    expect(canonicalStringify(new Map([["b", 1], ["a", 2]]))).toBe('{"$map":[["a",2],["b",1]]}');
    expect(canonicalStringify(new Map([[2, "x"], [1, "y"]]))).toBe('{"$map":[[1,"y"],[2,"x"]]}');
    expect(canonicalStringify(new Set([3, 1, 2]))).toBe('{"$set":[1,2,3]}');
  });

  it("throws a SnapshotCodecError for non-string/non-number Map keys", () => {
    expect(() => canonicalStringify(new Map([[{}, 1]]))).toThrowError(SnapshotCodecError);
  });

  it("throws a SnapshotCodecError for cyclic structures", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrowError(SnapshotCodecError);
    expect(() => canonicalStringify({ list: [cyclic] })).toThrowError(SnapshotCodecError);
  });
});

describe("canonicalParse", () => {
  it("restores Maps and Sets from tagged encodings", () => {
    const map = canonicalParse('{"$map":[["a",1],["b",2]]}');
    expect(map).toBeInstanceOf(Map);
    expect(map).toEqual(new Map([["a", 1], ["b", 2]]));
    const set = canonicalParse('{"$set":[1,2,3]}');
    expect(set).toBeInstanceOf(Set);
    expect(set).toEqual(new Set([1, 2, 3]));
  });

  it("rejects malformed JSON with reason invalid-json", () => {
    expect(() => canonicalParse("{oops")).toThrowError(expect.objectContaining({ reason: "invalid-json" }));
    expect(() => canonicalParse('{"a": undefined}')).toThrowError(expect.objectContaining({ reason: "invalid-json" }));
  });

  it("rejects malformed tagged structures with reason invalid-structure", () => {
    expect(() => canonicalParse('{"$map":[["a"]]}')).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
    expect(() => canonicalParse('{"$map":{"a":1}}')).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
    expect(() => canonicalParse('{"$set":{"a":1}}')).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
    expect(() => canonicalParse('{"$map":[],"x":1}')).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("accepts an empty tagged encoding", () => {
    expect(canonicalParse('{"$map":[]}')).toEqual(new Map());
    expect(canonicalParse('{"$set":[]}')).toEqual(new Set());
  });

  it("round-trips composite values losslessly", () => {
    const value: unknown = {
      m: new Map([["x", new Set([1, 2])]]),
      l: [new Map([["y", { z: 3 }]]), null, "s"],
      plain: { a: 1 },
    };
    const restored = canonicalParse(canonicalStringify(value));
    expect(restored).toEqual(value);
    expect(restored).toBeInstanceOf(Object);
    expect(canonicalStringify(restored)).toBe(canonicalStringify(value));
  });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(encoder.encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches the known SHA-256 vector for the empty string", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("sha256HexSync", () => {
  it("matches the known SHA-256 vectors", () => {
    expect(sha256HexSync("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexSync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("agrees with the async implementation across block-boundary sizes", async () => {
    for (const size of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 256;
      expect(sha256HexSync(bytes), `size ${size}`).toBe(await sha256Hex(bytes));
    }
    expect(sha256HexSync("The quick brown fox jumps over the lazy dog")).toBe(
      await sha256Hex("The quick brown fox jumps over the lazy dog"),
    );
  });
});

describe("gzipToBuffer and gunzipBounded", () => {
  it("round-trips bytes through gzip and gunzip", async () => {
    const text = "The quick brown fox jumps over the lazy dog.\n".repeat(50);
    const bytes = encoder.encode(text);
    const gz = await gzipToBuffer(bytes, CONTENT_COMPRESSED_LIMIT);
    expect(gz.uncompressedBytes).toBe(bytes.byteLength);
    expect(gz.compressedBytes).toBe(gz.bytes.byteLength);
    expect(gz.compressedBytes).toBeLessThan(bytes.byteLength);
    const out = await gunzipBounded(new Uint8Array(gz.bytes), CONTENT_COMPRESSED_LIMIT, CONTENT_DECOMPRESSED_LIMIT);
    expect(decoder.decode(out)).toBe(text);
  });

  it("rejects oversized compressed output with reason oversized", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    await expect(gzipToBuffer(bytes, 1024)).rejects.toMatchObject({ reason: "oversized" });
  });

  it("rejects compressed input over the compressed limit", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    const gz = await gzipToBuffer(bytes, CONTENT_COMPRESSED_LIMIT);
    await expect(gunzipBounded(new Uint8Array(gz.bytes), 64, CONTENT_DECOMPRESSED_LIMIT)).rejects.toMatchObject({
      reason: "oversized",
    });
  });

  it("rejects oversized decompressed output with reason oversized", async () => {
    const bytes = encoder.encode("abcdefghijklmnopqrstuvwxyz0123456789\n".repeat(128));
    const gz = await gzipToBuffer(bytes, CONTENT_COMPRESSED_LIMIT);
    await expect(
      gunzipBounded(new Uint8Array(gz.bytes), CONTENT_COMPRESSED_LIMIT, 128),
    ).rejects.toMatchObject({ reason: "oversized" });
  });

  it("rejects corrupt gzip bytes with reason corrupt", async () => {
    const junk = crypto.getRandomValues(new Uint8Array(64));
    await expect(gunzipBounded(junk, CONTENT_COMPRESSED_LIMIT, CONTENT_DECOMPRESSED_LIMIT)).rejects.toMatchObject({
      reason: "corrupt",
    });
  });

  it("exposes the shared limit constants and parser version", () => {
    expect(CONTENT_COMPRESSED_LIMIT).toBe(64 * 1024 * 1024);
    expect(CONTENT_DECOMPRESSED_LIMIT).toBe(128 * 1024 * 1024);
    expect(CHARACTER_COMPRESSED_LIMIT).toBe(4 * 1024 * 1024);
    expect(CHARACTER_DECOMPRESSED_LIMIT).toBe(32 * 1024 * 1024);
    expect(PARSER_VERSION).toBe("11");
  });
});
