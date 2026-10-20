import { describe, expect, it, vi } from 'vitest';
import { makeCustomServices } from '../customServices';

const feature = (name, extra = {}) => ({ localId: `l-${name}`, type: 'Custom Feature', name, id: `ID_HB_MOON_${name.toUpperCase().replace(/\W/g, '_')}`, idLocked: true, ...extra });

function services({ packs, library = [] }) {
  const api = {
    content: { elements: vi.fn(async ({ type, search }) => ({ items: library.filter((item) => (!type || item.type === type) && item.name.toLowerCase().includes(search.toLowerCase())) })) },
    characters: {},
  };
  const store = { listHomebrew: vi.fn(async () => packs) };
  return makeCustomServices({ api, store, id: 'ilyana', run: async (operation) => operation() });
}

describe('searching for something a pack defines but the builder has not loaded', () => {
  const pack = { id: 'p1', name: 'Moonwell', hasUnloadedChanges: true, ingestedAt: 1, elements: [feature('Tide Mark')] };

  it('offers the pack element, and says it needs Update builder', async () => {
    const found = await services({ packs: [pack] }).lookup.search({ type: 'Custom Feature', search: 'tide' });
    expect(found).toEqual([{ id: 'ID_HB_MOON_TIDE_MARK', name: 'Tide Mark', source: 'Moonwell', pending: 'Not in the builder yet: press Update builder on the pack' }]);
  });

  it('offers nothing for a pack whose file is already loaded, or for another type', async () => {
    const loaded = { ...pack, hasUnloadedChanges: false };
    expect(await services({ packs: [loaded] }).lookup.search({ type: 'Custom Feature', search: 'tide' })).toEqual([]);
    expect(await services({ packs: [pack] }).lookup.search({ type: 'Spell', search: 'tide' })).toEqual([]);
  });

  it('lists the library element once when the pack element is already in it', async () => {
    const library = [{ id: 'ID_HB_MOON_TIDE_MARK', name: 'Tide Mark', source: 'Moonwell', type: 'Custom Feature' }];
    const found = await services({ packs: [pack], library }).lookup.search({ type: 'Custom Feature', search: 'tide' });
    expect(found).toEqual([{ id: 'ID_HB_MOON_TIDE_MARK', name: 'Tide Mark', source: 'Moonwell' }]);
  });

  it('still answers when the device store cannot be read', async () => {
    const api = { content: { elements: vi.fn(async () => ({ items: [] })) }, characters: {} };
    const store = { listHomebrew: vi.fn(async () => { throw new Error('blocked'); }) };
    const lookup = makeCustomServices({ api, store, id: 'x', run: async (operation) => operation() }).lookup;
    expect(await lookup.search({ type: 'Custom Feature', search: 'a' })).toEqual([]);
  });
});
