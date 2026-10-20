// @vitest-environment happy-dom
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { compileCustomElement, customEntryIssues } from '@forge-cb/engine/custom';
import CustomItemModal from '../CustomItemModal';
import { makeCustomServices } from '../customServices';
import { makeItemDraft } from '../draftModel';
import { $, allByLabel, buttonByText, byLabel, choose, click, group, mount, option, radio, settle, type } from './harness';

const CHARACTER = 'ilyana';

const LONGSWORD = { id: 'ID_TEST_LONGSWORD', name: 'Longsword', source: 'Test Book', equipmentKind: 'Martial melee weapon', displayPrice: '15 gp' };
const RAPIER = { id: 'ID_TEST_RAPIER', name: 'Rapier', source: 'Test Book', equipmentKind: 'Martial melee weapon', displayPrice: '25 gp' };
const SHIELD = { id: 'ID_TEST_SHIELD', name: 'Shield', source: 'Test Book', equipmentKind: 'Shield', displayPrice: '10 gp' };
const COLD = { id: 'ID_TEST_RESISTANCE_COLD', name: 'Resistance (Cold)', source: 'Internal' };
const RAY = { id: 'ID_TEST_SPELL_RAY_OF_FROST', name: 'Ray of Frost', source: 'Test Book' };

function fakeApi({ casters, preview } = {}) {
  const characters = {
    spellcasting: vi.fn(async () => casters ?? [{ kind: 'class', name: 'Druid', ability: 'Wisdom' }]),
    saveCustomDraft: vi.fn(async (_id, draft) => ({ character: { id: CHARACTER }, entry: { draft, elementId: draft.id, kind: 'item' }, diagnostics: [] })),
    deleteCustomDraft: vi.fn(async () => ({ character: { id: CHARACTER }, entry: null, diagnostics: [] })),
    promoteCustomDraft: vi.fn(async (_id, draftId) => ({ id: draftId, xml: '<element />', element: { localId: 'x', id: draftId } })),
    previewCustomItem: vi.fn(
      preview ??
        (async () => ({
          attack: { name: 'Frostbite', range: '5 ft', bonus: '+5 vs AC', damage: '1d8+3 slashing + 1d6 cold', description: 'Versatile' },
        })),
    ),
  };
  const content = {
    elements: vi.fn(async ({ type: kind, search }) => {
      const pool = kind === 'Weapon' ? [LONGSWORD, RAPIER] : kind === 'Armor' ? [SHIELD] : kind === 'Condition' ? [COLD] : kind === 'Spell' ? [RAY] : [];
      const text = String(search ?? '').toLowerCase();
      return { items: pool.filter((item) => item.name.toLowerCase().includes(text)) };
    }),
    element: vi.fn(async () => undefined),
  };
  return { characters, content };
}

const store = { listHomebrew: vi.fn(async () => []), putHomebrew: vi.fn(async () => {}) };

function Host({ api, entry = null, template = 'weapon', onSaved = () => {} }) {
  const services = useMemo(() => {
    const built = makeCustomServices({ api, store, id: CHARACTER, run: async (operation) => operation() });
    built.lookup.debounceMs = 0;
    built.previewDelayMs = 0;
    return built;
  }, [api]);
  return <CustomItemModal services={services} characterName="Ilyana" entry={entry} initialTemplate={template} onClose={() => {}} onSaved={onSaved} />;
}

async function open(api, props = {}) {
  await mount(<Host api={api} {...props} />);
  await settle();
}

const savedDraft = (api) => api.characters.saveCustomDraft.mock.calls.at(-1)[1];
const savedOptions = (api) => api.characters.saveCustomDraft.mock.calls.at(-1)[2];

describe('the custom item dialog: a magic weapon', () => {
  it('starts from a real base and writes the weapon draft the engine accepts', async () => {
    const api = fakeApi();
    await open(api);
    await choose(byLabel('Base weapon'), LONGSWORD.id);
    await type(byLabel('Name'), 'Frostbite');
    await type(byLabel('Bonus to hit and damage'), '1');
    await click(buttonByText('+ Extra damage'));
    await type(byLabel('Extra damage dice 1'), '1d6');
    await choose(byLabel('Damage type 1'), 'cold');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('Requires attunement')));
    await choose(byLabel('Rarity'), 'Rare');
    await type(byLabel('Text'), 'Rime gathers on the edge.');

    await click(buttonByText('Add to inventory'));
    await settle();

    expect(api.characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    const draft = savedDraft(api);
    expect(draft).toEqual({
      schemaVersion: 1,
      id: expect.stringMatching(/^ID_CUSTOM_[0-9A-F]{20}$/),
      template: 'weapon',
      name: 'Frostbite',
      description: 'Rime gathers on the edge.',
      blocks: [],
      base: { id: LONGSWORD.id, name: 'Longsword' },
      bonus: 1,
      rarity: 'Rare',
      attunement: true,
      weapon: { extraDamage: [{ dice: '1d6', type: 'cold' }] },
    });
    expect(customEntryIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain(`<set name="weapon">${LONGSWORD.id}</set>`);
    expect(savedOptions(api)).toEqual({});
  });

  it('offers the effects an item has while attuned: a bonus, a resistance, a spell and a feature', async () => {
    const api = fakeApi();
    await open(api);
    await choose(byLabel('Base weapon'), LONGSWORD.id);
    await type(byLabel('Name'), 'Frostbite');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('Requires attunement')));
    expect(document.body.textContent).toContain('While attuned, also');

    await click(buttonByText('+ Resistance'));
    await type($('input[placeholder="Type to search"]'), 'cold');
    await settle();
    await click(option('Resistance (Cold)'));

    await click(buttonByText('+ Spell'));
    await settle();
    // The character's spellcasting ability is the default, so it needs no choosing.
    expect(byLabel('Casting ability').value).toBe('wisdom');
    await type(allByLabel('Search spell entries')[0] ?? $('input[placeholder="Type to search"]'), 'frost');
    await settle();
    await click(option('Ray of Frost'));

    await click(buttonByText('+ Bonus'));
    await choose(byLabel('What it changes'), 'spellcasting:attack');

    await click(buttonByText('Add to inventory'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.blocks.map((block) => [block.kind, block.target?.id ?? block.target])).toEqual([
      ['grant', COLD.id],
      ['grant', RAY.id],
      ['modifier', 'spellcasting:attack'],
    ]);
    expect(draft.blocks[1].spell).toEqual({ usage: '1/Long Rest', castAbility: 'wisdom' });
    expect(customEntryIssues(draft)).toEqual([]);
    expect(group('Resistance')).not.toBeNull();
    expect(group('Spell')).not.toBeNull();
  });

  it('names a feature grant "Other feature" in its Kind menu, not the first kind in the list', async () => {
    const api = fakeApi();
    await open(api);
    await click(buttonByText('+ Feature or other grant'));
    const kind = byLabel('Kind of element granted');
    expect(kind.value).toBe('Custom Feature');
    expect(kind.options[kind.selectedIndex].textContent).toBe('Other feature');
  });

  it('shows the attack row the engine works out, and says nothing until the draft is complete', async () => {
    const api = fakeApi();
    await open(api);
    expect($('[data-testid="item-attack-preview"]').textContent).toContain('Choose a base and a name to see the row.');
    expect(api.characters.previewCustomItem).not.toHaveBeenCalled();

    await choose(byLabel('Base weapon'), LONGSWORD.id);
    await type(byLabel('Name'), 'Frostbite');
    await settle();
    await settle();
    expect(api.characters.previewCustomItem).toHaveBeenCalledWith(CHARACTER, expect.objectContaining({ name: 'Frostbite', base: { id: LONGSWORD.id, name: 'Longsword' } }));
    const row = $('[data-testid="item-attack-preview"]').textContent;
    expect(row).toContain('Frostbite');
    expect(row).toContain('+5');
    expect(row).toContain('1d8+3 slashing + 1d6 cold');
  });

  it('lets the author change the ability, die, range and properties of the base', async () => {
    const api = fakeApi();
    await open(api);
    await choose(byLabel('Base weapon'), RAPIER.id);
    await type(byLabel('Name'), 'Spellblade');
    await choose(byLabel('Attack and damage with'), 'intelligence');
    await click(document.querySelector('summary'));
    await type(byLabel('Damage dice'), '1d10');
    await type(byLabel('Range'), '20/60');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes("Replace the base weapon's properties")));
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.trim() === 'Finesse'));
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.trim() === 'Thrown'));
    await click(buttonByText('Add to inventory'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.weapon).toEqual({
      attackAbility: 'intelligence',
      damage: { dice: '1d10', type: 'slashing' },
      range: '20/60',
      properties: ['ID_INTERNAL_WEAPON_PROPERTY_FINESSE', 'ID_INTERNAL_WEAPON_PROPERTY_THROWN'],
    });
    expect(customEntryIssues(draft)).toEqual([]);
  });

  it('refuses an incomplete form and names the field', async () => {
    const api = fakeApi();
    await open(api);
    await click(buttonByText('Add to inventory'));
    await settle();
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(' ');
    expect(alerts).toContain('pick the weapon it is made from');
    expect(alerts).toContain('give it a name');
  });

  it('can also copy the new item to a homebrew pack', async () => {
    const api = fakeApi();
    await open(api);
    await choose(byLabel('Base weapon'), LONGSWORD.id);
    await type(byLabel('Name'), 'Frostbite');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('homebrew pack')));
    await click(buttonByText('Add to inventory'));
    await settle();
    expect(api.characters.promoteCustomDraft).toHaveBeenCalledWith(CHARACTER, savedDraft(api).id, 'My homebrew');
  });
});

describe('the custom item dialog: other templates', () => {
  it('marks a shield base so its bonus goes on the shield', async () => {
    const api = fakeApi();
    await open(api, { template: 'armor' });
    await choose(byLabel('Base armor'), SHIELD.id);
    await type(byLabel('Name'), 'Ward');
    await type(byLabel('Bonus to armor class'), '2');
    await click(buttonByText('Add to inventory'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ template: 'armor', base: { id: SHIELD.id, name: 'Shield', shield: true }, bonus: 2 });
  });

  it('writes a worn item with a slot, and has no attack row', async () => {
    const api = fakeApi();
    await open(api, { template: 'worn' });
    expect($('[data-testid="item-attack-preview"]')).toBeNull();
    await type(byLabel('Name'), 'Hearth Pendant');
    await choose(byLabel('Worn on'), 'ring');
    await click(buttonByText('+ Charges or limited uses'));
    const charges = group('Charges');
    await type(charges.querySelector('[aria-label="Uses"]'), '3');
    await choose(charges.querySelector('[aria-label="Recharges on"]'), 'dawn');
    expect(document.body.textContent).toContain('While worn, also');
    await click(buttonByText('Add to inventory'));
    await settle();
    const saved = savedDraft(api);
    expect(saved).toMatchObject({ template: 'worn', slot: 'ring' });
    expect(saved.trackers).toEqual([
      expect.objectContaining({ label: 'Charges', unit: 'charges', max: { kind: 'number', value: 3 }, recharge: 'dawn' }),
    ]);
    expect(saved.uses).toBeUndefined();
    expect(api.characters.previewCustomItem).not.toHaveBeenCalled();
  });

  it('keeps the text of an item made before charges were tracked, until the author tracks them', async () => {
    const api = fakeApi();
    const draft = { ...makeItemDraft('worn'), name: 'Old Pendant', slot: 'neck', uses: '3 charges, regains all at dawn' };
    await open(api, { entry: { kind: 'item', draft, elementId: draft.id, type: 'Magic Item', section: 'other', granted: true, installed: true } });
    expect(byLabel('Limited uses or charges').value).toBe('3 charges, regains all at dawn');
    await click(buttonByText('+ Charges or limited uses'));
    expect(byLabel('Limited uses or charges')).toBeNull();
  });

  it('takes plain gear on one line: a quantity, a weight and notes', async () => {
    const api = fakeApi();
    await open(api, { template: 'gear' });
    await type(byLabel('Name'), 'Signal Whistle');
    await type(byLabel('Quantity'), '3');
    await type(byLabel('Weight in pounds'), '0.25');
    await type(byLabel('Notes'), 'Carved from bone.');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('stack')));
    await click(buttonByText('Add 3 to inventory'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ template: 'gear', name: 'Signal Whistle', weight: 0.25, stackable: true, blocks: [] });
    expect(savedOptions(api)).toEqual({ amount: 3, notes: 'Carved from bone.' });
    expect(group('Add an effect')).toBeNull();
  });

  it('changes template from the Start from choice and keeps the name', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Odd Thing');
    await click(radio('Worn item'));
    expect(byLabel('Name').value).toBe('Odd Thing');
    expect(byLabel('Worn on')).not.toBeNull();
    expect(byLabel('Base weapon')).toBeNull();
  });
});

describe('the custom item dialog: editing', () => {
  const stored = () => ({
    schemaVersion: 1,
    id: 'ID_CUSTOM_EDITME0000000000AA',
    template: 'weapon',
    name: 'Frostbite',
    description: '',
    blocks: [],
    base: { id: LONGSWORD.id, name: 'Longsword' },
    bonus: 1,
  });

  it('saves changes to a carried item without letting its base move', async () => {
    const api = fakeApi();
    await open(api, { entry: { kind: 'item', draft: stored(), elementId: stored().id, granted: true, installed: true } });
    expect(byLabel('Base weapon').disabled).toBe(true);
    expect(document.body.textContent).toContain('It is in the inventory on this base');
    await type(byLabel('Bonus to hit and damage'), '2');
    await click(buttonByText('Save changes'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ id: stored().id, bonus: 2 });
    // An edit is not a new add: no quantity or notes travel with it.
    expect(savedOptions(api)).toEqual({});
  });

  it('deletes the item after asking, taking every copy with it', async () => {
    const api = fakeApi();
    await open(api, { entry: { kind: 'item', draft: stored(), elementId: stored().id, granted: true, installed: true } });
    await click(buttonByText('Delete custom item'));
    expect($('[data-testid="remove-confirm"]').textContent).toContain('Every copy in the inventory goes too');
    expect(api.characters.deleteCustomDraft).not.toHaveBeenCalled();
    await click(buttonByText('Delete custom item', $('[data-testid="remove-confirm"]')));
    await settle();
    expect(api.characters.deleteCustomDraft).toHaveBeenCalledWith(CHARACTER, stored().id);
  });
});
