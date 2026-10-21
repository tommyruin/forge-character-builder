import { describe, expect, it } from 'vitest';
import { readCustomPackDraft } from '@forge-cb/engine/custom';
import {
  NEW_ELEMENT_GROUPS,
  NEW_ELEMENT_TEMPLATES,
  convertToFeature,
  createTemplateDraft,
  draftFamily,
  elementForDraft,
  elementIdOf,
  elementKind,
  elementMeta,
  migratePack,
  overrideElement,
  rawElement,
  appendElement,
} from '../packModel.js';
import { PACK_SCHEMA_VERSION, buildCollectionXml, createCollection } from '../xmlBuilder.js';
import { libraryWithHomebrew } from './homebrewHarness.js';

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

// A pack saved before packs carried an author, a release date or a version.
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

describe('reading a stored pack', () => {
  it('adds the fields packs carry and changes nothing else', () => {
    const migrated = migratePack(OLD_COLLECTION);
    expect(migrated).toMatchObject({ schemaVersion: PACK_SCHEMA_VERSION, author: '', release: '', playtest: false });
    expect(migrated.elements).toEqual(OLD_COLLECTION.elements);
    expect(migrated.ingestedAt).toBe(OLD_COLLECTION.ingestedAt);
  });

  it('is idempotent and leaves a current pack as it is', () => {
    const once = migratePack(OLD_COLLECTION);
    expect(migratePack(once)).toBe(once);
    expect(migratePack(pack)).toBe(pack);
  });

  it('writes the same file for an old collection as before it was migrated', () => {
    expect(buildCollectionXml(migratePack(OLD_COLLECTION))).toBe(buildCollectionXml(OLD_COLLECTION));
  });

  it('writes the author, release date and playtest flag a pack sets, and nothing for one that sets none', () => {
    const xml = buildCollectionXml({ ...pack, author: 'Ilyana & Co', release: '2026-03-09', playtest: true });
    expect(xml).toContain('<set name="author">Ilyana &amp; Co</set>');
    expect(xml).toContain('<set name="release">20260309</set>');
    expect(xml).toContain('<set name="playtest">true</set>');
    const plain = buildCollectionXml(pack);
    expect(plain).not.toContain('name="author"');
    expect(plain).not.toContain('name="release"');
    expect(plain).not.toContain('name="playtest"');
  });
});

describe('how an element is edited', () => {
  it('calls an element made with a form a form, an old structured one legacy, and XML-only raw', () => {
    expect(elementKind(OLD_COLLECTION.elements[0])).toBe('legacy');
    expect(elementKind(elementForDraft(createTemplateDraft('boon'), pack))).toBe('form');
    expect(elementKind(rawElement({ type: 'Race', name: 'Selkie', pack }))).toBe('raw');
  });

  it('reads the id of a raw element from its XML', () => {
    const element = rawElement({ type: 'Race', name: 'Selkie', pack });
    expect(elementIdOf(element, pack)).toBe(element.id);
    expect(elementIdOf({ ...element, id: '', rawXml: '<element name="x" type="Race" source="s" id="ID_X_Y"></element>' }, pack)).toBe('ID_X_Y');
  });
});

describe('the New element templates', () => {
  it('offers the five groups, with every template the design lists', () => {
    expect(NEW_ELEMENT_GROUPS.map((group) => group.label)).toEqual([
      'Gifts and afflictions',
      'Character options',
      'Magic and equipment',
      'Companions and world',
      'Advanced',
    ]);
    expect(NEW_ELEMENT_TEMPLATES.map((template) => template.label)).toEqual([
      'Boon or blessing', 'Curse or injury', 'Transformation', 'Feature',
      'Species', 'Subspecies or variant', 'Class', 'Subclass', 'Background', 'Feat',
      'Spell', 'Weapon', 'Armor or shield', 'Magic weapon or armor', 'Wondrous or worn item', 'Simple item',
      'Companion', 'Language', 'Proficiency', 'Sense or damage type', 'Deity', 'Optional rule', 'Alignment', 'Weapon property',
      'Change a book element', 'Add to a book element', 'Reflavour', 'Custom type or raw XML',
    ]);
  });

  it('gives every character option a form: no template is left as raw XML but the custom type', () => {
    const raw = NEW_ELEMENT_TEMPLATES.filter((template) => template.route.kind === 'raw').map((template) => template.label);
    expect(raw).toEqual(['Custom type or raw XML']);
    const options = ['species', 'subspecies', 'class', 'subclass', 'background', 'companion'];
    expect(options.map((id) => NEW_ELEMENT_TEMPLATES.find((template) => template.id === id).route.kind)).toEqual(['build', 'parent', 'build', 'parent', 'build', 'build']);
  });

  const formTemplates = NEW_ELEMENT_TEMPLATES.filter((template) => ['feature', 'catalog', 'spell', 'item', 'build'].includes(template.route.kind));

  it.each(formTemplates.map((template) => [template.label, template.id]))(
    'round-trips %s from form to XML and back to the form',
    async (_label, id) => {
      const draft = { ...createTemplateDraft(id), name: `Test ${id}`, description: 'Invented text.' };
      // Fill what a template needs before it is valid (the forms ask for these).
      if (draft.template === 'weapon' || draft.template === 'armor') draft.base = { id: 'ID_TEST_BASE', name: 'Test Base' };
      const element = elementForDraft(readCustomPackDraft(draft), pack);

      // Storage keeps the element as JSON; opening it again must give the same form.
      const reopened = JSON.parse(JSON.stringify(element));
      expect(reopened.customDraft).toEqual(draft);
      expect(elementKind(reopened)).toBe('form');

      // The XML is derived from the draft under the pack's name, and the library reads it.
      const library = await libraryWithHomebrew({ ...pack, elements: [reopened] });
      const parsed = library.byId.get(draft.id);
      expect(parsed.identity).toMatchObject({ id: draft.id, name: draft.name, source: pack.name });
      expect(parsed.identity.type).toBe(reopened.type);
      expect(draftFamily(reopened.customDraft)).toBe(
        { feature: 'feature', catalog: 'catalog', spell: 'spell', item: 'item', build: 'build' }[NEW_ELEMENT_TEMPLATES.find((t) => t.id === id).route.kind],
      );
    },
  );

  it('recompiles under a renamed pack, so every element follows the pack name', () => {
    const element = elementForDraft({ ...createTemplateDraft('boon'), name: 'Gift' }, pack);
    const xml = buildCollectionXml({ ...pack, name: 'Renamed Pack', elements: [element] });
    expect(xml).toContain('type="Custom Feature" source="Renamed Pack"');
  });

  it('gives a transformation the template that opens its switch', () => {
    expect(createTemplateDraft('transformation').template).toBe('transformation');
  });

  it('sets the rules version a template was created with', () => {
    expect(createTemplateDraft('language', { ruleset: '2024' }).ruleset).toBe('2024');
    expect(createTemplateDraft('language', { ruleset: 'inherit' }).ruleset).toBeUndefined();
  });

  it('labels each kind of element in the list', () => {
    expect(elementMeta(elementForDraft({ ...createTemplateDraft('spell'), name: 'Frost Lance', level: 1 }, pack))).toBe('Spell · 1st');
    expect(elementMeta(elementForDraft({ ...createTemplateDraft('language'), name: 'Tidecant' }, pack))).toBe('Language');
    expect(elementMeta(appendElement({ id: 'ID_X', name: 'Druid' }, pack))).toBe('Addition · Druid');
    expect(appendElement({ id: 'ID_X', name: 'Druid' }, pack).rawXml).toBe('');
    const changed = overrideElement({ id: 'ID_X', name: 'Shield', type: 'Spell', xml: '<element name="Shield" type="Spell" source="B" id="ID_X"><description><p>x</p></description></element>' }, pack);
    expect(elementMeta(changed)).toBe('Changed · Spell');
  });
});

describe('converting an unattachable element', () => {
  it('turns a Background Feature into a feature that can be granted, keeping its rules and id', () => {
    const feature = {
      ...rawElement({ type: 'Background Feature', name: "Hermit's Retreat", pack }),
    };
    const converted = convertToFeature(feature, pack);
    expect(converted.type).toBe('Custom Feature');
    expect(converted.rawXml).toContain('type="Custom Feature"');
    expect(converted.rawXml).toContain(`id="${feature.id}"`);
    expect(converted.id).toBe(feature.id);
    expect(elementKind(converted)).toBe('raw');
  });

  it('keeps the data of an element made with the earlier editor', () => {
    const legacy = { ...OLD_COLLECTION.elements[0], type: 'Background Feature', name: 'Old Retreat' };
    const converted = convertToFeature(legacy, pack);
    expect(converted.rawXml).toContain('type="Custom Feature"');
    expect(converted.rawXml).toContain('Plain text.');
    expect(converted.rawXml).toContain('strength');
  });
});
