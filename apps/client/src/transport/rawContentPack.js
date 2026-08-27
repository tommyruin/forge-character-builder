import { unzipSync, zipSync } from 'fflate';
import { stableHash } from '../cloud/librarySnapshot.js';
import { HASH_PATTERN, compareStrings, toHex } from './encoding.js';

export const RAW_CONTENT_PACK_FORMAT = 'dm-forge-raw-content-pack';
export const RAW_CONTENT_PACK_SCHEMA_VERSION = 1;

const RAW_CONTENT_PACK_KEY = 'current';
// ZIP stores a local DOS timestamp. Constructing this at UTC midnight becomes
// 1979 in western time zones, which fflate correctly rejects as unrepresentable.
// Local midnight keeps the encoded date fixed at the ZIP epoch everywhere.
function fixedZipTime() {
  return new Date(1980, 0, 1, 0, 0, 0, 0);
}
const MAX_FILES = 2_500;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_PACK_BYTES = 64 * 1024 * 1024;
const SUPPORTED_PATH = /\.(?:xml|index)$/i;
async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for local raw content packs');
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
  throw new TypeError('Raw content pack body must be binary data');
}

function validatePath(input) {
  const path = String(input ?? '');
  const segments = path.split('/');
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`Unsafe content path: ${path || '(empty)'}`);
  }
  if (!SUPPORTED_PATH.test(path)) {
    throw new TypeError(`Unsupported content path: ${path}`);
  }
  return path;
}

function decodeBase64(input) {
  let binary;
  try {
    binary = atob(input);
  } catch {
    throw new TypeError('Raw content record contains invalid base64 data');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function describeFiles(files) {
  const orderedFileHashes = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      hash: await stableHash({
        path: file.path,
        base64: file.base64,
      }),
    })),
  );
  return {
    orderedFileHashes,
    sourceDigest: await stableHash(orderedFileHashes),
  };
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) {
    throw new TypeError('Raw content files must be an array');
  }
  if (files.length > MAX_FILES) {
    throw new TypeError(`Raw content packs support at most ${MAX_FILES} files`);
  }

  const seen = new Set();
  let totalBytes = 0;
  const normalized = files
    .map((file) => {
      const path = validatePath(file?.path);
      if (seen.has(path)) {
        throw new TypeError(`Duplicate content path: ${path}`);
      }
      seen.add(path);
      if (typeof file?.base64 !== 'string') {
        throw new TypeError(`Raw content record is missing base64 data: ${path}`);
      }
      const bytes = decodeBase64(file.base64);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new TypeError('Raw content pack exceeds the 50 MiB safety limit');
      }
      return { path, base64: file.base64, bytes };
    })
    .sort((left, right) => compareStrings(left.path, right.path));
  return normalized;
}

export async function createRawContentPack(files, { now = Date.now() } = {}) {
  const normalized = normalizeFiles(files);
  const zipTime = fixedZipTime();
  const archiveEntries = Object.fromEntries(
    normalized.map(({ path, bytes }) => [
      path,
      [
        bytes,
        {
          mtime: zipTime,
          os: 0,
        },
      ],
    ]),
  );
  const bodyBytes = zipSync(archiveEntries, {
    level: 6,
    mtime: zipTime,
    os: 0,
  });
  const described = await describeFiles(normalized);
  const manifest = {
    format: RAW_CONTENT_PACK_FORMAT,
    schemaVersion: RAW_CONTENT_PACK_SCHEMA_VERSION,
    fileCount: normalized.length,
    ...described,
    bodyHash: await hashBytes(bodyBytes),
    bodyBytes: bodyBytes.byteLength,
  };
  return {
    key: RAW_CONTENT_PACK_KEY,
    manifest,
    body: new Blob([bodyBytes], { type: 'application/zip' }),
    createdAt: now,
  };
}

export async function inspectRawContentPack(record) {
  if (
    record?.key !== RAW_CONTENT_PACK_KEY ||
    record?.manifest?.format !== RAW_CONTENT_PACK_FORMAT ||
    record?.manifest?.schemaVersion !== RAW_CONTENT_PACK_SCHEMA_VERSION ||
    !Number.isSafeInteger(record?.manifest?.fileCount) ||
    record.manifest.fileCount < 0 ||
    record.manifest.fileCount > MAX_FILES ||
    !Array.isArray(record.manifest.orderedFileHashes) ||
    record.manifest.orderedFileHashes.length !== record.manifest.fileCount ||
    !HASH_PATTERN.test(record.manifest.sourceDigest) ||
    !HASH_PATTERN.test(record.manifest.bodyHash)
  ) {
    return { valid: false, reason: 'raw content pack manifest is unsupported' };
  }
  if (
    (await stableHash(record.manifest.orderedFileHashes)) !==
    record.manifest.sourceDigest
  ) {
    return {
      valid: false,
      reason: 'raw content pack file index does not match its manifest',
    };
  }
  const declaredBodyBytes = Number(record.manifest.bodyBytes);
  if (
    !Number.isSafeInteger(declaredBodyBytes) ||
    declaredBodyBytes < 0 ||
    declaredBodyBytes > MAX_PACK_BYTES
  ) {
    return {
      valid: false,
      reason: 'raw content pack length is unsafe',
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
      reason: 'raw content pack length does not match its manifest',
    };
  }

  let body;
  try {
    body = await toBytes(record.body);
  } catch {
    return { valid: false, reason: 'raw content pack body is not readable' };
  }
  if (body.byteLength !== declaredBodyBytes) {
    return {
      valid: false,
      reason: 'raw content pack length does not match its manifest',
    };
  }
  if ((await hashBytes(body)) !== record.manifest.bodyHash) {
    return {
      valid: false,
      reason: 'raw content pack hash does not match its manifest',
    };
  }
  return {
    valid: true,
    reason: null,
    body,
    fileCount: record.manifest.fileCount,
    orderedFileHashes: record.manifest.orderedFileHashes,
    sourceDigest: record.manifest.sourceDigest,
  };
}

export async function extractRawContentPack(inspection) {
  if (!inspection?.valid || !(inspection.body instanceof Uint8Array)) {
    return {
      valid: false,
      reason: inspection?.reason ?? 'raw content pack was not inspected',
    };
  }
  let files;
  try {
    let declaredFiles = 0;
    let declaredBytes = 0;
    const entries = unzipSync(inspection.body, {
      filter(file) {
        validatePath(file.name);
        declaredFiles += 1;
        declaredBytes += Number(file.originalSize) || 0;
        if (
          declaredFiles > MAX_FILES ||
          declaredBytes > MAX_UNCOMPRESSED_BYTES
        ) {
          throw new TypeError('Raw content pack exceeds safety limits');
        }
        return true;
      },
    });
    files = normalizeFiles(
      Object.entries(entries).map(([path, bytes]) => ({
        path,
        base64: encodeBase64(bytes),
      })),
    ).map(({ path, base64 }) => ({ path, base64 }));
  } catch (error) {
    return {
      valid: false,
      reason: `raw content pack could not be read: ${String(
        error?.message ?? error,
      )}`,
    };
  }

  const described = await describeFiles(files);
  if (
    files.length !== inspection.fileCount ||
    described.sourceDigest !== inspection.sourceDigest ||
    JSON.stringify(described.orderedFileHashes) !==
      JSON.stringify(inspection.orderedFileHashes)
  ) {
    return {
      valid: false,
      reason: 'raw content pack files do not match its manifest',
    };
  }
  return { valid: true, reason: null, files };
}

export async function validateRawContentPack(record) {
  const inspection = await inspectRawContentPack(record);
  if (!inspection.valid) return inspection;
  return extractRawContentPack(inspection);
}
