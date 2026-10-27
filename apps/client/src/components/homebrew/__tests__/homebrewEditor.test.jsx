// @vitest-environment happy-dom
// The Homebrew pack editor as the author uses it: the template picker, an old collection opening
// without losing anything, the pack health card and its fixes, and the warning before a choice that
// characters have picked under is changed.
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { $, $$, buttonByText, byLabel, choose, click, mount, settle, type, unmountAll } from '../../custom/__tests__/harness';

const h = vi.hoisted(() => {
  const records = new Map();
  const store = {
    listHomebrew: vi.fn(async () => [...records.values()]),
    getHomebrew: vi.fn(async (id) => records.get(id)),
    putHomebrew: vi.fn(async (record) => {
      records.set(record.id, record);
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
    },
  };
  return { records, store, api };
});

vi.mock('../../../api', () => ({ api: h.api }));
vi.mock('../../../transport/localStore', () => ({ localStore: h.store }));

const { default: HomebrewEditor } = await import('../HomebrewEditor.jsx');
const { default: NewElementDialog } = await import('../NewElementDialog.jsx');
const { buildCollectionXml, createCollection } = await import('../xmlBuilder.js');
const { elementForDraft, rawElement, appendElement } = await import('../packModel.js');
const { createCustomClassDraft } = await import('@forge-cb/engine/custom');

const wait = (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

// A collection saved before packs: no schema version, no author, a structured element.
const OLD_COLLECTION = {
  id: 'old-1',
  name: 'Old Stuff',
  slug: 'old-stuff',
  abbreviation: 'OS',
  description: 'From before.',
  ruleset: 'shared',
  slugTouched: true,
  abbrTouched: true,
  ingestedAt: 1700000000000,
  elements: [
    {
      localId: 'e1',
      type: 'Feat',
      name: 'Old Feat',
      description: 'Plain text.',
      sheetText: '',
      prerequisite: '',
      requirements: '',
      requirementRows: [],
      supports: ['General'],
      ruleset: 'inherit',
      setters: {},
      stats: [{ name: 'strength', value: '+1' }],
      grants: [],
      rawXml: null,
      id: 'ID_HB_OLD_STUFF_FEAT_OLD_FEAT',
      idLocked: true,
    },
  ],
};

beforeEach(() => {
  h.records.clear();
  for (const fn of [...Object.values(h.store), ...Object.values(h.api.content), ...Object.values(h.api.characters)]) fn.mockClear?.();
  h.api.content.checkPack.mockImplementation(async () => []);
  h.api.content.packChoiceImpact.mockImplementation(async () => ({ changes: [], hasPicks: false }));
  h.api.characters.customContent.mockImplementation(async () => ({ entries: [], problems: [] }));
});

async function openPack(record, props = {}) {
  h.records.set(record.id, record);
  await mount(<HomebrewEditor {...props} />);
  await settle();
  await choose(byLabel('Pack'), record.id);
  await settle();
}

const elementRow = (name) => $$('.fcb-homebrew-element-row button.fcb-homebrew-nav-row').find((button) => button.textContent.includes(name));

describe('the New element template picker', () => {
  async function pick(templateId, extra = {}) {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    await mount(<NewElementDialog pack={pack} api={h.api} onClose={onClose} onCreate={onCreate} {...extra} />);
    await click($(`[data-testid="hb-template-${templateId}"]`));
    return { onCreate, onClose };
  }

  it('keeps Back or Cancel on the left and the one forward action on the right, in every step', async () => {
    const { onCreate } = await pick('feature');
    const footer = () => $('.fcb-dialog-footer');
    const order = () => [...footer().querySelectorAll('button')].map((button) => button.textContent.trim());
    expect(order()).toEqual(['Cancel', 'Add element']);
    expect(footer().querySelector('button').className).toContain('mr-auto');

    // A template that needs more asks for it first, so the forward action says Next.
    await click($('[data-testid="hb-template-subclass"]'));
    expect(order()).toEqual(['Cancel', 'Next']);
    await click($('[data-testid="hb-template-create"]'));
    expect(order()).toEqual(['Back']);
    expect(footer().querySelector('button').className).toContain('mr-auto');

    await click(buttonByText('Back'));
    await click($('[data-testid="hb-template-raw"]'));
    await click($('[data-testid="hb-template-create"]'));
    expect(order()).toEqual(['Back', 'Add element']);

    // The spell and item templates are a step of this same dialog, not a second one.
    for (const [templateId, add] of [['spell', 'Add spell'], ['wondrous', 'Add item']]) {
      await click(buttonByText('Back'));
      await click($(`[data-testid="hb-template-${templateId}"]`));
      await click($('[data-testid="hb-template-create"]'));
      expect($$('[role="dialog"]')).toHaveLength(1);
      expect($('[role="dialog"]').getAttribute('aria-label')).toBe('New element in Moonwell Campaign');
      expect(order()).toEqual(['Back', add]);
      expect(footer().querySelector('button').className).toContain('mr-auto');
    }
    await click(buttonByText('Back'));
    expect($('[data-testid="hb-new-element"]')).not.toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('says what a template does in plain words, and asks for a book entry by that name', async () => {
    await mount(<NewElementDialog pack={pack} api={h.api} onClose={() => {}} onCreate={() => {}} />);
    const intro = $('[data-testid="hb-new-element"] p').textContent;
    expect(intro).not.toMatch(/pickers|blocks|\btags?\b/);
    await click($('[data-testid="hb-template-reflavour"]'));
    await click($('[data-testid="hb-template-create"]'));
    expect($('[data-testid="hb-book-step"]').textContent).toContain('Which book entry do you want to reflavour?');
    expect($('[data-testid="hb-book-step"]').textContent).not.toMatch(/\belement\b/);
  });

  it('spells Reflavour the way the rest of the app does (Colours, not Colors)', async () => {
    await mount(<NewElementDialog pack={pack} api={h.api} onClose={() => {}} onCreate={() => {}} />);
    expect($('[data-testid="hb-template-reflavour"]').textContent).toContain('Reflavour');
  });

  it('lists the five groups and offers a rules version', async () => {
    await mount(<NewElementDialog pack={pack} api={h.api} onClose={() => {}} onCreate={() => {}} />);
    expect($$('[data-testid="hb-new-element"] section').map((section) => section.getAttribute('aria-label'))).toEqual([
      'Gifts and afflictions',
      'Character options',
      'Magic and equipment',
      'Companions and world',
      'Advanced',
    ]);
    expect($$('.fcb-template-soon')).toHaveLength(0);
    expect(byLabel('Rules version for the new element').textContent).toContain('Pack default (both 2014 and 2024)');
  });

  it.each([
    ['boon', 'feature', 'boon'],
    ['curse', 'feature', 'curse'],
    ['transformation', 'feature', 'transformation'],
    ['feature', 'feature', 'feature'],
    ['feat', 'feature', 'feat'],
    ['language', 'catalog', 'language'],
    ['proficiency', 'catalog', 'proficiency'],
    ['vision', 'catalog', 'vision'],
    ['deity', 'catalog', 'deity'],
    ['option', 'catalog', 'option'],
    ['alignment', 'catalog', 'alignment'],
    ['weaponProperty', 'catalog', 'weaponProperty'],
    ['weapon', 'catalog', 'baseWeapon'],
    ['armor', 'catalog', 'baseArmor'],
  ])('creates a %s as a %s form', async (id, _family, template) => {
    const { onCreate, onClose } = await pick(id);
    await click($('[data-testid="hb-template-create"]'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const element = onCreate.mock.calls[0][0];
    expect(element.customDraft.template).toBe(template);
    expect(element.customDraft.name).not.toBe('');
    expect(element.rawXml).toContain('<element');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts a feat under Feats and the gifts and afflictions under Other', async () => {
    const feat = await pick('feat');
    await click($('[data-testid="hb-template-create"]'));
    expect(feat.onCreate.mock.calls[0][0].customDraft.showsUnder).toBe('feats');
  });

  it('applies the rules version picked in the dialog', async () => {
    const { onCreate } = await pick('language');
    await choose(byLabel('Rules version for the new element'), '2024');
    await click($('[data-testid="hb-template-create"]'));
    expect(onCreate.mock.calls[0][0].customDraft.ruleset).toBe('2024');
  });

  it.each([
    ['species', 'species', 'Race'],
    ['class', 'class', 'Class'],
    ['background', 'background', 'Background'],
    ['companion', 'companion', 'Companion'],
  ])('creates a %s as a character-option form', async (id, template, type) => {
    const { onCreate } = await pick(id);
    await click($('[data-testid="hb-template-create"]'));
    const element = onCreate.mock.calls[0][0];
    expect(element.customDraft.template).toBe(template);
    expect(element.type).toBe(type);
    expect(element.rawXml).toContain(`type="${type}"`);
    expect(element.rawXml).toContain('source="Moonwell Campaign"');
  });

  it('asks which class a subclass is for, and starts it under that class\' pick list', async () => {
    const pickPack = {
      ...pack,
      elements: [
        elementForDraft({ ...createCustomClassDraft('Moonwalker'), subclass: { level: 3, label: 'Moon Path' } }, pack),
        elementForDraft(createCustomClassDraft('Plain Class'), pack),
      ],
    };
    const onCreate = vi.fn();
    await mount(<NewElementDialog pack={pickPack} api={h.api} onClose={() => {}} onCreate={onCreate} />);
    await click($('[data-testid="hb-template-subclass"]'));
    await click($('[data-testid="hb-template-create"]'));
    expect($('[data-testid="hb-parent-step"]')).toBeTruthy();
    // A class that offers no subclass pick cannot be picked.
    expect(buttonByText('Plain Class').disabled).toBe(true);
    await click(buttonByText('Moonwalker'));
    const element = onCreate.mock.calls[0][0];
    expect(element.customDraft).toMatchObject({ template: 'subclass', parent: { name: 'Moonwalker', tag: 'Moon Path' } });
    expect(element.type).toBe('Archetype');
    expect(element.rawXml).toContain('<supports>Moon Path</supports>');
  });

  it('opens the spell form for a spell and adds the finished spell to the pack', async () => {
    const { onCreate } = await pick('spell');
    await click($('[data-testid="hb-template-create"]'));
    expect(onCreate).not.toHaveBeenCalled();
    await type(byLabel('Name'), 'Frost Lance');
    await click(buttonByText('Add spell'));
    await settle();
    const element = onCreate.mock.calls[0][0];
    expect(element).toMatchObject({ type: 'Spell', name: 'Frost Lance' });
    expect(element.customDraft.template).toBe('spell');
  });

  it.each([
    ['magicBase', 'weapon'],
    ['wondrous', 'worn'],
    ['gear', 'gear'],
  ])('opens the item form for %s and adds the finished item to the pack', async (id, template) => {
    const { onCreate } = await pick(id);
    await click($('[data-testid="hb-template-create"]'));
    await type(byLabel('Name'), 'Signal Whistle');
    if (template === 'weapon') {
      // A magic weapon needs a base; the form asks for one before it saves.
      await click(buttonByText('Add item'));
      await settle();
      expect(onCreate).not.toHaveBeenCalled();
      return;
    }
    await click(buttonByText('Add item'));
    await settle();
    expect(onCreate.mock.calls[0][0].customDraft.template).toBe(template);
  });

  it('asks which book element to change, and starts from a copy of its XML', async () => {
    h.api.content.elements.mockImplementation(async () => ({ items: [{ id: 'ID_BOOK_SPELL_SHIELD', name: 'Shield', source: 'Test Book' }] }));
    h.api.content.elementSource.mockImplementation(async () => ({
      id: 'ID_BOOK_SPELL_SHIELD',
      name: 'Shield',
      type: 'Spell',
      source: 'Test Book',
      xml: '<element name="Shield" type="Spell" source="Test Book" id="ID_BOOK_SPELL_SHIELD"><description><p>x</p></description></element>',
    }));
    const { onCreate } = await pick('override');
    await click($('[data-testid="hb-template-create"]'));
    await type($('[role="combobox"]'), 'Shield');
    await wait(260);
    await click($$('[role="option"]').find((row) => row.textContent.includes('Shield')));
    await settle();
    const element = onCreate.mock.calls[0][0];
    expect(element.id).toBe('ID_BOOK_SPELL_SHIELD');
    expect(element.customDraft).toMatchObject({ template: 'override', targetType: 'Spell' });
    expect(element.customDraft.reflavour).toBeUndefined();
  });

  it('makes a reflavour keep the rules and an addition name its target', async () => {
    h.api.content.elements.mockImplementation(async () => ({ items: [{ id: 'ID_BOOK_SPELL_SHIELD', name: 'Shield', source: 'Test Book' }] }));
    h.api.content.elementSource.mockImplementation(async () => ({
      id: 'ID_BOOK_SPELL_SHIELD', name: 'Shield', type: 'Spell', source: 'Test Book',
      xml: '<element name="Shield" type="Spell" source="Test Book" id="ID_BOOK_SPELL_SHIELD"><description><p>x</p></description></element>',
    }));
    const reflavour = await pick('reflavour');
    await click($('[data-testid="hb-template-create"]'));
    await type($('[role="combobox"]'), 'Shield');
    await wait(260);
    await click($$('[role="option"]').find((row) => row.textContent.includes('Shield')));
    await settle();
    expect(reflavour.onCreate.mock.calls[0][0].customDraft.reflavour).toBe(true);
  });

  it('names the target of an addition without copying its XML', async () => {
    h.api.content.elements.mockImplementation(async () => ({ items: [{ id: 'ID_BOOK_CLASS_DRUID', name: 'Druid', source: 'Test Book' }] }));
    const { onCreate } = await pick('append');
    await click($('[data-testid="hb-template-create"]'));
    await type($('[role="combobox"]'), 'Druid');
    await wait(260);
    await click($$('[role="option"]').find((row) => row.textContent.includes('Druid')));
    await settle();
    expect(h.api.content.elementSource).not.toHaveBeenCalled();
    expect(onCreate.mock.calls[0][0].customDraft).toMatchObject({ template: 'append', targetId: 'ID_BOOK_CLASS_DRUID', targetName: 'Druid' });
  });

  it('writes a custom type as XML after asking for its type and name', async () => {
    const { onCreate } = await pick('raw');
    await click($('[data-testid="hb-template-create"]'));
    await type(byLabel('Element type'), 'Race Variant');
    await type(byLabel('Element name'), 'Selkie Lineage');
    await click(buttonByText('Add element'));
    const element = onCreate.mock.calls[0][0];
    expect(element).toMatchObject({ type: 'Race Variant', name: 'Selkie Lineage' });
    expect(element.rawXml).toContain('type="Race Variant"');
    expect($('[data-testid="hb-raw-background-feature"]')).toBeNull();
    expect($('[data-testid="hb-raw-item-categories"]')).toBeNull();
  });

  it('offers no Background Feature type, and warns when one is typed but still makes it', async () => {
    const { ELEMENT_TYPES, GRANT_TYPES, TYPE_SPECS } = await import('../xmlBuilder.js');
    expect(ELEMENT_TYPES).not.toContain('Background Feature');
    expect(GRANT_TYPES).not.toContain('Background Feature');
    // An existing one still has its form spec, so it keeps loading and saving.
    expect(TYPE_SPECS['Background Feature']).toBeTruthy();

    const { onCreate } = await pick('raw');
    await click($('[data-testid="hb-template-create"]'));
    await type(byLabel('Element type'), 'background feature');
    expect($('[data-testid="hb-raw-background-feature"]').textContent).toContain('only a background that grants it attaches it');
    await type(byLabel('Element name'), 'Ferry Rights');
    await click(buttonByText('Add element'));
    expect(onCreate.mock.calls[0][0].rawXml).toContain('type="background feature"');
  });

  it('lists the Additional features categories when the type is an item', async () => {
    await pick('raw');
    await click($('[data-testid="hb-template-create"]'));
    await type(byLabel('Element type'), 'Magic Item');
    const advice = $('[data-testid="hb-raw-item-categories"]');
    expect(advice.textContent).toContain('To list it on Manage › Additional features, set its category to one of these values.');
    expect(advice.textContent).toContain('Supernatural Gifts');
    expect(advice.textContent).toContain('Additional Feature');
  });
});

describe('an old collection', () => {
  it('opens as a pack, brought up to the current shape in the store, with its file unchanged', async () => {
    await openPack(OLD_COLLECTION);
    expect(h.store.putHomebrew).toHaveBeenCalledWith(expect.objectContaining({ id: 'old-1', schemaVersion: 2, author: '', release: '', playtest: false }));
    const stored = h.records.get('old-1');
    expect(stored.elements).toEqual(OLD_COLLECTION.elements);
    expect(stored.ingestedAt).toBe(OLD_COLLECTION.ingestedAt);
    expect($('[data-testid="hb-pack-name"]').value).toBe('Old Stuff');
    expect($('[data-testid="hb-xml-preview"]').textContent).toBe(buildCollectionXml(OLD_COLLECTION));
  });

  it('opens an element the forms cannot represent as its XML with a notice, and edits it without losing a rule', async () => {
    await openPack(OLD_COLLECTION);
    await click(elementRow('Old Feat'));
    expect($('[data-testid="hb-legacy-notice"]').textContent).toContain('earlier editor');
    const xml = $('[data-testid="hb-raw-xml"]').value;
    expect(xml).toContain('name="Old Feat"');
    expect(xml).toContain('strength');
    // Nothing is changed by looking at it.
    expect(h.records.get('old-1').elements).toEqual(OLD_COLLECTION.elements);
    // Editing it keeps the rules it had: the author works on the XML the editor wrote.
    await type($('[data-testid="hb-raw-xml"]'), xml.replace('Plain text.', 'Edited text.'));
    await settle();
    await wait(700);
    const saved = h.records.get('old-1').elements[0];
    expect(saved.rawXml).toContain('Edited text.');
    expect(saved.rawXml).toContain('strength');
    expect(saved.id).toBe('ID_HB_OLD_STUFF_FEAT_OLD_FEAT');
  });

  it('shows the author, release date and playtest flag a pack can now carry', async () => {
    await openPack(OLD_COLLECTION);
    await type($('[data-testid="hb-pack-author"]'), 'Ilyana');
    await click($('[data-testid="hb-pack-playtest"]'));
    expect($('[data-testid="hb-xml-preview"]').textContent).toContain('<set name="author">Ilyana</set>');
    expect($('[data-testid="hb-xml-preview"]').textContent).toContain('<set name="playtest">true</set>');
  });
});

describe('pack health', () => {
  const hermit = () => rawElement({ type: 'Background Feature', name: "Hermit's Retreat", pack });
  const lanceGrant = () =>
    elementForDraft(
      {
        schemaVersion: 1,
        id: 'ID_CUSTOM_PACTTEST0001',
        template: 'boon',
        name: 'Moonwell Pact',
        showsUnder: 'other',
        description: 'A pact.',
        blocks: [{ kind: 'grant', id: 'g1', target: { by: 'id', type: 'Spell', id: 'ID_HB_MC_SPELL_FROST_LANCE', label: 'Frost Lance' } }],
      },
      pack,
    );

  it('lists each problem kind with its element and a fix where there is one', async () => {
    const retreat = hermit();
    const pact = lanceGrant();
    const wand = rawElement({ type: 'Magic Item', name: 'Wand of Embers', pack });
    const addition = appendElement({ id: 'ID_NOT_LOADED', name: 'Missing Thing' }, pack);
    const full = { ...pack, elements: [pact, retreat, wand, addition] };
    h.api.content.checkPack.mockImplementation(async () => [
      { kind: 'missing-grant', message: 'Moonwell Pact grants Frost Lance, which is not in your library.', elementId: 'ID_CUSTOM_PACTTEST0001', elementName: 'Moonwell Pact', missingId: 'ID_HB_MC_SPELL_FROST_LANCE', missingType: 'Spell' },
      { kind: 'duplicate-id', message: 'Wand of Embers is defined twice.', elementId: wand.id, elementName: 'Wand of Embers' },
      { kind: 'unattachable', message: "Hermit's Retreat is a Background Feature no Background grants.", elementId: retreat.id, elementName: "Hermit's Retreat" },
      { kind: 'append-target', message: 'Missing Thing adds to ID_NOT_LOADED, which is not loaded.', elementId: addition.id, elementName: 'Missing Thing', targetId: 'ID_NOT_LOADED' },
      { kind: 'invalid-requirements', message: 'Bad Gate has requirements the builder cannot read.', elementId: pact.id, elementName: 'Moonwell Pact' },
    ]);
    await openPack(full);
    await wait(800);
    const card = $('[data-testid="hb-pack-health"]');
    // The empty addition cannot load either, and is listed first.
    expect(card.textContent).toContain('6 to fix');
    expect($$('[data-testid="hb-pack-health"] li').map((item) => item.getAttribute('data-kind'))).toEqual([
      'incomplete', 'missing-grant', 'duplicate-id', 'unattachable', 'append-target', 'invalid-requirements',
    ]);
    const labelsOf = (kind) => [...card.querySelector(`li[data-kind="${kind}"]`).querySelectorAll('button')].map((button) => button.textContent);
    expect(labelsOf('missing-grant')).toEqual(['Create spell', 'Find a source', 'Open element']);
    expect(labelsOf('unattachable')).toEqual(['Convert to feature', 'Open element']);
    expect(labelsOf('duplicate-id')).toEqual(['Open element']);
    expect(labelsOf('append-target')).toEqual(['Find a source', 'Open element']);
    expect(labelsOf('invalid-requirements')).toEqual(['Open element']);
    // It asked the engine about this pack's own file.
    expect(h.api.content.checkPack).toHaveBeenCalledWith(expect.objectContaining({ xml: expect.stringContaining('Hermit') }));
  });

  it('lists what keeps an element from loading, in plain words, instead of saying No problems found', async () => {
    const unfinished = elementForDraft(
      {
        schemaVersion: 1,
        id: 'ID_CUSTOM_CHOICETEST01',
        template: 'boon',
        name: 'Moonwell Gift',
        showsUnder: 'other',
        description: 'A gift.',
        blocks: [{ kind: 'choice', id: 'c1', type: 'Language', name: '', count: 1, supports: { kind: 'group', op: 'all', items: [{ kind: 'tag', value: '' }] } }],
      },
      pack,
    );
    h.api.content.checkPack.mockImplementation(async () => []);
    await openPack({ ...pack, elements: [unfinished] });
    await wait(800);
    const card = $('[data-testid="hb-pack-health"]');
    expect(card.textContent).not.toContain('No problems found');
    expect(card.textContent).toContain('2 to fix');
    const items = $$('[data-testid="hb-pack-health"] li[data-kind="incomplete"]');
    expect(items).toHaveLength(2);
    const text = items.map((item) => item.textContent).join(' ');
    expect(text).toContain('Moonwell Gift');
    expect(text).toContain('Player choice: give the choice a name');
    expect(text).toContain('Player choice: a Has the tag filter is empty');
    expect(text).not.toMatch(/blocks\[|supports|\.name|\.value/);
    expect([...items[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Open element']);
  });

  it('says the same plain words when Load into builder is held back', async () => {
    const unfinished = elementForDraft(
      {
        schemaVersion: 1,
        id: 'ID_CUSTOM_CHOICETEST02',
        template: 'boon',
        name: 'Moonwell Gift',
        showsUnder: 'other',
        description: 'A gift.',
        blocks: [{ kind: 'choice', id: 'c1', type: 'Language', name: '', count: 1 }],
      },
      pack,
    );
    await openPack({ ...pack, elements: [unfinished] });
    await click(buttonByText('Load into builder'));
    await settle();
    expect(h.api.content.upload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Player choice: give the choice a name');
    expect(document.body.textContent).not.toMatch(/blocks\[0\]/);
  });

  it('converts an unattachable Background Feature to a feature that can be granted', async () => {
    const retreat = hermit();
    h.api.content.checkPack.mockImplementation(async (request) =>
      request.xml.includes('type="Background Feature"')
        ? [{ kind: 'unattachable', message: "Hermit's Retreat cannot be granted.", elementId: retreat.id, elementName: "Hermit's Retreat" }]
        : [],
    );
    await openPack({ ...pack, elements: [retreat] });
    await wait(800);
    await click(buttonByText('Convert to feature'));
    await wait(800);
    expect(h.records.get('pack-1').elements[0]).toMatchObject({ type: 'Custom Feature', id: retreat.id });
    expect($('[data-testid="hb-pack-health"]').textContent).toContain('No problems found');
  });

  it('opens the spell form for a missing spell and puts the new spell in the pack under the id the grant names', async () => {
    const pact = lanceGrant();
    h.api.content.checkPack.mockImplementation(async (request) =>
      /<element[^>]*\bid="ID_HB_MC_SPELL_FROST_LANCE"/.test(request.xml)
        ? []
        : [{ kind: 'missing-grant', message: 'Moonwell Pact grants Frost Lance.', elementId: pact.id, elementName: 'Moonwell Pact', missingId: 'ID_HB_MC_SPELL_FROST_LANCE', missingType: 'Spell' }],
    );
    await openPack({ ...pack, elements: [pact] });
    await wait(800);
    await click(buttonByText('Create spell'));
    expect(byLabel('Name').value).toBe('Frost Lance');
    await click(buttonByText('Add spell'));
    await settle();
    await wait(700);
    const stored = h.records.get('pack-1').elements;
    expect(stored.map((element) => element.name)).toEqual(['Moonwell Pact', 'Frost Lance']);
    expect(stored[1].id).toBe('ID_HB_MC_SPELL_FROST_LANCE');
    expect(stored[1].type).toBe('Spell');
  });

  it('opens the element a finding names', async () => {
    const wand = rawElement({ type: 'Magic Item', name: 'Wand of Embers', pack });
    h.api.content.checkPack.mockImplementation(async () => [
      { kind: 'duplicate-id', message: 'Wand of Embers is defined twice.', elementId: wand.id, elementName: 'Wand of Embers' },
    ]);
    await openPack({ ...pack, elements: [wand] });
    await wait(800);
    await click(buttonByText('Open element'));
    expect($('[data-testid="hb-element-editor"]').textContent).toContain('Wand of Embers');
  });
});

describe('changing a choice characters have picked under', () => {
  const choice = { kind: 'choice', id: 'pick', type: 'Language', name: 'Borrowed tongue', count: 2, level: 1, supports: { kind: 'group', op: 'all', items: [{ kind: 'tag', value: 'Standard' }] } };
  const gift = (extra = {}) => ({
    schemaVersion: 1, id: 'ID_CUSTOM_GIFTTEST0001', template: 'boon', name: 'Tide Gift', showsUnder: 'other', description: 'The tide answers.',
    blocks: [choice], ...extra,
  });
  const REPORT = {
    hasPicks: true,
    changes: [{ blockId: 'pick', name: 'Borrowed tongue', type: 'Language', change: 'changed', fields: ['name'], orphanedSlots: [1], picks: [{ characterId: 'Ilyana', slot: 1, elementId: 'ID_LANGUAGE_ELVISH', elementName: 'Elvish' }] }],
  };

  it('warns in the element editor, naming the picks that would be cleared', async () => {
    const loaded = gift();
    const element = { ...elementForDraft(gift({ blocks: [{ ...choice, name: 'Other tongue' }] }), pack), loadedDraft: loaded };
    h.api.content.packChoiceImpact.mockImplementation(async () => REPORT);
    await openPack({ ...pack, elements: [element] });
    await click(elementRow('Tide Gift'));
    await wait(500);
    expect(h.api.content.packChoiceImpact).toHaveBeenCalledWith(loaded, element.customDraft);
    const warning = $('[data-testid="hb-identity-warning"]');
    expect(warning.textContent).toContain('Borrowed tongue');
    expect(warning.textContent).toContain('Elvish');
  });

  it('holds Update builder back until the author accepts clearing the picks', async () => {
    const element = { ...elementForDraft(gift({ blocks: [{ ...choice, name: 'Other tongue' }] }), pack), loadedDraft: gift() };
    h.api.content.packChoiceImpact.mockImplementation(async () => REPORT);
    await openPack({ ...pack, elements: [element], ingestedAt: 1 });
    await click($('[data-testid="hb-save-ingest"]'));
    await settle();
    expect($('[data-testid="hb-risk-prompt"]').textContent).toContain('Elvish');
    expect(h.api.content.upload).not.toHaveBeenCalled();
    await click(buttonByText('Update and clear those picks'));
    await settle();
    expect(h.api.content.upload).toHaveBeenCalledTimes(1);
    // The version now in the library is the one the next edit is checked against.
    expect(h.records.get('pack-1').elements[0].loadedDraft.blocks[0].name).toBe('Other tongue');
  });

  it('does not warn when nothing was picked', async () => {
    const element = { ...elementForDraft(gift({ blocks: [{ ...choice, name: 'Other tongue' }] }), pack), loadedDraft: gift() };
    await openPack({ ...pack, elements: [element], ingestedAt: 1 });
    await click($('[data-testid="hb-save-ingest"]'));
    await settle();
    expect($('[data-testid="hb-risk-prompt"]')).toBeNull();
    expect(h.api.content.upload).toHaveBeenCalledTimes(1);
  });
});

describe('edits made just before the editor is left', () => {
  const gift = {
    schemaVersion: 1, id: 'ID_CUSTOM_RENAMETEST01', template: 'boon', name: 'Tide Gift', showsUnder: 'other', description: 'The tide answers.', blocks: [],
  };
  const other = { ...gift, id: 'ID_CUSTOM_RENAMETEST02', name: 'Moon Gift' };
  const savedNames = () => h.records.get('pack-1').elements.map((element) => element.customDraft.name);

  // Root cause: the debounced save was cancelled by the effect cleanup, which also runs when the
  // editor unmounts, so a rename inside the debounce window never reached the store.
  it('saves a rename when the editor closes before the debounce fires', async () => {
    await openPack({ ...pack, elements: [elementForDraft(gift, pack)] });
    await click(elementRow('Tide Gift'));
    h.store.putHomebrew.mockClear();
    await type(byLabel('Name'), 'Tide Gift, renamed');
    expect(h.store.putHomebrew).not.toHaveBeenCalled();
    await unmountAll();
    expect(savedNames()).toEqual(['Tide Gift, renamed']);
  });

  it('saves a rename as soon as the field loses focus', async () => {
    await openPack({ ...pack, elements: [elementForDraft(gift, pack)] });
    await click(elementRow('Tide Gift'));
    h.store.putHomebrew.mockClear();
    await type(byLabel('Name'), 'Tide Gift, renamed');
    await act(async () => {
      byLabel('Name').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    });
    await settle();
    expect(savedNames()).toEqual(['Tide Gift, renamed']);
  });

  it('saves a rename when another element is opened', async () => {
    await openPack({ ...pack, elements: [elementForDraft(gift, pack), elementForDraft(other, pack)] });
    await click(elementRow('Tide Gift'));
    await type(byLabel('Name'), 'Tide Gift, renamed');
    h.store.putHomebrew.mockClear();
    await click(elementRow('Moon Gift'));
    await settle();
    expect(h.store.putHomebrew).toHaveBeenCalled();
    expect(savedNames()).toEqual(['Tide Gift, renamed', 'Moon Gift']);
  });

  it('saves a rename when the page is about to unload', async () => {
    await openPack({ ...pack, elements: [elementForDraft(gift, pack)] });
    await click(elementRow('Tide Gift'));
    h.store.putHomebrew.mockClear();
    await type(byLabel('Name'), 'Tide Gift, renamed');
    await act(async () => {
      window.dispatchEvent(new window.Event('beforeunload'));
    });
    await settle();
    expect(savedNames()).toEqual(['Tide Gift, renamed']);
  });
});

describe('the open character\'s own pack', () => {
  it('is listed with the homebrew packs and its entries can be copied to My homebrew', async () => {
    const draft = { schemaVersion: 1, id: 'ID_CUSTOM_BOONTEST0001', template: 'boon', name: 'Tide Gift', showsUnder: 'other', description: '', blocks: [] };
    h.api.characters.customContent.mockImplementation(async () => ({
      entries: [{ kind: 'feature', draft, elementId: draft.id, type: 'Custom Feature', section: 'other', granted: true, installed: true }],
      problems: [],
    }));
    h.api.characters.promoteCustomDraft.mockImplementation(async (_id, draftId) => ({
      id: draftId,
      xml: '<element />',
      element: { localId: 'promoted-1', id: draftId, idLocked: true, type: 'Custom Feature', name: 'Tide Gift', rawXml: '<element />', customDraft: draft },
    }));
    h.records.set('pack-1', pack);
    await mount(<HomebrewEditor characterId="Ilyana" />);
    await settle();
    const options = $$('[data-testid="hb-pack-select"] option').map((option) => option.textContent);
    expect(options).toContain("Ilyana's pack");
    expect(options).toContain('Moonwell Campaign (0)');
    await choose(byLabel('Pack'), 'character:Ilyana');
    await settle();
    expect($('[data-testid="hb-character-pack"]').textContent).toContain('Tide Gift');
    await click(byLabel('Copy Tide Gift to My homebrew'));
    await settle();
    expect(h.api.characters.promoteCustomDraft).toHaveBeenCalledWith('Ilyana', draft.id, 'My homebrew');
    const mine = [...h.records.values()].find((record) => record.name === 'My homebrew');
    expect(mine.elements.map((element) => element.id)).toEqual([draft.id]);
  });
});
