import { describe, expect, it, vi } from 'vitest';
import { createDriveSyncService } from '../driveSyncService.js';

function createMetaStore(value = null) {
  let current = value;
  return {
    getMeta: vi.fn(async () => current),
    putMeta: vi.fn(async (_key, next) => {
      current = next;
    }),
    read: () => current,
  };
}

function createDependencies({ connected = true } = {}) {
  const identity = {
    clearAccessToken: vi.fn(),
    connect: vi.fn(async () => ({ access_token: 'memory-token' })),
    getAccessToken: vi.fn(() =>
      connected ? 'memory-token' : null
    ),
    isConnected: vi.fn(() => connected),
    revoke: vi.fn(async () => ({ successful: true })),
  };
  const drive = {
    getUserMetadata: vi.fn(async () => ({
      displayName: 'Ada Adventurer',
      emailAddress: 'ada@example.com',
    })),
  };
  const library = {
    readSnapshot: vi.fn(async () => ({
      characters: [],
      content: { files: [], sources: [] },
      homebrew: [],
      conflicts: [],
    })),
  };
  const metadataStore = createMetaStore();
  const contentApi = {
    reload: vi.fn(async () => ({ status: 'succeeded' })),
    remove: vi.fn(async () => ({ status: 'succeeded' })),
  };
  const characterApi = {
    flushPendingSaves: vi.fn(async () => {}),
    invalidateLoadedCharacter: vi.fn(),
  };
  const identityFactory = vi.fn(() => identity);
  const driveFactory = vi.fn(() => drive);
  const libraryFactory = vi.fn(() => library);
  const coordinator = vi.fn(async ({ onApplied }) => {
    await onApplied({
      applied: {
        characters: { put: 1, deleted: 0 },
      },
      contentChanges: {
        changed: true,
        removedPaths: ['imports/removed.xml'],
      },
      snapshot: {},
    });
    return {
      applied: {
        characters: { put: 1, deleted: 0 },
      },
      file: { id: 'library-1', version: '2' },
      folder: { id: 'folder-1' },
      lastSyncedAt: 100,
      summary: {
        characters: 2,
        content: 3,
        contentSources: 1,
        homebrew: 1,
        conflicts: 0,
      },
    };
  });

  return {
    characterApi,
    contentApi,
    coordinator,
    drive,
    driveFactory,
    identity,
    identityFactory,
    library,
    libraryFactory,
    metadataStore,
  };
}

describe('createDriveSyncService', () => {
  it('connects, syncs, and exposes a stable observable state', async () => {
    const deps = createDependencies();
    const service = createDriveSyncService({
      clientId: 'browser-client-id',
      ...deps,
      clock: () => 100,
    });
    const listener = vi.fn();
    service.subscribe(listener);

    await service.connect();

    expect(deps.identity.connect).toHaveBeenCalledWith({
      prompt: 'select_account',
    });
    expect(deps.driveFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        getAccessToken: expect.any(Function),
        onUnauthorized: expect.any(Function),
      })
    );
    expect(deps.coordinator).toHaveBeenCalledOnce();
    expect(deps.characterApi.flushPendingSaves).toHaveBeenCalledOnce();
    expect(
      deps.characterApi.invalidateLoadedCharacter,
    ).toHaveBeenCalledOnce();
    expect(deps.contentApi.remove).toHaveBeenCalledWith([
      'imports/removed.xml',
    ]);
    expect(deps.contentApi.reload).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({
      account: {
        displayName: 'Ada Adventurer',
        emailAddress: 'ada@example.com',
      },
      busy: false,
      connected: true,
      lastSyncedAt: 100,
      status: 'connected',
      summary: {
        characters: 2,
        content: 3,
        homebrew: 1,
      },
    });
    expect(listener).toHaveBeenCalled();
  });

  it('requires a configured public client ID without loading Google', async () => {
    const deps = createDependencies();
    const service = createDriveSyncService({
      clientId: '',
      ...deps,
    });

    await expect(service.connect()).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(deps.identityFactory).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({
      configured: false,
      status: 'unconfigured',
    });
  });

  it('revokes the in-memory grant but preserves the sync baseline', async () => {
    const deps = createDependencies();
    deps.metadataStore = createMetaStore({
      linked: true,
      baseline: { format: 'baseline' },
      fileId: 'library-1',
    });
    const service = createDriveSyncService({
      clientId: 'browser-client-id',
      ...deps,
      clock: () => 200,
    });
    await service.connect();

    await service.disconnect();

    expect(deps.identity.revoke).toHaveBeenCalledOnce();
    expect(deps.metadataStore.read()).toMatchObject({
      linked: false,
      disconnectedAt: 200,
      baseline: { format: 'baseline' },
      fileId: 'library-1',
    });
    expect(deps.metadataStore.read()).not.toHaveProperty('accessToken');
    expect(service.getSnapshot()).toMatchObject({
      account: null,
      connected: false,
      status: 'disconnected',
    });
  });
});
