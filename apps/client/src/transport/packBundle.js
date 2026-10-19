// The packs a `.dnd5e-pkg` carries. The package already bundles the content files stored on the
// device, which is what lets another device load a character's custom content. This adds the packs
// behind the files that the character uses, as the editor keeps them (drafts and details), so the
// other device gets them as packs it can edit and not only as loaded XML. A package without this
// part is read exactly as before, and a build that does not know the part ignores it.

import { packElementIds, packVersion, portablePack } from '../components/homebrew/portablePack.js';
import { contentStoragePath } from './contentStorage.js';

// The file name a pack is always stored under (see `collectionStoragePath`).
const PACK_STORED_FILE = 'collection.xml';

const ELEMENT_IDS = /\bID_[A-Za-z0-9_]+\b/g;

/** The packs whose elements the character's document names. */
export function packsUsedBy(records, characterXml) {
  const named = new Set(String(characterXml ?? '').match(ELEMENT_IDS) ?? []);
  return (records ?? []).filter((pack) => {
    for (const id of packElementIds(pack)) if (named.has(id)) return true;
    return false;
  });
}

/** The package's `packs` part for those packs; empty (so the part is left out) when none apply. */
export function bundledPacks(records, characterXml) {
  return packsUsedBy(records, characterXml).map((pack) => ({
    pack: portablePack(pack, { keepLoaded: true }),
    loaded: Boolean(pack.ingestedAt),
    unloadedChanges: pack.hasUnloadedChanges === true,
  }));
}

/** Where a pack's loaded file is stored, which is the same on every device. */
export const packStoredPath = (packId) => contentStoragePath(`homebrew-${packId}`, PACK_STORED_FILE);

const isPack = (value) =>
  value && typeof value === 'object' && typeof value.id === 'string' && value.id !== '' && typeof value.name === 'string' && Array.isArray(value.elements);

/**
 * Puts a package's packs into the device's pack store. A pack the device already has is kept when
 * its own copy is as new or newer, so opening an old package never undoes later edits. A pack is
 * marked loaded only when the package carries its file (`contentPaths`), since a pack with no
 * file in the library is not loaded however it was left on the other device.
 *
 * Returns every pack in the package that has an id, with whether it was `written` here.
 */
export async function restoreBundledPacks(store, entries, contentPaths = new Set()) {
  if (typeof store?.putHomebrew !== 'function' || !Array.isArray(entries)) return [];
  const results = [];
  for (const entry of entries) {
    const pack = entry?.pack;
    if (!isPack(pack)) continue;
    const existing = typeof store.getHomebrew === 'function' ? await store.getHomebrew(pack.id) : undefined;
    if (existing && packVersion(existing) >= packVersion(pack)) {
      results.push({ id: pack.id, name: pack.name, written: false });
      continue;
    }
    const hasFile = entry.loaded === true && contentPaths.has(packStoredPath(pack.id));
    await store.putHomebrew({
      ...pack,
      ingestedAt: hasFile ? Date.now() : null,
      hasUnloadedChanges: entry.unloadedChanges === true || (entry.loaded === true && !hasFile),
    });
    results.push({ id: pack.id, name: pack.name, written: true, loaded: hasFile });
  }
  return results;
}
