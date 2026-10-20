// @vitest-environment happy-dom
// Each kind of pack element is edited with its own form, writes its XML from the draft, and opens
// again as the same form.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { $, $$, buttonByText, byLabel, choose, click, mount, settle, type } from '../../custom/__tests__/harness';
import ElementEditor from '../ElementEditor.jsx';
import { appendElement, createTemplateDraft, elementForDraft, overrideElement, rawElement } from '../packModel.js';
import { buildCollectionXml, createCollection } from '../xmlBuilder.js';

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

const api = {
  content: {
    elements: vi.fn(async () => ({ items: [] })),
    element: vi.fn(async () => null),
  },
};

// Holds the element the way the pack editor does, and records every change.
function Host({ initial, changes }) {
  const [element, setElement] = useState(initial);
  return (
    <ElementEditor
      element={element}
      pack={{ ...pack, elements: [element] }}
      api={api}
      onChange={(next) => {
        changes.push(next);
        setElement(next);
      }}
    />
  );
}

const last = (changes) => changes[changes.length - 1];

describe('a feature (boon, curse, transformation, feature, feat)', () => {
  it.each(['boon', 'curse', 'transformation', 'feature', 'feat'])('edits a %s with the custom feature form', async (id) => {
    const changes = [];
    const initial = elementForDraft({ ...createTemplateDraft(id), name: 'Tide Gift', description: 'The tide answers.' }, pack);
    await mount(<Host initial={initial} changes={changes} />);
    expect(byLabel('Name').value).toBe('Tide Gift');
    expect(byLabel('Add an effect') ?? $('[role="group"][aria-label="Add an effect"]')).toBeTruthy();
    await type(byLabel('Name'), 'Moon Gift');
    expect(last(changes)).toMatchObject({ name: 'Moon Gift' });
    expect(last(changes).rawXml).toContain('name="Moon Gift"');
    expect(last(changes).customDraft.name).toBe('Moon Gift');
  });

  it('adds an effect block with the same chips a character\'s feature has', async () => {
    const changes = [];
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('boon'), name: 'Tide Gift' }, pack)} changes={changes} />);
    await click(buttonByText('+ Ability score'));
    await click(buttonByText('+ Player choice'));
    const draft = last(changes).customDraft;
    expect(draft.blocks.map((block) => block.kind)).toEqual(['modifier', 'choice']);
    expect(last(changes).rawXml).toContain('<stat');
  });

  it('opens a transformation with its switch row ready', async () => {
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('transformation'), name: 'Wild Form' }, pack)} changes={[]} />);
    expect($('[role="group"][aria-label="Only while active"]')).toBeTruthy();
  });

  it('shows the engine\'s issues once the author tries to update', async () => {
    const initial = elementForDraft({ ...createTemplateDraft('boon'), name: '' }, pack);
    await mount(<ElementEditor element={initial} pack={pack} api={api} showIssues onChange={() => {}} />);
    expect($('.fcb-custom-issues')).toBeTruthy();
  });
});

describe('a reference entry', () => {
  it('edits a language with its category tag and fields', async () => {
    const changes = [];
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('language'), name: 'Tidecant' }, pack)} changes={changes} />);
    await type(byLabel('Typical speakers'), 'Selkies');
    expect(last(changes).customDraft.fields).toEqual({ Speakers: 'Selkies' });
    expect(last(changes).rawXml).toContain('Selkies');
  });

  it('edits a deity\'s fields', async () => {
    const changes = [];
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('deity'), name: 'Selune' }, pack)} changes={changes} />);
    await type(byLabel('Domains'), 'Life, Light');
    expect(last(changes).customDraft.fields.domains).toBe('Life, Light');
  });

  it('edits a new base weapon: category, damage, properties and mastery', async () => {
    const changes = [];
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('weapon'), name: 'Tide Spear' }, pack)} changes={changes} />);
    await choose(byLabel('Weapon category'), 'martialMelee');
    await type(byLabel('Weapon damage dice'), '1d8');
    await choose(byLabel('Weapon damage type'), 'piercing');
    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.trim() === 'Reach'));
    await choose(byLabel('Weapon mastery'), 'ID_WOTC_PHB24_WEAPON_PROPERTY_SAP');
    const weapon = last(changes).customDraft.weapon;
    expect(weapon).toMatchObject({ category: 'martialMelee', damage: { dice: '1d8', type: 'piercing' }, mastery: 'ID_WOTC_PHB24_WEAPON_PROPERTY_SAP' });
    expect(weapon.properties).toEqual(['ID_INTERNAL_WEAPON_PROPERTY_REACH']);
    expect(last(changes).rawXml).toContain('Tide Spear');
  });

  it('edits a new base armor: group, armor class and stealth', async () => {
    const changes = [];
    await mount(<Host initial={elementForDraft({ ...createTemplateDraft('armor'), name: 'Kelp Mail' }, pack)} changes={changes} />);
    await choose(byLabel('Armor group'), 'medium');
    await type(byLabel('Armor class'), '14');
    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.includes('Stealth')));
    expect(last(changes).customDraft.armor).toMatchObject({ group: 'medium', ac: 14, stealthDisadvantage: true });
  });
});

describe('a spell and an item', () => {
  it('show a summary and open their own form, which saves back into the element', async () => {
    const changes = [];
    const spell = elementForDraft({ ...createTemplateDraft('spell'), name: 'Frost Lance' }, pack);
    await mount(<Host initial={spell} changes={changes} />);
    expect($('[data-testid="hb-form-card"]').textContent).toContain('Frost Lance');
    await click(buttonByText('Edit spell'));
    await type(byLabel('Name'), 'Frost Javelin');
    await click(buttonByText('Save changes'));
    await settle();
    expect(last(changes)).toMatchObject({ name: 'Frost Javelin', type: 'Spell' });
    expect(last(changes).customDraft.id).toBe(spell.customDraft.id);
    expect(last(changes).rawXml).toContain('Frost Javelin');
  });

  it('opens a worn item in the item form', async () => {
    const item = elementForDraft({ ...createTemplateDraft('wondrous'), name: 'Whistle Ring' }, pack);
    await mount(<Host initial={item} changes={[]} />);
    await click(buttonByText('Edit item'));
    expect(byLabel('Name').value).toBe('Whistle Ring');
  });
});

describe('an addition and a replacement', () => {
  it('edits what an addition adds to the book element', async () => {
    const changes = [];
    const addition = appendElement({ id: 'ID_BOOK_SPELL_SHIELD', name: 'Shield' }, pack);
    await mount(<Host initial={addition} changes={changes} />);
    expect($('.fcb-custom-picked').textContent).toContain('Shield');
    await click(buttonByText('Wizard'));
    expect(last(changes).customDraft.tags).toEqual(['Wizard']);
    expect(last(changes).rawXml).toContain('<append');
    expect(last(changes).rawXml).toContain('Wizard');
  });

  it('edits a house rule as XML and a reflavour as name and text only', async () => {
    const source = { id: 'ID_BOOK_SPELL_SHIELD', name: 'Shield', type: 'Spell', xml: '<element name="Shield" type="Spell" source="B" id="ID_BOOK_SPELL_SHIELD"><description><p>Original.</p></description></element>' };
    const changes = [];
    await mount(<Host initial={overrideElement(source, pack)} changes={changes} />);
    expect(byLabel('Element XML')).toBeTruthy();
    await type(byLabel('Text'), 'House rule text.');
    expect(last(changes).rawXml).toContain('House rule text.');

    const reflavour = [];
    await mount(<Host initial={overrideElement(source, pack, { reflavour: true })} changes={reflavour} />);
    expect($$('[aria-label="Element XML"]')).toHaveLength(1);
  });
});

describe('raw XML, the earlier editor and the Advanced section', () => {
  it('keeps a name, type and id read from the XML as it is edited', async () => {
    const changes = [];
    const raw = rawElement({ type: 'Race', name: 'Selkie', pack });
    await mount(<Host initial={raw} changes={changes} />);
    await type($('[data-testid="hb-raw-xml"]'), raw.rawXml.replace('name="Selkie"', 'name="Seal Folk"'));
    expect(last(changes)).toMatchObject({ name: 'Seal Folk', type: 'Race', id: raw.id });
  });

  it('flags XML that is not one element and keeps the last good name', async () => {
    const changes = [];
    const raw = rawElement({ type: 'Race Variant', name: 'Selkie', pack });
    await mount(<Host initial={raw} changes={changes} />);
    await type($('[data-testid="hb-raw-xml"]'), '<element name="x"');
    expect($('[role="alert"]').textContent).toContain('not well-formed');
    expect(last(changes).name).toBe('Selkie');
  });

  it('shows the element id and a rules version override, and writes the override into the draft', async () => {
    const changes = [];
    const element = elementForDraft({ ...createTemplateDraft('boon'), name: 'Tide Gift' }, pack);
    await mount(<Host initial={element} changes={changes} />);
    const advanced = $('[data-testid="hb-element-advanced"]');
    expect(advanced.textContent).toContain(element.id);
    await choose($('[data-testid="hb-element-ruleset"]'), '2024');
    expect(last(changes).customDraft.ruleset).toBe('2024');
    expect(last(changes).rawXml).toContain('2024');
    await choose($('[data-testid="hb-element-ruleset"]'), 'inherit');
    expect(last(changes).customDraft.ruleset).toBeUndefined();
  });

  it('turns a form element into XML only after the author confirms', async () => {
    const changes = [];
    const element = elementForDraft({ ...createTemplateDraft('boon'), name: 'Tide Gift' }, pack);
    await mount(<Host initial={element} changes={changes} />);
    await click(buttonByText('Edit raw XML'));
    expect(changes).toHaveLength(0);
    await click(buttonByText('Edit as XML'));
    expect(last(changes).customDraft).toBeUndefined();
    expect(last(changes).rawXml).toBe(element.rawXml);
    expect($('[data-testid="hb-raw-xml"]').value).toBe(element.rawXml);
  });

  it('compiles the XML pack file from the elements it holds', async () => {
    const element = elementForDraft({ ...createTemplateDraft('boon'), name: 'Tide Gift' }, pack);
    expect(buildCollectionXml({ ...pack, elements: [element] })).toContain('name="Tide Gift"');
  });
});
