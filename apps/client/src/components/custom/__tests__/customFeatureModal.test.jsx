// @vitest-environment happy-dom
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { compileCustomElement, createCustomDraft, customDraftIssues } from '@forge-cb/engine/custom';
import CustomFeatureModal from '../CustomFeatureModal';
import { CustomEntryList, useCustomContent } from '../CustomEntries';
import { MY_HOMEBREW_NAME, makeCustomServices, writePromotedElement } from '../customServices';
import {
  $,
  allByLabel,
  buttonByText,
  option,
  byLabel,
  choose,
  click,
  clickEffect,
  group,
  mount,
  radio,
  settle,
  type,
} from './harness';

const CHARACTER = 'ilyana';

const MOONBEAM = { id: 'ID_TEST_SPELL_MOONBEAM', name: 'Moonbeam', source: 'Test Book' };

// An in-memory stand-in for the engine's custom-content methods: what a save stores is what the
// next list returns, as it is for the real character pack.
function fakeApi({ impact, casters } = {}) {
  const stored = new Map();
  const entryFor = (draft) => ({
    draft,
    elementId: draft.id,
    type: draft.showsUnder === 'feats' ? 'Feat' : 'Custom Feature',
    section: draft.showsUnder,
    granted: true,
    installed: true,
  });
  const characters = {
    spellcasting: vi.fn(async () =>
      casters ?? [{ kind: 'class', name: 'Druid', ability: 'Wisdom' }, { kind: 'feature', name: 'Magic Initiate', ability: 'Charisma' }],
    ),
    customContent: vi.fn(async () => ({ entries: [...stored.values()].map(entryFor), problems: [] })),
    saveCustomDraft: vi.fn(async (_id, draft) => {
      stored.set(draft.id, structuredClone(draft));
      return { character: { id: CHARACTER }, entry: entryFor(draft), diagnostics: [] };
    }),
    deleteCustomDraft: vi.fn(async (_id, draftId) => {
      stored.delete(draftId);
      return { character: { id: CHARACTER }, entry: null, diagnostics: [] };
    }),
    promoteCustomDraft: vi.fn(async (_id, draftId) => ({
      id: draftId,
      xml: '<element />',
      element: { localId: `local-${draftId}`, id: draftId, idLocked: true, type: 'Feat', name: stored.get(draftId).name, rawXml: '<element />' },
    })),
    choiceIdentityImpact: vi.fn(impact ?? (async () => ({ changes: [], hasPicks: false }))),
  };
  const content = {
    elements: vi.fn(async ({ search }) => ({
      items: [MOONBEAM].filter((item) => item.name.toLowerCase().includes(String(search ?? '').toLowerCase())),
    })),
    element: vi.fn(async () => undefined),
  };
  return { characters, content, stored };
}

function fakeStore(initial = []) {
  const records = [...initial];
  return {
    records,
    listHomebrew: vi.fn(async () => records.map((record) => structuredClone(record))),
    putHomebrew: vi.fn(async (record) => {
      const at = records.findIndex((entry) => entry.id === record.id);
      if (at === -1) records.push(structuredClone(record));
      else records[at] = structuredClone(record);
    }),
  };
}

// The Build tab's custom pieces wired the way the tab wires them: a button, the entry list, the
// dialog, and a workspace `run` that refreshes after every change.
function Host({ api, store, initialDialog = null }) {
  const [dialog, setDialog] = useState(initialDialog);
  const [tick, setTick] = useState(0);
  const services = useMemo(() => {
    const built = makeCustomServices({
      api,
      store,
      id: CHARACTER,
      run: async (operation) => {
        const result = await operation();
        setTick((value) => value + 1);
        return result;
      },
    });
    built.lookup.debounceMs = 0;
    return built;
  }, [api, store]);
  const { entries } = useCustomContent(services, tick);
  return (
    <div>
      <button type="button" onClick={() => setDialog({ entry: null, showsUnder: 'feats' })}>
        Custom
      </button>
      <CustomEntryList
        entries={entries}
        onEdit={(entry) => setDialog({ entry, showsUnder: entry.draft.showsUnder })}
        onRemove={(entry) => services.remove(entry.elementId)}
      />
      {dialog && (
        <CustomFeatureModal
          key={dialog.entry?.elementId ?? 'new'}
          services={services}
          characterName="Ilyana"
          entry={dialog.entry}
          initialShowsUnder={dialog.showsUnder}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

async function open(api, store = fakeStore()) {
  await mount(<Host api={api} store={store} />);
  await settle();
  await click(buttonByText('Custom'));
  await settle();
  return store;
}

async function fillBlessing() {
  await type(byLabel('Name'), 'Blessing of the Moonwell');
  await type(byLabel('Where it came from'), 'Moonwell Campaign');
  await type(byLabel('Text'), 'You bathed in the Moonwell under a full moon.');
  await click(buttonByText('+ Ability score'));
  await choose(byLabel('What it changes'), 'wisdom');
}

const savedDraft = (api) => api.characters.saveCustomDraft.mock.calls.at(-1)[1];

describe('the custom feature dialog: creating', () => {
  it('saves the form as a draft the engine accepts, then lists the entry with a Custom badge', async () => {
    const api = fakeApi();
    await open(api);
    await fillBlessing();
    await click(buttonByText('+ Spell'));
    await settle();
    await type($('input[placeholder="Type to search"]'), 'moon');
    await settle();
    await click(option('Moonbeam'));
    await choose(byLabel('Casting ability'), 'wisdom');

    // The plain-language summary and the sheet preview follow the form.
    const summary = $('[data-testid="custom-summary"]').textContent;
    expect(summary).toContain('Wisdom score +1');
    expect(summary).toContain('Spell: Moonbeam (1/Long Rest, without a spell slot; cast with Wisdom)');
    expect($('[data-testid="custom-sheet-preview"]').textContent).toContain('Blessing of the Moonwell.');
    expect($('[data-testid="custom-sheet-preview"]').textContent).toContain('1/Long Rest');

    await click(buttonByText('Add feature'));
    await settle();

    expect(api.characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    const [characterId, draft] = api.characters.saveCustomDraft.mock.calls[0];
    expect(characterId).toBe(CHARACTER);
    expect(draft).toEqual({
      schemaVersion: 1,
      id: expect.stringMatching(/^ID_CUSTOM_[0-9A-F]{20}$/),
      template: 'feature',
      name: 'Blessing of the Moonwell',
      cameFrom: 'Moonwell Campaign',
      showsUnder: 'feats',
      description: 'You bathed in the Moonwell under a full moon.',
      blocks: [
        { kind: 'modifier', id: expect.any(String), target: 'wisdom', mode: 'add', value: { kind: 'number', value: 1 } },
        {
          kind: 'grant',
          id: expect.any(String),
          target: { by: 'id', type: 'Spell', id: MOONBEAM.id, label: 'Moonbeam' },
          spell: { usage: '1/Long Rest', castAbility: 'wisdom' },
        },
      ],
    });
    expect(customDraftIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('<grant type="Spell" id="ID_TEST_SPELL_MOONBEAM"');

    // The dialog closed and the entry is listed with its badge and its actions.
    expect($('[role="dialog"]')).toBeNull();
    const list = $('[data-testid="custom-entries"]');
    expect(list.textContent).toContain('Blessing of the Moonwell');
    expect(list.textContent).toContain('Feat · Custom · Moonwell Campaign');
    expect(list.querySelector('.fcb-custom-badge').textContent).toBe('Custom');
    expect(byLabel('Edit Blessing of the Moonwell')).not.toBeNull();
    expect(byLabel('Remove Blessing of the Moonwell')).not.toBeNull();
    // A new entry has no stored copy, so there are no picks to check.
    expect(api.characters.choiceIdentityImpact).not.toHaveBeenCalled();
  });

  it('casts a new spell with the character\'s spellcasting ability without being asked', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moon Gift');
    await click(buttonByText('+ Spell'));
    await settle();
    expect(byLabel('Casting ability').value).toBe('wisdom');
    // The ability is always one of the six; there is no "not set" to leave it on.
    expect([...byLabel('Casting ability').options].map((entry) => entry.textContent)).not.toContain('Not set');
    await type($('input[placeholder="Type to search"]'), 'moon');
    await settle();
    await click(option('Moonbeam'));
    await click(buttonByText('Add feature'));
    await settle();
    expect(savedDraft(api).blocks[0].spell).toEqual({ usage: '1/Long Rest', castAbility: 'wisdom' });
  });

  it('asks for the ability when the character has no spellcasting of its own', async () => {
    const api = fakeApi({ casters: [{ kind: 'feature', name: 'Magic Initiate', ability: 'Charisma' }] });
    await open(api);
    await type(byLabel('Name'), 'Moon Gift');
    await click(buttonByText('+ Spell'));
    await settle();
    expect(byLabel('Casting ability').value).toBe('');
    await type($('input[placeholder="Type to search"]'), 'moon');
    await settle();
    await click(option('Moonbeam'));
    // The spell is there but not the ability to cast it with: the button waits, the field asks.
    expect(buttonByText('Add feature').disabled).toBe(true);
    expect(byLabel('Casting ability').options[0].textContent).toBe('Choose an ability');
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    await choose(byLabel('Casting ability'), 'charisma');
    await click(buttonByText('Add feature'));
    await settle();
    expect(savedDraft(api).blocks[0].spell.castAbility).toBe('charisma');
  });

  it('keeps every spell of one feature on the ability already chosen', async () => {
    const api = fakeApi({ casters: [] });
    await open(api);
    await click(buttonByText('+ Spell'));
    await choose(byLabel('Casting ability'), 'intelligence');
    await click(buttonByText('+ Spell'));
    await settle();
    expect(allByLabel('Casting ability').map((select) => select.value)).toEqual(['intelligence', 'intelligence']);
  });

  it('refuses an incomplete form, names the field in plain words and holds the button back', async () => {
    const api = fakeApi();
    await open(api);
    expect(buttonByText('Add feature').disabled).toBe(true);
    await click(buttonByText('+ Spell'));
    // The empty spell is flagged on the spell field itself, not under "Only when", and in plain words.
    const grant = group('Spell');
    const hint = grant.querySelector('[data-testid="grant-target-hint"]');
    expect(hint.textContent).toBe('Choose a spell');
    expect(grant.querySelector('.fcb-custom-gates').contains(hint)).toBe(false);
    const field = [...grant.children].findIndex((child) => child.contains(hint));
    const gates = [...grant.children].findIndex((child) => child.classList.contains('fcb-custom-gates'));
    expect(field).toBeLessThan(gates);
    expect(document.body.textContent).not.toContain('pick the element that is granted');
    expect(buttonByText('Add feature').disabled).toBe(true);
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    expect($('[role="dialog"]')).not.toBeNull();
  });

  it('says what the held-back Add button is waiting for', async () => {
    const api = fakeApi();
    await open(api);
    const needs = $('[data-testid="add-needs"]');
    expect(needs.textContent).toContain('To add it: give it a name');
    expect(buttonByText('Add feature').getAttribute('aria-describedby')).toBe(needs.id);
    await type(byLabel('Name'), 'Stag Mark');
    expect($('[data-testid="add-needs"]')).toBeNull();
    expect(buttonByText('Add feature').disabled).toBe(false);
  });

  it('turns the button on once the name and the spell are there', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Stag Mark');
    await click(buttonByText('+ Spell'));
    expect(buttonByText('Add feature').disabled).toBe(true);
    await type($('input[placeholder="Type to search"]'), 'Moon');
    await settle();
    await click(option('Moonbeam'));
    expect(group('Spell').querySelector('[data-testid="grant-target-hint"]')).toBeNull();
    expect(buttonByText('Add feature').disabled).toBe(false);
  });

  it('keeps the entry under the section the author picks', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Stag Mark');
    await click(radio('Species'));
    await click(buttonByText('Add feature'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ name: 'Stag Mark', showsUnder: 'race', template: 'feature' });
  });

  it('writes limited uses as a tracker and an active switch onto its bonuses', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moonlit Form');
    await click(buttonByText('+ Ability score'));
    await click(buttonByText('+ Uses per rest'));
    const uses = group('Uses per rest');
    await type(uses.querySelector('[aria-label="Uses"]'), '2');
    await choose(uses.querySelector('[aria-label="Recharges on"]'), 'shortRest');
    await clickEffect('+ Only while active');
    // More than one limited use can live on an entry, so the chip stays.
    expect(buttonByText('+ Uses per rest')).toBeDefined();
    await click(buttonByText('Add feature'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.trackers).toEqual([
      { id: expect.any(String), label: 'Moonlit Form', max: { kind: 'number', value: 2 }, unit: 'uses', recharge: 'shortRest' },
    ]);
    expect(draft.sheet).toBeUndefined();
    expect(draft.blocks[0].gates).toEqual({ switch: 'Moonlit Form' });
    expect(customDraftIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('usage="2/Short Rest"');
  });

  it('has one place for the action a feature takes: Action type under More options', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Bladesong');
    await click(buttonByText('+ Uses per rest'));
    await clickEffect('+ Only while active');
    expect(byLabel('Action to use it')).toBeNull();
    expect(allByLabel('Action type')).toHaveLength(1);
    await choose(byLabel('Action type'), 'bonusAction');
    expect(document.querySelector('[data-testid="custom-sheet-preview"]').textContent).toContain('Bonus Action');
    await click(buttonByText('Add feature'));
    await settle();
    expect(savedDraft(api).sheet).toEqual({ action: 'bonusAction' });
  });

  it('offers every recharge, a dice-roll regain, a shared pool and a switch that spends a use', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moonlit Form');
    await click(buttonByText('+ Ability score'));
    await clickEffect('+ Only while active');
    await click(buttonByText('+ Uses per rest'));
    const uses = group('Uses per rest');
    expect([...uses.querySelector('[aria-label="Recharges on"]').options].map((entry) => entry.textContent)).toEqual([
      'Short rest', 'Long rest', 'Dawn', 'Day', 'Never', 'Dice roll (regains 1d6+1 at dawn)',
    ]);
    expect(byLabel('Regains')).toBeNull();
    await choose(uses.querySelector('[aria-label="Recharges on"]'), 'diceRoll');
    await type(byLabel('Regains'), '1d6+1 at dawn');
    await type(byLabel('Shared pool'), 'Moon points');
    await choose(byLabel('Spent by switch'), 'Moonlit Form');
    await click(buttonByText('Add feature'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.trackers[0]).toMatchObject({ recharge: 'diceRoll', regain: '1d6+1 at dawn', pool: 'Moon points', spendOnSwitch: 'Moonlit Form' });
    expect(customDraftIssues(draft)).toEqual([]);
  });

  it('follows the proficiency bonus, and a scale value, for how many', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moonlight');
    await clickEffect('+ Grows with level');
    const scale = group('Grows with level');
    await type(byLabel('Scale name'), 'Gaze count');
    await choose(byLabel('Scale kind'), 'number');
    await type(byLabel('Value 1'), '1');
    await click(buttonByText('+ Level'));
    await type(byLabel('Scale level 2'), '5');
    await type(byLabel('Value 2'), '3');
    expect(scale.textContent).toContain('{{scale:gaze count}}');

    await click(buttonByText('+ Uses per rest'));
    const uses = group('Uses per rest');
    await choose(uses.querySelector('[aria-label="Moonlight follows"]'), 'scale');
    await click(buttonByText('+ Uses per rest'));
    const second = group('Uses per rest 2');
    await type(second.querySelector('[aria-label="Limited use name"]'), 'Ward');
    await choose(second.querySelector('[aria-label="Ward follows"]'), 'reference');
    await click(buttonByText('Add feature'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.scales).toEqual([
      { id: expect.any(String), name: 'Gaze count', kind: 'number', steps: [{ level: 1, value: 1 }, { level: 5, value: 3 }] },
    ]);
    expect(draft.trackers[0].max).toEqual({ kind: 'scale', scale: draft.scales[0].id });
    expect(draft.trackers[1].max).toMatchObject({ kind: 'reference', ref: 'proficiency' });
    expect(customDraftIssues(draft)).toEqual([]);
  });

  it('lets a bonus follow a count scale value but not a die', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moonlight');
    await clickEffect('+ Bonus to another stat');
    expect([...byLabel('Amount is').options].map((entry) => entry.value)).not.toContain('scale');
    await clickEffect('+ Grows with level');
    expect([...byLabel('Amount is').options].map((entry) => entry.value)).not.toContain('scale');
    await choose(byLabel('Scale kind'), 'number');
    expect([...byLabel('Amount is').options].map((entry) => entry.value)).toContain('scale');
    await type(byLabel('Scale name'), 'Ward bonus');
    await choose(byLabel('Amount is'), 'scale');
    await click(buttonByText('Add feature'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.blocks[0].value).toEqual({ kind: 'scale', scale: draft.scales[0].id });
    expect(customDraftIssues(draft)).toEqual([]);
  });

  it('suggests the switches the character already uses', async () => {
    const api = fakeApi();
    const rage = {
      ...createCustomDraft('boon', 'Rage Echo'),
      blocks: [{ kind: 'modifier', id: 'm1', target: 'ac:misc', mode: 'add', value: { kind: 'number', value: 1 }, gates: { switch: 'Moonlit Form' } }],
    };
    await api.characters.saveCustomDraft(CHARACTER, rage);
    await open(api);
    await type(byLabel('Name'), 'Second');
    await clickEffect('+ Only while active');
    expect([...document.querySelectorAll('#custom-switch-names option')].map((entry) => entry.value)).toEqual(['Moonlit Form']);
  });

  it('opens an entry made with a usage line as a tracker, and writes the same line back', async () => {
    const api = fakeApi();
    const old = { ...createCustomDraft('boon', 'Old Gift'), description: 'Text.', sheet: { usage: '2/Short Rest', action: 'bonusAction' } };
    await api.characters.saveCustomDraft(CHARACTER, old);
    await open(api);
    await click(buttonByText('Edit'));
    await settle();
    const uses = group('Uses per rest');
    expect(uses.querySelector('[aria-label="Uses"]').value).toBe('2');
    expect(uses.querySelector('[aria-label="Recharges on"]').value).toBe('shortRest');
    await click(buttonByText('Save changes'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.sheet).toEqual({ action: 'bonusAction' });
    expect(draft.trackers[0]).toMatchObject({ label: 'Old Gift', max: { kind: 'number', value: 2 }, recharge: 'shortRest' });
    expect(compileCustomElement(draft)).toContain('usage="2/Short Rest"');
  });

  it('adds a choice, a language and a proficiency block that validate', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click(buttonByText('+ Player choice'));
    await type(byLabel('Name of the choice'), 'Borrowed tongue');
    await click(buttonByText('+ Proficiency'));
    await click(radio('By name'));
    await type(byLabel('Name of the element'), 'Skill Proficiency (Nature)');
    await click(buttonByText('Add feature'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.blocks.map((block) => block.kind)).toEqual(['choice', 'grant']);
    expect(draft.blocks[0]).toMatchObject({ type: 'Language', name: 'Borrowed tongue', count: 1 });
    expect(customDraftIssues(draft)).toEqual([]);
  });
});

describe('editing and removing', () => {
  async function withSavedEntry(api, store) {
    await open(api, store);
    await fillBlessing();
    await click(buttonByText('Add feature'));
    await settle();
  }

  it('reopens the entry filled in and saves the same element id', async () => {
    const api = fakeApi();
    await withSavedEntry(api);
    const original = savedDraft(api);

    await click(byLabel('Edit Blessing of the Moonwell'));
    await settle();
    expect(byLabel('Name').value).toBe('Blessing of the Moonwell');
    expect(byLabel('Where it came from').value).toBe('Moonwell Campaign');
    expect(group('Ability score')).not.toBeNull();
    expect(byLabel('What it changes').value).toBe('wisdom');
    expect(buttonByText('Save changes')).toBeDefined();

    await type(byLabel('Name'), 'Moonwell Blessing');
    await click(buttonByText('Save changes'));
    await settle();

    expect(api.characters.choiceIdentityImpact).toHaveBeenCalledTimes(1);
    expect(savedDraft(api)).toEqual({ ...original, name: 'Moonwell Blessing' });
    expect($('[data-testid="custom-entries"]').textContent).toContain('Moonwell Blessing');
    expect($('[data-testid="custom-entries"]').textContent).not.toContain('Blessing of the Moonwell');
  });

  it('removes the entry by deleting its draft', async () => {
    const api = fakeApi();
    await withSavedEntry(api);
    const { id } = savedDraft(api);
    await click(byLabel('Remove Blessing of the Moonwell'));
    await settle();
    expect(api.characters.deleteCustomDraft).toHaveBeenCalledWith(CHARACTER, id);
    expect($('[data-testid="custom-entries"]')).toBeNull();
  });
});

describe('choice identity', () => {
  const choiceEntryApi = () =>
    fakeApi({
      impact: async () => ({
        hasPicks: true,
        changes: [
          {
            blockId: 'pick',
            name: 'Borrowed tongue',
            type: 'Language',
            change: 'changed',
            fields: ['name'],
            orphanedSlots: [1],
            picks: [{ characterId: CHARACTER, slot: 1, elementId: 'ID_TEST_LANG_SYLVAN', elementName: 'Sylvan' }],
          },
        ],
      }),
    });

  async function editChoice(api) {
    await open(api);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click(buttonByText('+ Player choice'));
    await type(byLabel('Name of the choice'), 'Borrowed tongue');
    await click(buttonByText('Add feature'));
    await settle();
    api.characters.saveCustomDraft.mockClear();
    await click(byLabel('Edit Gift of Tongues'));
    await settle();
    await type(byLabel('Name of the choice'), 'Other tongue');
  }

  it('warns, naming the picks that would be cleared, before anything is written', async () => {
    const api = choiceEntryApi();
    await editChoice(api);
    await click(buttonByText('Save changes'));
    await settle();

    const warning = $('[data-testid="identity-warning"]');
    expect(warning).not.toBeNull();
    expect(warning.textContent).toContain('"Borrowed tongue" changes its name');
    expect(warning.textContent).toContain('Sylvan');
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    // The impact check saw the edited draft, not the stored one.
    expect(api.characters.choiceIdentityImpact.mock.calls.at(-1)[1].blocks[0].name).toBe('Other tongue');

    await click(buttonByText('Keep editing'));
    expect($('[data-testid="identity-warning"]')).toBeNull();
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
  });

  it('brings the warning into view, focuses it, and leaves only its two buttons', async () => {
    const api = choiceEntryApi();
    const scrolled = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrolled;
    await editChoice(api);
    await click(buttonByText('Save changes'));
    await settle();
    const warning = $('[data-testid="identity-warning"]');
    expect(scrolled).toHaveBeenCalled();
    expect(document.activeElement).toBe(warning);
    // Two choices, not four: the footer's Cancel and Save wait while the warning asks.
    expect(buttonByText('Cancel')).toBeUndefined();
    expect(buttonByText('Save changes')).toBeUndefined();
    expect(buttonByText('Save and clear those picks').className).toContain('fcb-button-danger');
    expect(buttonByText('Keep editing')).toBeDefined();
    await click(buttonByText('Keep editing'));
    expect(buttonByText('Save changes')).toBeDefined();
  });

  it('saves once the author accepts the warning', async () => {
    const api = choiceEntryApi();
    await editChoice(api);
    await click(buttonByText('Save changes'));
    await settle();
    await click(buttonByText('Save and clear those picks'));
    await settle();
    expect(api.characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    expect(savedDraft(api).blocks[0].name).toBe('Other tongue');
    expect($('[role="dialog"]')).toBeNull();
  });
});

describe('saving to a homebrew pack', () => {
  it('offers the pack tick when adding, in the shared wording, and not when editing', async () => {
    const api = fakeApi();
    await open(api);
    expect(document.body.textContent).toContain('Also save to a homebrew pack, so other characters can use it');
    await type(byLabel('Name'), 'Stag Mark');
    await click(buttonByText('Add feature'));
    await settle();
    await click(byLabel('Edit Stag Mark'));
    await settle();
    expect(document.body.textContent).not.toContain('Also save to a homebrew pack');
  });

  it('writes the promoted element to the homebrew drafts store and keeps its id', async () => {
    const api = fakeApi();
    const store = fakeStore();
    await open(api, store);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('homebrew pack')));
    await click(buttonByText('Add feature'));
    await settle();

    const draft = savedDraft(api);
    expect(api.characters.promoteCustomDraft).toHaveBeenCalledWith(CHARACTER, draft.id, MY_HOMEBREW_NAME);
    expect(store.putHomebrew).toHaveBeenCalledTimes(1);
    const collection = store.records[0];
    expect(collection.name).toBe(MY_HOMEBREW_NAME);
    expect(collection.elements).toEqual([expect.objectContaining({ id: draft.id, idLocked: true })]);
    expect($('[role="dialog"]')).toBeNull();
  });

  it('does not touch the homebrew store unless asked', async () => {
    const api = fakeApi();
    const store = fakeStore();
    await open(api, store);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click(buttonByText('Add feature'));
    await settle();
    expect(api.characters.promoteCustomDraft).not.toHaveBeenCalled();
    expect(store.putHomebrew).not.toHaveBeenCalled();
  });

  it('keeps the saved entry and says so when the copy fails', async () => {
    const api = fakeApi();
    api.characters.promoteCustomDraft.mockRejectedValueOnce(new Error('the store is full'));
    await open(api);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('homebrew pack')));
    await click(buttonByText('Add feature'));
    await settle();
    expect(api.characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    expect($('[role="alert"]').textContent).toContain('Added to Ilyana, but could not copy it to a homebrew pack: the store is full');
    await click(buttonByText('Close'));
    expect($('[data-testid="custom-entries"]').textContent).toContain('Gift of Tongues');
  });

  it('replaces the copy of an entry it already holds instead of adding a second', async () => {
    const store = fakeStore([{ id: 'c1', name: MY_HOMEBREW_NAME, elements: [{ localId: 'keep', id: 'ID_CUSTOM_A', name: 'Old' }] }]);
    await writePromotedElement(store, { element: { localId: 'new', id: 'ID_CUSTOM_A', name: 'New' } });
    await writePromotedElement(store, { element: { localId: 'other', id: 'ID_CUSTOM_B', name: 'Second' } });
    expect(store.records).toHaveLength(1);
    expect(store.records[0].elements).toEqual([
      { localId: 'keep', id: 'ID_CUSTOM_A', name: 'New' },
      { localId: 'other', id: 'ID_CUSTOM_B', name: 'Second' },
    ]);
  });
});
