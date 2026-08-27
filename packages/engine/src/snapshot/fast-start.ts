/**
 * Fast Start controller: prepares and serves a compressed snapshot of the
 * content library, and boots an existing library object from one.
 *
 * The payload is kind tcb-fast-start-library (schema 1): the canonical-JSON
 * content graph (serializeContentLibrary) plus a reserved diagnostics area
 * (null today), gzip-compressed. Buffers are one-shot: prepare replaces any
 * older pending buffer, takeBuffer consumes it. boot() validates everything
 * on a temporary value before copying into the existing library object, so a
 * rejected snapshot never touches the live content.
 */

import { canonicalStringify, canonicalParse, gzipToBuffer, gunzipBounded, sha256Hex, SnapshotCodecError, CONTENT_COMPRESSED_LIMIT, CONTENT_DECOMPRESSED_LIMIT, PARSER_VERSION } from "./codec.js";
import { contentLibraryDigest, hydrateContentLibrary, serializeContentLibrary, validateContentLibrary, type ContentLibraryPayload } from "./content-graph.js";
import { FAST_START_MANIFEST, FAST_START_LIBRARY_KIND, FAST_START_SCHEMA_VERSION } from "./identities.js";
import { engineError } from "../errors.js";
import { ENGINE_VERSION } from "../index.js";
import type { ElementLibrary } from "../content/library.js";
import type { BootFromSnapshotRequestDto, BootFromSnapshotResultDto, FastStartSnapshotPreparedDto, ManifestIdentityDto } from "@forge-cb/api";

export interface FastStartController {
  prepare(): Promise<FastStartSnapshotPreparedDto>;
  /** The pending prepared buffer; consumed by the call. */
  takeBuffer(): ArrayBuffer;
  /** Hydrates the payload into the library object the controller was built with. */
  boot(request: BootFromSnapshotRequestDto): Promise<BootFromSnapshotResultDto>;
}

export function createFastStartController(library: ElementLibrary): FastStartController {
  return new FastStartControllerImpl(library);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectSnapshot(error: SnapshotCodecError): never {
  throw engineError("snapshot-rejected", error.message, { reason: error.reason });
}

class FastStartControllerImpl implements FastStartController {
  private readonly library: ElementLibrary;
  private pendingBuffer: ArrayBuffer | undefined;

  constructor(library: ElementLibrary) {
    this.library = library;
  }

  async prepare(): Promise<FastStartSnapshotPreparedDto> {
    this.pendingBuffer = undefined;
    const graph = serializeContentLibrary(this.library);
    const payload = {
      client: FAST_START_MANIFEST.client,
      schema: FAST_START_MANIFEST.schema,
      codec: FAST_START_MANIFEST.codec,
      libraryKind: FAST_START_LIBRARY_KIND,
      schemaVersion: FAST_START_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      parserVersion: PARSER_VERSION,
      graph,
      diagnostics: null,
    };

    const orderedLibraryDigest = await contentLibraryDigest(graph);
    const diagnosticsDigest = await sha256Hex(canonicalStringify(payload.diagnostics));

    const serializationStart = performance.now();
    let json: string;
    try {
      json = canonicalStringify(payload);
    } catch (error) {
      throw engineError("conflict", `snapshot preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const serializationMs = Math.max(0, performance.now() - serializationStart);
    const serializedBytes = encoder.encode(json).byteLength;

    const compressionStart = performance.now();
    let compressed: ArrayBuffer;
    try {
      const gzipped = await gzipToBuffer(encoder.encode(json), CONTENT_COMPRESSED_LIMIT);
      compressed = gzipped.bytes;
      this.pendingBuffer = compressed;
      const compressionMs = Math.max(0, performance.now() - compressionStart);
      return {
        client: FAST_START_MANIFEST.client,
        schema: FAST_START_MANIFEST.schema,
        codec: FAST_START_MANIFEST.codec,
        libraryKind: FAST_START_LIBRARY_KIND,
        schemaVersion: FAST_START_SCHEMA_VERSION,
        elementCount: this.library.elementCount,
        sourceCount: this.library.sources.size,
        fileCount: this.library.fileOrder.length,
        typeCounts: { ...this.library.typeCounts },
        orderedLibraryDigest,
        diagnosticsDigest,
        serializedBytes,
        compressedBytes: gzipped.compressedBytes,
        serializationMs,
        compressionMs,
      };
    } catch (error) {
      if (error instanceof SnapshotCodecError) {
        throw engineError("conflict", `snapshot preparation failed: ${error.message}`);
      }
      throw error;
    }
  }

  takeBuffer(): ArrayBuffer {
    const buffer = this.pendingBuffer;
    if (buffer === undefined) throw engineError("conflict", "no pending fast start snapshot buffer");
    this.pendingBuffer = undefined;
    return buffer;
  }

  async boot(request: BootFromSnapshotRequestDto): Promise<BootFromSnapshotResultDto> {
    const totalStart = performance.now();
    const validationStart = performance.now();
    let hydrated: ElementLibrary;
    try {
      const decompressed = await gunzipBounded(
        new Uint8Array(request.body),
        CONTENT_COMPRESSED_LIMIT,
        CONTENT_DECOMPRESSED_LIMIT,
      );
      const decoded = canonicalParse(decoder.decode(decompressed));
      if (!isRecord(decoded)) throw new SnapshotCodecError("invalid-structure", "payload must be an object");
      if (
        decoded.client !== FAST_START_MANIFEST.client ||
        decoded.schema !== FAST_START_MANIFEST.schema ||
        decoded.codec !== FAST_START_MANIFEST.codec
      ) {
        throw new SnapshotCodecError(
          "identity-mismatch",
          `payload identity (${String(decoded.client)}/${String(decoded.schema)}/${String(decoded.codec)}) ` +
            `is not ${FAST_START_MANIFEST.client}/${FAST_START_MANIFEST.schema}/${FAST_START_MANIFEST.codec}`,
        );
      }
      if (decoded.libraryKind !== FAST_START_LIBRARY_KIND || decoded.schemaVersion !== FAST_START_SCHEMA_VERSION) {
        throw new SnapshotCodecError(
          "schema-mismatch",
          `payload libraryKind/schemaVersion (${String(decoded.libraryKind)}/${String(decoded.schemaVersion)}) ` +
            `is not ${FAST_START_LIBRARY_KIND}/${FAST_START_SCHEMA_VERSION}`,
        );
      }
      if (decoded.engineVersion !== ENGINE_VERSION) {
        throw new SnapshotCodecError(
          "schema-mismatch",
          `payload engineVersion "${String(decoded.engineVersion)}" does not match "${ENGINE_VERSION}"`,
        );
      }
      if (decoded.parserVersion !== PARSER_VERSION) {
        throw new SnapshotCodecError(
          "schema-mismatch",
          `payload parserVersion "${String(decoded.parserVersion)}" does not match "${PARSER_VERSION}"`,
        );
      }
      hydrated = hydrateContentLibrary(decoded.graph);
      // The graph must be in exact canonical form: re-serializing the hydrated
      // library must reproduce it byte-for-byte, so reordering a table or
      // records in an otherwise-valid payload still fails here.
      const graphDigest = await contentLibraryDigest(decoded.graph as ContentLibraryPayload);
      const reSerializedDigest = await contentLibraryDigest(serializeContentLibrary(hydrated));
      if (graphDigest !== reSerializedDigest) {
        throw new SnapshotCodecError("invalid-structure", "payload graph is not in canonical form");
      }
      validateContentLibrary(hydrated);
      if (!identityMatches(request.manifest) || !identityMatches(request.expectedIdentity)) {
        throw new SnapshotCodecError(
          "identity-mismatch",
          "request manifest/expectedIdentity do not match the fast start identity",
        );
      }
    } catch (error) {
      if (error instanceof SnapshotCodecError) rejectSnapshot(error);
      throw error;
    }
    const validationMs = Math.max(0, performance.now() - validationStart);

    const hydrationStart = performance.now();
    this.library.byId = hydrated.byId;
    this.library.byType = hydrated.byType;
    this.library.typeCounts = hydrated.typeCounts;
    this.library.sources = hydrated.sources;
    this.library.elementCount = hydrated.elementCount;
    this.library.fileOrder = hydrated.fileOrder;
    this.library.ruleset = hydrated.ruleset;
    this.library.rulesetCounts = hydrated.rulesetCounts;
    // The snapshot graph carries the finalized library only, not the raw XML
    // it was built from; incremental file operations must see that absence
    // instead of treating the installed set as empty.
    this.library.fileContents = undefined;
    this.library.revision = (this.library.revision ?? 0) + 1;
    const hydrationMs = Math.max(0, performance.now() - hydrationStart);
    const totalMs = Math.max(0, performance.now() - totalStart);

    return {
      elementCount: this.library.elementCount,
      sourceCount: this.library.sources.size,
      fileCount: this.library.fileOrder.length,
      typeCounts: { ...this.library.typeCounts },
      hydrationMs,
      validationMs,
      totalMs,
    };
  }
}

function identityMatches(identity: ManifestIdentityDto): boolean {
  return (
    identity.client === FAST_START_MANIFEST.client &&
    identity.schema === FAST_START_MANIFEST.schema &&
    identity.codec === FAST_START_MANIFEST.codec
  );
}
