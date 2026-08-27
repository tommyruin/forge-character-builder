import { describe, expect, it, vi } from 'vitest';
import { createLibrarySnapshot } from '../librarySnapshot.js';
import { createLibraryStore } from '../libraryStore.js';

function fakeLocalStore(initial = {}) {
  const state = {
    characters: structuredClone(initial.characters ?? []),
    content: structuredClone(initial.content ?? []),
    contentSources: structuredClone(initial.contentSources ?? []),
    homebrew: structuredClone(initial.homebrew ?? []),
  };
  const calls = [];
  const store = {
    listCharacters: vi.fn(async () => structuredClone(state.characters)),
    listContent: vi.fn(async () => structuredClone(state.content)),
    listContentSources: vi.fn(async () =>
      structuredClone(state.contentSources)
    ),
    listHomebrew: vi.fn(async () => structuredClone(state.homebrew)),
    putCharacter: vi.fn(async (record) => {
      calls.push(`character:put:${record.id}`);
      state.characters = [
        ...state.characters.filter(({ id }) => id !== record.id),
        structuredClone(record),
      ];
    }),
    deleteCharacter: vi.fn(async (id) => {
      calls.push(`character:delete:${id}`);
      state.characters = state.characters.filter((record) => record.id !== id);
    }),
    putContent: vi.fn(async (path, base64) => {
      calls.push(`content:put:${path}`);
      state.content = [
        ...state.content.filter((record) => record.path !== path),
        { path, base64 },
      ];
    }),
    deleteContent: vi.fn(async (path) => {
      calls.push(`content:delete:${path}`);
      state.content = state.content.filter((record) => record.path !== path);
    }),
    replaceContentSource: vi.fn(async (source, records) => {
      calls.push(`source:replace:${source.id}`);
      state.contentSources = [
        ...state.contentSources.filter(({ id }) => id !== source.id),
        structuredClone(source),
      ];
      state.content = [
        ...state.content.filter(({ sourceId }) => sourceId !== source.id),
        ...structuredClone(records).map((record) => ({
          ...record,
          sourceId: source.id,
        })),
      ];
    }),
    removeContentSource: vi.fn(async (id) => {
      calls.push(`source:delete:${id}`);
      state.contentSources = state.contentSources.filter(
        (source) => source.id !== id
      );
      state.content = state.content.filter(
        (record) => record.sourceId !== id
      );
    }),
    putHomebrew: vi.fn(async (record) => {
      calls.push(`homebrew:put:${record.id}`);
      state.homebrew = [
        ...state.homebrew.filter(({ id }) => id !== record.id),
        structuredClone(record),
      ];
    }),
    deleteHomebrew: vi.fn(async (id) => {
      calls.push(`homebrew:delete:${id}`);
      state.homebrew = state.homebrew.filter((record) => record.id !== id);
    }),
    getMeta: vi.fn(() => {
      throw new Error('meta is device-local');
    }),
    listMaps: vi.fn(() => {
      throw new Error('maps are outside the character library');
    }),
    listTokens: vi.fn(() => {
      throw new Error('tokens are outside the character library');
    }),
  };
  return { calls, state, store };
}

describe('libraryStore', () => {
  it('reads only characters, content, source metadata, and homebrew', async () => {
    const fixture = fakeLocalStore({
      characters: [
        {
          id: 'aria',
          xml: '<aria />',
          summary: { id: 'aria', name: 'Aria' },
          updatedAt: 10,
        },
      ],
      content: [
        {
          path: 'imports/source-a/rules.xml',
          base64: 'cnVsZXM=',
          sourceId: 'source-a',
          uploadedAt: 11,
        },
      ],
      contentSources: [
        {
          id: 'source-a',
          kind: 'folder',
          label: 'Rules',
          fileCount: 1,
        },
      ],
      homebrew: [{ id: 'draft', name: 'Draft', updatedAt: 12 }],
    });
    const library = createLibraryStore(fixture.store, { clock: () => 20 });

    const snapshot = await library.readSnapshot();

    expect(snapshot.characters).toHaveLength(1);
    expect(snapshot.content.files).toHaveLength(1);
    expect(snapshot.content.sources).toHaveLength(1);
    expect(snapshot.homebrew).toHaveLength(1);
    expect(fixture.store.getMeta).not.toHaveBeenCalled();
    expect(fixture.store.listMaps).not.toHaveBeenCalled();
    expect(fixture.store.listTokens).not.toHaveBeenCalled();
  });

  it('infers durable tombstones when baseline records disappeared locally', async () => {
    const fixture = fakeLocalStore();
    const library = createLibraryStore(fixture.store, { clock: () => 50 });
    const baseline = await createLibrarySnapshot({
      characters: [
        {
          id: 'removed',
          xml: '<removed />',
          summary: null,
          updatedAt: 10,
        },
      ],
      content: [
        {
          path: 'homebrew/removed.xml',
          base64: 'cmVtb3ZlZA==',
          uploadedAt: 10,
        },
      ],
      contentSources: [
        { id: 'removed-source', label: 'Removed', kind: 'folder' },
      ],
      homebrew: [{ id: 'removed-draft', updatedAt: 10 }],
    });

    const snapshot = await library.readSnapshot({ baseline });

    expect(snapshot.tombstones).toEqual({
      characters: [{ id: 'removed', deletedAt: 50 }],
      content: [{ path: 'homebrew/removed.xml', deletedAt: 50 }],
      contentSources: [{ id: 'removed-source', deletedAt: 50 }],
      homebrew: [{ id: 'removed-draft', deletedAt: 50 }],
    });
  });

  it('applies content before characters and never writes unrelated data', async () => {
    const fixture = fakeLocalStore({
      characters: [
        {
          id: 'old-character',
          xml: '<old />',
          summary: null,
          updatedAt: 1,
        },
      ],
      content: [
        {
          path: 'homebrew/old.xml',
          base64: 'b2xk',
          uploadedAt: 1,
        },
      ],
      homebrew: [{ id: 'old-draft', updatedAt: 1 }],
    });
    const library = createLibraryStore(fixture.store, { clock: () => 100 });
    const snapshot = await createLibrarySnapshot(
      {
        characters: [
          {
            id: 'new-character',
            xml: '<new />',
            summary: { id: 'new-character', name: 'New' },
            updatedAt: 20,
          },
        ],
        content: [
          {
            path: 'imports/source-a/rules.xml',
            base64: 'cnVsZXM=',
            relativePath: 'rules.xml',
            sourceId: 'source-a',
            uploadedAt: 20,
          },
          {
            path: 'homebrew/new.xml',
            base64: 'bmV3',
            uploadedAt: 20,
          },
        ],
        contentSources: [
          {
            id: 'source-a',
            kind: 'folder',
            label: 'Rules',
            fileCount: 1,
          },
        ],
        homebrew: [{ id: 'new-draft', name: 'New', updatedAt: 20 }],
      },
      {
        generatedAt: 20,
        tombstones: {
          characters: [{ id: 'old-character', deletedAt: 20 }],
          content: [{ path: 'homebrew/old.xml', deletedAt: 20 }],
          homebrew: [{ id: 'old-draft', deletedAt: 20 }],
        },
      }
    );

    const result = await library.applySnapshot(snapshot);

    expect(result).toMatchObject({
      characters: { put: 1, deleted: 1 },
      content: { put: 2, deleted: 1 },
      contentSources: { replaced: 1, deleted: 0 },
      homebrew: { put: 1, deleted: 1 },
    });
    expect(fixture.calls.indexOf('source:replace:source-a')).toBeLessThan(
      fixture.calls.indexOf('character:put:new-character')
    );
    expect(fixture.calls.indexOf('content:put:homebrew/new.xml')).toBeLessThan(
      fixture.calls.indexOf('character:put:new-character')
    );
    expect(fixture.store.putContent).toHaveBeenCalledTimes(1);
    expect(fixture.store.putContent).toHaveBeenCalledWith(
      'homebrew/new.xml',
      'bmV3'
    );
    expect(fixture.store.getMeta).not.toHaveBeenCalled();
    expect(fixture.store.listMaps).not.toHaveBeenCalled();
    expect(fixture.store.listTokens).not.toHaveBeenCalled();
  });

  it('does not rewrite records whose content hash is already current', async () => {
    const current = {
      characters: [
        {
          id: 'aria',
          xml: '<aria />',
          summary: { id: 'aria', name: 'Aria' },
          updatedAt: 100,
        },
      ],
      content: [
        {
          path: 'homebrew/aria.xml',
          base64: 'YXJpYQ==',
          uploadedAt: 100,
        },
      ],
      homebrew: [{ id: 'aria-draft', name: 'Aria', updatedAt: 100 }],
    };
    const fixture = fakeLocalStore(current);
    const library = createLibraryStore(fixture.store);
    const snapshot = await createLibrarySnapshot({
      characters: current.characters.map((record) => ({
        ...record,
        updatedAt: 10,
      })),
      content: current.content.map((record) => ({
        ...record,
        uploadedAt: 10,
      })),
      homebrew: current.homebrew.map((record) => ({
        ...record,
        updatedAt: 10,
      })),
    });

    const result = await library.applySnapshot(snapshot);

    expect(result.characters.put).toBe(0);
    expect(result.content.put).toBe(0);
    expect(result.homebrew.put).toBe(0);
    expect(fixture.store.putCharacter).not.toHaveBeenCalled();
    expect(fixture.store.putContent).not.toHaveBeenCalled();
    expect(fixture.store.putHomebrew).not.toHaveBeenCalled();
  });
});
