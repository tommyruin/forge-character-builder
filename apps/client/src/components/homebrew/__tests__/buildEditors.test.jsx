// @vitest-environment happy-dom
// The forms for the options a character is built from: species, subspecies, class, subclass,
// background and companion. Each edits its draft, writes the XML from it, and opens again as the
// same form; the level table, the spellcasting tab and the parent picker are driven the way an
// author drives them.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { allByLabel, $, $$, buttonByText, byLabel, choose, click, mount, radio, settle, type } from '../../custom/__tests__/harness';
import { createCustomClassDraft, createCustomSpeciesDraft } from '@forge-cb/engine/custom';
import ElementEditor from '../ElementEditor.jsx';
import { createBuildDraft, createTemplateDraft, elementForDraft } from '../packModel.js';
import { createCollection } from '../xmlBuilder.js';

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

const api = {
  content: {
    elements: vi.fn(async () => ({ items: [] })),
    element: vi.fn(async () => null),
  },
};

function Host({ initial, changes, packElements = [] }) {
  const [element, setElement] = useState(initial);
  return (
    <ElementEditor
      element={element}
      pack={{ ...pack, elements: [element, ...packElements] }}
      api={api}
      onChange={(next) => {
        changes.push(next);
        setElement(next);
      }}
    />
  );
}

const last = (changes) => changes[changes.length - 1];
const open = async (template, name, draftExtra = {}, packElements = []) => {
  const changes = [];
  const initial = elementForDraft({ ...createTemplateDraft(template), name, ...draftExtra }, pack);
  await mount(<Host initial={initial} changes={changes} packElements={packElements} />);
  return changes;
};
const tab = (label) => $$('[role="tab"]').find((button) => button.textContent.trim() === label);
const goTo = async (label) => click(tab(label));

describe('a class', () => {
  it('shows the tabs a class needs and writes its hit die, summary and subclass', async () => {
    const changes = await open('class', 'Moonwalker');
    expect($$('[role="tab"]').map((button) => button.textContent.trim())).toEqual(['Basics', 'Progression', 'Spellcasting', 'Multiclass', 'Sheet']);
    await click(radio('d12'));
    expect(last(changes).customDraft.hitDie).toBe(12);
    expect(last(changes).rawXml).toContain('<set name="hd">d12</set>');

    await type(byLabel('One-line summary'), 'A wanderer of the night.');
    expect(last(changes).customDraft.short).toBe('A wanderer of the night.');

    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.includes('Players choose a subclass')));
    expect(last(changes).customDraft.subclass).toEqual({ level: 3, label: 'Moonwalker Subclass' });
    await type(byLabel('Subclass level'), '2');
    await type(byLabel('Subclass pick name'), 'Moon Path');
    expect(last(changes).customDraft.subclass).toEqual({ level: 2, label: 'Moon Path' });
    expect(last(changes).rawXml).toContain('<select type="Archetype" name="Moon Path" supports="Moon Path" />');
  });

  it('reads ability score improvement levels as a list the author types', async () => {
    const changes = await open('class', 'Moonwalker');
    await type(byLabel('Ability score improvement levels'), '4, 8, 12');
    expect(last(changes).customDraft.asiLevels).toEqual([4, 8, 12]);
    expect(last(changes).rawXml).toContain('Improvement Option (Moonwalker 12)');
    await type(byLabel('Ability score improvement levels'), '4, 8, ');
    expect(last(changes).customDraft.asiLevels).toEqual([4, 8]);
    expect(byLabel('Ability score improvement levels').value).toBe('4, 8, ');
  });

  it('makes "choose N skills from these" a level-1 choice offering only the ticked skills', async () => {
    const changes = await open('class', 'Moonwalker');
    await type(byLabel('Skills to choose'), '2');
    const box = (label) => $$('input[type="checkbox"]').find((input) => input.parentElement.textContent.trim() === label);
    await click(box('Arcana'));
    await click(box('Nature'));
    const [skill] = last(changes).customDraft.starting;
    expect(skill).toMatchObject({ kind: 'choice', type: 'Proficiency', name: 'Skill Proficiency (Moonwalker)', count: 2 });
    expect(skill.supports.items.map((item) => item.value)).toEqual(expect.arrayContaining(['ID_PROFICIENCY_SKILL_ARCANA', 'ID_PROFICIENCY_SKILL_NATURE']));
    expect(last(changes).rawXml).toContain('supports="ID_PROFICIENCY_SKILL_ARCANA||ID_PROFICIENCY_SKILL_NATURE"');
    // Renaming the class does not rename the choice a character may already have picked under.
    await type(byLabel('Name'), 'Moon Walker');
    expect(last(changes).customDraft.starting[0].name).toBe('Skill Proficiency (Moonwalker)');
  });

  it('offers proficiencies, languages and picks for the first class, not ability scores', async () => {
    const changes = await open('class', 'Moonwalker');
    const chips = [...$('[role="group"][aria-label="Add an effect"]').querySelectorAll('button')].map((button) => button.textContent.trim());
    expect(chips).toEqual(['+ Proficiency', '+ Language', '+ Player picks']);
    await click(buttonByText('+ Proficiency'));
    expect(last(changes).customDraft.starting[0]).toMatchObject({ kind: 'grant', target: { type: 'Proficiency' } });
  });
});

describe("a class' level table", () => {
  it('adds a level, a feature, a choice and a value column, and writes each into the draft', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Progression');
    expect($('[data-testid="hb-progression"]')).toBeTruthy();
    await choose(byLabel('Add a level'), '3');
    await click(byLabel('Add a feature at level 3'));
    const draft = () => last(changes).customDraft;
    expect(draft().features).toHaveLength(1);
    expect(draft().features[0]).toMatchObject({ level: 3, draft: { name: 'New feature', template: 'classFeature', showsUnder: 'class' } });

    // The feature opens under the table with the same form a single feature uses, without a "shows under" choice.
    expect($('[data-testid="hb-progression-feature"]')).toBeTruthy();
    expect($('[role="radiogroup"][aria-label="Shows under"]')).toBeNull();
    await type(allByLabel('Name')[1], 'Lunar Step');
    await type(allByLabel('Text')[1], 'You step through moonlight.');
    expect(draft().features[0].draft).toMatchObject({ name: 'Lunar Step', description: 'You step through moonlight.' });
    expect(last(changes).rawXml).toContain('type="Class Feature"');
    expect(last(changes).rawXml).toContain(`<grant type="Class Feature" id="${draft().features[0].draft.id}" level="3" />`);

    await click(byLabel('Add a choice at level 3'));
    expect(draft().choices[0]).toMatchObject({ kind: 'choice', level: 3 });
    await type(byLabel('Name of the choice'), 'Moon Aspect');
    expect(draft().choices[0].name).toBe('Moon Aspect');
    expect($('[aria-label="Edit feature Lunar Step"]').textContent).toContain('Lunar Step');

    await click(buttonByText('+ Value column'));
    expect(draft().scales).toHaveLength(1);
    await type(byLabel('Scale name'), 'Moon die');
    await type(byLabel('Moon die at level 3'), 'd8');
    expect(draft().scales[0].steps).toEqual([{ level: 1, value: '1d6' }, { level: 3, value: 'd8' }]);
    expect(last(changes).rawXml).toContain('name="scale:moon die" value="d8" level="3" inline="true"');
  });

  it('lets a feature read the table\'s count columns from its bonuses', async () => {
    const changes = await open('class', 'Moonwalker', {
      scales: [{ id: 'strikes', name: 'Strikes', kind: 'number', steps: [{ level: 1, value: 1 }] }],
    });
    await goTo('Progression');
    await choose(byLabel('Add a level'), '2');
    await click(byLabel('Add a feature at level 2'));
    await click(buttonByText('+ Other bonus'));
    await choose($('[aria-label="Bonus value is"]') ?? $$('select').find((select) => select.getAttribute('aria-label')?.endsWith('is')), 'scale');
    const bonus = last(changes).customDraft.features[0].draft.blocks[0];
    expect(bonus.value).toMatchObject({ kind: 'scale', scale: 'strikes' });
  });

  it('shows the class\'s own milestones in the level they happen at', async () => {
    const changes = await open('class', 'Moonwalker', { subclass: { level: 3, label: 'Moon Path' }, asiLevels: [4] });
    await goTo('Progression');
    const row = (level) => $(`tr[data-level="${level}"]`);
    expect(row(3).textContent).toContain('Moon Path');
    expect(row(4).textContent).toContain('Ability Score Improvement');
    expect(changes).toHaveLength(0);
  });

  it('removes a feature from the table', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Progression');
    await choose(byLabel('Add a level'), '5');
    await click(byLabel('Add a feature at level 5'));
    await click(byLabel('Remove this feature'));
    expect(last(changes).customDraft.features).toEqual([]);
  });
});

describe("a class' spellcasting tab", () => {
  it('starts as no caster and writes the settings the author picks', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Spellcasting');
    expect($('[data-testid="hb-spellcasting"]').textContent).toContain('does not cast spells');
    await click(buttonByText('Give it spellcasting'));
    expect(last(changes).customDraft.spellcasting).toMatchObject({ ability: 'intelligence', style: 'prepared', slots: { progression: 'full' } });

    await choose(byLabel('Spellcasting ability'), 'wisdom');
    await click(radio('Third'));
    expect($('[data-testid="hb-slot-preview"]').textContent).toContain('start at class level 3');
    await click(radio('Knows a set'));
    const caster = () => last(changes).customDraft.spellcasting;
    expect(caster()).toMatchObject({ ability: 'wisdom', style: 'known', slots: { progression: 'third' } });
    expect(caster().prepare).toBeUndefined();

    await click(buttonByText('+ Step', $('[role="group"][aria-label="Spells"]')));
    await type(byLabel('Spells known 1'), '3');
    expect(caster().spells).toEqual([{ level: 2, known: 3 }].map((step) => expect.objectContaining({ known: step.known })));
    expect(last(changes).rawXml).toContain('<spellcasting name="Moonwalker" ability="Wisdom" prepare="false">');
    expect(last(changes).rawXml).toContain('ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD');
  });

  it('takes a custom table cell by cell, and a multiclass share', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Spellcasting');
    await click(buttonByText('Give it spellcasting'));
    await click(radio('Custom table'));
    await type(byLabel('Slots of level 1 at class level 1'), '2');
    await type(byLabel('Slots of level 2 at class level 3'), '1');
    const { slots } = last(changes).customDraft.spellcasting;
    expect(slots.progression).toBe('custom');
    expect(slots.table[0][0]).toBe(2);
    expect(slots.table[2][1]).toBe(1);
    await choose(byLabel('Counts toward shared slots'), 'half');
    expect(last(changes).customDraft.spellcasting.multiclassSlots).toBe('half');
    expect(last(changes).rawXml).toContain('ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF');
  });

  it('narrows the list to schools and removes the caster again', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Spellcasting');
    await click(buttonByText('Give it spellcasting'));
    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.trim() === 'Evocation'));
    expect(last(changes).customDraft.spellcasting.listFilter).toEqual({ kind: 'group', op: 'any', items: [{ kind: 'school', value: 'Evocation' }] });
    await click(buttonByText('Remove spellcasting'));
    expect(last(changes).customDraft.spellcasting).toBeUndefined();
  });
});

describe("a class' multiclass tab", () => {
  it('allows multiclassing with requirements, a proficiencies line and the proficiencies gained', async () => {
    const changes = await open('class', 'Moonwalker');
    await goTo('Multiclass');
    await click(buttonByText('Allow multiclassing into this class'));
    await type(byLabel('Multiclass proficiencies text'), 'Light armor');
    await click(buttonByText('Add requirements'));
    await click(buttonByText('+ Proficiency'));
    const multiclass = () => last(changes).customDraft.multiclass;
    expect(multiclass().summary).toBe('Light armor');
    expect(multiclass().requirements).toMatchObject({ kind: 'group' });
    expect(multiclass().blocks[0]).toMatchObject({ kind: 'grant' });
    expect(last(changes).rawXml).toContain('<multiclass id=');
    await click(buttonByText('Do not allow multiclassing into this class'));
    expect(last(changes).customDraft.multiclass).toBeUndefined();
  });
});

describe('a subclass', () => {
  const classElement = elementForDraft({ ...createCustomClassDraft('Moonwalker'), subclass: { level: 3, label: 'Moon Path' } }, pack);

  it('belongs to a class of the pack, and answers to that class\' pick list', async () => {
    const changes = [];
    const draft = createBuildDraft('subclass', { id: classElement.customDraft.id, name: 'Moonwalker', tag: 'Moon Path' });
    await mount(<Host initial={elementForDraft({ ...draft, name: 'Wellkeeper' }, pack)} changes={changes} packElements={[classElement]} />);
    expect($('[data-testid="hb-parent-picker"]').textContent).toContain('Moonwalker');
    expect($('[data-testid="hb-parent-picker"]').textContent).toContain('Moon Path');
    expect($$('[role="tab"]').map((button) => button.textContent.trim())).toEqual(['Basics', 'Progression', 'Spellcasting', 'Sheet']);
  });

  it('adds always-prepared spells by class level and spells to the class list', async () => {
    const changes = [];
    const draft = createBuildDraft('subclass', { id: 'ID_BOOK_CLASS', name: 'Druid', tag: 'Druid Circle' });
    await mount(<Host initial={elementForDraft({ ...draft, name: 'Circle of the Moonwell' }, pack)} changes={changes} />);
    await goTo('Spellcasting');
    await click(radio('Adds to the class'));
    expect(last(changes).customDraft.spells).toMatchObject({ caster: 'Druid', alwaysPrepared: [], addToList: [] });
    await click(buttonByText('+ Spell'));
    await type(byLabel('Always prepared level 1'), '5');
    await click(buttonByText('+ Spell for the list'));
    expect(last(changes).customDraft.spells.alwaysPrepared).toEqual([{ level: 5, spell: { id: '' } }]);
    expect(last(changes).customDraft.spells.addToList).toEqual([{ id: '' }]);

    await click(radio('Casts on its own'));
    expect(last(changes).customDraft.spells).toBeUndefined();
    expect(last(changes).customDraft.spellcasting).toMatchObject({ style: 'known', slots: { progression: 'third' }, listTag: 'Druid' });
  });
});

describe('a species', () => {
  it('edits size, speeds, senses, languages and ability increases', async () => {
    const changes = await open('species', 'Selkie');
    await choose(byLabel('Size'), 'Small');
    await type(byLabel('Walking speed'), '25');
    await click(buttonByText('+ Speed'));
    await choose(byLabel('Speed kind 1'), 'swim');
    await type(byLabel('Speed feet 1'), '40');
    const draft = () => last(changes).customDraft;
    expect(draft()).toMatchObject({ size: 'Small', speed: 25, speeds: [{ mode: 'swim', feet: 40 }] });

    await type(byLabel('Languages the player picks'), '1');
    expect(draft().languages).toEqual({ grants: [], choices: 1 });
    await click(buttonByText('+ Ability increase'));
    await type(byLabel('Increase amount 1'), '2');
    expect(draft().abilityBonuses).toEqual([{ ability: 'strength', amount: 2 }]);
    await type(byLabel('Points the player assigns'), '1');
    expect(draft().abilityChoice).toEqual({ picks: 1 });

    expect(last(changes).rawXml).toContain('<grant type="Size" id="ID_SIZE_SMALL" />');
    expect(last(changes).rawXml).toContain('name="innate speed:swim" value="40" bonus="base"');
    expect(last(changes).rawXml).toContain('requirements="!ID_INTERNAL_GRANTS_BACKGROUND_ASI"');
  });

  it('says a 2024 species takes its ability increase from the background', async () => {
    await open('species', 'Selkie', { ruleset: '2024' });
    expect($('[data-testid="hb-lineage"]').textContent).toContain('2024 species take no ability increase');
  });

  it('offers a subspecies pick that subspecies answer to, and keeps names and sizes under Advanced', async () => {
    const changes = await open('species', 'Selkie');
    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.includes('Players pick a subspecies')));
    expect(last(changes).customDraft.subspecies).toEqual({ kind: 'Sub Race' });
    await click(radio('Variant (optional)'));
    expect(last(changes).customDraft.subspecies.kind).toBe('Race Variant');
    expect(last(changes).rawXml).toContain('type="Race Variant" name="Selkie Variant" supports="Selkie" optional="true"');

    await type(byLabel('Male names'), 'Aldo, Bram');
    await type(byLabel('Height base'), `4'2"`);
    await type(byLabel('Height roll'), '2d4');
    expect(last(changes).customDraft.appearance).toEqual({ names: { male: 'Aldo, Bram' }, height: { base: `4'2"`, modifier: '2d4' } });
  });

  it('puts a level-5 trait in the table', async () => {
    const changes = await open('species', 'Selkie');
    await goTo('Progression');
    await choose(byLabel('Add a level'), '5');
    await click(byLabel('Add a feature at level 5'));
    await type(allByLabel('Name')[1], 'Tide Call');
    const entry = last(changes).customDraft.features[0];
    expect(entry).toMatchObject({ level: 5, draft: { name: 'Tide Call', template: 'racialTrait', showsUnder: 'race' } });
    expect(last(changes).rawXml).toContain(`<grant type="Racial Trait" id="${entry.draft.id}" level="5" />`);
  });
});

describe('a subspecies', () => {
  it('belongs to a species and changes the speed by a bonus', async () => {
    const speciesElement = elementForDraft({ ...createCustomSpeciesDraft('Selkie'), subspecies: { kind: 'Sub Race' } }, pack);
    const changes = [];
    const draft = createBuildDraft('subspecies', { id: speciesElement.customDraft.id, name: 'Selkie', tag: 'Selkie' });
    await mount(<Host initial={elementForDraft({ ...draft, name: 'Grey Selkie' }, pack)} changes={changes} packElements={[speciesElement]} />);
    expect($('[data-testid="hb-parent-picker"]').textContent).toContain('Selkie');
    await type(byLabel('Speed bonus'), '5');
    expect(last(changes).customDraft.speedBonus).toBe(5);
    expect(last(changes).rawXml).toContain('type="Sub Race"');
    expect(last(changes).rawXml).toContain('<supports>Selkie</supports>');
  });
});

describe('a background', () => {
  it('writes equipment, personality lists and its own feature', async () => {
    const changes = await open('background', 'Lighthouse Keeper');
    await type(byLabel('Equipment'), 'A brass lantern\nA signal horn');
    expect(last(changes).customDraft.equipment).toEqual(['A brass lantern', 'A signal horn']);

    await goTo('Personality');
    await click(buttonByText('+ Personality Trait list'));
    await type(byLabel('Personality Trait entries'), 'I count waves.\nI hum off-key.');
    await type(byLabel('Personality Trait picks'), '2');
    await click(buttonByText('+ Ideal list'));
    await type(byLabel('Ideal entries'), 'Vigilance.');
    const lists = last(changes).customDraft.lists;
    expect(lists).toEqual([
      { name: 'Personality Trait', count: 2, items: ['I count waves.', 'I hum off-key.'] },
      { name: 'Ideal', count: 1, items: ['Vigilance.'] },
    ]);
    expect(last(changes).rawXml).toContain('<select type="List" name="Personality Trait" number="2">');

    await goTo('Feature');
    await click(buttonByText('Add a background feature'));
    await type(byLabel('Name'), 'Keeper');
    expect(last(changes).customDraft.name).toBe('Keeper');
    expect(last(changes).customDraft.feature.name).toMatch(/^Feature: /);
    expect(last(changes).rawXml).toContain('type="Background Feature"');
  });

  it('writes the 2024 ability choice and origin feat, offering only abilities not yet chosen', async () => {
    const changes = await open('background', 'Lighthouse Keeper');
    await click($$('input[type="checkbox"]').find((box) => box.parentElement.textContent.includes('raises three abilities')));
    expect(last(changes).customDraft.abilityChoice).toEqual(['strength', 'dexterity', 'constitution']);
    await choose(byLabel('Background ability 3'), 'wisdom');
    expect(last(changes).customDraft.abilityChoice).toEqual(['strength', 'dexterity', 'wisdom']);
    expect(last(changes).rawXml).toContain('ID_INTERNAL_GRANTS_BACKGROUND_ASI');
    expect([...byLabel('Background ability 1').options].map((option) => option.value)).not.toContain('dexterity');
  });
});

describe('a companion', () => {
  it('edits the stat block, entries and statistics', async () => {
    const changes = await open('companion', 'Ember Mote');
    await choose(byLabel('Size'), 'Tiny');
    await type(byLabel('Armor class'), '12');
    await type(byLabel('Hit points'), '3');
    await type(byLabel('Dexterity score'), '14');
    await type(byLabel('Senses'), 'darkvision 30 ft.');
    const draft = () => last(changes).customDraft;
    expect(draft()).toMatchObject({ size: 'Tiny', armorClass: 12, hitPoints: 3, senses: 'darkvision 30 ft.' });
    expect(draft().abilities.dexterity).toBe(14);

    await click(buttonByText('+ Statistic'));
    expect(draft().stats[0]).toMatchObject({ target: 'companion:attack', mode: 'add', value: { kind: 'reference', ref: 'proficiency' } });
    expect(last(changes).rawXml).toContain('name="companion:attack" value="proficiency"');

    await goTo('Traits and actions');
    await click(buttonByText('+ Trait'));
    await type(byLabel('Trait 1 name'), 'Flicker');
    await type(byLabel('Trait 1 text'), 'The mote sheds dim light.');
    await click(buttonByText('+ Action'));
    await type(byLabel('Action 1 name'), 'Singe');
    expect(draft().traits).toMatchObject([{ name: 'Flicker', text: 'The mote sheds dim light.' }]);
    expect(draft().actions).toMatchObject([{ name: 'Singe' }]);
    expect(last(changes).rawXml).toContain('type="Companion Trait"');
    expect(last(changes).rawXml).toContain('type="Companion Action"');
  });
});

describe('every character option reopens as the form it was made with', () => {
  it.each(['species', 'class', 'background', 'companion'])('a %s', async (template) => {
    const first = elementForDraft({ ...createTemplateDraft(template), name: 'Test option' }, pack);
    const stored = JSON.parse(JSON.stringify(first));
    const changes = [];
    await mount(<Host initial={stored} changes={changes} />);
    expect(byLabel('Name').value).toBe('Test option');
    expect($(`[data-testid="hb-build-${template}"]`)).toBeTruthy();
    await settle();
    expect(changes).toHaveLength(0);
  });

  it('shows the engine\'s issues once the author tries to save', async () => {
    const initial = elementForDraft({ ...createTemplateDraft('class'), name: '' }, pack);
    await mount(<ElementEditor element={initial} pack={pack} api={api} showIssues onChange={() => {}} />);
    expect($('.fcb-custom-issues')).toBeTruthy();
  });
});
