// @vitest-environment happy-dom
// The learn browser's text, School and Source filters never stay on with their control hidden:
// a new spell choice starts unfiltered, and a filter that is on keeps its control on screen.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { characters } = vi.hoisted(() => ({ characters: { spellBrowse: vi.fn() } }));
vi.mock('../../../../api', () => ({ api: { characters } }));

import SpellBrowser from '../SpellBrowser';
import { WorkspaceContext } from '../../../WorkspaceContext';
import { $, $$, byLabel, choose, click, mount, settle, type } from '../../../custom/__tests__/harness';

const workspace = {
  id: 'Ada',
  busy: false,
  active: true,
  libraryRevision: 0,
  run: (operation) => operation(),
  notify: vi.fn(),
  getCachedResource: (_key, loader) => Promise.resolve().then(loader),
  createLibraryPickerRefreshController: () => ({ request: () => null, cancel: () => {} }),
  ensureLibraryRevisionReady: () => Promise.resolve(),
};

const spell = (id, level, school, source = 'Test Book') => ({
  id, name: id.replace('ID_', '').toLowerCase(), level, school, source, status: 'learnable',
});
const browse = (spells) => ({ spells, slots: [{ number: 1, spellId: null }], activeSpellLevels: [], maxSpellLevel: 9 });

// Choice A: two schools at level 1, ten level-1 spells (busy) and two level-2 spells.
const choiceA = browse([
  ...Array.from({ length: 10 }, (_, index) => spell(`ID_FIRE_${index}`, 1, index < 5 ? 'Evocation' : 'Abjuration')),
  spell('ID_FIREWALL', 2, 'Evocation'),
  spell('ID_STONE', 2, 'Evocation'),
]);
// Choice B: one school only, so its School select would normally hide.
const choiceB = browse([spell('ID_WARD', 1, 'Abjuration'), spell('ID_SHIELD', 1, 'Abjuration')]);

const rows = () => $$('[data-testid^="spell-row-"]');

function Browser({ rule }) {
  return (
    <WorkspaceContext.Provider value={workspace}>
      <SpellBrowser rule={rule} />
    </WorkspaceContext.Provider>
  );
}

describe('spell browser filters', () => {
  it('starts a new spell choice unfiltered rather than carrying a hidden School pick over', async () => {
    characters.spellBrowse.mockImplementation(async (_id, rule) => (rule === 'A' ? choiceA : choiceB));
    const { root } = await mount(<Browser rule={{ identifier: 'A' }} />);
    await settle();

    await choose(byLabel('Filter by school'), 'Evocation');
    expect(rows()).toHaveLength(5);

    // The tab re-renders the same browser for another choice.
    await act(async () => root.render(<Browser rule={{ identifier: 'B' }} />));
    await settle();

    expect(rows()).toHaveLength(2);
    expect(byLabel('Filter by school')).toBeNull();
  });

  it('keeps the text filter on screen while it narrows a level of 8 spells or fewer', async () => {
    characters.spellBrowse.mockResolvedValue(choiceA);
    await mount(<Browser rule={{ identifier: 'A' }} />);
    await settle();

    await type($('input[placeholder="Filter spells…"]'), 'fire');
    await click($('[data-testid="spell-level-tab-2"]'));

    const input = $('input[placeholder="Filter spells…"]');
    expect(input).not.toBeNull();
    expect(input.value).toBe('fire');
    expect(rows()).toHaveLength(1);

    await type(input, '');
    expect(rows()).toHaveLength(2);
    expect($('input[placeholder="Filter spells…"]')).toBeNull();
  });
});
