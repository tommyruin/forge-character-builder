// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { customDraftIssues, createCustomDraft } from '@forge-cb/engine/custom';
import ChoiceBlock from '../ChoiceBlock';
import GrantBlock from '../GrantBlock';
import LibraryPicker from '../LibraryPicker';
import ModifierBlock from '../ModifierBlock';
import RequirementsBuilder from '../RequirementsBuilder';
import SheetPresentation from '../SheetPresentation';
import TagPicker from '../TagPicker';
import { describeModifier, makeChoice, makeGrant, makeModifier } from '../draftModel';
import {
  $,
  Controlled,
  allByLabel,
  buttonByText,
  option,
  press,
  byLabel,
  choose,
  click,
  group,
  mount,
  radio,
  settle,
  type,
} from './harness';

const lookup = {
  search: vi.fn(async ({ type: kind, search }) =>
    [
      { id: 'ID_TEST_LANG_SYLVAN', name: 'Sylvan', source: 'Test Book' },
      { id: 'ID_TEST_LANG_ELVISH', name: 'Elvish', source: 'Test Book' },
    ].filter((item) => item.name.toLowerCase().includes(search.toLowerCase()) && kind !== 'Nothing'),
  ),
  name: vi.fn(async () => undefined),
  debounceMs: 0,
};

// A draft holding one block, so the engine's own validator can say whether the form made a
// shape the engine accepts.
const draftWith = (block) => ({ ...createCustomDraft('boon', 'Test'), id: 'ID_CUSTOM_BLOCKS01', blocks: [block] });

describe('ModifierBlock', () => {
  const modifier = makeModifier({ id: 'm1' });

  it('offers the engine catalogue by human label and never shows a stat key', async () => {
    await mount(<ModifierBlock block={modifier} onChange={() => {}} lookup={lookup} />);
    const options = [...byLabel('What it changes').querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toContain('Wisdom score');
    expect(options).toContain('Armor class bonus');
    expect(options).toContain('Raise the maximum of Wisdom');
    expect(options.some((text) => text.includes(':'))).toBe(false);
    const groups = [...byLabel('What it changes').querySelectorAll('optgroup')].map((entry) => entry.label);
    expect(groups.slice(0, 2)).toEqual(['Ability scores', 'Raise an ability maximum']);
  });

  it('narrows the menu to the groups an effect row offers', async () => {
    await mount(<ModifierBlock block={modifier} onChange={() => {}} lookup={lookup} allowedGroups={['Ability scores']} />);
    expect([...byLabel('What it changes').querySelectorAll('optgroup')].map((entry) => entry.label)).toEqual(['Ability scores']);
  });

  it('emits the draft shape for a target, a mode and a number', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={modifier} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('What it changes'), 'wisdom');
    await type(byLabel('Amount number'), '2');
    expect(emitted.at(-1)).toEqual({
      kind: 'modifier',
      id: 'm1',
      target: 'wisdom',
      mode: 'add',
      value: { kind: 'number', value: 2 },
    });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('lists only the modes a target accepts and switches mode when the target cannot', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={modifier} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('What it changes'), 'strength:max');
    expect(emitted.at(-1)).toMatchObject({ target: 'strength:max', mode: 'raiseMax' });
    const modes = [...byLabel('How it combines').querySelectorAll('option')].map((option) => option.textContent);
    expect(modes).toEqual(['Raise maximum']);
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('names the group of a best-of bonus so bonuses with the same name do not stack', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeModifier({ id: 'm1', target: 'ac:misc' })} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('How it combines'), 'bestOf');
    expect(emitted.at(-1)).toMatchObject({ mode: 'bestOf', bucket: 'armor class bonus' });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    await type(byLabel('Bonus group'), 'ward');
    expect(emitted.at(-1).bucket).toBe('ward');
  });

  it('takes a reference value and a limit', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeModifier({ id: 'm1', target: 'initiative' })} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('Amount is'), 'reference');
    await choose(byLabel('Amount value'), 'wisdom:modifier');
    const limit = [...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('Stop the total going above a limit'));
    await click(limit);
    expect(emitted.at(-1)).toMatchObject({
      value: { kind: 'reference', ref: 'wisdom:modifier' },
      cap: { kind: 'number', value: 20 },
    });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('offers an ability modifier with a minimum of 1 and writes it as a floored reference', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeModifier({ id: 'm1', target: 'ac:misc' })} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('Amount is'), 'reference');
    const labels = [...byLabel('Amount value').querySelectorAll('option')].map((entry) => entry.textContent);
    expect(labels).toContain('Intelligence modifier (minimum 1)');
    await choose(byLabel('Amount value'), 'intelligence:modifier#min:1');
    expect(emitted.at(-1).value).toEqual({ kind: 'reference', ref: 'intelligence:modifier', min: 1 });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    expect(byLabel('Amount value').value).toBe('intelligence:modifier#min:1');
    expect(describeModifier(emitted.at(-1))).toContain('Intelligence modifier (minimum 1)');
    // Subtracting keeps the floor, and going back to the plain modifier drops it.
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('Subtract it')));
    expect(emitted.at(-1).value).toEqual({ kind: 'reference', ref: 'intelligence:modifier', min: 1, negate: true });
    await choose(byLabel('Amount value'), 'intelligence:modifier');
    expect(emitted.at(-1).value).toEqual({ kind: 'reference', ref: 'intelligence:modifier', negate: true });
  });

  it('writes the gates: level, equipment, a switch', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={modifier} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await type(byLabel('From level'), '5');
    await click(buttonByText('Add an equipment gate'));
    await choose(byLabel('Slot'), 'shield');
    await type(byLabel('Switch name'), 'Moonlit');
    expect(emitted.at(-1).gates).toEqual({
      level: 5,
      equipped: [{ slot: 'shield', value: 'any' }],
      switch: 'Moonlit',
    });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    await type(byLabel('Switch name'), '');
    expect(emitted.at(-1).gates.switch).toBeUndefined();
  });

  it('builds an armor class calculation from ability modifiers', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeModifier({ id: 'm1', target: 'ac:misc' })} emitted={emitted}>
        {(block, onChange) => <ModifierBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('What it changes'), 'ac:calculation');
    const dexterity = [...document.querySelectorAll('fieldset input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('Dexterity'));
    await click(dexterity);
    expect(emitted.at(-1)).toMatchObject({ target: 'ac:calculation', mode: 'setBase', addAbilities: ['dexterity'] });
    expect(emitted.at(-1).value.kind).toBe('number');
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('shows the issues it is given', async () => {
    await mount(
      <ModifierBlock block={modifier} onChange={() => {}} lookup={lookup} issues={[{ path: 'blocks[0].value', message: 'give a number' }]} />,
    );
    expect($('[role="alert"]').textContent).toBe('give a number');
  });
});

describe('GrantBlock', () => {
  it('searches the library by kind and emits the picked element', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeGrant('Language', { id: 'g1' })} emitted={emitted}>
        {(block, onChange) => <GrantBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await settle();
    await type(byLabel('Search language entries') ?? $('input[placeholder="Type to search"]'), 'syl');
    await settle();
    await click(option('Sylvan'));
    expect(lookup.search).toHaveBeenCalledWith(expect.objectContaining({ type: 'Language', search: 'syl' }));
    expect(emitted.at(-1)).toEqual({
      kind: 'grant',
      id: 'g1',
      target: { by: 'id', type: 'Language', id: 'ID_TEST_LANG_SYLVAN', label: 'Sylvan' },
    });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    expect(document.body.textContent).toContain('Sylvan');
  });

  it('names an element the library does not hold', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeGrant('Proficiency', { id: 'g1' })} emitted={emitted}>
        {(block, onChange) => <GrantBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await click(radio('By name'));
    await type(byLabel('Name of the element'), 'Skill Proficiency (Nature)');
    expect(emitted.at(-1).target).toEqual({ by: 'name', type: 'Proficiency', name: 'Skill Proficiency (Nature)' });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('gives a spell its cast ability and a free-cast allowance', async () => {
    const emitted = [];
    const spell = makeGrant('Spell', {
      id: 'g1',
      target: { by: 'id', type: 'Spell', id: 'ID_TEST_SPELL', label: 'Moonbeam' },
      spell: { usage: '1/Long Rest' },
    });
    await mount(
      <Controlled initial={spell} emitted={emitted}>
        {(block, onChange) => <GrantBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    expect(radio('Uses per rest, no slot').getAttribute('aria-checked')).toBe('true');
    await choose(byLabel('Casting ability'), 'wisdom');
    await type(byLabel('Uses'), '2');
    await choose(byLabel('Recharges on'), 'Short Rest');
    expect(emitted.at(-1).spell).toEqual({ castAbility: 'wisdom', usage: '2/Short Rest' });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('offers always prepared only when a class can prepare it, and asks which', async () => {
    const spell = makeGrant('Spell', {
      id: 'g1',
      target: { by: 'id', type: 'Spell', id: 'ID_TEST_SPELL', label: 'Moonbeam' },
    });
    await mount(<GrantBlock block={spell} onChange={() => {}} lookup={lookup} casters={[]} />);
    expect(radio('Always prepared')).toBeUndefined();
  });

  it('writes an always-prepared spell with its caster', async () => {
    const emitted = [];
    const spell = makeGrant('Spell', {
      id: 'g1',
      target: { by: 'id', type: 'Spell', id: 'ID_TEST_SPELL', label: 'Moonbeam' },
    });
    await mount(
      <Controlled initial={spell} emitted={emitted}>
        {(block, onChange) => <GrantBlock block={block} onChange={onChange} lookup={lookup} casters={['Druid']} />}
      </Controlled>,
    );
    await click(radio('Always prepared'));
    expect(emitted.at(-1).spell).toEqual({ prepared: true, caster: 'Druid' });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    await click(radio('At will'));
    expect(emitted.at(-1).spell).toEqual({ usage: 'At will' });
  });

  it('writes a level and the requirements of a grant', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeGrant('Language', { id: 'g1', target: { by: 'id', type: 'Language', id: 'ID_TEST_LANG_SYLVAN', label: 'Sylvan' } })} emitted={emitted}>
        {(block, onChange) => <GrantBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await type(byLabel('Grant from level'), '3');
    expect(emitted.at(-1).level).toBe(3);
  });
});

describe('LibraryPicker', () => {
  const picker = (onPick) => (
    <LibraryPicker lookup={lookup} type="Language" value="" label="Search language entries" onPick={onPick} />
  );

  it('lists nothing and searches nothing until the author types', async () => {
    lookup.search.mockClear();
    await mount(picker(() => {}));
    await settle();
    expect(lookup.search).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.querySelector('[role="listbox"]').hidden).toBe(true);
  });

  it('says why a result from an unbuilt pack will not act yet', async () => {
    const unbuilt = { search: async () => [{ id: 'ID_HB_X', name: 'Tide Mark', source: 'Moonwell', pending: 'Not in the builder yet: press Update builder on the pack' }] };
    await mount(<LibraryPicker lookup={{ ...unbuilt, debounceMs: 0 }} type="Custom Feature" value="" label="Search feature entries" onPick={() => {}} />);
    await type($('input[role="combobox"]'), 'tide');
    await settle();
    expect(document.querySelector('[role="option"]').textContent).toContain('press Update builder');
  });

  it('shows results as option rows with the source in muted text', async () => {
    await mount(picker(() => {}));
    await type(byLabel('Search language entries') ?? $('input[role="combobox"]'), 'l');
    await settle();
    const rows = [...document.querySelectorAll('[role="option"]')];
    expect(rows.map((row) => row.querySelector('.fcb-option-title').textContent)).toEqual(['Sylvan', 'Elvish']);
    expect(rows[0].classList.contains('fcb-option-row')).toBe(true);
    expect(rows[0].querySelector('.fcb-option-subtitle').textContent).toBe('Test Book');
    // No result is a bordered button pill any more.
    expect(document.querySelector('[role="listbox"] button')).toBeNull();
  });

  it('moves through the rows with the arrow keys and picks with Enter', async () => {
    const picked = [];
    await mount(picker((item) => picked.push(item.id)));
    const input = $('input[role="combobox"]');
    await type(input, 'l');
    await settle();
    expect(input.getAttribute('aria-activedescendant')).toBe(option('Sylvan').id);
    await press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(option('Elvish').id);
    expect(option('Elvish').getAttribute('aria-selected')).toBe('true');
    await press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(option('Sylvan').id);
    await press(input, 'ArrowUp');
    await press(input, 'Enter');
    expect(picked).toEqual(['ID_TEST_LANG_ELVISH']);
  });

  it('says so when nothing matches', async () => {
    await mount(picker(() => {}));
    await type($('input[role="combobox"]'), 'zzz');
    await settle();
    expect(document.querySelector('[role="listbox"]').textContent).toContain('Nothing matches.');
  });
});

describe('ChoiceBlock', () => {
  it('emits the name, count and type of a choice', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeChoice({ id: 'c1' })} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await type(byLabel('Name of the choice'), 'Borrowed tongue');
    await type(byLabel('How many to pick'), '2');
    await type(byLabel('Choice from level'), '3');
    expect(emitted.at(-1)).toEqual({ kind: 'choice', id: 'c1', type: 'Language', name: 'Borrowed tongue', count: 2, level: 3 });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('offers an inline list in place of a library filter', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeChoice({ id: 'c1', name: 'Mark' })} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('What the player picks'), 'List');
    expect(emitted.at(-1)).toMatchObject({ type: 'List', items: [''] });
    expect(group('Which ones are offered')).toBeNull();
    await type(byLabel('List item 1'), 'Wolf');
    await click(buttonByText('Add an item'));
    await type(byLabel('List item 2'), 'Owl');
    expect(emitted.at(-1).items).toEqual(['Wolf', 'Owl']);
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
  });

  it('builds a filter with ALL OF / ANY OF / NONE OF', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeChoice({ id: 'c1', name: 'Tongue', type: 'Language' })} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await click(buttonByText('Narrow the list'));
    await type(byLabel('Tag'), 'Standard');
    await choose(byLabel('Match'), 'none');
    expect(emitted.at(-1).supports).toEqual({ kind: 'group', op: 'none', items: [{ kind: 'tag', value: 'Standard' }] });
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    expect(document.body.textContent).toContain('none of Standard');
  });

  it('offers spell level, school and a casting ability for a spell choice', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeChoice({ id: 'c1', name: 'Cantrip', type: 'Spell' })} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} casters={['Druid']} />}
      </Controlled>,
    );
    await click(buttonByText('Narrow the list'));
    await choose(byLabel('Filter to add'), 'level');
    await choose(byLabel('Spell level'), '0');
    await choose(byLabel('Casting ability'), 'wisdom');
    await choose(byLabel('Spellcasting feature'), 'Druid');
    expect(emitted.at(-1)).toMatchObject({
      supports: { kind: 'group', op: 'all', items: [{ kind: 'tag', value: '' }, { kind: 'level', value: 0 }] },
      castAbility: 'wisdom',
      caster: 'Druid',
    });
  });

  it('builds "one one-handed melee weapon" from weapon categories and hands, without typing an id', async () => {
    const emitted = [];
    const initial = makeChoice({
      id: 'c1',
      name: 'Bonded weapon',
      type: 'Proficiency',
      supports: { kind: 'group', op: 'all', items: [{ kind: 'tag', value: 'Weapon' }] },
    });
    await mount(
      <Controlled initial={initial} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('Filter to add'), 'preset:melee');
    await choose(allByLabel('Filter to add').at(-1), 'preset:oneHanded');
    const supports = emitted.at(-1).supports;
    expect(supports.items.slice(1)).toEqual([
      {
        kind: 'group',
        op: 'any',
        items: [
          { kind: 'tag', value: 'ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE' },
          { kind: 'tag', value: 'ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE' },
        ],
      },
      { kind: 'group', op: 'none', items: [{ kind: 'tag', value: 'ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED' }] },
    ]);
    expect(customDraftIssues(draftWith(emitted.at(-1)))).toEqual([]);
    expect(document.body.textContent).toContain('none of Two-handed');
    // A property is picked from names too.
    await choose(allByLabel('Filter to add').at(-1), 'weaponTag');
    await choose(allByLabel('Weapon category or property').at(-1), 'ID_INTERNAL_WEAPON_PROPERTY_FINESSE');
    expect(emitted.at(-1).supports.items.at(-1)).toEqual({ kind: 'tag', value: 'ID_INTERNAL_WEAPON_PROPERTY_FINESSE' });
  });

  it('keeps the weapon filters to the choices where they mean something', async () => {
    await mount(
      <Controlled initial={makeChoice({ id: 'c1', name: 'Tongue', type: 'Language', supports: { kind: 'group', op: 'all', items: [{ kind: 'tag', value: 'Standard' }] } })}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    expect(byLabel('Filter to add').querySelector('option[value="preset:melee"]')).toBeNull();
  });

  it('lets the player leave an optional choice unpicked', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={makeChoice({ id: 'c1', name: 'Tongue' })} emitted={emitted}>
        {(block, onChange) => <ChoiceBlock block={block} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('leave it unpicked')));
    expect(emitted.at(-1).optional).toBe(true);
  });
});

describe('RequirementsBuilder', () => {
  it('starts empty and emits undefined again when the last condition goes', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={undefined} emitted={emitted}>
        {(value, onChange) => <RequirementsBuilder value={value} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    expect(document.body.textContent).toContain('No requirements');
    await click(buttonByText('Add requirements'));
    expect(emitted.at(-1)).toEqual({ kind: 'group', op: 'all', items: [{ kind: 'level', min: 1 }] });
    await click(byLabel('Remove this condition'));
    expect(emitted.at(-1)).toBeUndefined();
    expect(document.body.textContent).toContain('No requirements');
  });

  it('builds nested ALL / ANY / NONE groups from the engine conditions and reads them back', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={{ kind: 'group', op: 'all', items: [{ kind: 'level', min: 5 }] }} emitted={emitted}>
        {(value, onChange) => <RequirementsBuilder value={value} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await choose(byLabel('Condition to add'), 'ability');
    await choose(byLabel('Ability'), 'wisdom');
    await type(byLabel('Minimum score'), '13');
    await click(buttonByText('Add a group'));
    await choose(allByLabel('Match')[1], 'none');
    const last = emitted.at(-1);
    expect(last).toEqual({
      kind: 'group',
      op: 'all',
      items: [
        { kind: 'level', min: 5 },
        { kind: 'ability', ability: 'wisdom', min: 13 },
        { kind: 'group', op: 'none', items: [{ kind: 'ability', ability: 'strength', min: 13 }] },
      ],
    });
    expect(customDraftIssues({ ...createCustomDraft('boon', 'T'), id: 'ID_CUSTOM_REQ00001', requirements: last })).toEqual([]);
    expect(document.body.textContent).toContain('Character level 5 or higher');
  });

  it('names what an unfinished condition still needs, using the engine validator', async () => {
    await mount(
      <RequirementsBuilder
        value={{ kind: 'group', op: 'all', items: [{ kind: 'element', id: '' }] }}
        onChange={() => {}}
        lookup={lookup}
      />,
    );
    expect($('[role="alert"]').textContent).toContain('pick the element or optional rule');
  });

  it('picks the element a condition names from the library', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={{ kind: 'group', op: 'all', items: [{ kind: 'element', id: '' }] }} emitted={emitted}>
        {(value, onChange) => <RequirementsBuilder value={value} onChange={onChange} lookup={lookup} />}
      </Controlled>,
    );
    await settle();
    await type($('input[placeholder="Type to search"]'), 'elv');
    await settle();
    await click(option('Elvish'));
    expect(emitted.at(-1).items[0]).toEqual({ kind: 'element', id: 'ID_TEST_LANG_ELVISH', label: 'Elvish' });
    await choose(byLabel('Has or lacks'), 'lacks');
    expect(emitted.at(-1).items[0]).toMatchObject({ negate: true });
  });
});

describe('SheetPresentation', () => {
  it('emits only what differs from the defaults', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={undefined} emitted={emitted}>
        {(value, onChange) => <SheetPresentation value={value} onChange={onChange} />}
      </Controlled>,
    );
    await choose(byLabel('Action type'), 'attack');
    await type(byLabel('Usage'), '2/Long Rest');
    await type(byLabel('Printed title'), 'Moon Strike');
    expect(emitted.at(-1)).toEqual({ action: 'attack', usage: '2/Long Rest', title: 'Moon Strike' });
    await choose(byLabel('Action type'), 'none');
    expect(emitted.at(-1)).toEqual({ usage: '2/Long Rest', title: 'Moon Strike' });
  });

  it('hides the entry from the sheet and adds level text', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={undefined} emitted={emitted}>
        {(value, onChange) => <SheetPresentation value={value} onChange={onChange} />}
      </Controlled>,
    );
    await click(buttonByText('Add level text'));
    await type(byLabel('Text from that level 1'), 'Now d8.');
    expect(emitted.at(-1)).toEqual({ tiers: [{ level: 2, text: 'Now d8.' }] });
    await click($('input[type="checkbox"]'));
    expect(emitted.at(-1)).toMatchObject({ show: false });
    expect(byLabel('Printed title')).toBeNull();
    expect(
      customDraftIssues({ ...createCustomDraft('boon', 'T'), id: 'ID_CUSTOM_SHEET001', sheet: emitted.at(-1) }),
    ).toEqual([]);
  });
});

describe('TagPicker', () => {
  it('toggles the suggested tags and adds a typed one', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={[]} emitted={emitted}>
        {(value, onChange) => <TagPicker value={value} onChange={onChange} suggestions={['Origin', 'Epic Boon']} />}
      </Controlled>,
    );
    await click(buttonByText('Epic Boon'));
    expect(emitted.at(-1)).toEqual(['Epic Boon']);
    await type(byLabel('Add another tag'), 'Moonwell');
    await click(buttonByText('Add tag'));
    expect(emitted.at(-1)).toEqual(['Epic Boon', 'Moonwell']);
    await click(buttonByText('Epic Boon'));
    expect(emitted.at(-1)).toEqual(['Moonwell']);
  });

  it('refuses a tag the engine would read as syntax', async () => {
    const emitted = [];
    await mount(
      <Controlled initial={[]} emitted={emitted}>
        {(value, onChange) => <TagPicker value={value} onChange={onChange} />}
      </Controlled>,
    );
    await type(byLabel('Add another tag'), 'a,b');
    await click(buttonByText('Add tag'));
    expect(emitted).toEqual([]);
    expect($('[role="alert"]').textContent).toContain('cannot contain');
  });
});
