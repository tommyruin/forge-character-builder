import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createLibraryManifest,
  createLibrarySnapshot,
} from '../librarySnapshot.js';
import {
  DRIVE_SYNC_META_KEY,
  DriveLibraryValidationError,
  synchronizeDriveLibrary,
} from '../driveSyncCoordinator.js';

// The content corpus is fetched separately (npm run corpus:fetch); the sync
// test over the whole folder skips without it.
const CORPUS_DIR = fileURLToPath(
  new URL('../../../../../third-party/elements/testdata/', import.meta.url)
);
const corpusPresent = existsSync(CORPUS_DIR);

function readTestDataContent(sourceId, uploadedAt) {
  const files = [];
  const pending = [CORPUS_DIR];

  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!/\.(?:index|xml)$/i.test(entry.name)) continue;
      const relativePath = relative(CORPUS_DIR, absolutePath).replaceAll('\\', '/');
      files.push({
        path: `imports/${sourceId}/${relativePath}`,
        relativePath,
        base64: readFileSync(absolutePath).toString('base64'),
        sourceId,
        uploadedAt,
      });
    }
  }

  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function createMetadataStore(initialValue = null) {
  let value = structuredClone(initialValue);
  return {
    getMeta: vi.fn(async (key) =>
      key === DRIVE_SYNC_META_KEY ? structuredClone(value) : undefined
    ),
    putMeta: vi.fn(async (key, nextValue) => {
      if (key === DRIVE_SYNC_META_KEY) value = structuredClone(nextValue);
    }),
    read: () => structuredClone(value),
  };
}

async function snapshotWithCharacter(id, xml, updatedAt) {
  return createLibrarySnapshot({
    characters: [
      {
        id,
        xml,
        summary: { id, name: id },
        updatedAt,
      },
    ],
  });
}

describe('synchronizeDriveLibrary', () => {
  it('reports identical sources imported under different device IDs without deleting them', async () => {
    const local = await createLibrarySnapshot({
      content: [
        {
          path: 'imports/mobile/rules.xml',
          relativePath: 'rules.xml',
          base64: 'cnVsZXM=',
          sourceId: 'mobile',
          uploadedAt: 10,
        },
      ],
      contentSources: [
        {
          id: 'mobile',
          kind: 'folder',
          label: 'legacy-elements',
          fileCount: 1,
          importedAt: 10,
        },
      ],
    });
    const remote = await createLibrarySnapshot({
      content: [
        {
          path: 'imports/desktop/rules.xml',
          relativePath: 'rules.xml',
          base64: 'cnVsZXM=',
          sourceId: 'desktop',
          uploadedAt: 20,
        },
      ],
      contentSources: [
        {
          id: 'desktop',
          kind: 'folder',
          label: 'Legacy Elements',
          fileCount: 1,
          importedAt: 20,
        },
      ],
    });
    const library = {
      readSnapshot: vi.fn(async () => local),
      applySnapshot: vi.fn(async () => ({
        characters: { put: 0, deleted: 0 },
        content: { put: 1, deleted: 0 },
        contentSources: { replaced: 1, deleted: 0 },
        homebrew: { put: 0, deleted: 0 },
      })),
    };
    const file = { id: 'library-1', version: '1' };
    const drive = {
      ensureFolder: vi.fn(async () => ({ id: 'folder-1' })),
      findManagedLibrary: vi.fn(async () => file),
      downloadJson: vi.fn(async () => remote),
      getFileMetadata: vi.fn(async () => file),
      saveLibrary: vi.fn(async (snapshot) => {
        expect(snapshot.content.sources).toHaveLength(2);
        return { ...file, version: '2' };
      }),
    };

    const result = await synchronizeDriveLibrary({
      drive,
      library,
      metadataStore: createMetadataStore(),
      clock: () => 100,
    });

    expect(result.summary).toMatchObject({
      contentSources: 2,
      duplicateGroups: 1,
      duplicateSources: 2,
    });
    expect(result.duplicateGroups[0].sourceIds).toEqual([
      'desktop',
      'mobile',
    ]);
  });

  it('creates the first Drive document and saves a body-free baseline', async () => {
    const local = await snapshotWithCharacter('aria', '<aria />', 10);
    const library = {
      readSnapshot: vi.fn(async () => local),
      applySnapshot: vi.fn(async () => ({
        characters: { put: 0, deleted: 0 },
        content: { put: 0, deleted: 0 },
        contentSources: { replaced: 0, deleted: 0 },
        homebrew: { put: 0, deleted: 0 },
      })),
    };
    const drive = {
      ensureFolder: vi.fn(async () => ({ id: 'folder-1' })),
      findManagedLibrary: vi.fn(async () => null),
      saveLibrary: vi.fn(async () => ({
        id: 'library-1',
        name: 'dm-forge-library.json',
        version: '1',
        modifiedTime: '2026-07-25T12:00:00Z',
      })),
    };
    const metadataStore = createMetadataStore();

    const result = await synchronizeDriveLibrary({
      drive,
      library,
      metadataStore,
      clock: () => 100,
    });

    expect(drive.saveLibrary).toHaveBeenCalledWith(
      local,
      null,
      expect.objectContaining({ folderId: 'folder-1' })
    );
    expect(result.summary).toMatchObject({
      characters: 1,
      content: 0,
      homebrew: 0,
    });
    expect(metadataStore.read()).toMatchObject({
      fileId: 'library-1',
      folderId: 'folder-1',
      remoteVersion: '1',
      lastSyncedAt: 100,
    });
    expect(metadataStore.read().baseline).not.toHaveProperty('characters');
  });

  it('merges a Drive-only change into IndexedDB before updating Drive', async () => {
    const baselineSnapshot = await snapshotWithCharacter(
      'aria',
      '<old />',
      10
    );
    const baseline = await createLibraryManifest(baselineSnapshot);
    const local = baselineSnapshot;
    const remote = await createLibrarySnapshot({
      characters: [
        {
          id: 'aria',
          xml: '<old />',
          summary: { id: 'aria', name: 'aria' },
          updatedAt: 10,
        },
        {
          id: 'bran',
          xml: '<remote />',
          summary: { id: 'bran', name: 'bran' },
          updatedAt: 20,
        },
      ],
    });
    const order = [];
    const library = {
      readSnapshot: vi.fn(async () => local),
      applySnapshot: vi.fn(async (snapshot) => {
        order.push('apply');
        expect(snapshot.characters.map(({ id }) => id)).toEqual([
          'aria',
          'bran',
        ]);
        return {
          characters: { put: 1, deleted: 0 },
          content: { put: 0, deleted: 0 },
          contentSources: { replaced: 0, deleted: 0 },
          homebrew: { put: 0, deleted: 0 },
        };
      }),
    };
    const file = {
      id: 'library-1',
      name: 'dm-forge-library.json',
      version: '4',
    };
    const drive = {
      ensureFolder: vi.fn(async () => ({ id: 'folder-1' })),
      findManagedLibrary: vi.fn(async () => file),
      downloadJson: vi.fn(async () => remote),
      getFileMetadata: vi.fn(async () => file),
      saveLibrary: vi.fn(async (_snapshot, existing) => {
        order.push('save');
        expect(existing).toBe(file);
        return { ...file, version: '5' };
      }),
    };
    const metadataStore = createMetadataStore({
      baseline,
      fileId: file.id,
      folderId: 'folder-1',
      remoteVersion: '3',
      lastSyncedAt: 50,
    });

    const result = await synchronizeDriveLibrary({
      drive,
      library,
      metadataStore,
      clock: () => 100,
    });

    expect(order).toEqual(['apply', 'save']);
    expect(result.applied.characters.put).toBe(1);
    expect(metadataStore.read().remoteVersion).toBe('5');
  });

  it('refuses an invalid Drive document without changing local data', async () => {
    const local = await createLibrarySnapshot();
    const library = {
      readSnapshot: vi.fn(async () => local),
      applySnapshot: vi.fn(),
    };
    const file = { id: 'library-1', version: '1' };
    const drive = {
      ensureFolder: vi.fn(async () => ({ id: 'folder-1' })),
      findManagedLibrary: vi.fn(async () => file),
      downloadJson: vi.fn(async () => ({
        format: 'not-dm-forge',
        version: 1,
      })),
      saveLibrary: vi.fn(),
    };

    await expect(
      synchronizeDriveLibrary({
        drive,
        library,
        metadataStore: createMetadataStore(),
      })
    ).rejects.toBeInstanceOf(DriveLibraryValidationError);
    expect(library.applySnapshot).not.toHaveBeenCalled();
  });

  it.skipIf(!corpusPresent)(
    'syncs the complete corpus folder from two devices and reports one exact duplicate group',
    { timeout: 60_000 },
    async () => {
      const mobileFiles = readTestDataContent('mobile-test-data', 10);
      const desktopFiles = mobileFiles.map((file) => ({
        ...file,
        path: file.path.replace(
          'imports/mobile-test-data/',
          'imports/desktop-test-data/'
        ),
        sourceId: 'desktop-test-data',
        uploadedAt: 20,
      }));
      const local = await createLibrarySnapshot({
        content: mobileFiles,
        contentSources: [
          {
            id: 'mobile-test-data',
            kind: 'folder',
            label: 'TestData',
            fileCount: mobileFiles.length,
            importedAt: 10,
          },
        ],
      });
      const remote = await createLibrarySnapshot({
        content: desktopFiles,
        contentSources: [
          {
            id: 'desktop-test-data',
            kind: 'folder',
            label: 'Test Data',
            fileCount: desktopFiles.length,
            importedAt: 20,
          },
        ],
      });
      const library = {
        readSnapshot: vi.fn(async () => local),
        applySnapshot: vi.fn(async () => ({
          characters: { put: 0, deleted: 0 },
          content: { put: desktopFiles.length, deleted: 0 },
          contentSources: { replaced: 1, deleted: 0 },
          homebrew: { put: 0, deleted: 0 },
        })),
      };
      const file = { id: 'test-data-library', version: '1' };
      const drive = {
        ensureFolder: vi.fn(async () => ({ id: 'folder-1' })),
        findManagedLibrary: vi.fn(async () => file),
        downloadJson: vi.fn(async () => remote),
        getFileMetadata: vi.fn(async () => file),
        saveLibrary: vi.fn(async () => ({ ...file, version: '2' })),
      };

      const result = await synchronizeDriveLibrary({
        drive,
        library,
        metadataStore: createMetadataStore(),
        clock: () => 100,
      });

      expect(mobileFiles.length).toBeGreaterThan(700);
      expect(result.snapshot.content.files).toHaveLength(
        mobileFiles.length * 2
      );
      expect(result.summary).toMatchObject({
        content: mobileFiles.length * 2,
        contentSources: 2,
        duplicateGroups: 1,
        duplicateSources: 2,
      });
      expect(result.duplicateGroups[0]).toMatchObject({
        fileCount: mobileFiles.length,
        sourceIds: ['desktop-test-data', 'mobile-test-data'],
      });
      expect(result.duplicateGroups[0].relativePaths).toHaveLength(
        mobileFiles.length
      );
    }
  );
});
