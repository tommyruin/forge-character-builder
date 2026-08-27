import {
  assertLibrarySnapshot,
  createLibrarySnapshot,
  hashLibraryRecord,
  validateLibraryManifest,
} from './librarySnapshot.js';

// Deliberately exclude localStore meta and any map/token stores. Sync metadata
// belongs to the coordinator, while this adapter only mirrors library records.
const COLLECTIONS = {
  characters: {
    key: 'id',
    listMethod: 'listCharacters',
  },
  content: {
    key: 'path',
    listMethod: 'listContent',
  },
  contentSources: {
    key: 'id',
    listMethod: 'listContentSources',
  },
  homebrew: {
    key: 'id',
    listMethod: 'listHomebrew',
  },
};

function ensureMethod(store, method) {
  if (typeof store?.[method] !== 'function') {
    throw new TypeError(`libraryStore requires localStore.${method}()`);
  }
}

function recordsByKey(records, keyName) {
  return new Map(records.map((record) => [record[keyName], record]));
}

async function hashMap(collection, records) {
  return new Map(
    await Promise.all(
      records.map(async (record) => [
        record[COLLECTIONS[collection].key],
        await hashLibraryRecord(collection, record),
      ])
    )
  );
}

async function readLocalState(store) {
  const values = await Promise.all(
    Object.values(COLLECTIONS).map(({ listMethod }) =>
      store[listMethod]()
    )
  );
  return Object.fromEntries(
    Object.keys(COLLECTIONS).map((collection, index) => [
      collection,
      values[index],
    ])
  );
}

function baselineParts(baseline) {
  if (!baseline) return null;
  const validation = validateLibraryManifest(baseline);
  if (!validation.valid) {
    throw new TypeError(
      `Invalid library baseline: ${validation.errors.join('; ')}`
    );
  }
  return {
    index: baseline.index,
    tombstones: baseline.tombstones,
    conflicts: Array.isArray(baseline.conflicts)
      ? baseline.conflicts
      : [],
  };
}

function inferredTombstones(state, baseline, now) {
  const result = Object.fromEntries(
    Object.keys(COLLECTIONS).map((collection) => [collection, []])
  );
  if (!baseline) return result;

  for (const [collection, descriptor] of Object.entries(COLLECTIONS)) {
    const liveKeys = new Set(
      state[collection].map((record) => record[descriptor.key])
    );
    const tombstones = new Map(
      baseline.tombstones[collection].map((tombstone) => [
        tombstone[descriptor.key],
        tombstone,
      ])
    );
    for (const key of Object.keys(baseline.index[collection])) {
      if (!liveKeys.has(key) && !tombstones.has(key)) {
        tombstones.set(key, {
          [descriptor.key]: key,
          deletedAt: now,
        });
      }
    }
    result[collection] = [...tombstones.values()].filter(
      (tombstone) => !liveKeys.has(tombstone[descriptor.key])
    );
  }
  return result;
}

function emptyApplyResult() {
  return {
    characters: { put: 0, deleted: 0 },
    content: { put: 0, deleted: 0 },
    contentSources: { replaced: 0, deleted: 0 },
    homebrew: { put: 0, deleted: 0 },
  };
}

async function changedKeys(collection, current, desired) {
  const [currentHashes, desiredHashes] = await Promise.all([
    hashMap(collection, current),
    hashMap(collection, desired),
  ]);
  return new Set(
    desired
      .filter(
        (record) =>
          currentHashes.get(record[COLLECTIONS[collection].key]) !==
          desiredHashes.get(record[COLLECTIONS[collection].key])
      )
      .map((record) => record[COLLECTIONS[collection].key])
  );
}

function groupBySource(records) {
  const groups = new Map();
  for (const record of records) {
    if (!record.sourceId) continue;
    const group = groups.get(record.sourceId) ?? [];
    group.push(record);
    groups.set(record.sourceId, group);
  }
  return groups;
}

async function applyContent(store, current, snapshot, result) {
  const desiredFiles = snapshot.content.files;
  const desiredSources = snapshot.content.sources;
  const currentFilesByPath = recordsByKey(current.content, 'path');
  const currentSourcesById = recordsByKey(
    current.contentSources,
    'id'
  );
  const changedFilePaths = await changedKeys(
    'content',
    current.content,
    desiredFiles
  );
  const changedSourceIds = await changedKeys(
    'contentSources',
    current.contentSources,
    desiredSources
  );
  const currentGroups = groupBySource(current.content);
  const desiredGroups = groupBySource(desiredFiles);
  const removedPaths = new Set();

  for (const tombstone of snapshot.tombstones.contentSources) {
    if (!currentSourcesById.has(tombstone.id)) continue;
    ensureMethod(store, 'removeContentSource');
    await store.removeContentSource(tombstone.id);
    result.contentSources.deleted += 1;
    for (const record of currentGroups.get(tombstone.id) ?? []) {
      removedPaths.add(record.path);
    }
  }

  for (const source of desiredSources) {
    const desiredGroup = desiredGroups.get(source.id) ?? [];
    const currentGroup = currentGroups.get(source.id) ?? [];
    const currentPaths = new Set(
      currentGroup.map((record) => record.path)
    );
    const desiredPaths = new Set(
      desiredGroup.map((record) => record.path)
    );
    const groupChanged =
      currentPaths.size !== desiredPaths.size ||
      [...desiredPaths].some(
        (path) => !currentPaths.has(path) || changedFilePaths.has(path)
      );
    if (!changedSourceIds.has(source.id) && !groupChanged) continue;

    ensureMethod(store, 'replaceContentSource');
    await store.replaceContentSource(source, desiredGroup);
    result.contentSources.replaced += 1;
    result.content.put += desiredGroup.filter((record) =>
      changedFilePaths.has(record.path)
    ).length;
    for (const record of currentGroup) {
      if (!desiredPaths.has(record.path)) removedPaths.add(record.path);
    }
  }

  for (const tombstone of snapshot.tombstones.content) {
    if (!currentFilesByPath.has(tombstone.path)) continue;
    result.content.deleted += 1;
    if (removedPaths.has(tombstone.path)) continue;
    ensureMethod(store, 'deleteContent');
    await store.deleteContent(tombstone.path);
    removedPaths.add(tombstone.path);
  }

  for (const record of desiredFiles) {
    if (record.sourceId || !changedFilePaths.has(record.path)) continue;
    if (typeof store.putContentRecord === 'function') {
      await store.putContentRecord(record);
    } else {
      ensureMethod(store, 'putContent');
      await store.putContent(record.path, record.base64);
    }
    result.content.put += 1;
  }
}

async function applySimpleCollection(
  store,
  collection,
  currentRecords,
  desiredRecords,
  tombstones,
  result
) {
  const descriptor = COLLECTIONS[collection];
  const currentByKey = recordsByKey(currentRecords, descriptor.key);
  const changed = await changedKeys(
    collection,
    currentRecords,
    desiredRecords
  );
  const methodSuffix =
    collection === 'characters' ? 'Character' : 'Homebrew';
  const deleteMethod = `delete${methodSuffix}`;
  const putMethod = `put${methodSuffix}`;

  for (const tombstone of tombstones) {
    const key = tombstone[descriptor.key];
    if (!currentByKey.has(key)) continue;
    ensureMethod(store, deleteMethod);
    await store[deleteMethod](key);
    result[collection].deleted += 1;
  }
  for (const record of desiredRecords) {
    const key = record[descriptor.key];
    if (!changed.has(key)) continue;
    ensureMethod(store, putMethod);
    await store[putMethod](record);
    result[collection].put += 1;
  }
}

export function createLibraryStore(localStore, { clock = Date.now } = {}) {
  for (const { listMethod } of Object.values(COLLECTIONS)) {
    ensureMethod(localStore, listMethod);
  }
  if (typeof clock !== 'function') {
    throw new TypeError('libraryStore clock must be a function');
  }

  return {
    async readSnapshot({ baseline = null, tombstones, conflicts } = {}) {
      const state = await readLocalState(localStore);
      const baselineState = baselineParts(baseline);
      const generatedAt = Number(clock());
      const deleted =
        tombstones ??
        inferredTombstones(state, baselineState, generatedAt);
      return createLibrarySnapshot(
        {
          characters: state.characters,
          content: state.content,
          contentSources: state.contentSources,
          homebrew: state.homebrew,
        },
        {
          generatedAt,
          tombstones: deleted,
          conflicts: conflicts ?? baselineState?.conflicts ?? [],
        }
      );
    },

    async applySnapshot(snapshot) {
      await assertLibrarySnapshot(snapshot);
      const current = await readLocalState(localStore);
      const result = emptyApplyResult();

      // Additional content must be present before a character is opened and
      // reconciled by the engine.
      await applyContent(localStore, current, snapshot, result);
      await applySimpleCollection(
        localStore,
        'homebrew',
        current.homebrew,
        snapshot.homebrew,
        snapshot.tombstones.homebrew,
        result
      );
      await applySimpleCollection(
        localStore,
        'characters',
        current.characters,
        snapshot.characters,
        snapshot.tombstones.characters,
        result
      );

      return result;
    },
  };
}
