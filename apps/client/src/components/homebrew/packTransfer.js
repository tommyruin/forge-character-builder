// Bringing a shared pack file into this device: what the file is, how it compares with a pack
// already here (by pack id), and the import itself. The Homebrew page and Content › Manage files
// both use this, so a pack file behaves the same wherever it is added.

import { saveCollection } from './homebrewStorage.js';
import { isPackFile, packVersion, readPackFile } from './packFile.js';
import { elementIdOf, loadedPack, migratePack } from './packModel.js';
import { validateDraft } from './xmlBuilder.js';

export { isPackFile };

const idsOf = (pack) => new Set((pack.elements ?? []).map((element) => elementIdOf(element, pack)));

/**
 * What importing a file would do. `new`: no pack here has its id. `update`: one does, and
 * `relation` says whether the file's copy is `newer`, the `same` age or `older`; the elements the
 * update would add and drop are listed so the confirm can name them. `invalid` carries why a pack
 * file could not be read, and `not-pack` is any other file.
 */
export function planPackImport(text, existingPacks) {
  const read = readPackFile(text);
  if (read.notPack) return { kind: 'not-pack' };
  if (read.error) return { kind: 'invalid', error: read.error };
  const incoming = migratePack(read.pack);
  const manifest = read.manifest;
  const existing = (existingPacks ?? []).map(migratePack).find((pack) => pack.id === incoming.id);
  if (!existing) return { kind: 'new', incoming, manifest };
  const incomingVersion = packVersion(incoming);
  const existingVersion = packVersion(existing);
  const relation = incomingVersion > existingVersion ? 'newer' : incomingVersion === existingVersion ? 'same' : 'older';
  const before = idsOf(existing);
  const after = idsOf(incoming);
  return {
    kind: 'update',
    incoming,
    existing,
    manifest,
    relation,
    added: incoming.elements.filter((element) => !before.has(elementIdOf(element, incoming))).map((element) => element.name),
    removed: existing.elements.filter((element) => !after.has(elementIdOf(element, existing))).map((element) => element.name),
  };
}

/**
 * Stores the pack and loads its file into the library, the way Update builder does. A pack that
 * does not pass validation is stored and left unloaded, so it can still be opened and fixed. The
 * pack keeps the id and version of the file, so a later copy of it updates this one in place.
 */
export async function applyPackImport(plan, { api, store, beforeLibraryMutation, onLibraryChanged, onLibraryMutationFinished }) {
  if (plan.kind !== 'new' && plan.kind !== 'update') throw new Error('Nothing to import.');
  const incoming = { ...plan.incoming, ingestedAt: null, hasUnloadedChanges: false };
  const errors = validateDraft(incoming);
  await beforeLibraryMutation?.();
  try {
    if (errors.length > 0) {
      await store.putHomebrew({ ...incoming, hasUnloadedChanges: true, ingestedAt: plan.kind === 'update' ? (plan.existing.ingestedAt ?? null) : null });
      await onLibraryChanged?.({ source: 'homebrew', result: {} });
      return { ok: false, stored: true, errors, pack: incoming };
    }
    await store.putHomebrew(incoming);
    const { result, diagnostics, warnings, rejected } = await saveCollection(api, incoming);
    api.content.clearCache?.();
    await onLibraryChanged?.({ source: 'homebrew', result });
    if (diagnostics.length > 0 || rejected.length > 0) {
      await store.putHomebrew({ ...incoming, hasUnloadedChanges: true });
      return { ok: false, stored: true, diagnostics, rejected, pack: incoming };
    }
    const loaded = loadedPack(incoming);
    await store.putHomebrew(loaded);
    return { ok: true, stored: true, count: result.elementCountAfterReload, warnings, pack: loaded };
  } finally {
    onLibraryMutationFinished?.();
  }
}
