import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFLICT_HISTORY_LIMIT,
  LIBRARY_FORMAT,
  LIBRARY_VERSION,
  createLibraryManifest,
  createLibrarySnapshot,
  mergeLibrarySnapshots,
  stableHash,
  validateLibrarySnapshot,
} from '../librarySnapshot.js';

const character = (id, xml, updatedAt) => ({
  id,
  xml,
  summary: { id, name: id.toUpperCase() },
  updatedAt,
});

describe('library snapshots', () => {
  it('uses a versioned format, deterministic record order, and stable hashes', async () => {
    const first = await createLibrarySnapshot(
      {
        characters: [
          character('zara', '<character id="zara" />', 20),
          character('aria', '<character id="aria" />', 10),
        ],
        content: [
          {
            base64: 'YmV0YQ==',
            path: 'homebrew/z.xml',
            uploadedAt: 20,
          },
          {
            path: 'imports/source-a/a.xml',
            uploadedAt: 10,
            base64: 'YWxwaGE=',
            sourceId: 'source-a',
          },
        ],
        contentSources: [
          {
            label: 'Source A',
            id: 'source-a',
            kind: 'folder',
            fileCount: 1,
          },
        ],
        homebrew: [
          { name: 'Zephyr', id: 'z-draft', updatedAt: 20 },
          { id: 'a-draft', updatedAt: 10, name: 'Ash' },
        ],
      },
      { generatedAt: 100 }
    );
    const second = await createLibrarySnapshot(
      {
        characters: [...first.characters].reverse().map((record) => ({
          updatedAt: record.updatedAt + 100,
          summary: { name: record.summary.name, id: record.summary.id },
          xml: record.xml,
          id: record.id,
        })),
        content: [...first.content.files].reverse().map((record) => ({
          uploadedAt: record.uploadedAt + 100,
          ...(record.sourceId ? { sourceId: record.sourceId } : {}),
          base64: record.base64,
          path: record.path,
        })),
        contentSources: [...first.content.sources],
        homebrew: [...first.homebrew].reverse().map((record) => ({
          updatedAt: record.updatedAt + 100,
          name: record.name,
          id: record.id,
        })),
      },
      { generatedAt: 200 }
    );

    expect(first).toMatchObject({
      format: LIBRARY_FORMAT,
      version: LIBRARY_VERSION,
      generatedAt: 100,
    });
    expect(first.characters.map(({ id }) => id)).toEqual(['aria', 'zara']);
    expect(first.content.files.map(({ path }) => path)).toEqual([
      'homebrew/z.xml',
      'imports/source-a/a.xml',
    ]);
    expect(first.homebrew.map(({ id }) => id)).toEqual([
      'a-draft',
      'z-draft',
    ]);
    expect(first.index).toEqual(second.index);
    expect(first.index.characters.aria).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(stableHash({ beta: 2, alpha: 1 })).resolves.toBe(
      await stableHash({ alpha: 1, beta: 2 })
    );

    const validation = await validateLibrarySnapshot(first);
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it('normalizes legacy ISO content-source timestamps', async () => {
    const importedAt = '2026-07-26T12:00:00.000Z';

    const snapshot = await createLibrarySnapshot({
      contentSources: [
        {
          id: 'legacy-source',
          kind: 'folder',
          label: 'Legacy source',
          importedAt,
          fileCount: 0,
        },
      ],
    });

    expect(snapshot.content.sources[0].importedAt).toBe(
      Date.parse(importedAt)
    );
    await expect(validateLibrarySnapshot(snapshot)).resolves.toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates synchronized duplicate acknowledgements when present', async () => {
    const snapshot = await createLibrarySnapshot({
      contentSources: [
        {
          id: 'acknowledged-source',
          kind: 'folder',
          label: 'Rules',
          fileCount: 0,
        },
      ],
    });
    snapshot.content.sources[0].duplicateAcknowledgedFingerprint =
      'not-a-fingerprint';

    expect((await validateLibrarySnapshot(snapshot)).errors).toContain(
      'contentSources[0].duplicateAcknowledgedFingerprint must be a SHA-256 hash',
    );
  });

  it('rejects unsupported, duplicate, and hash-tampered documents', async () => {
    const snapshot = await createLibrarySnapshot({
      characters: [character('aria', '<character />', 10)],
    });
    const unsupported = structuredClone(snapshot);
    unsupported.version = 999;
    const duplicated = structuredClone(snapshot);
    duplicated.characters.push(structuredClone(duplicated.characters[0]));
    const tampered = structuredClone(snapshot);
    tampered.characters[0].xml = '<tampered />';

    expect((await validateLibrarySnapshot(unsupported)).errors).toContain(
      'version must be 1'
    );
    expect((await validateLibrarySnapshot(duplicated)).errors).toContain(
      'characters contains duplicate key "aria"'
    );
    expect((await validateLibrarySnapshot(tampered)).errors).toContain(
      'index.characters["aria"] does not match its record'
    );
  });

  it('creates a body-free baseline manifest with indexes and tombstones', async () => {
    const snapshot = await createLibrarySnapshot(
      {
        characters: [character('aria', '<character />', 10)],
      },
      {
        tombstones: {
          homebrew: [{ id: 'removed-draft', deletedAt: 9 }],
        },
      }
    );

    const manifest = await createLibraryManifest(snapshot);

    expect(manifest).toEqual({
      format: LIBRARY_FORMAT,
      version: LIBRARY_VERSION,
      generatedAt: snapshot.generatedAt,
      index: snapshot.index,
      tombstones: snapshot.tombstones,
    });
    expect(manifest).not.toHaveProperty('characters');
    expect(manifest).not.toHaveProperty('content');
    expect(manifest).not.toHaveProperty('homebrew');
  });
});

describe('three-way library merge', () => {
  it('adds records unique to either device when there is no baseline', async () => {
    const local = await createLibrarySnapshot({
      characters: [character('aria', '<aria />', 10)],
      homebrew: [{ id: 'local-draft', name: 'Local', updatedAt: 10 }],
    });
    const remote = await createLibrarySnapshot({
      characters: [character('bran', '<bran />', 20)],
      content: [
        {
          path: 'homebrew/remote.xml',
          base64: 'cmVtb3Rl',
          uploadedAt: 20,
        },
      ],
    });

    const merged = await mergeLibrarySnapshots({
      local,
      remote,
      now: 30,
    });

    expect(merged.characters.map(({ id }) => id)).toEqual(['aria', 'bran']);
    expect(merged.content.files.map(({ path }) => path)).toEqual([
      'homebrew/remote.xml',
    ]);
    expect(merged.homebrew.map(({ id }) => id)).toEqual(['local-draft']);
    expect(merged.conflicts).toEqual([]);
  });

  it('combines independent local and remote edits without a conflict', async () => {
    const baseline = await createLibrarySnapshot({
      characters: [character('aria', '<old-character />', 10)],
      homebrew: [{ id: 'draft', name: 'Old draft', updatedAt: 10 }],
    });
    const local = await createLibrarySnapshot({
      characters: [character('aria', '<local-character />', 20)],
      homebrew: [{ id: 'draft', name: 'Old draft', updatedAt: 10 }],
    });
    const remote = await createLibrarySnapshot({
      characters: [character('aria', '<old-character />', 10)],
      homebrew: [{ id: 'draft', name: 'Remote draft', updatedAt: 30 }],
    });

    const merged = await mergeLibrarySnapshots({
      baseline: await createLibraryManifest(baseline),
      local,
      remote,
      now: 40,
    });

    expect(merged.characters[0].xml).toBe('<local-character />');
    expect(merged.homebrew[0].name).toBe('Remote draft');
    expect(merged.conflicts).toEqual([]);
  });

  it('keeps a deletion when the other device has not changed the baseline', async () => {
    const baseline = await createLibrarySnapshot({
      characters: [
        character('aria', '<aria />', 10),
        character('bran', '<bran />', 10),
      ],
    });
    const local = await createLibrarySnapshot(
      {
        characters: [character('aria', '<aria />', 10)],
      },
      {
        tombstones: {
          characters: [{ id: 'bran', deletedAt: 20 }],
        },
      }
    );
    const remote = await createLibrarySnapshot({
      characters: [
        character('aria', '<aria />', 10),
        character('bran', '<bran />', 10),
      ],
    });

    const merged = await mergeLibrarySnapshots({
      baseline: await createLibraryManifest(baseline),
      local,
      remote,
      now: 30,
    });

    expect(merged.characters.map(({ id }) => id)).toEqual(['aria']);
    expect(merged.tombstones.characters).toEqual([
      { id: 'bran', deletedAt: 20 },
    ]);
  });

  it('chooses the newest true conflict and retains both full alternatives', async () => {
    const baseline = await createLibrarySnapshot({
      characters: [
        character('aria', '<old-aria />', 10),
        character('bran', '<old-bran />', 10),
      ],
    });
    const local = await createLibrarySnapshot({
      characters: [
        character('aria', '<local-aria />', 20),
        character('bran', '<local-bran />', 50),
      ],
    });
    const remote = await createLibrarySnapshot({
      characters: [
        character('aria', '<remote-aria />', 30),
        character('bran', '<remote-bran />', 40),
      ],
    });

    const merged = await mergeLibrarySnapshots({
      baseline: await createLibraryManifest(baseline),
      local,
      remote,
      now: 60,
      conflictLimit: 1,
    });

    expect(merged.characters).toEqual([
      character('aria', '<remote-aria />', 30),
      character('bran', '<local-bran />', 50),
    ]);
    expect(merged.conflicts).toHaveLength(1);
    const [conflict] = merged.conflicts;
    expect(conflict.alternatives.map((entry) => entry.record.xml)).toEqual(
      expect.arrayContaining([
        `<local-${conflict.key} />`,
        `<remote-${conflict.key} />`,
      ])
    );
    expect(merged.conflicts[0].winner.hash).toBe(
      merged.index.characters[conflict.key]
    );
  });

  it('records an edit-versus-delete conflict and honors the newer tombstone', async () => {
    const baseline = await createLibrarySnapshot({
      characters: [character('aria', '<old />', 10)],
    });
    const local = await createLibrarySnapshot({
      characters: [character('aria', '<edited />', 20)],
    });
    const remote = await createLibrarySnapshot(
      {},
      {
        tombstones: {
          characters: [{ id: 'aria', deletedAt: 30 }],
        },
      }
    );

    const merged = await mergeLibrarySnapshots({
      baseline: await createLibraryManifest(baseline),
      local,
      remote,
      now: 40,
    });

    expect(merged.characters).toEqual([]);
    expect(merged.tombstones.characters).toEqual([
      { id: 'aria', deletedAt: 30 },
    ]);
    expect(merged.conflicts[0].alternatives).toEqual([
      expect.objectContaining({
        side: 'local',
        kind: 'record',
        record: character('aria', '<edited />', 20),
      }),
      expect.objectContaining({
        side: 'remote',
        kind: 'deleted',
        tombstone: { id: 'aria', deletedAt: 30 },
      }),
    ]);
  });

  it('caps accumulated conflict history by default', async () => {
    const baseline = await createLibrarySnapshot({
      characters: Array.from(
        { length: DEFAULT_CONFLICT_HISTORY_LIMIT + 2 },
        (_, index) => character(`character-${index}`, '<old />', 1)
      ),
    });
    const local = await createLibrarySnapshot({
      characters: baseline.characters.map((record, index) =>
        character(record.id, `<local-${index} />`, 2)
      ),
    });
    const remote = await createLibrarySnapshot({
      characters: baseline.characters.map((record, index) =>
        character(record.id, `<remote-${index} />`, 3)
      ),
    });

    const merged = await mergeLibrarySnapshots({
      baseline: await createLibraryManifest(baseline),
      local,
      remote,
      now: 4,
    });

    expect(merged.conflicts).toHaveLength(DEFAULT_CONFLICT_HISTORY_LIMIT);
  });
});
