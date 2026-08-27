import { afterEach, describe, expect, it, vi } from 'vitest';

describe('local content transaction safety', () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDb;
    vi.restoreAllMocks();
  });

  it('aborts the whole batch when scheduling a later IndexedDB write throws', async () => {
    const transaction = {
      abort: vi.fn(),
      objectStore: vi.fn(() => ({
        put(record) {
          if (record.path === 'package/two.xml') {
            throw new Error('simulated synchronous put failure');
          }
        },
      })),
    };
    const database = {
      objectStoreNames: {
        contains: (name) =>
          ['characters', 'content', 'homebrew', 'meta'].includes(name),
      },
      transaction: vi.fn(() => transaction),
    };
    globalThis.indexedDB = {
      open: vi.fn(() => {
        const request = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    };
    vi.resetModules();
    const { localStore } = await import('../localStore.js');

    await expect(
      localStore.putContentBatch([
        { path: 'package/one.xml', base64: 'b25l' },
        { path: 'package/two.xml', base64: 'dHdv' },
      ]),
    ).rejects.toThrow('simulated synchronous put failure');
    expect(transaction.abort).toHaveBeenCalledTimes(1);
  });

  it('opens a newer compatible database without downgrading or clearing it', async () => {
    const characters = [{ id: 'saved-character' }];
    const database = {
      objectStoreNames: {
        contains: (name) =>
          ['characters', 'content', 'homebrew', 'meta'].includes(name),
      },
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          getAll: vi.fn(() => {
            const request = {};
            queueMicrotask(() => {
              request.result = characters;
              request.onsuccess?.();
            });
            return request;
          }),
        })),
      })),
    };
    const open = vi.fn((name, version) => {
      const request = {};
      queueMicrotask(() => {
        if (version === 4) {
          const error = new Error(
            'The requested version (4) is less than the existing version (5).',
          );
          error.name = 'VersionError';
          request.error = error;
          request.onerror?.();
          return;
        }
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    });
    globalThis.indexedDB = { open };
    vi.resetModules();
    const { localStore } = await import('../localStore.js');

    await expect(localStore.listCharacters()).resolves.toEqual(characters);
    // Pinned: the database name is a persisted identifier, not a brand string.
    expect(open).toHaveBeenNthCalledWith(1, 'aurora-local', 5);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
