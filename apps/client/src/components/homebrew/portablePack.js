// What of a stored pack travels with it. Kept free of imports so the package exporter in the
// transport can use it without loading the editor.

// Fields that describe this device's copy of a pack, not the pack: whether it is loaded into the
// library here, whether the editor has changes the library has not seen, and when the store last
// wrote it.
const DEVICE_FIELDS = ['ingestedAt', 'hasUnloadedChanges', 'updatedAt'];

/** When a pack was last changed, in milliseconds: its own version, else the time it was last stored. */
export function packVersion(pack) {
  const version = Number(pack?.version ?? pack?.updatedAt ?? 0);
  return Number.isFinite(version) ? version : 0;
}

/**
 * The pack as it travels: everything the editor needs to open it again and nothing about this
 * device. `keepLoaded` keeps each element's remembered library version, for a package whose
 * content files carry the library side of the same state.
 */
export function portablePack(pack, { keepLoaded = false } = {}) {
  const portable = { ...pack, version: packVersion(pack) };
  for (const field of DEVICE_FIELDS) delete portable[field];
  portable.elements = (pack.elements ?? []).map((element) => {
    if (keepLoaded) return element;
    const { loadedDraft: _loaded, ...rest } = element;
    return rest;
  });
  return portable;
}

const ELEMENT_ID = /\bid="(ID_[A-Za-z0-9_]+)"/g;

/** Every element id a pack's elements are stored under or write into their XML. */
export function packElementIds(pack) {
  const ids = new Set();
  for (const element of pack?.elements ?? []) {
    if (element.id) ids.add(element.id);
    if (element.customDraft?.id) ids.add(element.customDraft.id);
    if (typeof element.rawXml === 'string') for (const match of element.rawXml.matchAll(ELEMENT_ID)) ids.add(match[1]);
  }
  return ids;
}
