// Pack health: what is wrong with a pack's file, found by the engine without loading it, and the
// fix the editor can offer for each kind of problem. The engine names the pack element behind every
// finding, so the card can open it.

import { buildCollectionXml, collectionStoragePath, draftIssuesOf } from './xmlBuilder.js';
import { convertToFeature, elementForFinding, elementIdOf, loadedPack } from './packModel.js';
import { saveCollection } from './homebrewStorage.js';

// Ids the pack replaces on purpose: a changed book element keeps the book's id, so it is not a
// duplicate. The engine reports those as `overrides`, which are notes and not problems.
function overriddenIds(pack) {
  return (pack.elements ?? [])
    .filter((element) => element.customDraft?.template === 'override')
    .map((element) => elementIdOf(element, pack));
}

/**
 * What keeps a form-made element from loading (an unnamed choice, an empty filter), as findings of
 * kind `incomplete`. Load into builder and Share pack refuse a pack with any of them, so the card
 * lists them first instead of saying the pack is fine.
 */
export function incompleteFindings(pack) {
  return draftIssuesOf(pack).map(({ element, message }) => ({
    kind: 'incomplete',
    message,
    elementId: elementIdOf(element, pack),
    elementName: element.name?.trim() || 'An unnamed element',
  }));
}

/** The pack's findings: what stops it loading, then the engine's findings for its current file. */
export async function checkPackHealth(api, pack) {
  const incomplete = incompleteFindings(pack);
  if (typeof api.content?.checkPack !== 'function') return incomplete;
  const findings = await api.content.checkPack({
    path: collectionStoragePath(pack),
    xml: buildCollectionXml(pack),
    overrides: overriddenIds(pack),
  });
  return [...incomplete, ...(findings ?? [])];
}

/** Findings that are faults; an `overrides` finding only says the pack replaces a book element. */
export const problemsIn = (findings) => findings.filter((finding) => finding.kind !== 'overrides');

const KIND_TITLES = {
  incomplete: 'Not finished, so it cannot load',
  'missing-grant': 'Grants something that is not in your library',
  'duplicate-id': 'Defined twice',
  unattachable: 'Cannot be added to anyone',
  'missing-base': 'Has no base weapon or armour',
  'append-target': 'Adds to something that is not loaded',
  'invalid-requirements': 'Requirements the builder cannot read',
};

// A magic weapon or armour with no base says which of the two it lacks.
const MISSING_BASE_TITLES = { Weapon: 'Has no base weapon', Armor: 'Has no base armour' };

export const findingTitle = (finding) =>
  (finding.kind === 'missing-base' && MISSING_BASE_TITLES[finding.missingType]) || KIND_TITLES[finding.kind] || finding.kind;

/**
 * The fix offered for a finding, or null. `create-spell` makes the spell a grant is waiting for,
 * `convert` turns an unattachable Background Feature into a feature, and `open` goes to the element
 * that carries the problem (a magic weapon or armour with no base is fixed there, by giving it one).
 */
export function fixFor(finding, pack) {
  const element = elementForFinding(finding, pack);
  if (finding.kind === 'missing-grant' && finding.missingType === 'Spell') {
    return { action: 'create-spell', label: 'Create spell', element };
  }
  if (finding.kind === 'unattachable' && element) return { action: 'convert', label: 'Convert to feature', element };
  if (element) return { action: 'open', label: 'Open element', element };
  return null;
}

/**
 * What to import to settle a finding about something the library lacks: the id (or `Type "Name"`)
 * nothing defines, the type the rule wants, and the element that needs it. Null for a finding that
 * is not about a missing definition.
 */
export function sourceNeedFor(finding) {
  if (finding.kind === 'missing-grant') {
    return { label: finding.missingId ?? '', type: finding.missingType ?? '', neededBy: finding.elementName ?? '' };
  }
  if (finding.kind === 'append-target') {
    return { label: finding.targetId ?? '', type: '', neededBy: finding.elementName ?? '' };
  }
  return null;
}

// Every pack keeps its file at the same path around its id (see collectionStoragePath).
const [PACK_PATH_HEAD, PACK_PATH_TAIL] = collectionStoragePath({ id: 'PACKID' }).split('PACKID');

/** Whether a stored file is a pack's file, so a finding about it can be fixed in the pack. */
export function isPackFilePath(path) {
  if (typeof path !== 'string' || !path.startsWith(PACK_PATH_HEAD) || !path.endsWith(PACK_PATH_TAIL)) return false;
  const id = path.slice(PACK_PATH_HEAD.length, path.length - PACK_PATH_TAIL.length);
  return id !== '' && !id.includes('/');
}

/** The pack this device keeps whose file is at `path`, if any. */
export const packForFile = (packs, path) => (packs ?? []).find((pack) => collectionStoragePath(pack) === path) ?? null;

/**
 * Convert to feature from the upload screen: the health card's conversion, applied to the pack
 * that wrote the file and saved at once, since no editor is open to save it. A clean save marks
 * the pack as loaded, as Update builder does. Null when the finding is not about an element of a
 * pack this device keeps (an uploaded file that is not a pack, or a pack since deleted).
 */
export async function convertFindingInPack({ api, store, finding }) {
  const pack = packForFile(await store.listHomebrew(), finding.file);
  const element = pack ? elementForFinding(finding, pack) : null;
  if (!element) return null;
  const updated = {
    ...pack,
    elements: pack.elements.map((entry) => (entry.localId === element.localId ? convertToFeature(entry, pack) : entry)),
  };
  await store.putHomebrew(updated);
  const saved = await saveCollection(api, updated);
  api.content.clearCache?.();
  const clean = saved.diagnostics.length === 0 && saved.rejected.length === 0;
  const stored = clean ? loadedPack(updated) : updated;
  if (clean) await store.putHomebrew(stored);
  return { pack: stored, saved, clean };
}
