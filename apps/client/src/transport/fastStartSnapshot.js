import { FAST_START_MANIFEST, FAST_START_SCHEMA_VERSION, SNAPSHOT_PARSER_VERSION } from '@forge-cb/api';
import { canonicalStringify, stableHash } from '../cloud/librarySnapshot.js';
import { HASH_PATTERN, compareStrings, toHex } from './encoding.js';

export const FAST_START_FORMAT = FAST_START_MANIFEST.client;
export { FAST_START_SCHEMA_VERSION };
// Keyed on the engine's parser revision, so stored snapshots miss when
// content parsing or library finalization changes.
export const FAST_START_PARSER_REVISION = `finalized-library-v${SNAPSHOT_PARSER_VERSION}`;

/**
 * The engine identity a snapshot is keyed on. The build stamps a fingerprint
 * of the engine sources into the bundle, so any engine change orphans stored
 * snapshots automatically. Without a fingerprint (dev server, tests) the
 * fingerprint cannot track live edits, so snapshots are disabled in dev
 * unless explicitly enabled; the override doubles as a kill switch.
 * Returns the identity string, or null when snapshots must not be used.
 * @param {{ dev?: boolean, fingerprint?: string | null, override?: string | null }} [options]
 * @param {string | null | undefined} engineVersion
 * @returns {string | null}
 */
export function resolveFastStartEngineVersion({ dev = false, fingerprint, override } = {}, engineVersion) {
  if (!engineVersion) return null;
  const flag = String(override ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return null;
  const stamped = String(fingerprint ?? '').trim();
  if (stamped) return `${engineVersion}+${stamped}`;
  if (dev && flag !== '1' && flag !== 'true') return null;
  return engineVersion;
}
export const MAX_FAST_START_BODY_BYTES = 64 * 1024 * 1024;
export const FAST_START_LIBRARY_KIND = 'tcb-fast-start-library';
export const FAST_START_BODY_CODEC = 'gzip-json';

const IDENTITY_FIELDS = [
  'format',
  'schemaVersion',
  'parserRevision',
  'engineVersion',
  'publicContentProfile',
  'sourceDigest',
  'fileCount',
  'key',
];
const ENGINE_METADATA_FIELDS = new Set([
  'libraryKind',
  'bodyCodec',
  'elementCount',
  'elementTypeCount',
  'orderedElementDigest',
  'diagnosticsDigest',
  'snapshotBytes',
  'snapshotBodyBytes',
  'snapshotSerializeMs',
  'snapshotCompressMs',
  'snapshotDecompressMs',
  'snapshotHydrateMs',
]);

async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for local Fast Start');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${toHex(digest)}`;
}

async function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new TypeError('Snapshot body must be binary data');
}

function binaryBodyByteLength(body) {
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (body instanceof Blob) return body.size;
  return null;
}

function assertBodyWithinSafetyLimit(bodyBytes) {
  if (bodyBytes > MAX_FAST_START_BODY_BYTES) {
    throw new RangeError(
      'Snapshot body exceeds the 64 MiB safety limit',
    );
  }
}

function exactIdentityMatch(manifest, identity) {
  if (
    !IDENTITY_FIELDS.every(
      (field) => manifest?.[field] === identity?.[field],
    )
  ) {
    return false;
  }
  try {
    return (
      canonicalStringify(manifest?.sourcePointers) ===
      canonicalStringify(identity?.sourcePointers)
    );
  } catch {
    return false;
  }
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizePointerMetadata(value) {
  if (value === undefined || value === null) return null;
  return JSON.parse(canonicalStringify(value));
}

function normalizeSourcePointer(source) {
  const kind = String(source?.kind ?? 'unknown').trim();
  return {
    kind: kind || 'unknown',
    location: normalizeOptionalString(source?.location),
    revision: normalizeOptionalString(source?.revision),
    licence: normalizePointerMetadata(
      source?.licence ?? source?.license,
    ),
    provenance: normalizePointerMetadata(source?.provenance),
  };
}

function compareSourcePointers(left, right) {
  return compareStrings(
    canonicalStringify(left),
    canonicalStringify(right),
  );
}

function hasCompleteEngineMetadata(metadata) {
  return (
    metadata?.libraryKind === FAST_START_LIBRARY_KIND &&
    metadata?.bodyCodec === FAST_START_BODY_CODEC &&
    Number.isSafeInteger(metadata?.elementCount) &&
    metadata.elementCount >= 0 &&
    Number.isSafeInteger(metadata?.elementTypeCount) &&
    metadata.elementTypeCount >= 0 &&
    HASH_PATTERN.test(metadata?.orderedElementDigest) &&
    HASH_PATTERN.test(metadata?.diagnosticsDigest)
  );
}

export async function createFastStartIdentity({
  engineVersion,
  publicContentProfile,
  parserRevision = FAST_START_PARSER_REVISION,
  files = [],
  orderedFileHashes: suppliedFileHashes,
  sources = [],
}) {
  const normalizedEngineVersion = String(engineVersion ?? '').trim();
  if (!normalizedEngineVersion) return null;
  const normalizedProfile = String(publicContentProfile ?? '').trim();
  if (!normalizedProfile) {
    throw new TypeError('A public content profile is required');
  }
  if (!Array.isArray(files)) {
    throw new TypeError('Snapshot content files must be an array');
  }
  if (!Array.isArray(sources)) {
    throw new TypeError('Snapshot content sources must be an array');
  }

  let orderedFileHashes;
  if (suppliedFileHashes !== undefined) {
    if (!Array.isArray(suppliedFileHashes)) {
      throw new TypeError('Snapshot file hashes must be an array');
    }
    const seenPaths = new Set();
    orderedFileHashes = suppliedFileHashes
      .map((entry) => {
        if (
          typeof entry?.path !== 'string' ||
          !entry.path.trim() ||
          !HASH_PATTERN.test(entry?.hash)
        ) {
          throw new TypeError('Snapshot file hashes are invalid');
        }
        if (seenPaths.has(entry.path)) {
          throw new TypeError(`Duplicate snapshot file hash: ${entry.path}`);
        }
        seenPaths.add(entry.path);
        return { path: entry.path, hash: entry.hash };
      })
      .sort((left, right) => compareStrings(left.path, right.path));
  } else {
    const orderedFiles = files
      .map((file) => {
        if (
          typeof file?.path !== 'string' ||
          !file.path.trim() ||
          typeof file.base64 !== 'string'
        ) {
          throw new TypeError(
            'Snapshot content files require path and base64',
          );
        }
        return { path: file.path, base64: file.base64 };
      })
      .sort((left, right) => compareStrings(left.path, right.path));
    orderedFileHashes = await Promise.all(
      orderedFiles.map(async (file) => ({
        path: file.path,
        hash: await stableHash(file),
      })),
    );
  }
  const sourceDigest = await stableHash(orderedFileHashes);
  const sourcePointers = sources
    .map(normalizeSourcePointer)
    .sort(compareSourcePointers);
  const identity = {
    format: FAST_START_FORMAT,
    schemaVersion: FAST_START_SCHEMA_VERSION,
    parserRevision: String(parserRevision),
    engineVersion: normalizedEngineVersion,
    publicContentProfile: normalizedProfile,
    sourceDigest,
    fileCount: orderedFileHashes.length,
    sourcePointers,
  };

  return {
    ...identity,
    orderedFileHashes,
    key: await stableHash(identity),
  };
}

export async function createFastStartRecord({
  identity,
  body,
  engineMetadata = {},
  now = Date.now(),
}) {
  if (!identity?.key) {
    throw new TypeError('A complete snapshot identity is required');
  }
  const declaredBodyBytes = binaryBodyByteLength(body);
  if (declaredBodyBytes !== null) {
    assertBodyWithinSafetyLimit(declaredBodyBytes);
  }
  const bytes = await toBytes(body);
  assertBodyWithinSafetyLimit(bytes.byteLength);
  const bodyHash = await hashBytes(bytes);
  const safeEngineMetadata = Object.fromEntries(
    Object.entries(engineMetadata).filter(([field]) =>
      ENGINE_METADATA_FIELDS.has(field),
    ),
  );
  if (!hasCompleteEngineMetadata(safeEngineMetadata)) {
    throw new TypeError(
      'A complete engine snapshot metadata contract is required',
    );
  }
  return {
    key: identity.key,
    manifest: {
      ...identity,
      ...safeEngineMetadata,
      bodyHash,
      bodyBytes: bytes.byteLength,
    },
    body: new Blob([bytes], { type: 'application/octet-stream' }),
    createdAt: now,
  };
}

export async function validateFastStartRecord(record, identity) {
  if (!record || record.key !== identity?.key) {
    return {
      valid: false,
      reason: 'manifest does not match the expected snapshot identity',
    };
  }
  if (!exactIdentityMatch(record.manifest, identity)) {
    return {
      valid: false,
      reason: 'manifest does not match the expected snapshot identity',
    };
  }
  if (
    !Array.isArray(record.manifest.sourcePointers) ||
    !hasCompleteEngineMetadata(record.manifest)
  ) {
    return {
      valid: false,
      reason: 'manifest engine metadata is incomplete or unsupported',
    };
  }
  if (
    !Array.isArray(record.manifest.orderedFileHashes) ||
    (await stableHash(record.manifest.orderedFileHashes)) !==
      identity.sourceDigest
  ) {
    return {
      valid: false,
      reason: 'manifest file hashes do not match the expected source digest',
    };
  }
  if (!HASH_PATTERN.test(record.manifest.bodyHash)) {
    return {
      valid: false,
      reason: 'snapshot body hash is invalid',
    };
  }
  const declaredBodyBytes = Number(record.manifest.bodyBytes);
  if (
    !Number.isSafeInteger(declaredBodyBytes) ||
    declaredBodyBytes < 0
  ) {
    return {
      valid: false,
      reason: 'snapshot body length is invalid',
    };
  }
  if (declaredBodyBytes > MAX_FAST_START_BODY_BYTES) {
    return {
      valid: false,
      reason: 'snapshot body exceeds the 64 MiB safety limit',
    };
  }
  const availableBodyBytes =
    typeof record.body?.size === 'number'
      ? record.body.size
      : typeof record.body?.byteLength === 'number'
        ? record.body.byteLength
        : null;
  if (
    availableBodyBytes !== null &&
    availableBodyBytes !== declaredBodyBytes
  ) {
    return {
      valid: false,
      reason: 'snapshot body length does not match its manifest',
    };
  }

  let body;
  try {
    body = await toBytes(record.body);
  } catch {
    return { valid: false, reason: 'snapshot body is not readable' };
  }
  if (body.byteLength !== declaredBodyBytes) {
    return {
      valid: false,
      reason: 'snapshot body length does not match its manifest',
    };
  }
  if ((await hashBytes(body)) !== record.manifest.bodyHash) {
    return {
      valid: false,
      reason: 'snapshot body hash does not match its manifest',
    };
  }
  const transferableBody =
    body.buffer instanceof ArrayBuffer &&
    body.byteOffset === 0 &&
    body.byteLength === body.buffer.byteLength
      ? body
      : new Uint8Array(body);
  return { valid: true, reason: null, body: transferableBody };
}
