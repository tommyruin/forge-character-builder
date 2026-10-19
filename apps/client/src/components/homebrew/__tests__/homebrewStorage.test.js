// Saving, warning about and deleting a homebrew collection must all name the same stored file, and
// saving again must replace it: a stale copy from an earlier save would load beside the new one
// and, for the ids both define, win or lose by file-path order.

import { describe, expect, it, vi } from 'vitest';
import { createEngineApi } from '../../../transport/engineTransport.ts';
import { removeCollection, saveCollection, consolidateStrayCopies } from '../homebrewStorage.js';
import { createCollection, createElement, makeSourceId } from '../xmlBuilder.js';

function draftWithFeat(name = 'Moon Forge') {
  const draft = createCollection(name);
  const feat = createElement('Feat');
  feat.name = 'Moon Boon';
  draft.elements = [feat];
  return draft;
}

// A content store with IndexedDB's semantics: a record is keyed by its path, so writing the same
// path replaces it.
function harness() {
  const records = new Map();
  let clock = 1;
  const store = {
    listCharacters: vi.fn(async () => []),
    getCharacter: vi.fn(async () => undefined),
    putCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
    listContent: vi.fn(async () => [...records.values()].map((record) => ({ ...record }))),
    putContentBatch: vi.fn(async (next) => {
      for (const record of next) records.set(record.path, { ...record, uploadedAt: clock++ });
    }),
    deleteContentBatch: vi.fn(async (paths) => {
      const removed = [];
      for (const path of paths) {
        if (records.has(path)) removed.push(records.get(path));
        records.delete(path);
      }
      return removed;
    }),
    listContentSources: vi.fn(async () => []),
    replaceContentSource: vi.fn(async () => []),
    removeContentSource: vi.fn(async () => []),
    removeContentSources: vi.fn(async () => []),
    clearFastStartData: vi.fn(async () => undefined),
    getMeta: vi.fn(async () => []),
  };
  const live = new Map();
  const client = new Proxy({}, {
    get: (_target, method) => method === 'then' ? undefined : async (request) => {
      if (method === 'boot') {
        if (Array.isArray(request?.files)) {
          live.clear();
          for (const file of request.files) live.set(file.path, file.base64);
        }
        return { elementCount: live.size, sourceCount: 1, fileCount: live.size, typeCounts: {} };
      }
      if (method === 'patchHomebrew') {
        live.set(request.path, request.base64);
        return {
          elementCount: live.size,
          diagnostics: [{ kind: 'missing-grant', file: request.path, message: 'grants a missing element' }],
        };
      }
      if (method === 'removeUploaded') {
        for (const path of request.paths) live.delete(path);
        return { elementCount: live.size };
      }
      return { elementCount: live.size, sourceCount: 1, fileCount: live.size, typeCounts: {} };
    },
  });
  return { api: createEngineApi({ client, store }), records, live, store };
}

const homebrewPaths = (records) => [...records.keys()].filter((path) => path.startsWith('imports/'));

describe('saving a homebrew collection', () => {
  it('replaces the stored copy instead of adding another', async () => {
    const { api, records, live } = harness();
    const draft = draftWithFeat();
    await saveCollection(api, draft);
    await saveCollection(api, draft);
    await saveCollection(api, { ...draft, name: 'Moon Forge' });
    expect(homebrewPaths(records)).toHaveLength(1);
    expect([...live.keys()].filter((path) => path.startsWith('imports/'))).toHaveLength(1);
  });

  it('keeps the same stored file when the collection is renamed', async () => {
    const { api, records } = harness();
    const draft = draftWithFeat();
    await saveCollection(api, draft);
    const [before] = homebrewPaths(records);
    await saveCollection(api, { ...draft, slug: 'moon-forge-renamed' });
    expect(homebrewPaths(records)).toEqual([before]);
  });

  it('returns the engine warnings about the file it saved', async () => {
    const { api } = harness();
    const { diagnostics, warnings } = await saveCollection(api, draftWithFeat());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('missing-grant');
    // Advice about missing content does not stop the collection loading.
    expect(diagnostics).toEqual([]);
  });
});

describe('deleting a homebrew collection', () => {
  it('removes the stored copy that saving wrote', async () => {
    const { api, records } = harness();
    const draft = draftWithFeat();
    await saveCollection(api, draft);
    await removeCollection(api, draft);
    expect(homebrewPaths(records)).toEqual([]);
  });
});

describe('copies stored by earlier versions', () => {
  function seedStrays(records, draft) {
    const source = makeSourceId(draft);
    const body = (label) => btoa(`<elements><element name="${label}" type="Source" source="x" id="${source}"/></elements>`);
    records.set('imports/aaaa-1111/moon-forge.xml', { path: 'imports/aaaa-1111/moon-forge.xml', base64: body('first'), sourceId: 'aaaa-1111', uploadedAt: 1 });
    records.set('imports/zzzz-2222/moon-forge.xml', { path: 'imports/zzzz-2222/moon-forge.xml', base64: body('newest'), sourceId: 'zzzz-2222', uploadedAt: 3 });
    records.set('imports/mmmm-3333/moon-forge.xml', { path: 'imports/mmmm-3333/moon-forge.xml', base64: body('second'), sourceId: 'mmmm-3333', uploadedAt: 2 });
    records.set('imports/other/other.xml', { path: 'imports/other/other.xml', base64: btoa('<elements/>'), sourceId: 'other', uploadedAt: 1 });
  }

  it('are folded into one stored file holding the newest, leaving unrelated content alone', async () => {
    const { api, records } = harness();
    const draft = draftWithFeat();
    seedStrays(records, draft);
    await consolidateStrayCopies(api, [draft]);
    const mine = homebrewPaths(records).filter((path) => path !== 'imports/other/other.xml');
    expect(mine).toHaveLength(1);
    expect(atob(records.get(mine[0]).base64)).toContain('name="newest"');
    expect(records.has('imports/other/other.xml')).toBe(true);
  });

  it('are replaced by the next save', async () => {
    const { api, records } = harness();
    const draft = draftWithFeat();
    seedStrays(records, draft);
    await saveCollection(api, draft);
    expect(homebrewPaths(records).filter((path) => path !== 'imports/other/other.xml')).toHaveLength(1);
  });

  it('are removed along with the collection', async () => {
    const { api, records } = harness();
    const draft = draftWithFeat();
    seedStrays(records, draft);
    await removeCollection(api, draft);
    expect(homebrewPaths(records)).toEqual(['imports/other/other.xml']);
  });
});
