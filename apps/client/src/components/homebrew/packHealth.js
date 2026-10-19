// Pack health: what is wrong with a pack's file, found by the engine without loading it, and the
// fix the editor can offer for each kind of problem. The engine names the pack element behind every
// finding, so the card can open it.

import { buildCollectionXml, collectionStoragePath } from './xmlBuilder.js';
import { elementForFinding, elementIdOf } from './packModel.js';

// Ids the pack replaces on purpose: a changed book element keeps the book's id, so it is not a
// duplicate. The engine reports those as `overrides`, which are notes and not problems.
function overriddenIds(pack) {
  return (pack.elements ?? [])
    .filter((element) => element.customDraft?.template === 'override')
    .map((element) => elementIdOf(element, pack));
}

/** The engine's findings for a pack's current file. */
export async function checkPackHealth(api, pack) {
  if (typeof api.content?.checkPack !== 'function') return [];
  const findings = await api.content.checkPack({
    path: collectionStoragePath(pack),
    xml: buildCollectionXml(pack),
    overrides: overriddenIds(pack),
  });
  return findings ?? [];
}

/** Findings that are faults; an `overrides` finding only says the pack replaces a book element. */
export const problemsIn = (findings) => findings.filter((finding) => finding.kind !== 'overrides');

const KIND_TITLES = {
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
