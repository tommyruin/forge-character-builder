import { CHARACTER_LOAD_MANIFEST, CHARACTER_LOAD_SCHEMA_VERSION } from '@forge-cb/api';
import { canonicalStringify, stableHash } from '../cloud/librarySnapshot.js';
import { HASH_PATTERN, toHex } from './encoding.js';

export const CHARACTER_LOAD_FORMAT = CHARACTER_LOAD_MANIFEST.client;
export { CHARACTER_LOAD_SCHEMA_VERSION };
export const CHARACTER_LOAD_PARSER_REVISION = 'character-xml-v1';
export const CHARACTER_LOAD_BODY_CODEC = CHARACTER_LOAD_MANIFEST.codec;
export const MAX_CHARACTER_LOAD_BODY_BYTES = 4 * 1024 * 1024;

const METADATA_FIELDS = new Set([
  'selectionCount',
  'elementCount',
  'inventoryCount',
  'attackCount',
  'finalStateDigest',
  'snapshotBytes',
  'snapshotBodyBytes',
  'snapshotSerializeMs',
  'snapshotCompressMs',
]);

async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Web Crypto is required for local character snapshots',
    );
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${toHex(digest)}`;
}

async function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    );
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  throw new TypeError('Character snapshot body must be binary data');
}

function bodyByteLength(body) {
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return null;
}

function assertBounded(bytes) {
  if (bytes > MAX_CHARACTER_LOAD_BODY_BYTES) {
    throw new RangeError(
      'Character snapshot body exceeds the 4 MiB safety limit',
    );
  }
}

function completeLibraryIdentity(identity) {
  return (
    HASH_PATTERN.test(identity?.key) &&
    HASH_PATTERN.test(identity?.sourceDigest) &&
    typeof identity?.engineVersion === 'string' &&
    identity.engineVersion.trim() &&
    typeof identity?.publicContentProfile === 'string' &&
    identity.publicContentProfile.trim() &&
    typeof identity?.parserRevision === 'string' &&
    identity.parserRevision.trim()
  );
}

function exactIdentityMatch(manifest, identity) {
  const fields = [
    'format',
    'schemaVersion',
    'parserRevision',
    'bodyCodec',
    'characterId',
    'characterXmlHash',
    'libraryKey',
    'librarySourceDigest',
    'libraryParserRevision',
    'engineVersion',
    'publicContentProfile',
    'key',
  ];
  return fields.every(
    (field) => manifest?.[field] === identity?.[field],
  );
}

function completeMetadata(metadata) {
  return (
    Number.isSafeInteger(metadata?.selectionCount) &&
    metadata.selectionCount >= 0 &&
    Number.isSafeInteger(metadata?.elementCount) &&
    metadata.elementCount >= 0 &&
    Number.isSafeInteger(metadata?.inventoryCount) &&
    metadata.inventoryCount >= 0 &&
    Number.isSafeInteger(metadata?.attackCount) &&
    metadata.attackCount >= 0 &&
    HASH_PATTERN.test(metadata?.finalStateDigest)
  );
}

export async function createCharacterLoadIdentity({
  characterId,
  xml,
  libraryIdentity,
  parserRevision = CHARACTER_LOAD_PARSER_REVISION,
}) {
  const normalizedCharacterId = String(characterId ?? '').trim();
  if (!normalizedCharacterId) {
    throw new TypeError('A character id is required');
  }
  if (typeof xml !== 'string' || !xml) {
    throw new TypeError('Character XML is required');
  }
  if (!completeLibraryIdentity(libraryIdentity)) {
    return null;
  }
  const characterXmlHash = await hashBytes(
    new TextEncoder().encode(xml),
  );
  const identity = {
    format: CHARACTER_LOAD_FORMAT,
    schemaVersion: CHARACTER_LOAD_SCHEMA_VERSION,
    parserRevision: String(parserRevision),
    bodyCodec: CHARACTER_LOAD_BODY_CODEC,
    characterId: normalizedCharacterId,
    characterXmlHash,
    libraryKey: libraryIdentity.key,
    librarySourceDigest: libraryIdentity.sourceDigest,
    libraryParserRevision: libraryIdentity.parserRevision,
    engineVersion: libraryIdentity.engineVersion,
    publicContentProfile: libraryIdentity.publicContentProfile,
  };
  return {
    ...identity,
    key: await stableHash(identity),
  };
}

export async function createCharacterLoadRecord({
  identity,
  body,
  engineMetadata,
  now = Date.now(),
}) {
  if (!identity?.key) {
    throw new TypeError(
      'A complete character snapshot identity is required',
    );
  }
  const declaredBytes = bodyByteLength(body);
  if (declaredBytes !== null) assertBounded(declaredBytes);
  const bytes = await toBytes(body);
  assertBounded(bytes.byteLength);
  const metadata = Object.fromEntries(
    Object.entries(engineMetadata ?? {}).filter(([field]) =>
      METADATA_FIELDS.has(field),
    ),
  );
  if (!completeMetadata(metadata)) {
    throw new TypeError(
      'Complete character snapshot engine metadata is required',
    );
  }
  return {
    characterId: identity.characterId,
    key: identity.key,
    manifest: {
      ...identity,
      ...metadata,
      bodyHash: await hashBytes(bytes),
      bodyBytes: bytes.byteLength,
    },
    body: new Blob([bytes], {
      type: 'application/octet-stream',
    }),
    createdAt: now,
  };
}

export async function validateCharacterLoadRecord(record, identity) {
  if (
    !record ||
    record.characterId !== identity?.characterId ||
    record.key !== identity?.key ||
    !exactIdentityMatch(record.manifest, identity)
  ) {
    return {
      valid: false,
      reason:
        'character snapshot manifest does not match the expected identity',
    };
  }
  if (
    !completeMetadata(record.manifest) ||
    !HASH_PATTERN.test(record.manifest.bodyHash)
  ) {
    return {
      valid: false,
      reason: 'character snapshot metadata is incomplete or unsupported',
    };
  }
  const declaredBytes = Number(record.manifest.bodyBytes);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    return {
      valid: false,
      reason: 'character snapshot body length is invalid',
    };
  }
  if (declaredBytes > MAX_CHARACTER_LOAD_BODY_BYTES) {
    return {
      valid: false,
      reason: 'character snapshot body exceeds the 4 MiB safety limit',
    };
  }
  const availableBytes = bodyByteLength(record.body);
  if (availableBytes !== null && availableBytes !== declaredBytes) {
    return {
      valid: false,
      reason:
        'character snapshot body length does not match its manifest',
    };
  }
  let body;
  try {
    body = await toBytes(record.body);
  } catch {
    return {
      valid: false,
      reason: 'character snapshot body is not readable',
    };
  }
  if (body.byteLength !== declaredBytes) {
    return {
      valid: false,
      reason:
        'character snapshot body length does not match its manifest',
    };
  }
  if ((await hashBytes(body)) !== record.manifest.bodyHash) {
    return {
      valid: false,
      reason:
        'character snapshot body hash does not match its manifest',
    };
  }
  return {
    valid: true,
    reason: null,
    body:
      body.byteOffset === 0 &&
      body.byteLength === body.buffer.byteLength
        ? body
        : new Uint8Array(body),
  };
}

export function characterLoadIdentityJson(identity) {
  return canonicalStringify(identity);
}
