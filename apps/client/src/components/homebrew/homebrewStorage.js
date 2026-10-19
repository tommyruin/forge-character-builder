// How a homebrew collection reaches the engine and the content store: one generated file per
// collection, at one path, used by saving, the warnings filter and deleting alike.

import {
  COLLECTION_STORED_FILE,
  UPLOAD_CATEGORY,
  buildCollectionXml,
  collectionContentSourceId,
  collectionStoragePath,
  makeSourceId,
} from './xmlBuilder.js';

// Findings that describe the content but do not stop it loading: the collection is in the
// library and its ids are final.
const NON_BLOCKING_KINDS = new Set(['missing-grant']);

// Folds copies left by earlier saves (each under a new random source id) into the stable file.
// Safe to repeat: it does nothing once a collection holds one copy.
export async function consolidateStrayCopies(api, drafts) {
  if (typeof api.content.consolidateHomebrew !== 'function') return 0;
  let removed = 0;
  for (const draft of drafts) {
    const result = await api.content.consolidateHomebrew({
      sourceId: collectionContentSourceId(draft),
      relativePath: COLLECTION_STORED_FILE,
      marker: makeSourceId(draft),
    });
    removed += result?.removed ?? 0;
  }
  return removed;
}

// Writes the collection's XML to its stored file (replacing the previous save) and sorts the
// engine's findings about that file into those that block it (`diagnostics`) and those that are
// advice (`warnings`).
export async function saveCollection(api, draft) {
  await consolidateStrayCopies(api, [draft]);
  const file = new File([buildCollectionXml(draft)], COLLECTION_STORED_FILE, { type: 'application/xml' });
  const result = await api.content.upload([file], UPLOAD_CATEGORY, {
    sourceId: collectionContentSourceId(draft),
  });
  const path = collectionStoragePath(draft);
  const findings = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.file === path);
  return {
    result,
    diagnostics: findings.filter((diagnostic) => !NON_BLOCKING_KINDS.has(diagnostic.kind)),
    warnings: findings.filter((diagnostic) => NON_BLOCKING_KINDS.has(diagnostic.kind)),
    rejected: (result.files ?? []).filter((entry) => !entry.accepted),
  };
}

export async function removeCollection(api, draft) {
  await consolidateStrayCopies(api, [draft]);
  return api.content.remove([collectionStoragePath(draft)]);
}
