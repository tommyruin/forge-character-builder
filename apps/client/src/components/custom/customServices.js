// What the custom-feature UI needs from the rest of the app, behind one object so the form
// components and their tests never reach for the engine API or the browser database directly:
// library search for the pickers, the character's own pack, the choice-identity check, and
// "also save to a homebrew pack".

import { createCollection } from '../homebrew/xmlBuilder.js';

// The collection a promoted entry lands in until packs exist; one per device, found by name.
export const MY_HOMEBREW_NAME = 'My homebrew';

// Puts a promoted element into a homebrew collection's drafts. The id is the entry's stable
// id, so promoting the same entry again replaces its copy instead of adding a second one.
// Only the drafts store is written: the collection reaches the library when the author saves
// it from the Homebrew page, which keeps this entry's id from resolving twice in one library.
export async function writePromotedElement(store, promoted, collectionName = MY_HOMEBREW_NAME) {
  const records = await store.listHomebrew();
  const existing = records.find((record) => record.name === collectionName);
  const collection = existing ?? createCollection(collectionName);
  const elements = collection.elements ?? [];
  const at = elements.findIndex((element) => element.id === promoted.element.id);
  const next =
    at === -1
      ? [...elements, promoted.element]
      : elements.map((element, index) =>
          index === at ? { ...promoted.element, localId: element.localId ?? promoted.element.localId } : element,
        );
  await store.putHomebrew({ ...collection, elements: next });
  return collection.id;
}

export function makeCustomServices({ api, store, id, run, ruleset }) {
  const characters = api.characters;
  return {
    characterId: id,
    lookup: {
      search: async ({ type = '', search = '', take = 30 }) => {
        const page = await api.content.elements({
          type: type === '' ? undefined : type,
          search,
          take,
          ruleset: ruleset ?? 'all',
          characterId: id,
        });
        return (page.items ?? []).map((item) => ({ id: item.id, name: item.name, source: item.source }));
      },
      name: async (elementId) => (await api.content.element(elementId))?.name,
    },
    // The spellcasting features an always-prepared spell can join.
    casters: async () => {
      const casters = await characters.spellcasting(id);
      return (casters ?? []).filter((caster) => caster.kind === 'class').map((caster) => caster.name);
    },
    // The ability a new spell effect is cast with unless the author says otherwise: the first
    // spellcasting class's. Null for a character with no class spellcasting.
    defaultCastAbility: async () => {
      const casters = await characters.spellcasting(id);
      const first = (casters ?? []).find((caster) => caster.kind === 'class' && caster.ability);
      return first ? String(first.ability).toLowerCase() : null;
    },
    list: () => characters.customContent(id),
    impact: (draft) => characters.choiceIdentityImpact(id, draft),
    save: (draft, options) => run(() => characters.saveCustomDraft(id, draft, options)),
    // Every library weapon (or armor) a custom item can sit on, for the base menu.
    itemBases: async (kind) => {
      const page = await api.content.elements({
        type: kind === 'armor' ? 'Armor' : 'Weapon',
        ruleset: ruleset ?? 'all',
        characterId: id,
        take: 400,
      });
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
    // The weapon's attack row as the engine would print it, for the live preview.
    previewItem: (draft) => characters.previewCustomItem(id, draft),
    setItemDetails: (identifier, details) => run(() => characters.setItemDetails(id, identifier, details)),
    remove: (draftId) => run(() => characters.deleteCustomDraft(id, draftId)),
    promote: async (draft) => {
      const promoted = await characters.promoteCustomDraft(id, draft.id, MY_HOMEBREW_NAME);
      await writePromotedElement(store, promoted, MY_HOMEBREW_NAME);
      return MY_HOMEBREW_NAME;
    },
  };
}
