import { HASH_PATTERN, toHex } from '../transport/encoding.js';
export const LIBRARY_FORMAT = 'dm-forge-drive-snapshot';
export const LIBRARY_VERSION = 1;
export const DEFAULT_CONFLICT_HISTORY_LIMIT = 25;

// This is the provider-neutral logical document. A Drive adapter may upload it
// as one JSON file or split it into several physical files later.
const COLLECTIONS = {
  characters: {
    key: 'id',
    volatileFields: new Set(['updatedAt']),
    records: (document) => document.characters,
    timestamp: (record) => record.updatedAt,
  },
  content: {
    key: 'path',
    volatileFields: new Set(['updatedAt', 'uploadedAt']),
    records: (document) => document.content.files,
    timestamp: (record) => record.updatedAt ?? record.uploadedAt,
  },
  contentSources: {
    key: 'id',
    volatileFields: new Set(['updatedAt']),
    records: (document) => document.content.sources,
    timestamp: (record) => record.updatedAt ?? record.importedAt,
  },
  homebrew: {
    key: 'id',
    volatileFields: new Set(['updatedAt']),
    records: (document) => document.homebrew,
    timestamp: (record) => record.updatedAt,
  },
};
const COLLECTION_NAMES = Object.keys(COLLECTIONS);

export class LibrarySnapshotError extends Error {
  constructor(errors) {
    super(`Invalid DM Forge library snapshot: ${errors.join('; ')}`);
    this.name = 'LibrarySnapshotError';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, path, ancestors) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} contains an unsupported ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path} contains a circular reference`);
  }

  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) =>
      canonicalValue(entry, `${path}[${index}]`, ancestors)
    );
  } else {
    if (!isPlainObject(value)) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }
    result = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalValue(value[key], `${path}.${key}`, ancestors),
        ])
    );
  }
  ancestors.delete(value);
  return result;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value, '$', new WeakSet()));
}

function cloneJson(value) {
  return JSON.parse(canonicalStringify(value));
}

function compareStrings(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

export async function stableHash(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required to hash a DM Forge library');
  }
  const source = new TextEncoder().encode(canonicalStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return `sha256:${toHex(digest)}`;
}

function hashableRecord(collection, record) {
  // localStore stamps these fields again when a remote record is applied. They
  // choose a conflict winner, but are not part of the content identity.
  const volatileFields = COLLECTIONS[collection].volatileFields;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !volatileFields.has(key))
  );
}

export function hashLibraryRecord(collection, record) {
  if (!COLLECTIONS[collection]) {
    throw new TypeError(`Unknown library collection "${collection}"`);
  }
  return stableHash(hashableRecord(collection, record));
}

function normalizedInputRecords(input) {
  return {
    characters: input.characters ?? [],
    content: Array.isArray(input.content)
      ? input.content
      : (input.content?.files ?? []),
    contentSources:
      input.contentSources ?? input.content?.sources ?? [],
    homebrew: input.homebrew ?? [],
  };
}

function normalizeRecord(collection, record) {
  const copy = cloneJson(record);
  if (
    collection === 'contentSources' &&
    typeof copy.importedAt === 'string'
  ) {
    const importedAt = Date.parse(copy.importedAt);
    if (Number.isFinite(importedAt) && importedAt >= 0) {
      copy.importedAt = importedAt;
    }
  }
  return copy;
}

function sortedRecords(collection, records) {
  const keyName = COLLECTIONS[collection].key;
  return records
    .map((record) => normalizeRecord(collection, record))
    .sort((left, right) => compareStrings(left[keyName], right[keyName]));
}

function emptyCollectionObject() {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, {}]));
}

function emptyTombstones() {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, []]));
}

function normalizeTombstones(tombstones, records) {
  const normalized = emptyTombstones();
  for (const collection of COLLECTION_NAMES) {
    const keyName = COLLECTIONS[collection].key;
    const liveKeys = new Set(
      records[collection].map((record) => record[keyName])
    );
    const newestByKey = new Map();
    for (const tombstone of tombstones?.[collection] ?? []) {
      const copy = cloneJson(tombstone);
      const key = copy[keyName];
      const previous = newestByKey.get(key);
      if (
        !previous ||
        Number(copy.deletedAt) >= Number(previous.deletedAt)
      ) {
        newestByKey.set(key, copy);
      }
    }
    normalized[collection] = [...newestByKey.values()]
      .filter((tombstone) => !liveKeys.has(tombstone[keyName]))
      .sort((left, right) =>
        compareStrings(left[keyName], right[keyName])
      );
  }
  return normalized;
}

async function buildIndexes(records) {
  const indexes = emptyCollectionObject();
  await Promise.all(
    COLLECTION_NAMES.map(async (collection) => {
      const keyName = COLLECTIONS[collection].key;
      const entries = await Promise.all(
        records[collection].map(async (record) => [
          record[keyName],
          await hashLibraryRecord(collection, record),
        ])
      );
      indexes[collection] = Object.fromEntries(entries);
    })
  );
  return indexes;
}

function sortConflictHistory(conflicts, limit) {
  const byId = new Map();
  for (const conflict of conflicts ?? []) {
    const copy = cloneJson(conflict);
    const previous = byId.get(copy.id);
    if (
      !previous ||
      Number(copy.detectedAt) >= Number(previous.detectedAt)
    ) {
      byId.set(copy.id, copy);
    }
  }
  return [...byId.values()]
    .sort(
      (left, right) =>
        Number(right.detectedAt) - Number(left.detectedAt) ||
        compareStrings(left.id, right.id)
    )
    .slice(0, limit);
}

function validTimestamp(value) {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
}

function validateRecord(collection, record, index, errors) {
  const keyName = COLLECTIONS[collection].key;
  const label = `${collection}[${index}]`;
  if (!isPlainObject(record)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof record[keyName] !== 'string' || !record[keyName]) {
    errors.push(`${label}.${keyName} must be a non-empty string`);
  }
  if (
    collection === 'characters' &&
    typeof record.xml !== 'string'
  ) {
    errors.push(`${label}.xml must be a string`);
  }
  if (
    collection === 'characters' &&
    record.summary !== null &&
    record.summary !== undefined &&
    !isPlainObject(record.summary)
  ) {
    errors.push(`${label}.summary must be an object or null`);
  }
  if (
    collection === 'content' &&
    typeof record.base64 !== 'string'
  ) {
    errors.push(`${label}.base64 must be a string`);
  }
  for (const field of ['updatedAt', 'uploadedAt', 'importedAt']) {
    if (record[field] !== undefined && !validTimestamp(record[field])) {
      errors.push(`${label}.${field} must be a non-negative timestamp`);
    }
  }
  if (
    collection === 'contentSources' &&
    record.duplicateAcknowledgedFingerprint !== undefined &&
    !HASH_PATTERN.test(record.duplicateAcknowledgedFingerprint)
  ) {
    errors.push(
      `${label}.duplicateAcknowledgedFingerprint must be a SHA-256 hash`
    );
  }
  try {
    canonicalStringify(record);
  } catch (error) {
    errors.push(`${label} is not JSON-safe: ${error.message}`);
  }
}

function validateRecords(document, errors) {
  const lists = {
    characters: document.characters,
    content: document.content?.files,
    contentSources: document.content?.sources,
    homebrew: document.homebrew,
  };
  for (const collection of COLLECTION_NAMES) {
    const records = lists[collection];
    if (!Array.isArray(records)) {
      errors.push(`${collection} must be an array`);
      continue;
    }
    const keyName = COLLECTIONS[collection].key;
    const keys = new Set();
    for (const [index, record] of records.entries()) {
      validateRecord(collection, record, index, errors);
      const key = record?.[keyName];
      if (typeof key === 'string') {
        if (keys.has(key)) {
          errors.push(
            `${collection} contains duplicate key "${key}"`
          );
        }
        keys.add(key);
      }
    }
  }

  if (Array.isArray(lists.content) && Array.isArray(lists.contentSources)) {
    const sourceIds = new Set(
      lists.contentSources
        .map((source) => source?.id)
        .filter((id) => typeof id === 'string')
    );
    for (const record of lists.content) {
      if (
        record?.sourceId !== undefined &&
        (!record.sourceId || !sourceIds.has(record.sourceId))
      ) {
        errors.push(
          `content["${record?.path ?? ''}"] refers to missing source "${record.sourceId}"`
        );
      }
    }
  }
  return lists;
}

function validateIndexes(document, lists, errors) {
  if (!isPlainObject(document.index)) {
    errors.push('index must be an object');
    return;
  }
  for (const collection of COLLECTION_NAMES) {
    const index = document.index[collection];
    if (!isPlainObject(index)) {
      errors.push(`index.${collection} must be an object`);
      continue;
    }
    const keyName = COLLECTIONS[collection].key;
    const recordKeys = new Set(
      (Array.isArray(lists[collection]) ? lists[collection] : [])
        .map((record) => record?.[keyName])
        .filter((key) => typeof key === 'string')
    );
    for (const key of Object.keys(index)) {
      if (!HASH_PATTERN.test(index[key])) {
        errors.push(`index.${collection}["${key}"] must be a SHA-256 hash`);
      }
      if (!recordKeys.has(key)) {
        errors.push(
          `index.${collection} contains unknown key "${key}"`
        );
      }
    }
    for (const key of recordKeys) {
      if (!Object.hasOwn(index, key)) {
        errors.push(`index.${collection} is missing key "${key}"`);
      }
    }
  }
}

function validateTombstones(document, lists, errors) {
  if (!isPlainObject(document.tombstones)) {
    errors.push('tombstones must be an object');
    return;
  }
  for (const collection of COLLECTION_NAMES) {
    const tombstones = document.tombstones[collection];
    if (!Array.isArray(tombstones)) {
      errors.push(`tombstones.${collection} must be an array`);
      continue;
    }
    const keyName = COLLECTIONS[collection].key;
    const liveKeys = new Set(
      (Array.isArray(lists[collection]) ? lists[collection] : [])
        .map((record) => record?.[keyName])
        .filter((key) => typeof key === 'string')
    );
    const deletedKeys = new Set();
    for (const [index, tombstone] of tombstones.entries()) {
      const label = `tombstones.${collection}[${index}]`;
      if (!isPlainObject(tombstone)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      const key = tombstone[keyName];
      if (typeof key !== 'string' || !key) {
        errors.push(`${label}.${keyName} must be a non-empty string`);
      } else {
        if (deletedKeys.has(key)) {
          errors.push(
            `tombstones.${collection} contains duplicate key "${key}"`
          );
        }
        if (liveKeys.has(key)) {
          errors.push(
            `${collection} key "${key}" cannot be both live and deleted`
          );
        }
        deletedKeys.add(key);
      }
      if (!validTimestamp(tombstone.deletedAt)) {
        errors.push(`${label}.deletedAt must be a non-negative timestamp`);
      }
    }
  }
}

function validateConflictAlternative(alternative, label, errors) {
  if (!isPlainObject(alternative)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!['local', 'remote'].includes(alternative.side)) {
    errors.push(`${label}.side must be local or remote`);
  }
  if (!['record', 'deleted'].includes(alternative.kind)) {
    errors.push(`${label}.kind must be record or deleted`);
  }
  if (!validTimestamp(alternative.updatedAt)) {
    errors.push(`${label}.updatedAt must be a non-negative timestamp`);
  }
  if (
    alternative.kind === 'record' &&
    (!HASH_PATTERN.test(alternative.hash) ||
      !isPlainObject(alternative.record))
  ) {
    errors.push(`${label} must preserve a hashed record`);
  }
  if (
    alternative.kind === 'deleted' &&
    !isPlainObject(alternative.tombstone)
  ) {
    errors.push(`${label} must preserve a tombstone`);
  }
}

function validateConflicts(document, errors) {
  if (!Array.isArray(document.conflicts)) {
    errors.push('conflicts must be an array');
    return;
  }
  if (document.conflicts.length > DEFAULT_CONFLICT_HISTORY_LIMIT) {
    errors.push(
      `conflicts cannot exceed ${DEFAULT_CONFLICT_HISTORY_LIMIT} entries`
    );
  }
  for (const [index, conflict] of document.conflicts.entries()) {
    const label = `conflicts[${index}]`;
    if (!isPlainObject(conflict)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (typeof conflict.id !== 'string' || !conflict.id) {
      errors.push(`${label}.id must be a non-empty string`);
    }
    if (!COLLECTIONS[conflict.collection]) {
      errors.push(`${label}.collection is not supported`);
    }
    if (typeof conflict.key !== 'string' || !conflict.key) {
      errors.push(`${label}.key must be a non-empty string`);
    }
    if (!validTimestamp(conflict.detectedAt)) {
      errors.push(`${label}.detectedAt must be a non-negative timestamp`);
    }
    if (!isPlainObject(conflict.winner)) {
      errors.push(`${label}.winner must be an object`);
    }
    if (
      !Array.isArray(conflict.alternatives) ||
      conflict.alternatives.length !== 2
    ) {
      errors.push(`${label}.alternatives must contain both versions`);
    } else {
      conflict.alternatives.forEach((alternative, alternativeIndex) =>
        validateConflictAlternative(
          alternative,
          `${label}.alternatives[${alternativeIndex}]`,
          errors
        )
      );
    }
  }
}

function schemaErrors(document) {
  const errors = [];
  if (!isPlainObject(document)) {
    return ['document must be an object'];
  }
  if (document.format !== LIBRARY_FORMAT) {
    errors.push(`format must be "${LIBRARY_FORMAT}"`);
  }
  if (document.version !== LIBRARY_VERSION) {
    errors.push(`version must be ${LIBRARY_VERSION}`);
  }
  if (!validTimestamp(document.generatedAt)) {
    errors.push('generatedAt must be a non-negative timestamp');
  }
  if (!isPlainObject(document.content)) {
    errors.push('content must be an object');
  }
  const lists = validateRecords(document, errors);
  validateIndexes(document, lists, errors);
  validateTombstones(document, lists, errors);
  validateConflicts(document, errors);
  try {
    canonicalStringify(document);
  } catch (error) {
    errors.push(`document is not JSON-safe: ${error.message}`);
  }
  return errors;
}

async function hashIntegrityErrors(document) {
  const errors = [];
  if (!isPlainObject(document.index)) return errors;
  for (const collection of COLLECTION_NAMES) {
    const records = COLLECTIONS[collection].records(document);
    if (!Array.isArray(records) || !isPlainObject(document.index[collection])) {
      continue;
    }
    await Promise.all(
      records.map(async (record) => {
        const key = record?.[COLLECTIONS[collection].key];
        if (typeof key !== 'string') return;
        const actual = await hashLibraryRecord(collection, record);
        if (document.index[collection][key] !== actual) {
          errors.push(
            `index.${collection}["${key}"] does not match its record`
          );
        }
      })
    );
  }
  return errors.sort();
}

export async function validateLibrarySnapshot(
  document,
  { verifyHashes = true } = {}
) {
  const errors = schemaErrors(document);
  if (verifyHashes && errors.length === 0) {
    errors.push(...(await hashIntegrityErrors(document)));
  }
  return { valid: errors.length === 0, errors };
}

export async function assertLibrarySnapshot(document) {
  const validation = await validateLibrarySnapshot(document);
  if (!validation.valid) throw new LibrarySnapshotError(validation.errors);
  return document;
}

export async function createLibrarySnapshot(
  input = {},
  {
    generatedAt = Date.now(),
    tombstones = input.tombstones,
    conflicts = input.conflicts,
    conflictLimit = DEFAULT_CONFLICT_HISTORY_LIMIT,
  } = {}
) {
  if (
    !Number.isInteger(conflictLimit) ||
    conflictLimit < 0 ||
    conflictLimit > DEFAULT_CONFLICT_HISTORY_LIMIT
  ) {
    throw new TypeError(
      `conflictLimit must be between 0 and ${DEFAULT_CONFLICT_HISTORY_LIMIT}`
    );
  }
  const sourceRecords = normalizedInputRecords(input);
  const records = Object.fromEntries(
    COLLECTION_NAMES.map((collection) => [
      collection,
      sortedRecords(collection, sourceRecords[collection]),
    ])
  );
  const snapshot = {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    generatedAt,
    characters: records.characters,
    content: {
      files: records.content,
      sources: records.contentSources,
    },
    homebrew: records.homebrew,
    index: await buildIndexes(records),
    tombstones: normalizeTombstones(tombstones, records),
    conflicts: sortConflictHistory(conflicts, conflictLimit),
  };
  const validation = await validateLibrarySnapshot(snapshot, {
    verifyHashes: false,
  });
  if (!validation.valid) throw new LibrarySnapshotError(validation.errors);
  return snapshot;
}

export async function parseLibrarySnapshot(value) {
  let document = value;
  if (typeof value === 'string') {
    try {
      document = JSON.parse(value);
    } catch {
      throw new LibrarySnapshotError(['document is not valid JSON']);
    }
  }
  await assertLibrarySnapshot(document);
  return cloneJson(document);
}

export async function createLibraryManifest(snapshot) {
  await assertLibrarySnapshot(snapshot);
  return cloneJson({
    format: snapshot.format,
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    index: snapshot.index,
    tombstones: snapshot.tombstones,
  });
}

function manifestErrors(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return ['baseline must be an object'];
  if (manifest.format !== LIBRARY_FORMAT) {
    errors.push(`baseline format must be "${LIBRARY_FORMAT}"`);
  }
  if (manifest.version !== LIBRARY_VERSION) {
    errors.push(`baseline version must be ${LIBRARY_VERSION}`);
  }
  if (!validTimestamp(manifest.generatedAt)) {
    errors.push('baseline generatedAt must be a non-negative timestamp');
  }
  if (!isPlainObject(manifest.index)) {
    errors.push('baseline index must be an object');
  }
  if (!isPlainObject(manifest.tombstones)) {
    errors.push('baseline tombstones must be an object');
  }
  for (const collection of COLLECTION_NAMES) {
    const index = manifest.index?.[collection];
    if (!isPlainObject(index)) {
      errors.push(`baseline index.${collection} must be an object`);
    } else {
      for (const [key, hash] of Object.entries(index)) {
        if (!key || !HASH_PATTERN.test(hash)) {
          errors.push(
            `baseline index.${collection}["${key}"] must be a SHA-256 hash`
          );
        }
      }
    }
    const tombstones = manifest.tombstones?.[collection];
    const keyName = COLLECTIONS[collection].key;
    if (!Array.isArray(tombstones)) {
      errors.push(`baseline tombstones.${collection} must be an array`);
    } else {
      for (const [indexPosition, tombstone] of tombstones.entries()) {
        if (
          !isPlainObject(tombstone) ||
          typeof tombstone[keyName] !== 'string' ||
          !tombstone[keyName] ||
          !validTimestamp(tombstone.deletedAt)
        ) {
          errors.push(
            `baseline tombstones.${collection}[${indexPosition}] is invalid`
          );
        }
      }
    }
  }
  return errors;
}

export function validateLibraryManifest(manifest) {
  const candidate =
    manifest?.characters && manifest?.content && manifest?.homebrew
      ? {
          format: manifest.format,
          version: manifest.version,
          generatedAt: manifest.generatedAt,
          index: manifest.index,
          tombstones: manifest.tombstones,
        }
      : manifest;
  const errors = manifestErrors(candidate);
  return { valid: errors.length === 0, errors };
}

function emptyManifest() {
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    generatedAt: 0,
    index: emptyCollectionObject(),
    tombstones: emptyTombstones(),
  };
}

function normalizeManifest(baseline) {
  if (!baseline) return emptyManifest();
  const candidate =
    baseline.characters && baseline.content && baseline.homebrew
      ? {
          format: baseline.format,
          version: baseline.version,
          generatedAt: baseline.generatedAt,
          index: baseline.index,
          tombstones: baseline.tombstones,
        }
      : baseline;
  const validation = validateLibraryManifest(candidate);
  if (!validation.valid) throw new LibrarySnapshotError(validation.errors);
  return cloneJson(candidate);
}

function explicitStates(document, collection) {
  const descriptor = COLLECTIONS[collection];
  const states = new Map();
  for (const record of descriptor.records(document)) {
    states.set(record[descriptor.key], {
      kind: 'record',
      record,
      hash: document.index[collection][record[descriptor.key]],
      updatedAt: validTimestamp(descriptor.timestamp(record))
        ? descriptor.timestamp(record)
        : document.generatedAt,
    });
  }
  for (const tombstone of document.tombstones[collection]) {
    states.set(tombstone[descriptor.key], {
      kind: 'deleted',
      tombstone,
      updatedAt: tombstone.deletedAt,
    });
  }
  return states;
}

function baselineStates(manifest, collection) {
  const descriptor = COLLECTIONS[collection];
  const states = new Map();
  for (const [key, hash] of Object.entries(manifest.index[collection])) {
    states.set(key, { kind: 'record', hash });
  }
  for (const tombstone of manifest.tombstones[collection]) {
    states.set(tombstone[descriptor.key], {
      kind: 'deleted',
      tombstone,
      updatedAt: tombstone.deletedAt,
    });
  }
  return states;
}

function effectiveState(states, key, baseline, document, collection) {
  const explicit = states.get(key);
  if (explicit) return explicit;
  if (!baseline) return { kind: 'absent', updatedAt: 0 };
  if (baseline.kind === 'deleted') {
    return {
      kind: 'deleted',
      tombstone: baseline.tombstone,
      updatedAt: baseline.updatedAt,
    };
  }
  const keyName = COLLECTIONS[collection].key;
  return {
    kind: 'deleted',
    tombstone: {
      [keyName]: key,
      deletedAt: document.generatedAt,
    },
    updatedAt: document.generatedAt,
  };
}

function semanticallyEqual(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'record') return left.hash === right.hash;
  return true;
}

function stateTieBreaker(state) {
  if (state.kind === 'record') {
    return `record:${state.hash}:${canonicalStringify(state.record)}`;
  }
  if (state.kind === 'deleted') {
    return `deleted:${canonicalStringify(state.tombstone)}`;
  }
  return 'absent';
}

function newestState(left, right) {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  return compareStrings(stateTieBreaker(left), stateTieBreaker(right)) >= 0
    ? left
    : right;
}

function alternative(side, state) {
  if (state.kind === 'record') {
    return {
      side,
      kind: 'record',
      hash: state.hash,
      updatedAt: state.updatedAt,
      record: cloneJson(state.record),
    };
  }
  return {
    side,
    kind: 'deleted',
    updatedAt: state.updatedAt,
    tombstone: cloneJson(state.tombstone),
  };
}

function winnerSummary(state) {
  if (state.kind === 'record') {
    return {
      kind: 'record',
      hash: state.hash,
      updatedAt: state.updatedAt,
    };
  }
  return {
    kind: 'deleted',
    updatedAt: state.updatedAt,
  };
}

async function createConflict(
  collection,
  key,
  local,
  remote,
  winner,
  detectedAt
) {
  const fingerprints = [local, remote]
    .map((state) => stateTieBreaker(state))
    .sort();
  const id = await stableHash({ collection, key, alternatives: fingerprints });
  return {
    id: `conflict:${id.slice('sha256:'.length)}`,
    collection,
    key,
    detectedAt,
    winner: winnerSummary(winner),
    alternatives: [
      alternative('local', local),
      alternative('remote', remote),
    ],
  };
}

function allCollectionKeys(collection, baseline, local, remote) {
  return [
    ...new Set([
      ...baseline.keys(),
      ...local.keys(),
      ...remote.keys(),
    ]),
  ].sort();
}

export async function mergeLibrarySnapshots({
  local,
  remote,
  baseline = null,
  now = Date.now(),
  conflictLimit = DEFAULT_CONFLICT_HISTORY_LIMIT,
}) {
  await Promise.all([
    assertLibrarySnapshot(local),
    assertLibrarySnapshot(remote),
  ]);
  if (!validTimestamp(now)) {
    throw new TypeError('now must be a non-negative timestamp');
  }
  if (
    !Number.isInteger(conflictLimit) ||
    conflictLimit < 0 ||
    conflictLimit > DEFAULT_CONFLICT_HISTORY_LIMIT
  ) {
    throw new TypeError(
      `conflictLimit must be between 0 and ${DEFAULT_CONFLICT_HISTORY_LIMIT}`
    );
  }
  const manifest = normalizeManifest(baseline);
  const mergedRecords = Object.fromEntries(
    COLLECTION_NAMES.map((collection) => [collection, []])
  );
  const mergedTombstones = emptyTombstones();
  const newConflicts = [];

  for (const collection of COLLECTION_NAMES) {
    const descriptor = COLLECTIONS[collection];
    const baselineByKey = baselineStates(manifest, collection);
    const localByKey = explicitStates(local, collection);
    const remoteByKey = explicitStates(remote, collection);
    const keys = allCollectionKeys(
      collection,
      baselineByKey,
      localByKey,
      remoteByKey
    );

    for (const key of keys) {
      const baselineState =
        baselineByKey.get(key) ?? { kind: 'absent', updatedAt: 0 };
      const localState = effectiveState(
        localByKey,
        key,
        baselineByKey.get(key),
        local,
        collection
      );
      const remoteState = effectiveState(
        remoteByKey,
        key,
        baselineByKey.get(key),
        remote,
        collection
      );
      const localChanged = !semanticallyEqual(
        localState,
        baselineState
      );
      const remoteChanged = !semanticallyEqual(
        remoteState,
        baselineState
      );

      let selected;
      if (semanticallyEqual(localState, remoteState)) {
        selected = newestState(localState, remoteState);
      } else if (localChanged && !remoteChanged) {
        selected = localState;
      } else if (!localChanged && remoteChanged) {
        selected = remoteState;
      } else if (!localChanged && !remoteChanged) {
        selected = newestState(localState, remoteState);
      } else {
        selected = newestState(localState, remoteState);
        newConflicts.push(
          await createConflict(
            collection,
            key,
            localState,
            remoteState,
            selected,
            now
          )
        );
      }

      if (selected.kind === 'record') {
        mergedRecords[collection].push(selected.record);
      } else if (selected.kind === 'deleted') {
        mergedTombstones[collection].push({
          ...selected.tombstone,
          [descriptor.key]: key,
          deletedAt: selected.updatedAt,
        });
      }
    }
  }

  return createLibrarySnapshot(
    {
      characters: mergedRecords.characters,
      content: mergedRecords.content,
      contentSources: mergedRecords.contentSources,
      homebrew: mergedRecords.homebrew,
    },
    {
      generatedAt: now,
      tombstones: mergedTombstones,
      conflicts: [
        ...(local.conflicts ?? []),
        ...(remote.conflicts ?? []),
        ...newConflicts,
      ],
      conflictLimit,
    }
  );
}
