// @vitest-environment happy-dom
// Picking the class a subclass belongs to: a pack's own class, a library class whose pick list is
// read from its rules, and one the builder cannot read, where the author states the tag.
import { describe, expect, it, vi } from 'vitest';
import { $, buttonByText, byLabel, click, mount, option, settle, type } from '../../custom/__tests__/harness';
import { createCustomClassDraft } from '@forge-cb/engine/custom';
import ParentPicker from '../ParentPicker.jsx';
import { elementForDraft } from '../packModel.js';
import { createCollection } from '../xmlBuilder.js';

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

const rules = {
  ID_BOOK_CLASS: '<grant type="Class Feature" id="ID_BOOK_FEATURE_ONE" level="1" /><grant type="Class Feature" id="ID_BOOK_TRADITION" level="2" />',
  ID_BOOK_FEATURE_ONE: '<stat name="x" value="1" />',
  ID_BOOK_TRADITION: '<select type="Archetype" name="Arcane Tradition" supports="Arcane Tradition" />',
  ID_BOOK_PLAIN: '<grant type="Class Feature" id="ID_BOOK_FEATURE_ONE" level="1" />',
};

const api = {
  content: {
    element: vi.fn(async (id) => ({ rules: rules[id] ?? null })),
    elements: vi.fn(async () => ({ items: [{ id: 'ID_BOOK_CLASS', name: 'Tidal Mage', source: 'Book' }, { id: 'ID_BOOK_PLAIN', name: 'Plain Fighter', source: 'Book' }] })),
  },
};
const lookup = { debounceMs: 0, search: async ({ search }) => (await api.content.elements({ search })).items, name: async () => null };

describe('the parent picker', () => {
  it('offers the pack\'s own classes, and only those that offer a subclass', async () => {
    const own = elementForDraft({ ...createCustomClassDraft('Moonwalker'), subclass: { level: 3, label: 'Moon Path' } }, pack);
    const none = elementForDraft(createCustomClassDraft('Plain Class'), pack);
    const onPick = vi.fn();
    await mount(<ParentPicker kind="subclass" pack={{ ...pack, elements: [own, none] }} api={api} lookup={lookup} value={null} onPick={onPick} />);
    expect(buttonByText('Plain Class').disabled).toBe(true);
    await click(buttonByText('Moonwalker'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Moonwalker', tag: 'Moon Path' }));
  });

  it('reads a library class\' pick list from the rules of its features', async () => {
    const onPick = vi.fn();
    await mount(<ParentPicker kind="subclass" pack={pack} api={api} lookup={lookup} value={null} onPick={onPick} />);
    await type($('input[role="combobox"]'), 'Tidal');
    await settle();
    await click(option('Tidal Mage'));
    await settle();
    expect(onPick).toHaveBeenCalledWith({ id: 'ID_BOOK_CLASS', name: 'Tidal Mage', tag: 'Arcane Tradition', kind: 'Archetype' });
  });

  it('asks for the tag when a class offers no pick the builder can read', async () => {
    const onPick = vi.fn();
    await mount(<ParentPicker kind="subclass" pack={pack} api={api} lookup={lookup} value={null} onPick={onPick} />);
    await type($('input[role="combobox"]'), 'Plain');
    await settle();
    await click(option('Plain Fighter'));
    await settle();
    expect($('[data-testid="hb-parent-missing"]')).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    await type(byLabel('Pick list tag'), 'Fighter Path');
    await click(buttonByText('Use this tag'));
    expect(onPick).toHaveBeenCalledWith({ id: 'ID_BOOK_PLAIN', name: 'Plain Fighter', tag: 'Fighter Path', kind: null });
  });

  it('shows a chosen parent with the pick list it answers to', async () => {
    await mount(<ParentPicker kind="subclass" pack={pack} api={api} lookup={lookup} value={{ id: 'ID_X', name: 'Wizard', tag: 'Arcane Tradition||Wizard Subclass' }} onPick={() => {}} />);
    expect($('[data-testid="hb-parent-picker"]').textContent).toContain('Wizard');
    expect($('[data-testid="hb-parent-picker"]').textContent).toContain('Arcane Tradition” or “Wizard Subclass');
  });
});
