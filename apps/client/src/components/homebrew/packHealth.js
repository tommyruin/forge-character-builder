// Pack health: what is wrong with a pack's file, found by the engine without loading it, and the
// fix the editor can offer for each kind of problem. The engine names the pack element behind every
// finding, so the card can open it.

import { buildCollectionXml, collectionStoragePath, draftIssuesOf } from './xmlBuilder.js';
import { elementForFinding, elementIdOf } from './packModel.js';

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
  'append-target': 'Adds to something that is not loaded',
  'invalid-requirements': 'Requirements the builder cannot read',
};

export const findingTitle = (finding) => KIND_TITLES[finding.kind] ?? finding.kind;

/**
 * The fix offered for a finding, or null. `create-spell` makes the spell a grant is waiting for,
 * `convert` turns an unattachable Background Feature into a feature, and `open` goes to the element
 * that carries the problem.
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
