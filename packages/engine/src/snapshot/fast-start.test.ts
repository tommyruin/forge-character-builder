import { describe, expect, it, beforeAll } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { createFastStartController, type FastStartController } from "./fast-start.js";
import { FAST_START_MANIFEST } from "./identities.js";
import { canonicalParse, gunzipBounded, gzipToBuffer, CONTENT_DECOMPRESSED_LIMIT } from "./codec.js";
import type { BootFromSnapshotRequestDto } from "@forge-cb/api";
import { buildCorpusLibrary } from "../testing/corpus.js";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function emptyLibrary(): ElementLibrary {
  return {
    byId: new Map(),
    byType: new Map(),
    typeCounts: {},
    sources: new Map(),
    elementCount: 0,
    fileOrder: [],
    ruleset: new Map(),
    rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 },
  };
}

const decoder = new TextDecoder();

async function decodeBuffer(body: ArrayBuffer): Promise<Record<string, unknown>> {
  const decompressed = await gunzipBounded(new Uint8Array(body), 64 * 1024 * 1024, CONTENT_DECOMPRESSED_LIMIT);
  return canonicalParse(decoder.decode(decompressed)) as Record<string, unknown>;
}

async function prepareBuffer(controller: FastStartController): Promise<ArrayBuffer> {
  await controller.prepare();
  return controller.takeBuffer();
}

async function bootRequest(body: ArrayBuffer, overrides: Partial<BootFromSnapshotRequestDto> = {}): Promise<BootFromSnapshotRequestDto> {
  return {
    manifest: FAST_START_MANIFEST,
    expectedIdentity: FAST_START_MANIFEST,
    body,
    ...overrides,
  };
}

async function tamperedBuffer(
  controller: FastStartController,
  mutate: (payload: Record<string, unknown>) => void,
): Promise<ArrayBuffer> {
  const body = await prepareBuffer(controller);
  const decompressed = await gunzipBounded(new Uint8Array(body), 64 * 1024 * 1024, CONTENT_DECOMPRESSED_LIMIT);
  const payload = canonicalParse(decoder.decode(decompressed)) as Record<string, unknown>;
  mutate(payload);
  const gzipped = await gzipToBuffer(new TextEncoder().encode(JSON.stringify(payload)), 64 * 1024 * 1024);
  return gzipped.bytes;
}

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  if (ua.byteLength !== ub.byteLength) return false;
  for (let i = 0; i < ua.byteLength; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

describe("fast start controller", () => {
  const CORPUS_TIMEOUT = 60_000;

  it("prepares metadata and a readable gzip payload for the full corpus", async () => {
    const controller = createFastStartController(library);
    const prepared = await controller.prepare();
    expect(prepared.client).toBe("dm-forge-fast-start");
    expect(prepared.schema).toBe(2);
    expect(prepared.codec).toBe("gzip-json");
    expect(prepared.libraryKind).toBe("fcb-fast-start-library");
    expect(prepared.schemaVersion).toBe(2);
    expect(prepared.elementCount).toBe(25960);
    expect(prepared.sourceCount).toBe(136);
    expect(prepared.fileCount).toBe(742);
    expect(Object.values(prepared.typeCounts).reduce((sum, n) => sum + n, 0)).toBe(26369);
    expect(prepared.orderedLibraryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.diagnosticsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.serializedBytes).toBeGreaterThan(0);
    expect(prepared.compressedBytes).toBeGreaterThan(0);
    expect(prepared.serializationMs).toBeGreaterThanOrEqual(0);
    expect(prepared.compressionMs).toBeGreaterThanOrEqual(0);

    const payload = await decodeBuffer(controller.takeBuffer());
    expect(payload.client).toBe("dm-forge-fast-start");
    expect(payload.schema).toBe(2);
    expect(payload.codec).toBe("gzip-json");
    expect(payload.libraryKind).toBe("fcb-fast-start-library");
    expect(payload.schemaVersion).toBe(2);
    expect(payload.diagnostics).toBeNull();
    expect(payload.graph).toBeDefined();
  }, CORPUS_TIMEOUT);

  it("produces byte-identical buffers across repeated prepares", async () => {
    const controller = createFastStartController(library);
    const first = await prepareBuffer(controller);
    const second = await prepareBuffer(controller);
    expect(bytesEqual(first, second)).toBe(true);
  }, CORPUS_TIMEOUT);

  it("boots into a separate library object, preserving its reference", async () => {
    const controller = createFastStartController(library);
    const body = await prepareBuffer(controller);

    const bootTarget = emptyLibrary();
    const bootController = createFastStartController(bootTarget);
    const result = await bootController.boot(await bootRequest(body));

    expect(result.elementCount).toBe(25960);
    expect(result.sourceCount).toBe(136);
    expect(result.fileCount).toBe(742);
    expect(Object.values(result.typeCounts).reduce((sum, n) => sum + n, 0)).toBe(26369);
    expect(result.validationMs).toBeGreaterThanOrEqual(0);
    expect(result.hydrationMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(bootTarget.elementCount).toBe(25960);
    expect(bootTarget.byId.size).toBe(25960);
    expect(bootTarget.sources.size).toBe(136);
    expect(bootTarget.fileOrder).toEqual(library.fileOrder);
    expect(bootTarget.typeCounts).toEqual(library.typeCounts);
    expect(bootTarget.rulesetCounts).toEqual(library.rulesetCounts);
  }, CORPUS_TIMEOUT);

  it("refuses incremental ingest into a snapshot-booted library instead of wiping it", async () => {
    const controller = createFastStartController(library);
    const body = await prepareBuffer(controller);

    const bootTarget = { ...emptyLibrary(), fileContents: new Map<string, string>() };
    const bootController = createFastStartController(bootTarget);
    await bootController.boot(await bootRequest(body));

    // The snapshot graph carries no raw file contents, so incremental file
    // operations cannot start from the installed set; they must fail loudly
    // (caller does a full rebuild) rather than rebuild from the uploads alone.
    const spellXml = `<?xml version="1.0"?><elements><element name="Custom Bolt" type="Spell" source="Homebrew" id="ID_HOMEBREW_SPELL_CUSTOM_BOLT"><supports>Wizard</supports><setters><set name="level">1</set></setters></element></elements>`;
    const upload = { path: "imports/custom/custom-spell.xml", base64: Buffer.from(spellXml, "utf8").toString("base64") };
    const before = bootTarget.elementCount;
    await expect(ingestContentFiles(bootTarget, [upload])).rejects.toMatchObject({ code: "conflict" });
    expect(bootTarget.elementCount).toBe(before);
    expect(bootTarget.byId.has("ID_WOTC_PHB_CLASS_WIZARD")).toBe(true);
  }, CORPUS_TIMEOUT);

  it("rejects a corrupt body without touching the existing library", async () => {
    const target = emptyLibrary();
    const controller = createFastStartController(target);
    const junk = new Uint8Array(64);
    await expect(controller.boot(await bootRequest(junk.buffer))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "corrupt" },
    });
    expect(target.elementCount).toBe(0);
  });

  it("rejects a mismatched manifest or expectedIdentity", async () => {
    const controller = createFastStartController(library);
    const body = await prepareBuffer(controller);
    const wrong = { client: "dm-forge-character-load", schema: 1, codec: "gzip-json" };
    await expect(controller.boot(await bootRequest(body, { manifest: wrong }))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "identity-mismatch" },
    });
    await expect(controller.boot(await bootRequest(body, { expectedIdentity: wrong }))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "identity-mismatch" },
    });
  }, CORPUS_TIMEOUT);

  it("rejects a payload with the wrong schema version", async () => {
    const controller = createFastStartController(library);
    const body = await tamperedBuffer(controller, (payload) => {
      payload.schemaVersion = 99;
    });
    await expect(controller.boot(await bootRequest(body))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "schema-mismatch" },
    });
  }, CORPUS_TIMEOUT);

  it("rejects a stale engineVersion payload", async () => {
    const controller = createFastStartController(library);
    const body = await tamperedBuffer(controller, (payload) => {
      payload.engineVersion = "0.0.0";
    });
    await expect(controller.boot(await bootRequest(body))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "schema-mismatch" },
    });
  }, CORPUS_TIMEOUT);

  it("rejects a structurally invalid graph", async () => {
    const controller = createFastStartController(library);
    const body = await tamperedBuffer(controller, (payload) => {
      const graph = payload.graph as { byId: Array<{ index: number }> };
      graph.byId[0]!.index = 1_000_000;
    });
    await expect(controller.boot(await bootRequest(body))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "invalid-structure" },
    });
  }, CORPUS_TIMEOUT);

  it("rejects a reordered element table whose digest no longer matches re-serialization", async () => {
    const controller = createFastStartController(library);
    const body = await tamperedBuffer(controller, (payload) => {
      const graph = payload.graph as {
        elementTable: Array<{ identity: { type: string } }>;
        byId: Array<{ index: number }>;
        byType: Array<{ indexes: number[] }>;
        sources: Array<{ index: number }>;
      };
      const table = graph.elementTable;
      const firstType = table[0]!.identity.type;
      const other = table.findIndex((entry, index) => index > 0 && entry.identity.type === firstType);
      expect(other).toBeGreaterThan(0);
      const [a, b] = [table[0]!, table[other]!];
      table[0] = b;
      table[other] = a;
      const swap = (index: number): number => (index === 0 ? other : index === other ? 0 : index);
      for (const record of graph.byId) record.index = swap(record.index);
      for (const record of graph.byType) record.indexes = record.indexes.map(swap);
      for (const record of graph.sources) record.index = swap(record.index);
    });
    await expect(controller.boot(await bootRequest(body))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "invalid-structure" },
    });
  }, CORPUS_TIMEOUT);

  it("rejects a semantically invalid hydrated library without touching the existing library", async () => {
    const controller = createFastStartController(library);
    const body = await tamperedBuffer(controller, (payload) => {
      const graph = payload.graph as {
        ruleset: Array<{ id: string; tag: "2014" | "2024" | "shared" }>;
        rulesetCounts: { rules2014Count: number; rules2024Count: number; sharedCount: number };
      };
      const entry = graph.ruleset.find(({ tag }) => tag !== "shared")!;
      if (entry.tag === "2014") graph.rulesetCounts.rules2014Count--;
      else graph.rulesetCounts.rules2024Count--;
      entry.tag = "shared";
      graph.rulesetCounts.sharedCount++;
    });

    const target = emptyLibrary();
    const before = {
      byId: target.byId,
      byType: target.byType,
      typeCounts: target.typeCounts,
      sources: target.sources,
      fileOrder: target.fileOrder,
      ruleset: target.ruleset,
      rulesetCounts: target.rulesetCounts,
    };
    const bootController = createFastStartController(target);

    await expect(bootController.boot(await bootRequest(body))).rejects.toMatchObject({
      code: "snapshot-rejected",
      details: { reason: "invalid-structure" },
    });
    expect(target.elementCount).toBe(0);
    expect(target.byId).toBe(before.byId);
    expect(target.byType).toBe(before.byType);
    expect(target.typeCounts).toBe(before.typeCounts);
    expect(target.sources).toBe(before.sources);
    expect(target.fileOrder).toBe(before.fileOrder);
    expect(target.ruleset).toBe(before.ruleset);
    expect(target.rulesetCounts).toBe(before.rulesetCounts);
  }, CORPUS_TIMEOUT);

  it("keeps the existing library untouched by every rejection", async () => {
    const target = emptyLibrary();
    const controller = createFastStartController(library);
    const body = await prepareBuffer(controller);
    const bootController = createFastStartController(target);
    const wrong = { client: "wrong", schema: 1, codec: "gzip-json" };
    await expect(bootController.boot(await bootRequest(body, { expectedIdentity: wrong }))).rejects.toMatchObject({
      code: "snapshot-rejected",
    });
    expect(target.elementCount).toBe(0);
    expect(target.byId.size).toBe(0);
  }, CORPUS_TIMEOUT);

  it("enforces one-shot replace-and-consume buffer semantics", async () => {
    const controller = createFastStartController(library);
    await controller.prepare();
    await controller.prepare();
    const taken = controller.takeBuffer();
    expect(taken.byteLength).toBeGreaterThan(0);
    expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));

    const fresh = createFastStartController(library);
    expect(() => fresh.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));
  }, CORPUS_TIMEOUT);

  it("clears an older pending buffer when the next prepare fails", async () => {
    const source = emptyLibrary();
    const controller = createFastStartController(source);
    await controller.prepare();
    (source.typeCounts as Record<string, unknown>).invalid = 1n;

    await expect(controller.prepare()).rejects.toMatchObject({ reason: "invalid-structure" });
    expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));
  });

  it("round-trips an empty library with elementCount 0", async () => {
    const source = emptyLibrary();
    const controller = createFastStartController(source);
    const prepared = await controller.prepare();
    expect(prepared.elementCount).toBe(0);
    const body = controller.takeBuffer();

    const target = emptyLibrary();
    const bootController = createFastStartController(target);
    const result = await bootController.boot(await bootRequest(body));
    expect(result.elementCount).toBe(0);
    expect(result.sourceCount).toBe(0);
    expect(result.fileCount).toBe(0);
    expect(target.elementCount).toBe(0);
  });
});
