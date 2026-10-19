// @vitest-environment happy-dom
// Content › Manage files and the Homebrew page: a pack file added here opens as an editable pack
// (the rest of the selection stays ordinary content), and the file manager says what a pack asked
// it to find.
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { $, click, mount, settle } from '../custom/__tests__/harness';

const h = vi.hoisted(() => {
  const records = new Map();
  const store = {
    listHomebrew: vi.fn(async () => [...records.values()].map((record) => structuredClone(record))),
    getHomebrew: vi.fn(async (id) => structuredClone(records.get(id))),
    putHomebrew: vi.fn(async (record) => {
      records.set(record.id, structuredClone(record));
    }),
    listContent: vi.fn(async () => []),
    listContentSources: vi.fn(async () => []),
  };
  const api = {
    content: {
      status: vi.fn(async () => ({ elementCount: 3, elementTypes: { Feat: 3 } })),
      sources: vi.fn(async () => []),
      elements: vi.fn(async () => ({ items: [], total: 0, typeCounts: { Feat: 3 } })),
      element: vi.fn(async () => null),
      upload: vi.fn(async (files) => ({ status: 'succeeded', files: files.map(() => ({ accepted: true })), elementCountAfterReload: 4, diagnostics: [] })),
      consolidateHomebrew: vi.fn(async () => ({ removed: 0 })),
      clearCache: vi.fn(),
      getLoadState: vi.fn(() => ({ active: false, percentage: null, message: 'ready', error: null })),
      onLoadProgress: vi.fn(() => () => {}),
    },
    characters: {},
  };
  return { records, store, api };
});

vi.mock('../../api', () => ({ api: h.api }));
vi.mock('../../transport/localStore', () => ({ localStore: h.store }));
vi.mock('../../cloud/driveSyncService', () => ({ driveSyncService: { subscribe: () => () => {}, getSnapshot: () => ({}) } }));
vi.mock('../DescriptionPanel', () => ({ default: () => null }));
vi.mock('../LocalPerformanceCacheControl', () => ({ default: () => null }));

const { default: ContentManager } = await import('../ContentManager.jsx');
const { buildPackFile } = await import('../homebrew/packFile.js');
const { buildCollectionXml, createCollection } = await import('../homebrew/xmlBuilder.js');
const { elementForDraft } = await import('../homebrew/packModel.js');
const { createCustomDraft } = await import('@forge-cb/engine/custom');

const shared = () => ({
  ...createCollection('Moon World'),
  id: 'shared-1',
  version: 1000,
  elements: [elementForDraft(createCustomDraft('boon', 'Tide Gift'), { name: 'Moon World' })],
});

const openDrawer = async (props = {}) => {
  await mount(<ContentManager active onLibraryChanged={vi.fn(async () => {})} {...props} />);
  await settle();
  await click($('[data-testid="cm-manage-files"]'));
  await settle();
};

beforeEach(() => {
  h.records.clear();
  for (const fn of [...Object.values(h.store), ...Object.values(h.api.content)]) fn.mockClear?.();
  h.api.content.element.mockImplementation(async () => null);
});

describe('a pack file added under Manage files', () => {
  it('opens as an editable pack, while the other files in the selection are uploaded as content', async () => {
    const onLibraryChanged = vi.fn(async () => {});
    await openDrawer({ onLibraryChanged });
    const input = $('input[type="file"][aria-label="Choose XML or index files"]');
    const pack = new File([buildPackFile(shared())], 'moon.pack.xml');
    const plain = new File([buildCollectionXml(createCollection('Plain'))], 'plain.xml');
    Object.defineProperty(input, 'files', { value: [pack, plain], configurable: true });
    await act(async () => {
      input.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(h.records.get('shared-1')).toMatchObject({ name: 'Moon World', version: 1000 });
    expect(h.records.get('shared-1').elements[0].customDraft).toBeTruthy();
    // The pack went to its own stable path; the plain file went up as ordinary content.
    const uploads = h.api.content.upload.mock.calls.map(([files]) => files.map((file) => file.name ?? file.fileName));
    expect(uploads.flat()).toContain('collection.xml');
    expect(uploads.flat()).toContain('plain.xml');
    expect($('[data-testid="hb-import-done"]').textContent).toContain('Imported Moon World');
  });

  it('asks before replacing a pack already on the device', async () => {
    h.records.set('shared-1', { ...shared(), version: 10 });
    await openDrawer();
    const input = $('input[type="file"][aria-label="Choose XML or index files"]');
    Object.defineProperty(input, 'files', { value: [new File([buildPackFile(shared())], 'moon.pack.xml')], configurable: true });
    await act(async () => {
      input.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect($('[data-testid="hb-import-confirm"]').textContent).toContain('newer copy');
    await click($('[data-testid="hb-import-apply"]'));
    await settle();
    expect(h.records.get('shared-1').version).toBe(1000);
  });
});

describe('what a pack asked Manage files to find', () => {
  const need = { label: 'ID_OTHER_FEAT_ROOT', type: 'Feat', neededBy: 'Moonwell Pact' };

  it('opens the file manager and names the id and who needs it', async () => {
    await mount(<ContentManager active importNeed={need} onDismissNeed={vi.fn()} />);
    await settle();
    const note = $('[data-testid="cm-import-need"]');
    expect(note.textContent).toContain('Moonwell Pact needs');
    expect($('[data-testid="cm-import-need-label"]').textContent).toBe('ID_OTHER_FEAT_ROOT');
  });

  it('clears itself once the library defines the id', async () => {
    h.api.content.element.mockImplementation(async (id) => (id === need.label ? { id } : null));
    const onDismissNeed = vi.fn();
    await mount(<ContentManager active importNeed={need} onDismissNeed={onDismissNeed} />);
    await settle();
    expect(onDismissNeed).toHaveBeenCalled();
  });
});
