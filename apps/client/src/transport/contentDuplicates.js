import { safeContentSourceId } from './contentStorage.js';
import { toHex } from './encoding.js';

const CONTENT_EXTENSIONS = new Set(['.xml', '.index']);

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required to compare content sources.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${toHex(digest)}`;
}

function normalizePath(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLocaleLowerCase() : '';
}

export function relativeContentPath(record, sourceId = record?.sourceId) {
  if (record?.relativePath) return normalizePath(record.relativePath);
  const path = normalizePath(record?.path);
  const prefix = `imports/${safeContentSourceId(sourceId)}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function comparableFiles(records, sourceId) {
  return records
    .map((record) => ({
      base64: record?.base64,
      relativePath: relativeContentPath(record, sourceId),
    }))
    .filter(
      (record) =>
        typeof record.base64 === 'string' &&
        record.relativePath &&
        CONTENT_EXTENSIONS.has(extensionOf(record.relativePath)),
    )
    .sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
}

export async function fingerprintContentSource(records, sourceId) {
  const files = comparableFiles(records, sourceId);
  if (!files.length) return null;

  // Hash one file at a time so the browser never creates a second in-memory
  // copy of a complete large import while checking it.
  const entries = [];
  for (const file of files) {
    entries.push([
      file.relativePath,
      await sha256(file.base64),
    ]);
  }
  return sha256(JSON.stringify(entries));
}

export async function describeContentSource(records, sourceId) {
  const files = comparableFiles(records, sourceId);
  return {
    fingerprint: await fingerprintContentSource(files, sourceId),
    fileCount: files.length,
    relativePaths: files.map((file) => file.relativePath),
  };
}

export async function findDuplicateContentGroups(
  sources,
  records,
  { includeAcknowledged = false } = {},
) {
  const recordsBySource = new Map();
  for (const record of records) {
    if (!record?.sourceId) continue;
    const group = recordsBySource.get(record.sourceId) ?? [];
    group.push(record);
    recordsBySource.set(record.sourceId, group);
  }

  const byFingerprint = new Map();
  for (const source of sources) {
    const description = await describeContentSource(
      recordsBySource.get(source.id) ?? [],
      source.id,
    );
    if (!description.fingerprint) continue;
    const entries = byFingerprint.get(description.fingerprint) ?? [];
    entries.push({ source, ...description });
    byFingerprint.set(description.fingerprint, entries);
  }

  const duplicates = [];
  for (const [fingerprint, entries] of byFingerprint) {
    if (entries.length < 2) continue;
    entries.sort((left, right) =>
      left.source.id.localeCompare(right.source.id),
    );
    const acknowledged = entries.every(
      ({ source }) =>
        source.duplicateAcknowledgedFingerprint === fingerprint,
    );
    if (acknowledged && !includeAcknowledged) continue;
    duplicates.push({
      fingerprint,
      acknowledged,
      fileCount: entries[0].fileCount,
      relativePaths: entries[0].relativePaths,
      sourceIds: entries.map(({ source }) => source.id),
      sources: entries.map(({ source }) => source),
    });
  }
  return duplicates.sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

export async function findMatchingContentSources(
  sources,
  records,
  incomingRecords,
  { excludeSourceId = null } = {},
) {
  const incoming = await describeContentSource(incomingRecords, null);
  if (!incoming.fingerprint) return { ...incoming, matches: [] };

  const matches = [];
  for (const source of sources) {
    if (source.id === excludeSourceId) continue;
    const sourceRecords = records.filter(
      (record) => record.sourceId === source.id,
    );
    const fingerprint = await fingerprintContentSource(
      sourceRecords,
      source.id,
    );
    if (fingerprint === incoming.fingerprint) matches.push(source);
  }
  return {
    ...incoming,
    matches: matches.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}
