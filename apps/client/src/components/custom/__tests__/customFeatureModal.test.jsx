// @vitest-environment happy-dom
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { compileCustomElement, customDraftIssues } from '@forge-cb/engine/custom';
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

    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('Add to Ilyana'));
    await settle();
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    expect($('[role="alert"]').textContent).toContain('Pick the ability this spell is cast with.');
    await choose(byLabel('Casting ability'), 'charisma');
    await click(buttonByText('Add to Ilyana'));
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

  it('refuses an incomplete form and names the field', async () => {
    const api = fakeApi();
    await open(api);
    await click(buttonByText('+ Spell'));
    await click(buttonByText('Add to Ilyana'));
    await settle();
    expect(api.characters.saveCustomDraft).not.toHaveBeenCalled();
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent).join(' ');
    expect(alerts).toContain('give it a name');
    expect(alerts).toContain('pick the element that is granted');
    expect($('[role="dialog"]')).not.toBeNull();
  });

  it('keeps the entry under the section the author picks', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Stag Mark');
    await click(radio('Race'));
    await click(buttonByText('Add to Ilyana'));
    await settle();
    expect(savedDraft(api)).toMatchObject({ name: 'Stag Mark', showsUnder: 'race', template: 'feature' });
  });

  it('writes limited uses as the sheet usage line and an active switch onto its bonuses', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Moonlit Form');
    await click(buttonByText('+ Ability score'));
    await click(buttonByText('+ Limited uses'));
    await type(byLabel('Uses'), '2');
    await choose(byLabel('Recharges on'), 'Short Rest');
    await click(buttonByText('+ Only while active'));
    await click(buttonByText('Add to Ilyana'));
    await settle();
    const draft = savedDraft(api);
    expect(draft.sheet).toEqual({ usage: '2/Short Rest' });
    expect(draft.blocks[0].gates).toEqual({ switch: 'Moonlit Form' });
    expect(customDraftIssues(draft)).toEqual([]);
    // Both rows leave the chip bar once they are on.
    expect(buttonByText('+ Limited uses')).toBeUndefined();
  });

  it('adds a choice, a language and a proficiency block that validate', async () => {
    const api = fakeApi();
    await open(api);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click(buttonByText('+ Player picks'));
    await type(byLabel('Name of the choice'), 'Borrowed tongue');
    await click(buttonByText('+ Proficiency'));
    await click(radio('By name'));
    await type(byLabel('Name of the element'), 'Skill Proficiency (Nature)');
    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('+ Player picks'));
    await type(byLabel('Name of the choice'), 'Borrowed tongue');
    await click(buttonByText('Add to Ilyana'));
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
  it('writes the promoted element to the homebrew drafts store and keeps its id', async () => {
    const api = fakeApi();
    const store = fakeStore();
    await open(api, store);
    await type(byLabel('Name'), 'Gift of Tongues');
    await click([...document.querySelectorAll('input[type="checkbox"]')].find((box) => box.parentElement.textContent.includes('homebrew pack')));
    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('Add to Ilyana'));
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
    await click(buttonByText('Add to Ilyana'));
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
