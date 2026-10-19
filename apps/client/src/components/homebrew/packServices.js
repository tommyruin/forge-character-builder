// What the custom-content forms need when they edit an element of a pack rather than an entry of a
// character: the same shape as `makeCustomServices`, with no character behind it. There is no caster
// to cast a spell, no attack row to preview and no inventory to add to; saving hands the draft to
// the pack being edited. The library lookup also offers the pack's own elements, so a grant can name
// the spell or feature the pack defines before the pack has been loaded.

import { elementIdOf } from './packModel.js';

function packEntries(pack, type, search) {
  const query = search.trim().toLowerCase();
  return (pack?.elements ?? [])
    .filter((element) => (type === '' || element.type === type) && (query === '' || element.name?.toLowerCase().includes(query)))
    .map((element) => ({ id: elementIdOf(element, pack), name: element.name, source: pack.name }));
}

export function makePackLookup(api, pack) {
  return {
    search: async ({ type = '', search = '', take = 30 }) => {
      const page = await api.content.elements({ type: type === '' ? undefined : type, search, take, ruleset: 'all' });
      const own = packEntries(pack, type, search);
      const ownIds = new Set(own.map((entry) => entry.id));
      const library = (page.items ?? []).filter((item) => !ownIds.has(item.id)).map((item) => ({ id: item.id, name: item.name, source: item.source }));
      return [...own, ...library].slice(0, take);
    },
    name: async (elementId) => {
      const own = (pack?.elements ?? []).find((element) => elementIdOf(element, pack) === elementId);
      return own?.name ?? (await api.content.element(elementId))?.name;
    },
  };
}

export function makePackFormServices({ api, pack, kind, onSave }) {
  return {
    characterId: null,
    lookup: makePackLookup(api, pack),
    casters: async () => [],
    defaultCastAbility: async () => null,
    list: async () => ({ entries: [], problems: [] }),
    itemBases: async (itemKind) => {
      const page = await api.content.elements({ type: itemKind === 'armor' ? 'Armor' : 'Weapon', ruleset: 'all', take: 400 });
      return (page.items ?? [])
        .map((item) => ({
          id: item.id,
          name: item.name,
          source: item.source,
          equipmentKind: item.equipmentKind ?? item.category ?? '',
          displayPrice: item.displayPrice ?? '',
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));
    },
    save: async (draft) => {
      await onSave(draft);
      return { entry: { kind, draft, elementId: draft.id } };
    },
  };
}
