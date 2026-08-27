import { api } from '../api.js';
import { localStore } from '../transport/localStore.js';
import { createGoogleDriveClient } from './googleDriveClient.js';
import { createGoogleIdentity } from './googleIdentity.js';
import {
  DRIVE_SYNC_META_KEY,
  summarizeDriveLibrary,
  synchronizeDriveLibrary,
} from './driveSyncCoordinator.js';
import { createLibraryStore } from './libraryStore.js';

const SYNC_LOCK_NAME = 'dm-forge-google-drive-sync';

export class DriveSyncServiceError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'DriveSyncServiceError';
    this.code = code;
  }
}

function initialState(configured) {
  return {
    account: null,
    busy: false,
    configured,
    connected: false,
    error: null,
    lastSyncedAt: null,
    previouslyLinked: false,
    status: configured ? 'disconnected' : 'unconfigured',
    summary: null,
  };
}

function friendlyError(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Google Drive sync failed.');
}

function isAuthorizationError(error) {
  return (
    error?.code === 'unauthorized' ||
    error?.code === 'not_connected' ||
    error?.code === 'access_denied' ||
    error?.code === 'insufficient_scope'
  );
}

export function createDriveSyncService({
  clientId = '',
  metadataStore = localStore,
  contentApi = api.content,
  characterApi = api.characters,
  identityFactory = createGoogleIdentity,
  driveFactory = createGoogleDriveClient,
  libraryFactory = createLibraryStore,
  coordinator = synchronizeDriveLibrary,
  clock = Date.now,
  lockManager = globalThis.navigator?.locks,
} = {}) {
  const configured = Boolean(String(clientId || '').trim());
  let state = initialState(configured);
  let identity = null;
  let drive = null;
  let library = null;
  let connectPromise = null;
  let syncPromise = null;
  let hydratePromise = null;
  const listeners = new Set();

  function emit(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function ensureConfigured() {
    if (configured) return;
    throw new DriveSyncServiceError(
      'Google Drive sync is not configured for this deployment.',
      'not_configured'
    );
  }

  function ensureResources() {
    ensureConfigured();
    if (!identity) {
      identity = identityFactory({ clientId: String(clientId).trim() });
    }
    if (!drive) {
      drive = driveFactory({
        getAccessToken: () => identity.getAccessToken(),
        onUnauthorized: () => {
          identity.clearAccessToken();
          emit({
            busy: false,
            connected: false,
            error:
              'Google Drive authorization expired. Reconnect to sync again.',
            status: 'reconnect',
          });
        },
      });
    }
    if (!library) library = libraryFactory(metadataStore);
    return { drive, identity, library };
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      let metadata = null;
      try {
        metadata = await metadataStore.getMeta(DRIVE_SYNC_META_KEY);
      } catch {
        // Local storage being unavailable is surfaced when a sync is attempted.
      }

      let summary = state.summary;
      try {
        const resources = ensureResources();
        const local = await resources.library.readSnapshot({
          baseline: metadata?.baseline ?? null,
        });
        summary = await summarizeDriveLibrary(local);
      } catch (error) {
        if (configured) {
          emit({ error: friendlyError(error) });
        }
      }

      const previouslyLinked = Boolean(metadata?.linked);
      emit({
        lastSyncedAt: metadata?.lastSyncedAt ?? null,
        previouslyLinked,
        status: configured
          ? previouslyLinked
            ? 'reconnect'
            : 'disconnected'
          : 'unconfigured',
        summary,
      });
      return state;
    })();
    return hydratePromise;
  }

  async function updateLiveContent(contentChanges) {
    if (!contentChanges?.changed) return;
    if (
      contentChanges.removedPaths?.length &&
      typeof contentApi?.remove === 'function'
    ) {
      await contentApi.remove(contentChanges.removedPaths);
    }
    if (typeof contentApi?.reload === 'function') {
      await contentApi.reload();
    }
  }

  async function updateLiveLibrary({ applied, contentChanges }) {
    await updateLiveContent(contentChanges);
    const changedCharacters =
      Number(applied?.characters?.put ?? 0) +
      Number(applied?.characters?.deleted ?? 0);
    if (changedCharacters > 0) {
      characterApi?.invalidateLoadedCharacter?.();
    }
  }

  async function executeSync() {
    const resources = ensureResources();
    if (!resources.identity.isConnected()) {
      emit({
        busy: false,
        connected: false,
        status: state.previouslyLinked ? 'reconnect' : 'disconnected',
      });
      throw new DriveSyncServiceError(
        'Reconnect Google Drive before syncing.',
        'not_connected'
      );
    }

    emit({ busy: true, connected: true, error: null, status: 'syncing' });
    try {
      await characterApi?.flushPendingSaves?.();
      const result = await coordinator({
        drive: resources.drive,
        library: resources.library,
        metadataStore,
        clock,
        onApplied: updateLiveLibrary,
      });
      emit({
        busy: false,
        connected: true,
        error: null,
        lastSyncedAt: result.lastSyncedAt,
        previouslyLinked: true,
        status: 'connected',
        summary: result.summary,
      });
      return result;
    } catch (error) {
      const authorizationError = isAuthorizationError(error);
      if (authorizationError) resources.identity.clearAccessToken();
      emit({
        busy: false,
        connected: authorizationError
          ? false
          : resources.identity.isConnected(),
        error: friendlyError(error),
        status: authorizationError ? 'reconnect' : 'error',
      });
      throw error;
    }
  }

  function withOriginLock(task) {
    if (typeof lockManager?.request !== 'function') return task();
    return lockManager.request(SYNC_LOCK_NAME, { mode: 'exclusive' }, task);
  }

  function sync() {
    if (syncPromise) return syncPromise;
    const attempt = Promise.resolve().then(() =>
      withOriginLock(executeSync)
    );
    syncPromise = attempt;
    attempt.then(
      () => {
        if (syncPromise === attempt) syncPromise = null;
      },
      () => {
        if (syncPromise === attempt) syncPromise = null;
      }
    );
    return attempt;
  }

  function connect() {
    if (connectPromise) return connectPromise;
    try {
      ensureConfigured();
    } catch (error) {
      emit({ error: friendlyError(error), status: 'unconfigured' });
      return Promise.reject(error);
    }

    const attempt = (async () => {
      await hydrate();
      const resources = ensureResources();
      emit({ busy: true, error: null, status: 'connecting' });
      try {
        await resources.identity.connect({
          prompt: state.previouslyLinked ? '' : 'select_account',
        });
        const account = await resources.drive.getUserMetadata();
        emit({
          account,
          busy: false,
          connected: true,
          status: 'connected',
        });
        return await sync();
      } catch (error) {
        const authorizationError = isAuthorizationError(error);
        emit({
          busy: false,
          connected: false,
          error: friendlyError(error),
          status: authorizationError ? 'reconnect' : 'error',
        });
        throw error;
      }
    })();

    connectPromise = attempt;
    attempt.then(
      () => {
        if (connectPromise === attempt) connectPromise = null;
      },
      () => {
        if (connectPromise === attempt) connectPromise = null;
      }
    );
    return attempt;
  }

  async function disconnect() {
    let revokeError = null;
    emit({ busy: true, error: null, status: 'disconnecting' });
    try {
      await identity?.revoke?.();
    } catch (error) {
      revokeError = error;
    } finally {
      identity?.clearAccessToken?.();
    }

    const previous =
      (await metadataStore.getMeta(DRIVE_SYNC_META_KEY).catch(() => null)) ??
      {};
    await metadataStore.putMeta(DRIVE_SYNC_META_KEY, {
      ...previous,
      linked: false,
      disconnectedAt: Number(clock()),
    });
    emit({
      account: null,
      busy: false,
      connected: false,
      error: revokeError ? friendlyError(revokeError) : null,
      previouslyLinked: false,
      status: 'disconnected',
    });
    if (revokeError) throw revokeError;
  }

  return {
    connect,
    disconnect,
    getSnapshot: () => state,
    hydrate,
    subscribe,
    sync,
  };
}

export const driveSyncService = createDriveSyncService({
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '',
});
