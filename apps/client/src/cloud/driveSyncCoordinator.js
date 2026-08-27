import {
  createLibraryManifest,
  mergeLibrarySnapshots,
  validateLibrarySnapshot,
} from './librarySnapshot.js';
import { findDuplicateContentGroups } from '../transport/contentDuplicates.js';

export const DRIVE_SYNC_META_KEY = 'google-drive-sync';
const DEFAULT_MAX_REMOTE_RETRIES = 1;

export class DriveLibraryValidationError extends Error {
  constructor(errors) {
    super(
      `The Google Drive library is not a valid DM Forge library: ${errors.join(
        '; '
      )}`
    );
    this.name = 'DriveLibraryValidationError';
    this.code = 'invalid_drive_library';
    this.errors = [...errors];
  }
}

export class DriveLibraryChangedError extends Error {
  constructor() {
    super(
      'The Google Drive library changed during sync. Wait a moment and try again.'
    );
    this.name = 'DriveLibraryChangedError';
    this.code = 'remote_changed_during_sync';
  }
}

function requireMethod(value, method, owner) {
  if (typeof value?.[method] !== 'function') {
    throw new TypeError(`${owner}.${method}() is required for Drive sync`);
  }
}

function sameDriveVersion(left, right) {
  if (left == null || right == null) return true;
  return String(left) === String(right);
}

async function summarize(snapshot) {
  const duplicateGroups = await findDuplicateContentGroups(
    snapshot.content.sources,
    snapshot.content.files
  );
  return {
    characters: snapshot.characters.length,
    content: snapshot.content.files.length,
    contentSources: snapshot.content.sources.length,
    homebrew: snapshot.homebrew.length,
    conflicts: snapshot.conflicts.length,
    duplicateGroups: duplicateGroups.length,
    duplicateSources: duplicateGroups.reduce(
      (total, group) => total + group.sourceIds.length,
      0
    ),
  };
}

function describeContentChanges(local, merged) {
  const localByPath = new Map(
    local.content.files.map((record) => [
      record.path,
      local.index.content[record.path],
    ])
  );
  const mergedByPath = new Map(
    merged.content.files.map((record) => [
      record.path,
      merged.index.content[record.path],
    ])
  );
  return {
    changed:
      localByPath.size !== mergedByPath.size ||
      [...mergedByPath].some(
        ([path, hash]) => localByPath.get(path) !== hash
      ),
    removedPaths: [...localByPath.keys()].filter(
      (path) => !mergedByPath.has(path)
    ),
  };
}

async function assertRemoteLibrary(document) {
  const validation = await validateLibrarySnapshot(document);
  if (!validation.valid) {
    throw new DriveLibraryValidationError(validation.errors);
  }
  return document;
}

/**
 * Runs one complete, user-present sync cycle.
 *
 * IndexedDB is always read first and remains the working copy. Remote content
 * is applied before character records by libraryStore, then the validated
 * merged document is written to Drive. The baseline is committed only after a
 * successful Drive write, so a failed upload remains retryable.
 */
export async function synchronizeDriveLibrary({
  drive,
  library,
  metadataStore,
  clock = Date.now,
  onApplied,
  maxRemoteRetries = DEFAULT_MAX_REMOTE_RETRIES,
} = {}) {
  requireMethod(drive, 'ensureFolder', 'drive');
  requireMethod(drive, 'findManagedLibrary', 'drive');
  requireMethod(drive, 'saveLibrary', 'drive');
  requireMethod(library, 'readSnapshot', 'library');
  requireMethod(library, 'applySnapshot', 'library');
  requireMethod(metadataStore, 'getMeta', 'metadataStore');
  requireMethod(metadataStore, 'putMeta', 'metadataStore');
  if (typeof clock !== 'function') {
    throw new TypeError('Drive sync clock must be a function');
  }
  if (!Number.isInteger(maxRemoteRetries) || maxRemoteRetries < 0) {
    throw new TypeError('maxRemoteRetries must be a non-negative integer');
  }

  const previous =
    (await metadataStore.getMeta(DRIVE_SYNC_META_KEY).catch(() => null)) ??
    {};
  const baseline = previous.baseline ?? null;
  const folder = await drive.ensureFolder();
  if (!folder?.id) {
    throw new TypeError('Google Drive did not return a DM Forge folder ID');
  }

  for (let attempt = 0; attempt <= maxRemoteRetries; attempt += 1) {
    const local = await library.readSnapshot({ baseline });
    const remoteFile = await drive.findManagedLibrary(folder);
    let merged = local;

    if (remoteFile) {
      requireMethod(drive, 'downloadJson', 'drive');
      const remote = await assertRemoteLibrary(
        await drive.downloadJson(remoteFile)
      );
      merged = await mergeLibrarySnapshots({
        local,
        remote,
        baseline,
        now: Number(clock()),
      });
    }

    const applied = await library.applySnapshot(merged);

    if (remoteFile && typeof drive.getFileMetadata === 'function') {
      const latestRemoteFile = await drive.getFileMetadata(remoteFile);
      if (!sameDriveVersion(remoteFile.version, latestRemoteFile?.version)) {
        if (attempt < maxRemoteRetries) continue;
        throw new DriveLibraryChangedError();
      }
    }

    const savedFile = await drive.saveLibrary(merged, remoteFile, {
      folderId: folder.id,
    });
    if (!savedFile?.id) {
      throw new TypeError('Google Drive did not return a library file ID');
    }

    const lastSyncedAt = Number(clock());
    const nextMetadata = {
      ...previous,
      linked: true,
      folderId: folder.id,
      fileId: savedFile.id,
      fileName: savedFile.name ?? remoteFile?.name ?? null,
      remoteModifiedTime: savedFile.modifiedTime ?? null,
      remoteVersion: savedFile.version ?? null,
      lastSyncedAt,
      baseline: await createLibraryManifest(merged),
    };
    await metadataStore.putMeta(DRIVE_SYNC_META_KEY, nextMetadata);
    const contentChanges = describeContentChanges(local, merged);
    await onApplied?.({
      applied,
      contentChanges,
      previousSnapshot: local,
      snapshot: merged,
    });

    const duplicateGroups = await findDuplicateContentGroups(
      merged.content.sources,
      merged.content.files
    );
    return {
      applied,
      contentChanges,
      duplicateGroups,
      file: savedFile,
      folder,
      lastSyncedAt,
      metadata: nextMetadata,
      snapshot: merged,
      summary: await summarize(merged),
    };
  }

  throw new DriveLibraryChangedError();
}

export async function summarizeDriveLibrary(snapshot) {
  return summarize(snapshot);
}
