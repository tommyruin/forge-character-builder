// @vitest-environment happy-dom
import { useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { compileCustomElement, customEntryIssues } from '@forge-cb/engine/custom';
import CustomSpellModal from '../CustomSpellModal';
import { makeCustomServices } from '../customServices';
import { $, buttonByText, byLabel, choose, click, mount, radio, settle, type } from './harness';

const CHARACTER = 'ilyana';

function fakeApi({ casters, preview } = {}) {
  const characters = {
    spellcasting: vi.fn(async () => casters ?? [
      { kind: 'class', name: 'Druid', ability: 'Wisdom' },
      { kind: 'class', name: 'Warlock', ability: 'Charisma' },
      { kind: 'feature', name: 'Additional Spells', ability: 'Wisdom' },
    ]),
    saveCustomDraft: vi.fn(async (_id, draft) => ({ character: { id: CHARACTER }, entry: { draft, elementId: draft.id, kind: 'spell' }, diagnostics: [] })),
    deleteCustomDraft: vi.fn(async () => ({ character: { id: CHARACTER }, entry: null, diagnostics: [] })),
    promoteCustomDraft: vi.fn(async (_id, draftId) => ({ id: draftId, xml: '<element />', element: { localId: 'x', id: draftId } })),
    previewCustomSpell: vi.fn(
      preview ??
        (async () => ({ attack: { casterName: 'Druid', bonus: '+5 WIS vs AC', damage: '2d8 cold', range: '120 feet', warning: null } })),
    ),
  };
  return { characters, content: { elements: vi.fn(async () => ({ items: [] })), element: vi.fn() } };
}

const store = { listHomebrew: vi.fn(async () => []), putHomebrew: vi.fn(async () => {}) };

function Host({ api, entry = null, initialDraft = null, defaultCaster, onSaved = () => {}, onClose = () => {} }) {
  const services = useMemo(() => {
    const built = makeCustomServices({ api, store, id: CHARACTER, run: async (operation) => operation() });
    built.previewDelayMs = 0;
    return built;
  }, [api]);
  return (
    <CustomSpellModal
      services={services}
      characterName="Ilyana"
      entry={entry}
      initialDraft={initialDraft}
      defaultCaster={defaultCaster}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

async function open(api, props = {}) {
  await mount(<Host api={api} {...props} />);
  await settle();
}

const savedDraft = (api) => api.characters.saveCustomDraft.mock.calls.at(-1)[1];
const savedOptions = (api) => api.characters.saveCustomDraft.mock.calls.at(-1)[2];
const checkbox = (text) =>
  [...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.trim() === text);

describe('the custom spell dialog', () => {
  it('writes the spell draft the engine accepts, granted to the first caster', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await choose(byLabel('Level'), '2');
    await choose(byLabel('School'), 'Evocation');
    await type(byLabel('Range'), '120 feet');
    await click(radio('Ranged spell attack'));
    await click(buttonByText('+ Damage'));
    await type(byLabel('Damage dice 1'), '2d8');
    await choose(byLabel('Damage type 1'), 'cold');
    await type(byLabel('Text'), 'A lance of ice flies at a creature.');
    await click(buttonByText('Add spell'));
    await settle();

    const draft = savedDraft(api);
    expect(draft).toEqual({
      schemaVersion: 1,
      id: expect.stringMatching(/^ID_CUSTOM_[0-9A-F]{20}$/),
      template: 'spell',
      name: 'Frost Lance',
      description: 'A lance of ice flies at a creature.',
      level: 2,
      school: 'Evocation',
      castingTime: '1 action',
      range: '120 feet',
      duration: 'Instantaneous',
      // Components start unticked: a spell with none is common (a thought, a word on a scroll), and
      // a pre-ticked box is easy to leave wrong.
      components: {},
      mechanics: { roll: 'attackRanged', damage: [{ dice: '2d8', type: 'cold' }] },
    });
    expect(customEntryIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('<set name="spell roll">ranged attack</set>');
    expect(savedOptions(api)).toEqual({ caster: 'Druid' });
  });

  it('starts with the name it was given, and the id when it is making a missing spell', async () => {
    const api = fakeApi();
    await open(api, { initialDraft: { name: 'Frost Lance', id: 'ID_HB_MC_SPELL_FROST_LANCE' } });
    expect(byLabel('Name').value).toBe('Frost Lance');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedDraft(api).id).toBe('ID_HB_MC_SPELL_FROST_LANCE');
  });

  it('asks for a saving throw ability only for a saving throw, and offers half on a success', async () => {
    const api = fakeApi();
    await open(api);
    expect(byLabel('Saving throw ability')).toBeNull();
    await click(radio('Saving throw'));
    await choose(byLabel('Saving throw ability'), 'dexterity');
    await click(checkbox('Half damage on a successful save'));
    await click(buttonByText('+ Damage'));
    await type(byLabel('Damage dice 1'), '8d6');
    await choose(byLabel('Damage type 1'), 'fire');
    await type(byLabel('Name'), 'Ember Burst');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedDraft(api).mechanics).toEqual({
      roll: 'save',
      saveAbility: 'dexterity',
      halfOnSave: true,
      damage: [{ dice: '8d6', type: 'fire' }],
    });
    // Back to an attack: the save fields do not travel with it.
    await click(radio('Ranged spell attack'));
    expect(byLabel('Saving throw ability')).toBeNull();
  });

  it('scales a cantrip by character level and a spell by slot level', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Ember');
    await choose(byLabel('Level'), '0');
    await click(radio('Ranged spell attack'));
    await click(buttonByText('+ Damage'));
    await type(byLabel('Damage dice 1'), '1d10');
    await choose(byLabel('Damage type 1'), 'fire');
    expect(radio('Per slot level')).toBeUndefined();
    await click(radio('By character level'));
    await click(buttonByText('+ Tier'));
    await type(byLabel('Tier level 1'), '5');
    await type(byLabel('Tier dice 1'), '2d10');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedDraft(api).mechanics.scaling).toEqual({ kind: 'cantrip', tiers: [{ level: 5, dice: '2d10' }] });

    await choose(byLabel('Level'), '1');
    expect(radio('By character level')).toBeUndefined();
    await click(radio('Per slot level'));
    await type(byLabel('Dice per slot level'), '1d6');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedDraft(api).mechanics.scaling).toEqual({ kind: 'slot', dice: '1d6' });
  });

  it('puts the spell on the class lists that are ticked', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await click(checkbox('Druid'));
    await click(checkbox('Wizard'));
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedDraft(api).classes).toEqual(['Druid', 'Wizard']);
  });

  it('can add the spell to a class list only, without granting it', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await choose(byLabel('Cast with'), '__list');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedOptions(api)).toEqual({ grant: false });
  });

  it('casts with the caster it was opened from', async () => {
    const api = fakeApi();
    await open(api, { defaultCaster: 'Warlock' });
    expect(byLabel('Cast with').value).toBe('Warlock');
    await type(byLabel('Name'), 'Frost Lance');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedOptions(api)).toEqual({ caster: 'Warlock' });
  });

  it('gathers the spell under Additional Spells when the character has no class caster', async () => {
    const none = fakeApi({ casters: [] });
    await open(none);
    expect(byLabel('Cast with').value).toBe('');
    await type(byLabel('Name'), 'Frost Lance');
    await click(buttonByText('Add spell'));
    await settle();
    expect(savedOptions(none)).toEqual({});
  });

  it('shows the attack row the engine works out for the caster, and says so while it waits', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await click(radio('Ranged spell attack'));
    await settle();
    await settle();
    expect(api.characters.previewCustomSpell).toHaveBeenCalled();
    const [, draft, caster] = api.characters.previewCustomSpell.mock.calls.at(-1);
    expect(draft.mechanics.roll).toBe('attackRanged');
    expect(caster).toBe('Druid');
    expect($('[data-testid="spell-attack-preview"]').textContent).toContain('+5 WIS vs AC');
    expect($('[data-testid="spell-attack-preview"]').textContent).toContain('2d8 cold');
  });

  it('refuses a draft the engine would refuse, naming the field', async () => {
    const api = fakeApi();
    await open(api);
    expect(buttonByText('Add spell').disabled).toBe(true);
    await click(buttonByText('Add spell'));
    await settle();
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    expect($('[data-testid="add-needs"]').textContent).toContain('To add it: give it a name');
  });

  it('reads the spell back in plain words as it is filled in', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await choose(byLabel('Level'), '0');
    expect($('[data-testid="spell-summary"]').textContent).toContain('Evocation cantrip');
  });

  it('edits a saved spell in place, keeping its id and not asking where to cast it', async () => {
    const api = fakeApi();
    const entry = {
      kind: 'spell',
      elementId: 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA',
      granted: true,
      draft: { ...JSON.parse(JSON.stringify({ schemaVersion: 1, template: 'spell', id: 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA', name: 'Frost Lance', description: '', level: 1, school: 'Evocation', castingTime: '1 action', range: '60 feet', duration: 'Instantaneous', components: { verbal: true }, mechanics: { roll: 'none' } })) },
    };
    await open(api, { entry });
    expect(byLabel('Cast with')).toBeNull();
    await type(byLabel('Name'), 'Glacial Lance');
    await click(buttonByText('Save changes'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ id: 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA', name: 'Glacial Lance' });
    expect(savedOptions(api)).toEqual({});
  });

  it('deletes after a confirmation', async () => {
    const api = fakeApi();
    const onClose = vi.fn();
    const entry = {
      kind: 'spell',
      elementId: 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA',
      granted: true,
      draft: { schemaVersion: 1, template: 'spell', id: 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA', name: 'Frost Lance', description: '', level: 1, school: 'Evocation', castingTime: '1 action', range: '60 feet', duration: 'Instantaneous', components: { verbal: true }, mechanics: { roll: 'none' } },
    };
    await open(api, { entry, onClose });
    await click(buttonByText('Delete custom spell'));
    expect(api.characters.deleteCustomDraft).not.toHaveBeenCalled();
    await click(buttonByText('Delete custom spell'));
    await settle();
    expect(api.characters.deleteCustomDraft).toHaveBeenCalledWith(CHARACTER, 'ID_CUSTOM_AAAAAAAAAAAAAAAAAAAA');
    expect(onClose).toHaveBeenCalled();
  });

  it('can also save the spell to a homebrew pack under the same id', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Frost Lance');
    await click(checkbox('Also save to a homebrew pack, so other characters can use it'));
    await click(buttonByText('Add spell'));
    await settle();
    const draft = savedDraft(api);
    expect(api.characters.promoteCustomDraft).toHaveBeenCalledWith(CHARACTER, draft.id, 'My homebrew');
    expect(store.putHomebrew).toHaveBeenCalled();
  });
});

describe('healing on a spell', () => {
  it('is added like damage: a + Healing button, then a row with its own remove', async () => {
    const api = fakeApi();
    await open(api);
    expect(byLabel('Healing dice')).toBeNull();
    await type(byLabel('Name'), 'Mend');
    await click(buttonByText('+ Healing'));
    await type(byLabel('Healing dice'), '2d8');
    await click(buttonByText('Add spell'));
    await settle();
    expect(api.characters.saveCustomDraft.mock.calls.at(-1)[1].mechanics.healing).toBe('2d8');
    expect(buttonByText('+ Healing')).toBeUndefined();
  });

  it('goes away with its remove button', async () => {
    const api = fakeApi();
    await open(api);
    await click(buttonByText('+ Healing'));
    await type(byLabel('Healing dice'), '2d8');
    await click(byLabel('Remove healing'));
    expect(byLabel('Healing dice')).toBeNull();
    expect(buttonByText('+ Healing')).toBeDefined();
  });
});

describe('plain words in the spell dialog', () => {
  it('says nothing about flags, pickers or rows', async () => {
    const api = fakeApi();
    await open(api);
    const text = document.body.textContent;
    for (const jargon of ['Components and flags', 'pickers', 'Attack row']) expect(text).not.toContain(jargon);
  });
});
