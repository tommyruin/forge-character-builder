// What the custom-feature UI needs from the rest of the app, behind one object so the form
// components and their tests never reach for the engine API or the browser database directly:
// library search for the pickers, the character's own pack, the choice-identity check, and
// "also save to a homebrew pack".

import { promoteCustomDraft } from '@forge-cb/engine/custom';
import { saveCollection } from '../homebrew/homebrewStorage.js';
import { packEntries } from '../homebrew/packServices.js';
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

// Writes a spell into a homebrew collection and saves the collection again, so a grant that named
// the spell by id resolves. The spell keeps the draft's id; saving it a second time replaces it.
// `collection` null means the pack that wrote the grant is not one of the builder's collections
// (an uploaded file): the spell goes to "My homebrew" instead, which a grant resolves through just
// as well, since ids are global to the library.
export async function addSpellToCollection({ api, store, collection, draft }) {
  const records = await store.listHomebrew();
  const target =
    collection ?? records.find((record) => record.name === MY_HOMEBREW_NAME) ?? createCollection(MY_HOMEBREW_NAME);
  const promoted = promoteCustomDraft(draft, target.name);
  const elements = target.elements ?? [];
  const at = elements.findIndex((element) => element.id === promoted.element.id);
  const next =
    at === -1
      ? [...elements, promoted.element]
      : elements.map((element, index) =>
          index === at ? { ...promoted.element, localId: element.localId ?? promoted.element.localId } : element,
        );
  const updated = { ...target, elements: next };
  await store.putHomebrew(updated);
  const saved = await saveCollection(api, updated);
  api.content.clearCache?.();
  return { collection: updated, saved };
}

// What the spell form needs when it makes a spell for a pack rather than for a character: there is
// no caster to cast it, no preview and no second place to copy it to.
export function makePackSpellServices({ api, store, collection, beforeSave }) {
  return {
    characterId: null,
    casters: async () => [],
    save: async (draft) => {
      await beforeSave?.();
      const { saved } = await addSpellToCollection({ api, store, collection, draft });
      if (saved.diagnostics.length > 0 || saved.rejected.length > 0) {
        const first = saved.diagnostics[0] ?? null;
        throw new Error(first ? first.message : `${saved.rejected[0].fileName}: ${saved.rejected[0].error ?? 'rejected'}`);
      }
      return { entry: { kind: 'spell', draft, elementId: draft.id, result: saved.result }, saved };
    },
  };
}

const PENDING_NOTE = 'Not in the builder yet: press Update builder on the pack';

// What a pack defines that the library has not loaded: a feature made a moment ago exists only in
// the pack's drafts until Update builder puts the file into the library. It is offered, marked, so
// a grant can name it now; the mark says why it does nothing until the pack is updated.
async function unbuiltPackEntries(store, type, search, taken) {
  let packs;
  try {
    packs = (await store?.listHomebrew?.()) ?? [];
  } catch {
    return [];
  }
  return packs
    .filter((pack) => pack.hasUnloadedChanges === true || !pack.ingestedAt)
    .flatMap((pack) => packEntries(pack, type, search))
    .filter((entry) => !taken.has(entry.id))
    .map((entry) => ({ ...entry, pending: PENDING_NOTE }));
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
        const found = (page.items ?? []).map((item) => ({ id: item.id, name: item.name, source: item.source }));
        const unbuilt = await unbuiltPackEntries(store, type, search, new Set(found.map((item) => item.id)));
        return [...found, ...unbuilt].slice(0, take);
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
    // The spell's attack or save row for a caster, as the engine would print it, for the live preview.
    previewSpell: (draft, caster) => characters.previewCustomSpell(id, draft, caster),
    setItemDetails: (identifier, details) => run(() => characters.setItemDetails(id, identifier, details)),
    remove: (draftId) => run(() => characters.deleteCustomDraft(id, draftId)),
    promote: async (draft) => {
      const promoted = await characters.promoteCustomDraft(id, draft.id, MY_HOMEBREW_NAME);
      await writePromotedElement(store, promoted, MY_HOMEBREW_NAME);
      return MY_HOMEBREW_NAME;
    },
  };
}
