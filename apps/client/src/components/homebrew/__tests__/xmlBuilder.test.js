import { describe, expect, it } from 'vitest';
import {
  buildCollectionXml,
  buildElementXml,
  createCollection,
  createElement,
} from '../xmlBuilder.js';

const representativeCollection = {
  name: 'Moon & Mire',
  slug: 'moon-mire',
  abbreviation: 'MM',
  description: 'A collection for patient adventurers.\n\nSecond paragraph & more.',
  elements: [
    {
      localId: 'feat-1',
      type: 'Feat',
      name: 'Warden & Weaver',
      description: 'First paragraph & more.\n\nSecond paragraph.',
      sheetText: 'Gain <em>steady hands</em>.',
      prerequisite: 'Dexterity 13',
      supports: ['ID_SKILL_NATURE'],
      setters: {},
      stats: [{ name: 'dexterity', value: '+2' }],
      grants: [{ type: 'Spell', id: 'ID_SPELL_MOONLIGHT' }],
      rawXml: null,
      id: 'ID_HB_MM_FEAT_WARDEN_WEAVER',
      idLocked: true,
    },
  ],
};

const expectedXml = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<elements>',
  '  <element name="Moon &amp; Mire" type="Source" source="Moon &amp; Mire" id="ID_HB_MM_SOURCE_MOON_MIRE">',
  '    <description>',
  '      <p>A collection for patient adventurers.</p>',
  '      <p>Second paragraph &amp; more.</p>',
  '    </description>',
  '    <setters>',
  '      <set name="abbreviation">MM</set>',
  '      <set name="url">https://local.homebrew</set>',
  '      <set name="homebrew">true</set>',
  '      <set name="ruleset">shared</set>',
  '    </setters>',
  '  </element>',
  '  <element name="Warden &amp; Weaver" type="Feat" source="Moon &amp; Mire" id="ID_HB_MM_FEAT_WARDEN_WEAVER">',
  '    <supports>ID_SKILL_NATURE</supports>',
  '    <prerequisite>Dexterity 13</prerequisite>',
  '    <description>',
  '      <p>First paragraph &amp; more.</p>',
  '      <p>Second paragraph.</p>',
  '    </description>',
  '    <sheet>',
  '      <description>Gain &lt;em&gt;steady hands&lt;/em&gt;.</description>',
  '    </sheet>',
  '    <rules>',
  '      <stat name="dexterity" value="+2" />',
  '      <grant type="Spell" id="ID_SPELL_MOONLIGHT" />',
  '    </rules>',
  '  </element>',
  '</elements>',
].join('\n') + '\n';

describe('homebrew XML output', () => {
  it('keeps representative collection XML byte-for-byte stable', () => {
    expect(buildCollectionXml(representativeCollection)).toBe(expectedXml);
  });

  it('creates languages that standard language pickers can select', () => {
    const language = createElement('Language');
    language.name = 'Picker Language';

    expect(language.supports).toEqual(['Standard']);
    language.supports = [];
    expect(
      buildCollectionXml({
        ...representativeCollection,
        elements: [language],
      }),
    ).toContain('    <supports>Standard</supports>');
  });

  it('emits collection defaults and explicit entry ruleset overrides', () => {
    const collection = createCollection('Rules Lab');
    collection.ruleset = '2024';

    const inherited = createElement('Feat');
    inherited.name = 'Future Lore';

    const legacy = createElement('Feat');
    legacy.name = 'Legacy Lore';
    legacy.ruleset = '2014';

    const shared = createElement('Feat');
    shared.name = 'Common Lore';
    shared.ruleset = 'shared';

    const xml = buildCollectionXml({
      ...collection,
      elements: [inherited, legacy, shared],
    });

    expect(xml).toContain('      <set name="ruleset">2024</set>');
    expect(xml).toContain(
      '<element name="Future Lore" type="Feat" source="Rules Lab"',
    );
    expect(xml).toContain(
      '<element name="Legacy Lore" type="Feat" source="Rules Lab"',
    );
    expect(xml).toContain(
      '<element name="Common Lore" type="Feat" source="Rules Lab"',
    );
    expect(xml).toContain('<set name="ruleset">2014</set>');
    expect(xml).toContain('<set name="ruleset">shared</set>');
  });

  it('keeps legacy drafts shared and inherited when metadata is absent', () => {
    const xml = buildCollectionXml({
      name: 'Legacy Draft',
      slug: 'legacy-draft',
      abbreviation: 'LD',
      description: '',
      elements: [
        {
          ...createElement('Feat'),
          name: 'Old Draft Feat',
        },
      ],
    });

    expect(xml).toContain('      <set name="ruleset">shared</set>');
    expect(xml).not.toMatch(
      /<element name="Old Draft Feat"[\s\S]*?<set name="ruleset">/,
    );
  });

  it('leaves raw XML responsible for its own ruleset metadata', () => {
    const rawXml = [
      '<element name="Raw Rules" type="Feat" source="Raw" id="ID_RAW_RULES">',
      '  <description><p>Raw.</p></description>',
      '  <setters><set name="ruleset">2014</set></setters>',
      '</element>',
    ].join('\n');

    const collectionXml = buildCollectionXml({
      name: 'Raw',
      slug: 'raw',
      abbreviation: 'RAW',
      description: '',
      ruleset: '2024',
      elements: [{ ...createElement('Feat'), rawXml }],
    });

    expect(collectionXml).toContain('<set name="ruleset">2024</set>');
    expect(buildElementXml({ ...createElement('Feat'), rawXml }, { name: 'Raw' })).toBe(
      rawXml,
    );
  });
});
