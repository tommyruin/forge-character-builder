import { STORAGE_DATABASE } from '../storageNames.js';
// Browser-local persistence for the fully-frontend (no-backend) mode.
//
// Characters and uploaded custom content live in IndexedDB ON THE DEVICE (not per-account),
// surviving reloads/reboots until the user clears browser data. There is no server: the engine
// runs in a Web Worker and computes everything, this module is the durable store, and sharing is
// file-based (export/import). Object stores:
//   characters  { id, xml, summary, updatedAt }   — the client-computed .dnd5e XML + list summary
//   content     { path, base64, uploadedAt }       — raw uploaded .xml/.index, re-staged at boot
//
// IndexedDB (not localStorage) because content + characters far exceed localStorage's ~5 MB
// and must not block the main thread. Best-effort durability: call requestPersistence() to ask
// the browser not to evict under storage pressure.
//
// v2 adds:
//   homebrew    { id, ...draft, updatedAt }        — homebrew editor collection drafts (the
//                 structured form model; the generated XML lives in `content` like any upload)
//   meta        { key, value, updatedAt }          — small key/value records (e.g. a character's
//                 pending migration snapshot, kept until the user resolves the re-picks)
//
// v3 adds:
//   fastStartSnapshots { key, manifest, body, createdAt, invalidAt?, invalidReason? }
//               — optimized parsed-library snapshots stored as binary Blobs on this device
//
// v4 adds:
//   rawContentPacks { key, manifest, body, createdAt }
//               — deterministic local ZIP cache of the authoritative content rows
//
// v5 adds:
//   characterLoadSnapshots { characterId, key, manifest, body, createdAt,
//                            invalidAt?, invalidReason? }
//               — one compressed, replaceable restore plan per local character

// The database name is a persisted identifier: every character, content pack
// and snapshot already on a user's device lives under it. Renaming it opens a
// different, empty database and orphans their data.
const DB_NAME = STORAGE_DATABASE;
const DB_VERSION = 5;
const CHARACTERS = 'characters';
const CONTENT = 'content';
const HOMEBREW = 'homebrew';
const META = 'meta';
const FAST_START_SNAPSHOTS = 'fastStartSnapshots';
const RAW_CONTENT_PACKS = 'rawContentPacks';
const CHARACTER_LOAD_SNAPSHOTS = 'characterLoadSnapshots';
const CURRENT_RAW_CONTENT_PACK = 'current';
const CONTENT_SOURCES_KEY = 'content-import-sources';
const CONTENT_REVISION_KEY = 'content-revision';
const FAST_START_RETENTION = 2;
const REQUIRED_STORES = [CHARACTERS, CONTENT, HOMEBREW, META];

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    const opening = new Promise((resolve, reject) => {
      const connect = (version) => {
        const req =
          version === undefined
            ? indexedDB.open(DB_NAME)
            : indexedDB.open(DB_NAME, version);
        let settled = false;
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CHARACTERS))
            db.createObjectStore(CHARACTERS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(CONTENT))
            db.createObjectStore(CONTENT, { keyPath: 'path' });
          if (!db.objectStoreNames.contains(HOMEBREW))
            db.createObjectStore(HOMEBREW, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(META))
            db.createObjectStore(META, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(FAST_START_SNAPSHOTS))
            db.createObjectStore(FAST_START_SNAPSHOTS, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(RAW_CONTENT_PACKS))
            db.createObjectStore(RAW_CONTENT_PACKS, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(CHARACTER_LOAD_SNAPSHOTS))
            db.createObjectStore(CHARACTER_LOAD_SNAPSHOTS, {
              keyPath: 'characterId',
            });
        };
        req.onsuccess = () => {
          const db = req.result;
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          const missing = REQUIRED_STORES.filter(
            (store) => !db.objectStoreNames.contains(store),
          );
          if (missing.length) {
            db.close();
            reject(
              new Error(
                `The saved Character Builder database is missing: ${missing.join(', ')}.`,
              ),
            );
            return;
          }
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          if (settled) return;
          if (version !== undefined && req.error?.name === 'VersionError') {
            settled = true;
            connect();
            return;
          }
          settled = true;
          if (dbPromise === opening) dbPromise = null;
          reject(req.error);
        };
        req.onblocked = () => {
          if (settled) return;
          settled = true;
          if (dbPromise === opening) dbPromise = null;
          reject(
            new Error(
              'DM Forge storage needs an upgrade. Close other DM Forge tabs and retry.',
            ),
          );
        };
      };
      connect(DB_VERSION);
    });
    dbPromise = opening.catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function readAll(store) {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll());
}
async function readOne(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key));
}
async function write(store, mutate) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  try {
    mutate(tx.objectStore(store));
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* the transaction is already inactive */
    }
    throw error;
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function writeMany(stores, mutate) {
  const db = await openDb();
  const tx = db.transaction(stores, 'readwrite');
  try {
    mutate(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* the transaction is already inactive */
    }
    throw error;
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function listContentSources() {
  return (await readOne(META, CONTENT_SOURCES_KEY))?.value ?? [];
}

function contentRevisionOf(record) {
  const revision = Number(record?.value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function invalidateRawPackForContentMutation(tx) {
  tx.objectStore(RAW_CONTENT_PACKS).delete(CURRENT_RAW_CONTENT_PACK);
  const metaStore = tx.objectStore(META);
  const request = metaStore.get(CONTENT_REVISION_KEY);
  request.onsuccess = () => {
    const currentRevision = contentRevisionOf(request.result);
    metaStore.put({
      key: CONTENT_REVISION_KEY,
      value:
        currentRevision < Number.MAX_SAFE_INTEGER ? currentRevision + 1 : 1,
      updatedAt: Date.now(),
    });
  };
}

async function mutateContentState(mutate) {
  const db = await openDb();
  const tx = db.transaction(
    [CONTENT, META, RAW_CONTENT_PACKS],
    'readwrite',
  );
  const contentStore = tx.objectStore(CONTENT);
  const metaStore = tx.objectStore(META);
  const contentRequest = contentStore.getAll();
  const sourcesRequest = metaStore.get(CONTENT_SOURCES_KEY);
  let contentReady = false;
  let sourcesReady = false;
  let mutationApplied = false;
  let mutationResult;
  let callbackError = null;

  const abortWith = (error) => {
    callbackError = error;
    try {
      tx.abort();
    } catch {
      /* the transaction is already inactive */
    }
  };
  const applyWhenReady = () => {
    if (mutationApplied || !contentReady || !sourcesReady) return;
    mutationApplied = true;
    try {
      const sourceRecord = sourcesRequest.result;
      mutationResult = mutate({
        content: contentRequest.result ?? [],
        sources: Array.isArray(sourceRecord?.value)
          ? sourceRecord.value
          : [],
        contentStore,
        metaStore,
      });
      invalidateRawPackForContentMutation(tx);
    } catch (error) {
      abortWith(error);
    }
  };
  contentRequest.onsuccess = () => {
    contentReady = true;
    applyWhenReady();
  };
  sourcesRequest.onsuccess = () => {
    sourcesReady = true;
    applyWhenReady();
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(mutationResult);
    tx.onerror = () => reject(callbackError ?? tx.error);
    tx.onabort = () => reject(callbackError ?? tx.error);
  });
}

async function listContentWithRevision() {
  const db = await openDb();
  const tx = db.transaction([CONTENT, META], 'readonly');
  const [records, revisionRecord] = await Promise.all([
    wrap(tx.objectStore(CONTENT).getAll()),
    wrap(tx.objectStore(META).get(CONTENT_REVISION_KEY)),
  ]);
  return {
    records,
    revision: contentRevisionOf(revisionRecord),
  };
}

async function getRawContentPackWithRevision() {
  const db = await openDb();
  const tx = db.transaction([RAW_CONTENT_PACKS, META], 'readonly');
  const [record, revisionRecord] = await Promise.all([
    wrap(tx.objectStore(RAW_CONTENT_PACKS).get(CURRENT_RAW_CONTENT_PACK)),
    wrap(tx.objectStore(META).get(CONTENT_REVISION_KEY)),
  ]);
  return {
    record,
    revision: contentRevisionOf(revisionRecord),
  };
}

async function replaceContentSource(source, records) {
  return mutateContentState(({ content, sources, contentStore, metaStore }) => {
    const previous = content.filter(
      (record) => record.sourceId === source.id,
    );
    const nextSources = [
      ...sources.filter((candidate) => candidate.id !== source.id),
      source,
    ].sort((left, right) => left.label.localeCompare(right.label));
    for (const record of previous) contentStore.delete(record.path);
    for (const record of records) {
      contentStore.put({
        ...record,
        sourceId: source.id,
        uploadedAt: Date.now(),
      });
    }
    metaStore.put({
      key: CONTENT_SOURCES_KEY,
      value: nextSources,
      updatedAt: Date.now(),
    });
    return previous;
  });
}

async function removeContentSource(sourceId) {
  return mutateContentState(({ content, sources, contentStore, metaStore }) => {
    const removed = content.filter(
      (record) => record.sourceId === sourceId,
    );
    for (const record of removed) contentStore.delete(record.path);
    metaStore.put({
      key: CONTENT_SOURCES_KEY,
      value: sources.filter((source) => source.id !== sourceId),
      updatedAt: Date.now(),
    });
    return removed;
  });
}

async function removeContentSources(sourceIds) {
  const ids = new Set(sourceIds);
  return mutateContentState(({ content, sources, contentStore, metaStore }) => {
    const removed = content.filter((record) => ids.has(record.sourceId));
    for (const record of removed) contentStore.delete(record.path);
    metaStore.put({
      key: CONTENT_SOURCES_KEY,
      value: sources.filter((source) => !ids.has(source.id)),
      updatedAt: Date.now(),
    });
    return removed;
  });
}

async function acknowledgeContentDuplicates(sourceIds, fingerprint) {
  const ids = new Set(sourceIds);
  const sources = await listContentSources();
  await write(META, (store) =>
    store.put({
      key: CONTENT_SOURCES_KEY,
      value: sources.map((source) =>
        ids.has(source.id)
          ? { ...source, duplicateAcknowledgedFingerprint: fingerprint }
          : source,
      ),
      updatedAt: Date.now(),
    }),
  );
}

async function deleteContentBatch(paths) {
  const uniquePaths = [
    ...new Set(
      (Array.isArray(paths) ? paths : [paths]).filter(
        (path) => typeof path === 'string' && path.length > 0,
      ),
    ),
  ];
  if (!uniquePaths.length) return [];

  return mutateContentState(({ content, sources, contentStore, metaStore }) => {
    const removedPaths = new Set(uniquePaths);
    const removed = content.filter((record) =>
      removedPaths.has(record.path),
    );
    const remainingCounts = new Map();
    for (const record of content) {
      if (removedPaths.has(record.path) || !record.sourceId) continue;
      remainingCounts.set(
        record.sourceId,
        (remainingCounts.get(record.sourceId) ?? 0) + 1,
      );
    }
    for (const path of uniquePaths) contentStore.delete(path);
    metaStore.put({
      key: CONTENT_SOURCES_KEY,
      value: sources
        .map((source) => ({
          ...source,
          fileCount: remainingCounts.get(source.id) ?? 0,
        }))
        .filter((source) => source.fileCount > 0),
      updatedAt: Date.now(),
    });
    return removed;
  });
}

async function deleteContent(path) {
  await deleteContentBatch([path]);
}

function validateContentRecords(records) {
  if (!Array.isArray(records)) throw new Error('Invalid content records.');
  return records.map((record) => {
    if (
      typeof record?.path !== 'string' ||
      !record.path.trim() ||
      typeof record.base64 !== 'string'
    ) {
      throw new Error('Invalid content record.');
    }
    return {
      path: record.path,
      base64: record.base64,
      ...(typeof record.relativePath === 'string'
        ? { relativePath: record.relativePath }
        : {}),
      ...(typeof record.sourceId === 'string' ? { sourceId: record.sourceId } : {}),
    };
  });
}

function validateFastStartSnapshot(record) {
  if (
    typeof record?.key !== 'string' ||
    !record.key.trim() ||
    !record.manifest ||
    typeof record.manifest !== 'object' ||
    !(record.body instanceof Blob)
  ) {
    throw new Error('Invalid Fast Start snapshot record.');
  }

  const validRecord = { ...record };
  delete validRecord.invalidAt;
  delete validRecord.invalidReason;
  return validRecord;
}

function validateRawContentPack(record) {
  if (
    record?.key !== CURRENT_RAW_CONTENT_PACK ||
    !record.manifest ||
    typeof record.manifest !== 'object' ||
    !(record.body instanceof Blob)
  ) {
    throw new Error('Invalid raw content pack record.');
  }
  return { ...record };
}

function validateCharacterLoadSnapshot(record) {
  if (
    typeof record?.characterId !== 'string' ||
    !record.characterId.trim() ||
    typeof record?.key !== 'string' ||
    !record.key.trim() ||
    !record.manifest ||
    typeof record.manifest !== 'object' ||
    !(record.body instanceof Blob)
  ) {
    throw new Error('Invalid character-load snapshot record.');
  }
  const validRecord = { ...record };
  delete validRecord.invalidAt;
  delete validRecord.invalidReason;
  return validRecord;
}

async function getFastStartSnapshot(key) {
  const record = await readOne(FAST_START_SNAPSHOTS, key);
  return record?.invalidAt ? undefined : record;
}

async function getFastStartSummary() {
  const records = (await readAll(FAST_START_SNAPSHOTS))
    .filter((record) => !record?.invalidAt)
    .sort(
      (left, right) =>
        (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0),
    );
  const latest = records[0];
  const rawPack = await readOne(RAW_CONTENT_PACKS, CURRENT_RAW_CONTENT_PACK);
  return {
    lastBuildAt: latest?.createdAt ?? null,
    snapshotSizeBytes:
      Number(latest?.manifest?.bodyBytes) || latest?.body?.size || 0,
    hasSnapshot: Boolean(latest),
    hasRawContentPack: Boolean(rawPack),
  };
}

async function clearFastStartData() {
  return writeMany(
    [
      FAST_START_SNAPSHOTS,
      RAW_CONTENT_PACKS,
      CHARACTER_LOAD_SNAPSHOTS,
    ],
    (tx) => {
    tx.objectStore(FAST_START_SNAPSHOTS).clear();
    tx.objectStore(RAW_CONTENT_PACKS).clear();
      tx.objectStore(CHARACTER_LOAD_SNAPSHOTS).clear();
    },
  );
}

async function pruneFastStartSnapshots() {
  const records = await readAll(FAST_START_SNAPSHOTS);
  const stale = records
    .sort(
      (left, right) =>
        (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0) ||
        String(right.key).localeCompare(String(left.key)),
    )
    .slice(FAST_START_RETENTION);
  if (!stale.length) return;
  await write(FAST_START_SNAPSHOTS, (store) => {
    for (const record of stale) store.delete(record.key);
  });
}

async function markFastStartSnapshotInvalid(key, reason) {
  const db = await openDb();
  const tx = db.transaction(FAST_START_SNAPSHOTS, 'readwrite');
  const store = tx.objectStore(FAST_START_SNAPSHOTS);
  let callbackError = null;
  const request = store.get(key);
  request.onsuccess = () => {
    if (!request.result) return;
    try {
      store.put({
        ...request.result,
        body: new Blob([], { type: 'application/octet-stream' }),
        bodyRemoved: true,
        invalidAt: Date.now(),
        invalidReason: String(reason || 'Snapshot validation failed.'),
      });
    } catch (error) {
      callbackError = error;
      try {
        tx.abort();
      } catch {
        /* the transaction is already inactive */
      }
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(callbackError ?? tx.error);
    tx.onabort = () => reject(callbackError ?? tx.error);
  });
}

export const localStore = {
  // --- Characters ---
  listCharacters: () => readAll(CHARACTERS),
  getCharacter: (id) => readOne(CHARACTERS, id),
  putCharacter: (record) =>
    write(CHARACTERS, (s) => s.put({ ...record, updatedAt: Date.now() })),
  deleteCharacter: (id) =>
    writeMany([CHARACTERS, CHARACTER_LOAD_SNAPSHOTS], (tx) => {
      tx.objectStore(CHARACTERS).delete(id);
      tx.objectStore(CHARACTER_LOAD_SNAPSHOTS).delete(id);
    }),

  // --- Uploaded custom content (raw .xml/.index bytes, base64) ---
  listContent: () => readAll(CONTENT),
  listContentWithRevision,
  getContent: (path) => readOne(CONTENT, path),
  putContent: (path, base64) =>
    writeMany([CONTENT, META, RAW_CONTENT_PACKS], (tx) => {
      tx.objectStore(CONTENT).put({
        path,
        base64,
        uploadedAt: Date.now(),
      });
      invalidateRawPackForContentMutation(tx);
    }),
  putContentBatch: (records) => {
    const validated = validateContentRecords(records);
    return writeMany([CONTENT, META, RAW_CONTENT_PACKS], (tx) => {
      const contentStore = tx.objectStore(CONTENT);
      const uploadedAt = Date.now();
      for (const record of validated) {
        contentStore.put({ ...record, uploadedAt });
      }
      invalidateRawPackForContentMutation(tx);
    });
  },
  deleteContent,
  deleteContentBatch,
  clearContent: () =>
    writeMany([CONTENT, META, RAW_CONTENT_PACKS], (tx) => {
      tx.objectStore(CONTENT).clear();
      invalidateRawPackForContentMutation(tx);
    }),
  listContentSources,
  getContentSourceFiles: async (sourceId) =>
    (await readAll(CONTENT)).filter((record) => record.sourceId === sourceId),
  replaceContentSource,
  removeContentSource,
  removeContentSources,
  acknowledgeContentDuplicates,

  // --- Homebrew editor drafts (structured form models; XML output lives in `content`) ---
  listHomebrew: () => readAll(HOMEBREW),
  getHomebrew: (id) => readOne(HOMEBREW, id),
  putHomebrew: (record) =>
    write(HOMEBREW, (s) => s.put({ ...record, updatedAt: Date.now() })),
  deleteHomebrew: (id) => write(HOMEBREW, (s) => s.delete(id)),

  // --- Small key/value records (pending migrations etc.) ---
  getMeta: async (key) => (await readOne(META, key))?.value,
  putMeta: (key, value) =>
    write(META, (s) => s.put({ key, value, updatedAt: Date.now() })),
  deleteMeta: (key) => write(META, (s) => s.delete(key)),

  // --- Local parsed-library snapshots for optional Fast Start booting ---
  getFastStartSnapshot,
  getFastStartSummary,
  clearFastStartData,
  putFastStartSnapshot: async (record) => {
    const validated = validateFastStartSnapshot(record);
    await write(FAST_START_SNAPSHOTS, (s) => s.put(validated));
    await pruneFastStartSnapshots();
  },
  putFastStartSnapshotIfCurrent: async (record, expectedContentRevision) => {
    const validated = validateFastStartSnapshot(record);
    if (
      !Number.isSafeInteger(expectedContentRevision) ||
      expectedContentRevision < 0
    ) {
      throw new Error('Invalid expected content revision.');
    }
    const db = await openDb();
    const tx = db.transaction([META, FAST_START_SNAPSHOTS], 'readwrite');
    const metaStore = tx.objectStore(META);
    const snapshotStore = tx.objectStore(FAST_START_SNAPSHOTS);
    let stored = false;
    let callbackError = null;
    const request = metaStore.get(CONTENT_REVISION_KEY);
    request.onsuccess = () => {
      try {
        if (contentRevisionOf(request.result) !== expectedContentRevision) {
          return;
        }
        snapshotStore.put(validated);
        stored = true;
      } catch (error) {
        callbackError = error;
        try {
          tx.abort();
        } catch {
          /* the transaction is already inactive */
        }
      }
    };

    const committed = await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(stored);
      tx.onerror = () => reject(callbackError ?? tx.error);
      tx.onabort = () => reject(callbackError ?? tx.error);
    });
    if (committed) await pruneFastStartSnapshots();
    return committed;
  },
  markFastStartSnapshotInvalid,

  // --- Browser-local character restore plans (never exported or synced) ---
  getCharacterLoadSnapshot: async (characterId) => {
    const record = await readOne(
      CHARACTER_LOAD_SNAPSHOTS,
      characterId,
    );
    return record?.invalidAt ? undefined : record;
  },
  putCharacterLoadSnapshotIfCurrent: async (
    record,
    expectedCharacterXml,
  ) => {
    const validated = validateCharacterLoadSnapshot(record);
    if (
      typeof expectedCharacterXml !== 'string' ||
      !expectedCharacterXml
    ) {
      throw new Error('Invalid expected character XML.');
    }
    const db = await openDb();
    const tx = db.transaction(
      [CHARACTERS, CHARACTER_LOAD_SNAPSHOTS],
      'readwrite',
    );
    const characters = tx.objectStore(CHARACTERS);
    const snapshots = tx.objectStore(CHARACTER_LOAD_SNAPSHOTS);
    let stored = false;
    let callbackError = null;
    const request = characters.get(validated.characterId);
    request.onsuccess = () => {
      try {
        if (request.result?.xml !== expectedCharacterXml) return;
        snapshots.put(validated);
        stored = true;
      } catch (error) {
        callbackError = error;
        try {
          tx.abort();
        } catch {
          /* the transaction is already inactive */
        }
      }
    };
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(stored);
      tx.onerror = () => reject(callbackError ?? tx.error);
      tx.onabort = () => reject(callbackError ?? tx.error);
    });
  },
  markCharacterLoadSnapshotInvalid: (characterId, reason) =>
    write(CHARACTER_LOAD_SNAPSHOTS, (store) => {
      const request = store.get(characterId);
      request.onsuccess = () => {
        if (!request.result) return;
        store.put({
          ...request.result,
          body: new Blob([], {
            type: 'application/octet-stream',
          }),
          bodyRemoved: true,
          invalidAt: Date.now(),
          invalidReason: String(
            reason || 'Character snapshot validation failed.',
          ),
        });
      };
    }),

  // --- Deterministic local raw-content pack cache ---
  getRawContentPack: () => readOne(RAW_CONTENT_PACKS, CURRENT_RAW_CONTENT_PACK),
  getRawContentPackWithRevision,
  putRawContentPackIfCurrent: async (record, expectedContentRevision) => {
    const validated = validateRawContentPack(record);
    if (
      !Number.isSafeInteger(expectedContentRevision) ||
      expectedContentRevision < 0
    ) {
      throw new Error('Invalid expected content revision.');
    }
    const db = await openDb();
    const tx = db.transaction([META, RAW_CONTENT_PACKS], 'readwrite');
    const metaStore = tx.objectStore(META);
    const rawPackStore = tx.objectStore(RAW_CONTENT_PACKS);
    let stored = false;
    let callbackError = null;
    const request = metaStore.get(CONTENT_REVISION_KEY);
    request.onsuccess = () => {
      try {
        if (contentRevisionOf(request.result) !== expectedContentRevision) {
          return;
        }
        rawPackStore.put(validated);
        stored = true;
      } catch (error) {
        callbackError = error;
        try {
          tx.abort();
        } catch {
          /* the transaction is already inactive */
        }
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(stored);
      tx.onerror = () => reject(callbackError ?? tx.error);
      tx.onabort = () => reject(callbackError ?? tx.error);
    });
  },
  markRawContentPackInvalid: () =>
    write(RAW_CONTENT_PACKS, (store) => store.delete(CURRENT_RAW_CONTENT_PACK)),

  // Ask the browser to keep this origin's storage through eviction pressure (best effort).
  requestPersistence: async () => {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  },
};
