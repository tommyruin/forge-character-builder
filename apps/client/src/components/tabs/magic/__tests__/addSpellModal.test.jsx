// @vitest-environment happy-dom
// Magic's "Add a spell (DM / homebrew grant)" dialog: it grants the spell to the caster it was
// told, and offers to create a spell the library lacks.
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { characters, content } = vi.hoisted(() => ({
  characters: { addSpell: vi.fn(async () => ({})) },
  content: { elements: vi.fn() },
}));
vi.mock('../../../../api', () => ({ api: { characters, content } }));

import AddSpellModal from '../AddSpellModal';
import { WorkspaceContext } from '../../../WorkspaceContext';
import { buttonByText, byLabel, choose, click, mount, settle, type } from '../../../custom/__tests__/harness';

const CASTERS = [
  { name: 'Wizard', kind: 'class' },
  { name: 'Warlock', kind: 'class' },
  { name: 'Additional Spells', kind: 'feature' },
  { name: 'Magic Initiate', kind: 'feature' },
];

const FIRE_BOLT = { id: 'ID_FIRE_BOLT', name: 'Fire Bolt', source: 'Test Book', detail: 'Cantrip' };

async function open(props = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const onCreate = vi.fn();
  await mount(
    <WorkspaceContext.Provider value={{ detail: { rulesetMode: '2014' } }}>
      <AddSpellModal id="ilyana" casters={CASTERS} open onClose={onClose} onAdded={onAdded} onCreate={onCreate} {...props} />
    </WorkspaceContext.Provider>,
  );
  return { onClose, onAdded, onCreate };
}

// The dialog waits for the player to pause before it searches.
async function pause() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  await settle();
}

async function search(text) {
  await type(document.querySelector('input[placeholder="Search all spells…"]'), text);
  await pause();
}

beforeEach(() => {
  characters.addSpell.mockClear();
  content.elements.mockReset();
  content.elements.mockResolvedValue({ items: [FIRE_BOLT] });
});

describe('a spell the character already has', () => {
  const withSpell = (knownSpell) => CASTERS.map((caster) => (caster.name === 'Magic Initiate' ? { ...caster, knownSpells: [knownSpell] } : { ...caster, knownSpells: [] }));

  it('warns that a feature already grants it, and still lets the grant through', async () => {
    await open({ casters: withSpell({ id: 'ID_FIRE_BOLT', name: 'Fire Bolt', isAlwaysPrepared: true }) });
    await pause();
    const note = document.querySelector('[data-testid="already-granted"]');
    expect(note.textContent).toContain('Magic Initiate');
    expect(note.textContent).toContain('Already on this character');
    expect(buttonByText('Add')).toBeUndefined();
    await click(buttonByText('Add anyway'));
    await settle();
    expect(characters.addSpell).toHaveBeenCalledWith('ilyana', 'ID_FIRE_BOLT', 'Wizard');
  });

  it('says nothing about a spell no caster lists', async () => {
    await open({ casters: withSpell({ id: 'ID_OTHER', name: 'Other', isAlwaysPrepared: true }) });
    await pause();
    expect(document.querySelector('[data-testid="already-granted"]')).toBeNull();
    expect(buttonByText('Add')).toBeDefined();
  });
});

describe('adding a spell to a caster', () => {
  it('offers the character\'s class casters, not a feature\'s, and starts on the one it was opened from', async () => {
    await open({ defaultCaster: 'Warlock' });
    await settle();
    const select = byLabel('Add to');
    expect([...select.options].map((option) => option.value)).toEqual(['Wizard', 'Warlock', '']);
    expect(select.value).toBe('Warlock');
  });

  it('starts on the first class caster when it was opened from a feature caster', async () => {
    await open({ defaultCaster: 'Additional Spells' });
    await settle();
    expect(byLabel('Add to').value).toBe('Wizard');
  });

  it('sends the chosen caster with the spell', async () => {
    const { onAdded, onClose } = await open();
    await pause();
    await choose(byLabel('Add to'), 'Warlock');
    await click(buttonByText('Add'));
    await settle();
    expect(characters.addSpell).toHaveBeenCalledWith('ilyana', 'ID_FIRE_BOLT', 'Warlock');
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends no caster for Additional Spells', async () => {
    await open();
    await pause();
    await choose(byLabel('Add to'), '');
    await click(buttonByText('Add'));
    await settle();
    expect(characters.addSpell).toHaveBeenCalledWith('ilyana', 'ID_FIRE_BOLT', null);
  });
});

describe('a spell the library lacks', () => {
  it('offers to create it, with the caster the player chose', async () => {
    content.elements.mockResolvedValue({ items: [] });
    const { onCreate, onClose } = await open({ defaultCaster: 'Wizard' });
    await search('Frost Lance');
    expect(document.body.textContent).toContain("Frost Lance isn't in your library. Create it?");
    await choose(byLabel('Add to'), 'Warlock');
    await click(buttonByText('Create spell'));
    expect(onCreate).toHaveBeenCalledWith({ name: 'Frost Lance', caster: 'Warlock' });
    expect(onClose).toHaveBeenCalled();
  });

  it('stays quiet while the search is empty or finds something', async () => {
    content.elements.mockResolvedValue({ items: [] });
    await open();
    await settle();
    expect(document.body.textContent).not.toContain('Create it?');
    content.elements.mockResolvedValue({ items: [FIRE_BOLT] });
    await search('Fire');
    expect(document.body.textContent).not.toContain('Create it?');
  });
});
