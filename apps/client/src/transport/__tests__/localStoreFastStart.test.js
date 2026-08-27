import { afterEach, describe, expect, it, vi } from 'vitest';

function createStore(keyPath, records = []) {
  return {
    keyPath,
    records: new Map(
      records.map((record) => [record[keyPath], structuredClone(record)]),
    ),
  };
}

function createFakeIndexedDb({
  version = 0,
  stores = {},
  blocked = false,
} = {}) {
  const state = {
    version,
    stores: new Map(
      Object.entries(stores).map(([name, definition]) => [
        name,
        createStore(definition.keyPath, definition.records),
      ]),
    ),
  };
  const connections = [];
  let openCount = 0;
  let writeTail = Promise.resolve();

  function createTransaction(storeNames, mode = 'readonly') {
    const allowedStores = new Set(
      Array.isArray(storeNames) ? storeNames : [storeNames],
    );
    const startsAfter = writeTail;
    let releaseWrite = null;
    if (mode === 'readwrite') {
      const writeComplete = new Promise((resolve) => {
        releaseWrite = resolve;
      });
      writeTail = startsAfter.then(() => writeComplete);
    }
    let pendingRequests = 0;
    let completionScheduled = false;
    let finished = false;

    const transaction = {
      error: null,
      onabort: null,
      oncomplete: null,
      onerror: null,
      objectStore(name) {
        if (!allowedStores.has(name)) {
          throw new Error(`Store ${name} is not part of this transaction`);
        }
        const store = state.stores.get(name);
        if (!store) throw new Error(`Store ${name} does not exist`);

        const request = (operation) => {
          if (finished) throw new Error('Transaction is inactive');
          pendingRequests += 1;
          const result = { error: null, result: undefined };
          startsAfter.then(() => {
            queueMicrotask(() => {
              if (finished) return;
              try {
                result.result = operation();
                result.onsuccess?.();
              } catch (error) {
                result.error = error;
                transaction.error = error;
                result.onerror?.();
                transaction.onerror?.();
              } finally {
                pendingRequests -= 1;
                scheduleCompletion();
              }
            });
          });
          return result;
        };

        return {
          clear: () =>
            request(() => {
              store.records.clear();
            }),
          delete: (key) =>
            request(() => {
              store.records.delete(key);
            }),
          get: (key) => request(() => structuredClone(store.records.get(key))),
          getAll: () =>
            request(() =>
              [...store.records.values()].map((record) =>
                structuredClone(record),
              ),
            ),
          put: (record) => {
            const cloned = structuredClone(record);
            const key = cloned[store.keyPath];
            if (key == null) {
              throw new Error(`Record is missing key path ${store.keyPath}`);
            }
            return request(() => {
              store.records.set(key, cloned);
              return key;
            });
          },
        };
      },
      abort() {
        if (finished) return;
        finished = true;
        transaction.error = new Error('Transaction aborted');
        releaseWrite?.();
        queueMicrotask(() => transaction.onabort?.());
      },
    };

    function scheduleCompletion() {
      if (
        finished ||
        completionScheduled ||
        pendingRequests !== 0 ||
        transaction.error
      ) {
        return;
      }
      completionScheduled = true;
      queueMicrotask(() => {
        if (finished || pendingRequests !== 0) {
          completionScheduled = false;
          scheduleCompletion();
          return;
        }
        finished = true;
        releaseWrite?.();
        transaction.oncomplete?.();
      });
    }

    return transaction;
  }

  function createConnection() {
    const connection = {
      closed: false,
      onversionchange: null,
      objectStoreNames: {
        contains: (name) => state.stores.has(name),
      },
      createObjectStore(name, { keyPath }) {
        if (state.stores.has(name)) {
          throw new Error(`Store ${name} already exists`);
        }
        const store = createStore(keyPath);
        state.stores.set(name, store);
        return store;
      },
      transaction(storeNames, mode) {
        if (connection.closed) throw new Error('Database is closed');
        return createTransaction(storeNames, mode);
      },
      close() {
        connection.closed = true;
      },
    };
    connections.push(connection);
    return connection;
  }

  return {
    open(_name, requestedVersion) {
      openCount += 1;
      const request = { error: null, result: null };
      queueMicrotask(() => {
        if (blocked) {
          request.onblocked?.({
            oldVersion: state.version,
            newVersion: requestedVersion,
          });
          return;
        }
        if (requestedVersion < state.version) {
          request.error = Object.assign(
            new Error('Requested database version is too old'),
            { name: 'VersionError' },
          );
          request.onerror?.();
          return;
        }

        const oldVersion = state.version;
        request.result = createConnection();
        if (requestedVersion > oldVersion) {
          request.onupgradeneeded?.({
            oldVersion,
            newVersion: requestedVersion,
          });
          state.version = requestedVersion;
        }
        request.onsuccess?.();
      });
      return request;
    },
    get openCount() {
      return openCount;
    },
    hasStore(name) {
      return state.stores.has(name);
    },
    readRecord(storeName, key) {
      return structuredClone(state.stores.get(storeName)?.records.get(key));
    },
    triggerVersionChange() {
      connections.at(-1)?.onversionchange?.({
        oldVersion: state.version,
        newVersion: state.version + 1,
      });
    },
    get lastConnection() {
      return connections.at(-1);
    },
    get version() {
      return state.version;
    },
  };
}

describe('local Fast Start snapshot persistence', () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDb;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('upgrades v2 without replacing existing browser-local data', async () => {
    const fakeIndexedDb = createFakeIndexedDb({
      version: 2,
      stores: {
        characters: {
          keyPath: 'id',
          records: [{ id: 'hero', xml: '<character />' }],
        },
        content: {
          keyPath: 'path',
          records: [{ path: 'user/rules.xml', base64: 'cnVsZXM=' }],
        },
        homebrew: {
          keyPath: 'id',
          records: [{ id: 'brew', name: 'New ancestry' }],
        },
        meta: {
          keyPath: 'key',
          records: [{ key: 'migration:hero', value: { pending: true } }],
        },
      },
    });
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');

    await expect(
      localStore.getFastStartSnapshot('not-created'),
    ).resolves.toBeUndefined();

    expect(fakeIndexedDb.version).toBe(5);
    expect(fakeIndexedDb.hasStore('fastStartSnapshots')).toBe(true);
    expect(fakeIndexedDb.hasStore('rawContentPacks')).toBe(true);
    expect(fakeIndexedDb.hasStore('characterLoadSnapshots')).toBe(true);
    await expect(localStore.getCharacter('hero')).resolves.toMatchObject({
      xml: '<character />',
    });
    await expect(
      localStore.getContent('user/rules.xml'),
    ).resolves.toMatchObject({ base64: 'cnVsZXM=' });
    await expect(localStore.getHomebrew('brew')).resolves.toMatchObject({
      name: 'New ancestry',
    });
    await expect(localStore.getMeta('migration:hero')).resolves.toEqual({
      pending: true,
    });
  });

  it('rejects a blocked multi-tab upgrade with a retryable message', async () => {
    globalThis.indexedDB = createFakeIndexedDb({
      version: 2,
      blocked: true,
    });
    const { localStore } = await import('../localStore.js');

    await expect(localStore.listCharacters()).rejects.toThrow(
      /close other DM Forge tabs and retry/i,
    );
  });

  it('opens a future-version database without replacing its existing records', async () => {
    const fakeIndexedDb = createFakeIndexedDb({
      version: 6,
      stores: {
        characters: {
          keyPath: 'id',
          records: [{ id: 'hero', xml: '<character />' }],
        },
        content: { keyPath: 'path', records: [] },
        homebrew: { keyPath: 'id', records: [] },
        meta: { keyPath: 'key', records: [] },
        fastStartSnapshots: { keyPath: 'key', records: [] },
        rawContentPacks: { keyPath: 'key', records: [] },
        characterLoadSnapshots: {
          keyPath: 'characterId',
          records: [],
        },
      },
    });
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');

    await expect(localStore.getCharacter('hero')).resolves.toMatchObject({
      xml: '<character />',
    });
    expect(fakeIndexedDb.version).toBe(6);
    expect(fakeIndexedDb.openCount).toBe(2);
  });

  it('round-trips a snapshot Blob and hides it after invalidation', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    vi.spyOn(Date, 'now').mockReturnValue(1_753_776_000_000);
    const { localStore } = await import('../localStore.js');
    const record = {
      key: 'sha256:snapshot',
      manifest: { bodyBytes: 4, bodyHash: 'sha256:body' },
      body: new Blob([new Uint8Array([0, 1, 2, 255])], {
        type: 'application/octet-stream',
      }),
      createdAt: 1_753_775_000_000,
    };

    await localStore.putFastStartSnapshot(record);

    const restored = await localStore.getFastStartSnapshot(record.key);
    expect(restored).toMatchObject({
      key: record.key,
      manifest: record.manifest,
      createdAt: record.createdAt,
    });
    expect(restored.body).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await restored.body.arrayBuffer())]).toEqual([
      0, 1, 2, 255,
    ]);

    await localStore.markFastStartSnapshotInvalid(
      record.key,
      'snapshot body hash does not match its manifest',
    );

    await expect(
      localStore.getFastStartSnapshot(record.key),
    ).resolves.toBeUndefined();
    const invalidRecord = fakeIndexedDb.readRecord(
      'fastStartSnapshots',
      record.key,
    );
    expect(invalidRecord).toMatchObject({
      key: record.key,
      invalidAt: 1_753_776_000_000,
      invalidReason: 'snapshot body hash does not match its manifest',
      bodyRemoved: true,
    });
    expect(invalidRecord.body.size).toBe(0);
  });

  it('publishes one character snapshot only while its XML is still current', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    await localStore.putCharacter({
      id: 'hero',
      xml: '<character revision="1" />',
      summary: { id: 'hero' },
    });
    const snapshot = {
      characterId: 'hero',
      key: 'sha256:character-snapshot',
      manifest: { bodyBytes: 3 },
      body: new Blob([new Uint8Array([1, 2, 3])]),
      createdAt: 10,
    };

    await expect(
      localStore.putCharacterLoadSnapshotIfCurrent(
        snapshot,
        '<character revision="0" />',
      ),
    ).resolves.toBe(false);
    await expect(
      localStore.getCharacterLoadSnapshot('hero'),
    ).resolves.toBeUndefined();

    await expect(
      localStore.putCharacterLoadSnapshotIfCurrent(
        snapshot,
        '<character revision="1" />',
      ),
    ).resolves.toBe(true);
    await expect(
      localStore.getCharacterLoadSnapshot('hero'),
    ).resolves.toMatchObject(snapshot);

    await localStore.putCharacter({
      id: 'hero',
      xml: '<character revision="2" />',
      summary: { id: 'hero' },
    });
    await expect(
      localStore.getCharacterLoadSnapshot('hero'),
    ).resolves.toMatchObject(snapshot);
  });

  it('clears character snapshots with performance data and not characters', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    await localStore.putCharacter({
      id: 'hero',
      xml: '<character />',
      summary: { id: 'hero' },
    });
    await localStore.putCharacterLoadSnapshotIfCurrent(
      {
        characterId: 'hero',
        key: 'sha256:character-snapshot',
        manifest: { bodyBytes: 1 },
        body: new Blob([new Uint8Array([1])]),
        createdAt: 10,
      },
      '<character />',
    );

    await localStore.clearFastStartData();

    await expect(localStore.getCharacter('hero')).resolves.toMatchObject({
      xml: '<character />',
    });
    await expect(
      localStore.getCharacterLoadSnapshot('hero'),
    ).resolves.toBeUndefined();
  });

  it('replaces an invalid record with a newly generated valid snapshot', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    const firstRecord = {
      key: 'sha256:snapshot',
      manifest: { bodyBytes: 1 },
      body: new Blob([new Uint8Array([1])]),
      createdAt: 10,
    };
    await localStore.putFastStartSnapshot(firstRecord);
    await localStore.markFastStartSnapshotInvalid(firstRecord.key, 'corrupt');

    const replacement = {
      ...firstRecord,
      manifest: { bodyBytes: 2 },
      body: new Blob([new Uint8Array([2, 3])]),
      createdAt: 20,
    };
    await localStore.putFastStartSnapshot(replacement);

    const restored = await localStore.getFastStartSnapshot(replacement.key);
    expect(restored.invalidAt).toBeUndefined();
    expect(restored.invalidReason).toBeUndefined();
    expect([...new Uint8Array(await restored.body.arrayBuffer())]).toEqual([
      2, 3,
    ]);
  });

  it('retains only the two newest local snapshots', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    const record = (key, createdAt) => ({
      key,
      manifest: { bodyBytes: 1 },
      body: new Blob([new Uint8Array([createdAt])]),
      createdAt,
    });

    await localStore.putFastStartSnapshot(record('oldest', 1));
    await localStore.putFastStartSnapshot(record('middle', 2));
    await localStore.putFastStartSnapshot(record('newest', 3));

    await expect(
      localStore.getFastStartSnapshot('oldest'),
    ).resolves.toBeUndefined();
    await expect(
      localStore.getFastStartSnapshot('middle'),
    ).resolves.toMatchObject({ key: 'middle' });
    await expect(
      localStore.getFastStartSnapshot('newest'),
    ).resolves.toMatchObject({ key: 'newest' });
    expect(
      fakeIndexedDb.readRecord('fastStartSnapshots', 'oldest'),
    ).toBeUndefined();
  });

  it('round-trips a raw pack and invalidates it atomically with content changes', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    const pack = {
      key: 'current',
      manifest: {
        format: 'dm-forge-raw-content-pack',
        schemaVersion: 1,
        fileCount: 1,
      },
      body: new Blob([new Uint8Array([1, 2, 3])], {
        type: 'application/zip',
      }),
      createdAt: 10,
    };

    const { revision } = await localStore.listContentWithRevision();
    await expect(
      localStore.putRawContentPackIfCurrent(pack, revision),
    ).resolves.toBe(true);
    await expect(localStore.getRawContentPack()).resolves.toMatchObject({
      key: 'current',
      manifest: { fileCount: 1 },
      body: expect.any(Blob),
    });
    await expect(localStore.getFastStartSummary()).resolves.toMatchObject({
      hasSnapshot: false,
      hasRawContentPack: true,
    });
    await expect(
      localStore.getRawContentPackWithRevision(),
    ).resolves.toMatchObject({
      record: {
        key: 'current',
        manifest: { fileCount: 1 },
        body: expect.any(Blob),
      },
      revision,
    });

    await localStore.putContent('homebrew/new.xml', 'PGVsZW1lbnRzIC8+');

    await expect(localStore.getRawContentPack()).resolves.toBeUndefined();
    await expect(localStore.getFastStartSummary()).resolves.toMatchObject({
      hasSnapshot: false,
      hasRawContentPack: false,
    });
    expect(
      fakeIndexedDb.readRecord('rawContentPacks', 'current'),
    ).toBeUndefined();
  });

  it('does not publish a raw pack built from content changed by another tab', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');

    await localStore.putContent('rules/old.xml', 'b2xk');
    const staleContent = await localStore.listContentWithRevision();
    const stalePack = {
      key: 'current',
      manifest: {
        format: 'dm-forge-raw-content-pack',
        schemaVersion: 1,
        fileCount: 1,
      },
      body: new Blob([new Uint8Array([1, 2, 3])], {
        type: 'application/zip',
      }),
      createdAt: 10,
    };

    // This models another tab changing the authoritative rows while the first
    // tab is still building a pack from staleContent.records.
    await localStore.putContent('rules/new.xml', 'bmV3');

    await expect(
      localStore.putRawContentPackIfCurrent(stalePack, staleContent.revision),
    ).resolves.toBe(false);
    await expect(localStore.getRawContentPack()).resolves.toBeUndefined();

    const currentContent = await localStore.listContentWithRevision();
    await expect(
      localStore.putRawContentPackIfCurrent(stalePack, currentContent.revision),
    ).resolves.toBe(true);
    await expect(localStore.getRawContentPack()).resolves.toMatchObject({
      key: 'current',
    });
  });

  it('does not publish a parsed snapshot built from content changed by another tab', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');

    await localStore.putContent('rules/old.xml', 'b2xk');
    const staleContent = await localStore.listContentWithRevision();
    const staleSnapshot = {
      key: 'sha256:stale-snapshot',
      manifest: {
        format: 'dm-forge-fast-start',
        schemaVersion: 1,
        bodyBytes: 3,
      },
      body: new Blob([new Uint8Array([1, 2, 3])], {
        type: 'application/octet-stream',
      }),
      createdAt: 10,
    };

    // Another tab changes the authoritative content while this tab is still
    // asking the worker to serialize its now-stale parsed library.
    await localStore.putContent('rules/new.xml', 'bmV3');

    await expect(
      localStore.putFastStartSnapshotIfCurrent(
        staleSnapshot,
        staleContent.revision,
      ),
    ).resolves.toBe(false);
    await expect(
      localStore.getFastStartSnapshot(staleSnapshot.key),
    ).resolves.toBeUndefined();

    const currentContent = await localStore.listContentWithRevision();
    await expect(
      localStore.putFastStartSnapshotIfCurrent(
        staleSnapshot,
        currentContent.revision,
      ),
    ).resolves.toBe(true);
    await expect(
      localStore.getFastStartSnapshot(staleSnapshot.key),
    ).resolves.toMatchObject({
      key: staleSnapshot.key,
    });
  });

  it('preserves concurrent source additions while another tab removes a source', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    const removedSource = {
      id: 'removed-source',
      kind: 'folder',
      label: 'Removed source',
      fileCount: 1,
    };
    await localStore.replaceContentSource(removedSource, [
      { path: 'removed/old.xml', base64: 'b2xk' },
    ]);

    const addedSource = {
      id: 'added-source',
      kind: 'github',
      label: 'Added source',
      location: 'https://github.com/example/rules',
      revision: 'commit-a',
      fileCount: 1,
    };
    await Promise.all([
      localStore.removeContentSource(removedSource.id),
      localStore.replaceContentSource(addedSource, [
        { path: 'added/new.xml', base64: 'bmV3' },
      ]),
    ]);

    await expect(localStore.listContentSources()).resolves.toEqual([
      addedSource,
    ]);
    await expect(
      localStore.getContent('removed/old.xml'),
    ).resolves.toBeUndefined();
    await expect(localStore.getContent('added/new.xml')).resolves.toMatchObject({
      sourceId: addedSource.id,
      base64: 'bmV3',
    });
  });

  it('updates source file counts in the same transaction as content deletion', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');
    const source = {
      id: 'two-files',
      kind: 'folder',
      label: 'Two files',
      fileCount: 2,
    };
    await localStore.replaceContentSource(source, [
      { path: 'two/one.xml', base64: 'b25l' },
      { path: 'two/two.xml', base64: 'dHdv' },
    ]);

    await localStore.deleteContent('two/one.xml');

    await expect(localStore.listContentSources()).resolves.toEqual([
      { ...source, fileCount: 1 },
    ]);
    await expect(
      localStore.getContent('two/one.xml'),
    ).resolves.toBeUndefined();
    await expect(localStore.getContent('two/two.xml')).resolves.toMatchObject({
      sourceId: source.id,
    });
  });

  it('closes a stale connection and reopens after a version change', async () => {
    const fakeIndexedDb = createFakeIndexedDb();
    globalThis.indexedDB = fakeIndexedDb;
    const { localStore } = await import('../localStore.js');

    await localStore.getFastStartSnapshot('missing');
    const firstConnection = fakeIndexedDb.lastConnection;
    fakeIndexedDb.triggerVersionChange();

    expect(firstConnection.closed).toBe(true);
    await localStore.getFastStartSnapshot('missing');
    expect(fakeIndexedDb.openCount).toBe(2);
    expect(fakeIndexedDb.lastConnection).not.toBe(firstConnection);
  });
});
