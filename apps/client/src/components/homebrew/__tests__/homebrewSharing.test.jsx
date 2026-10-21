// @vitest-environment happy-dom
// Sharing, promotion and the character's own entries on the Homebrew page, as the author uses them:
// edit an entry made on the character, add it to a world pack with what it refers to, share the
// pack as one file, add a shared file back (new, then a newer copy), point at the file a missing
// grant needs, and reach the XML tools under Advanced.
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { $, $$, buttonByText, byLabel, choose, click, mount, settle, type } from '../../custom/__tests__/harness';

const h = vi.hoisted(() => {
  const records = new Map();
  const store = {
    listHomebrew: vi.fn(async () => [...records.values()].map((record) => structuredClone(record))),
    getHomebrew: vi.fn(async (id) => structuredClone(records.get(id))),
    putHomebrew: vi.fn(async (record) => {
      records.set(record.id, structuredClone(record));
    }),
    deleteHomebrew: vi.fn(async (id) => {
      records.delete(id);
    }),
  };
  const api = {
    content: {
      elements: vi.fn(async () => ({ items: [] })),
      element: vi.fn(async () => null),
      elementSource: vi.fn(async () => null),
      checkPack: vi.fn(async () => []),
      packChoiceImpact: vi.fn(async () => ({ changes: [], hasPicks: false })),
      upload: vi.fn(async () => ({ elementCountAfterReload: 3, diagnostics: [], files: [{ accepted: true }] })),
      consolidateHomebrew: vi.fn(async () => ({ removed: 0 })),
      remove: vi.fn(async () => ({})),
      clearCache: vi.fn(),
    },
    characters: {
      customContent: vi.fn(async () => ({ entries: [], problems: [] })),
      promoteCustomDraft: vi.fn(),
      saveCustomDraft: vi.fn(async (_id, draft) => ({ entry: { kind: 'feature', draft, elementId: draft.id } })),
      deleteCustomDraft: vi.fn(),
      choiceIdentityImpact: vi.fn(async () => ({ changes: [], hasPicks: false })),
      get: vi.fn(async () => ({ rulesetMode: '2014' })),
    },
  };
  return { records, store, api };
});

vi.mock('../../../api', () => ({ api: h.api }));
vi.mock('../../../transport/localStore', () => ({ localStore: h.store }));

const { default: HomebrewEditor } = await import('../HomebrewEditor.jsx');
const { createCollection } = await import('../xmlBuilder.js');
const { buildPackFile, packVersion } = await import('../packFile.js');
const { elementForDraft, overrideElement, rawElement } = await import('../packModel.js');
const { createCustomDraft, createCustomItemDraft, newCustomBlockId } = await import('@forge-cb/engine/custom');

const wait = (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

const gift = { ...createCustomDraft('boon', 'Tide Gift'), description: 'The tide answers.' };
const wand = {
  ...createCustomItemDraft('worn', 'Tide Wand'),
  slot: 'misc',
  blocks: [{ kind: 'grant', id: newCustomBlockId(), target: { by: 'id', type: 'Custom Feature', id: gift.id, label: 'Tide Gift' } }],
};
const entryOf = (draft, kind) => ({ kind, draft, elementId: draft.id, type: 'Custom Feature', section: 'other', granted: true, installed: true });

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

let downloads;

beforeEach(() => {
  h.records.clear();
  for (const fn of [...Object.values(h.store), ...Object.values(h.api.content), ...Object.values(h.api.characters)]) fn.mockClear?.();
  h.api.content.checkPack.mockImplementation(async () => []);
  h.api.characters.customContent.mockImplementation(async () => ({ entries: [], problems: [] }));
  downloads = [];
  URL.createObjectURL = vi.fn((blob) => {
    downloads.push(blob);
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  window.HTMLAnchorElement.prototype.click = vi.fn();
});

async function openCharacterPack(props = {}) {
  await mount(<HomebrewEditor characterId="Ilyana" {...props} />);
  await settle();
  await choose(byLabel('Pack'), 'character:Ilyana');
  await settle();
}

async function openPack(record, props = {}) {
  h.records.set(record.id, record);
  await mount(<HomebrewEditor {...props} />);
  await settle();
  await choose(byLabel('Pack'), record.id);
  await settle();
}

const withCharacterEntries = (...entries) => h.api.characters.customContent.mockImplementation(async () => ({ entries, problems: [] }));

describe("editing the open character's own entries", () => {
  it('opens the entry in its form, saves through the character call and tells the workspace', async () => {
    withCharacterEntries(entryOf(gift, 'feature'));
    const onCharacterChanged = vi.fn();
    await openCharacterPack({ onCharacterChanged });
    await click(byLabel('Edit Tide Gift'));
    expect(byLabel('Name').value).toBe('Tide Gift');
    await type(byLabel('Name'), 'Tide Gift, Greater');
    await click(buttonByText('Save changes'));
    await settle();
    expect(h.api.characters.saveCustomDraft).toHaveBeenCalledWith('Ilyana', expect.objectContaining({ id: gift.id, name: 'Tide Gift, Greater' }), undefined);
    expect(onCharacterChanged).toHaveBeenCalled();
    // The list was read again after the save.
    expect(h.api.characters.customContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('opens an item in the item form', async () => {
    withCharacterEntries({ ...entryOf(wand, 'item'), type: 'Magic Item' });
    await openCharacterPack();
    await click(byLabel('Edit Tide Wand'));
    expect($('[role="dialog"]').getAttribute('aria-label')).toBe('Edit custom item');
  });
});

describe('copying a character entry to a pack', () => {
  it('offers the elements it refers to, creates the pack with a name and author, and keeps the ids', async () => {
    withCharacterEntries({ ...entryOf(wand, 'item'), type: 'Magic Item' }, entryOf(gift, 'feature'));
    await openCharacterPack();
    await click(byLabel('Copy Tide Wand to a pack'));
    const items = $$('[data-testid="hb-promote-items"] li').map((row) => row.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Tide Wand');
    expect(items[1]).toContain('Tide Gift');
    expect(items[1]).toContain('Used by Tide Wand');
    await type(byLabel('Pack name'), 'Moon World');
    await type(byLabel('Author'), 'Dana');
    await click($('[data-testid="hb-promote-confirm"]'));
    await settle();
    const made = [...h.records.values()].find((record) => record.name === 'Moon World');
    expect(made).toMatchObject({ author: 'Dana', world: true });
    expect(made.elements.map((element) => element.id).sort()).toEqual([gift.id, wand.id].sort());
    expect(made.elements.every((element) => element.customDraft && element.rawXml.includes('source="Moon World"'))).toBe(true);
    const toast = $('.fcb-toast-stack .fcb-toast');
    expect(toast.textContent).toContain('now in Moon World');
    expect(toast.textContent).not.toMatch(/\bids?\b/);
  });

  it('adds only the entry when the author leaves the linked one out', async () => {
    withCharacterEntries({ ...entryOf(wand, 'item'), type: 'Magic Item' }, entryOf(gift, 'feature'));
    h.records.set('pack-1', pack);
    await openCharacterPack();
    await click(byLabel('Copy Tide Wand to a pack'));
    await choose($('[data-testid="hb-promote-pack"]'), 'pack-1');
    await click(byLabel('Copy Tide Gift'));
    await click($('[data-testid="hb-promote-confirm"]'));
    await settle();
    expect(h.records.get('pack-1').elements.map((element) => element.id)).toEqual([wand.id]);
  });
});

describe('copying a pack element to another pack', () => {
  it('copies it with its id and leaves the open pack as it was', async () => {
    const source = { ...pack, elements: [{ ...elementForDraft(gift, pack) }] };
    h.records.set('pack-2', { ...createCollection('Other Pack'), id: 'pack-2' });
    await openPack(source);
    await click($$('.fcb-homebrew-element-row button.fcb-homebrew-nav-row')[0]);
    await click($('[data-testid="hb-copy-to-pack"]'));
    const destinations = $$('[data-testid="hb-promote-pack"] option').map((option) => option.textContent);
    expect(destinations.some((label) => label.startsWith('Moonwell Campaign'))).toBe(false);
    await choose($('[data-testid="hb-promote-pack"]'), 'pack-2');
    await click($('[data-testid="hb-promote-confirm"]'));
    await settle();
    expect(h.records.get('pack-2').elements.map((element) => element.id)).toEqual([gift.id]);
    expect(h.records.get('pack-2').elements[0].rawXml).toContain('source="Other Pack"');
    expect(h.records.get('pack-1').elements).toHaveLength(1);
  });
});

describe('sharing a pack as one file', () => {
  it('saves the pack with its drafts, and refuses a pack that does not validate', async () => {
    await openPack({ ...pack, elements: [elementForDraft(gift, pack)] });
    await click($('[data-testid="hb-share-pack"]'));
    await settle();
    expect(downloads).toHaveLength(1);
    const text = await downloads[0].text();
    expect(text).toContain('urn:forge-cb:pack:1');
    expect(text).toContain(`id="${gift.id}"`);
    const toast = $('.fcb-toast-stack .fcb-toast');
    const shared = toast.querySelector('.fcb-toast-message').textContent;
    // Plain words: what was saved, under which file name, and what the other person does with it.
    expect(shared).toBe(
      'Moonwell Campaign was saved as moonwell-campaign.pack.xml. Send that file to anyone who should have the pack: they add it under Homebrew › Import pack or Content › Manage files, and can edit it just as you do.',
    );
    expect(shared).not.toMatch(/\bids?\b|drafts?|XML/);
    // It holds a file name the reader needs, so it stays until dismissed.
    expect(toast.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
    // A toast, not a line in the page: sharing never moves the layout.
    expect($('[data-testid="hb-share-notice"]')).toBeNull();
  });

  it('does not share a pack with a blocking problem', async () => {
    await openPack({ ...pack, name: '   ', slug: '', elements: [] });
    await click($('[data-testid="hb-share-pack"]'));
    await settle();
    expect(downloads).toHaveLength(0);
    expect($('[data-testid="hb-ingest-result"]').textContent).toContain('Pack name is required');
  });
});

describe('adding a shared pack file', () => {
  const fileFor = (record, name = 'moon.pack.xml') => new File([buildPackFile(record)], name, { type: 'application/xml' });
  const choosePackFile = async (file) => {
    const input = $('[data-testid="hb-import-input"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();
  };
  const shared = () => ({ ...createCollection('Moon World'), id: 'shared-1', author: 'Dana', version: 1000, elements: [elementForDraft(gift, { name: 'Moon World' })] });

  it('imports a pack this device does not have, editable and loaded', async () => {
    const onLibraryChanged = vi.fn(async () => {});
    await mount(<HomebrewEditor onLibraryChanged={onLibraryChanged} />);
    await settle();
    await choosePackFile(fileFor(shared()));
    const stored = h.records.get('shared-1');
    expect(stored).toMatchObject({ name: 'Moon World', author: 'Dana', version: 1000 });
    expect(stored.elements[0].customDraft.id).toBe(gift.id);
    expect(stored.ingestedAt).toBeGreaterThan(0);
    expect(h.api.content.upload).toHaveBeenCalled();
    expect(onLibraryChanged).toHaveBeenCalledWith(expect.objectContaining({ source: 'homebrew' }));
    expect($('[data-testid="hb-import-done"]').textContent).toContain('Imported Moon World');
    expect($$('[data-testid="hb-pack-select"] option').map((option) => option.textContent)).toContain('Moon World (1)');
  });

  it('asks before replacing a pack with a newer copy of it, naming what goes', async () => {
    h.records.set('shared-1', { ...shared(), ingestedAt: 5, elements: [...shared().elements, elementForDraft({ ...createCustomDraft('boon', 'Old Boon') }, { name: 'Moon World' })] });
    await mount(<HomebrewEditor />);
    await settle();
    await choosePackFile(fileFor({ ...shared(), version: 2000 }));
    const confirm = $('[data-testid="hb-import-confirm"]');
    expect(confirm.textContent).toContain('newer copy');
    expect(confirm.textContent).toContain('Removes: Old Boon');
    expect(h.records.get('shared-1').elements).toHaveLength(2);
    await click($('[data-testid="hb-import-apply"]'));
    await settle();
    expect(h.records.get('shared-1').elements).toHaveLength(1);
    expect(packVersion(h.records.get('shared-1'))).toBe(2000);
    expect($('[data-testid="hb-import-done"]').textContent).toContain('Updated Moon World');
  });

  it('keeps the copy on this device when the author says so', async () => {
    h.records.set('shared-1', { ...shared(), version: 5000 });
    await mount(<HomebrewEditor />);
    await settle();
    await choosePackFile(fileFor(shared()));
    expect($('[data-testid="hb-import-confirm"]').textContent).toContain('older copy');
    await click(buttonByText('Keep my copy'));
    expect($('[data-testid="hb-import-confirm"]')).toBeNull();
    expect(packVersion(h.records.get('shared-1'))).toBe(5000);
  });

  it('shows the file\'s copy in the editor when the open pack was the one replaced', async () => {
    h.records.set('shared-1', { ...shared(), ingestedAt: 5 });
    await mount(<HomebrewEditor />);
    await settle();
    await choose(byLabel('Pack'), 'shared-1');
    await settle();
    await choosePackFile(fileFor({ ...shared(), version: 2000, description: 'Newer words.' }));
    await click($('[data-testid="hb-import-apply"]'));
    await settle();
    await wait(800);
    expect($('[data-testid="hb-pack-details"] textarea').value).toBe('Newer words.');
    expect(h.records.get('shared-1').description).toBe('Newer words.');
  });

  it('says a plain content file is not a pack file', async () => {
    await mount(<HomebrewEditor />);
    await settle();
    await choosePackFile(new File(['<elements></elements>'], 'plain.xml'));
    expect($('.fcb-toast-stack .fcb-toast').textContent).toContain('plain content file');
    expect(h.records.size).toBe(0);
  });
});

describe('pack health: Find a source', () => {
  it('sends the author to Content › Manage files with the id that is missing', async () => {
    const pact = elementForDraft(
      {
        schemaVersion: 1,
        id: 'ID_CUSTOM_PACTTEST0001',
        template: 'boon',
        name: 'Moonwell Pact',
        showsUnder: 'other',
        description: '',
        blocks: [{ kind: 'grant', id: 'g1', target: { by: 'id', type: 'Feat', id: 'ID_OTHER_FEAT_ROOT', label: 'Root' } }],
      },
      pack,
    );
    h.api.content.checkPack.mockImplementation(async () => [
      { kind: 'missing-grant', message: 'Moonwell Pact grants Root.', elementId: pact.id, elementName: 'Moonwell Pact', missingId: 'ID_OTHER_FEAT_ROOT', missingType: 'Feat' },
    ]);
    const onOpenContent = vi.fn();
    await openPack({ ...pack, elements: [pact] }, { onOpenContent });
    await wait(800);
    await click($('[data-testid="hb-find-source"]'));
    expect(onOpenContent).toHaveBeenCalledWith({ missing: { label: 'ID_OTHER_FEAT_ROOT', type: 'Feat', neededBy: 'Moonwell Pact' } });
  });
});

describe('XML under More pack tools', () => {
  it('keeps an XML element and Manage files together, inside the editor, without repeating the pack bar', async () => {
    const onOpenContent = vi.fn();
    await openPack({ ...pack, elements: [] }, { onOpenContent });
    const tools = $('[data-testid="hb-pack-tools"]');
    expect($('[data-testid="hb-main-editor"]').contains(tools)).toBe(true);
    expect(tools.textContent).not.toContain('Import');
    expect(tools.textContent).not.toContain('Download');
    await click($('[data-testid="hb-pack-tools-manage-files"]'));
    expect(onOpenContent).toHaveBeenCalledWith();
    await click($('[data-testid="hb-pack-tools-raw"]'));
    expect($('[data-testid="hb-raw-step"]')).not.toBeNull();
  });

  it('edits the XML of a change to a book element, and the edit is what the pack holds', async () => {
    const source = { id: 'ID_PHB_SPELL_FIREBALL', type: 'Spell', name: 'Fireball', xml: '<element name="Fireball" type="Spell" source="Player\'s Handbook" id="ID_PHB_SPELL_FIREBALL"><description><p>Boom.</p></description></element>' };
    const changed = overrideElement(source, pack);
    await openPack({ ...pack, elements: [changed] });
    await click($$('.fcb-homebrew-element-row button.fcb-homebrew-nav-row')[0]);
    await click($('[data-testid="hb-element-advanced"] summary'));
    await click(buttonByText('Edit raw XML'));
    await click(buttonByText('Edit as XML'));
    const box = $('[data-testid="hb-raw-xml"]');
    expect(box.value).toContain('id="ID_PHB_SPELL_FIREBALL"');
    await type(box, box.value.replace('Boom.', 'A bigger boom.'));
    await wait(800);
    const stored = h.records.get('pack-1').elements[0];
    expect(stored.customDraft).toBeUndefined();
    expect(stored.rawXml).toContain('A bigger boom.');
    expect(stored.id).toBe('ID_PHB_SPELL_FIREBALL');
  });

  it('edits an element written as XML in place', async () => {
    const raw = rawElement({ type: 'Race Variant', name: 'Tidal', pack });
    await openPack({ ...pack, elements: [raw] });
    await click($$('.fcb-homebrew-element-row button.fcb-homebrew-nav-row')[0]);
    const box = $('[data-testid="hb-raw-xml"]');
    await type(box, box.value.replace('<p></p>', '<p>Salt in the hair.</p>'));
    await wait(800);
    expect(h.records.get('pack-1').elements[0].rawXml).toContain('Salt in the hair.');
  });
});
