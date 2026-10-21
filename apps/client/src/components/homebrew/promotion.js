// Promotion: copying entries into a named pack, a world pack included. The entries keep their ids,
// so a character that already uses one keeps resolving it, and anything an entry refers to (an
// item's granted feature, a subclass's class) is offered along with it so the pack holds what it
// needs. Only the pack's drafts are written; the pack reaches the library when it is loaded from
// the Homebrew page, which keeps an entry's id from resolving twice in one library.

import { customPackDraftIssues, linkedCustomIds, packElementFor } from '@forge-cb/engine/custom';
import { elementIdOf } from './packModel.js';
import { buildElementXml, createCollection, plainDraftIssue } from './xmlBuilder.js';

/** A new pack made for sharing with the table. */
export function createWorldPack({ name, author = '' }) {
  return { ...createCollection(name.trim()), author: author.trim(), world: true };
}

/** The `source` of a raw element's root tag follows the pack it now sits in. */
export function retargetRawXml(xml, sourceName) {
  return xml.replace(/^(\s*<element\b[^>]*?\bsource=")[^"]*(")/, (_, head, tail) => `${head}${sourceName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}${tail}`);
}

/**
 * The entry as an element of `target`. A form-made entry is compiled again under the pack's name;
 * an element written as XML keeps its XML with the new source name.
 */
export function elementForTarget(item, target, sourcePack) {
  if (item.draft) return packElementFor(item.draft, target.name, { tolerant: true });
  const element = item.element;
  // A form-made element's draft is its source of truth, so it is compiled again for the new pack.
  if (element.customDraft) return packElementFor(element.customDraft, target.name, { tolerant: true });
  const home = sourcePack ?? target;
  const { loadedDraft: _loaded, ...rest } = element;
  return {
    ...rest,
    localId: crypto.randomUUID(),
    rawXml: retargetRawXml(buildElementXml(element, home), target.name),
    id: elementIdOf(element, home),
    idLocked: true,
  };
}

/**
 * What a promotion would bring: the entry, and for each element it refers to, either the entry to
 * copy, a note that the target pack already holds it, or the id nothing here defines.
 * `find(id)` returns `{ key, name, meta, draft | element }` for an entry the source has, else null.
 */
export function planPromotion({ primary, find, target }) {
  const held = new Set((target?.elements ?? []).map((element) => element.id));
  const items = [{ ...primary, linked: false, replaces: held.has(primary.id) }];
  const seen = new Set([primary.id]);
  const notFound = [];
  const queue = [...(primary.refs ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = find(id);
    if (!entry) {
      notFound.push(id);
      continue;
    }
    items.push({ ...entry, id, linked: true, replaces: held.has(id) });
    queue.push(...(entry.refs ?? []));
  }
  return { items, notFound };
}

/** The ids a draft refers to, for a plan. */
export const refsOfDraft = (draft) => (draft ? linkedCustomIds(draft) : []);

/** The ids a pack element refers to: its draft's, else any builder-made id its XML names. */
export function refsOfElement(element) {
  if (element.customDraft) return linkedCustomIds(element.customDraft);
  const own = element.id;
  const found = new Set((element.rawXml ?? '').match(/\bID_CUSTOM_[A-Z0-9_]+\b/g) ?? []);
  found.delete(own);
  return [...found];
}

/**
 * What keeps an entry from being copied: the issues of its draft (a form-made element or a
 * character's entry), in plain words. An element written as XML has no draft and is copied as it is.
 */
export function promotionProblems(item) {
  const draft = item.draft ?? item.element?.customDraft;
  if (!draft || typeof draft !== 'object') return [];
  return customPackDraftIssues(draft).map((issue) => plainDraftIssue(draft, issue));
}

/**
 * Writes the chosen entries into the target pack, creating it when `target.create` says so. An
 * entry whose id the pack already holds replaces that copy in place. Returns the stored pack and
 * which entries were added or replaced.
 */
export async function promoteToPack({ store, target, items, sourcePack = null, now = Date.now() }) {
  // An unfinished entry would land in the pack and stop it loading, so nothing is written.
  for (const item of items) {
    const problems = promotionProblems(item);
    if (problems.length > 0) throw new Error(`${item.name} is not finished: ${problems.join(' ')}`);
  }
  const records = await store.listHomebrew();
  const pack = target.create ? createWorldPack(target.create) : records.find((record) => record.id === target.packId);
  if (!pack) throw new Error('That pack no longer exists.');
  const elements = [...(pack.elements ?? [])];
  const added = [];
  const replaced = [];
  for (const item of items) {
    const next = elementForTarget(item, pack, sourcePack);
    const at = elements.findIndex((element) => element.id && element.id === next.id);
    if (at === -1) {
      elements.push(next);
      added.push(next.name);
    } else {
      elements[at] = { ...next, localId: elements[at].localId ?? next.localId };
      replaced.push(next.name);
    }
  }
  const stored = { ...pack, elements, version: now, ...(pack.ingestedAt ? { hasUnloadedChanges: true } : {}) };
  await store.putHomebrew(stored);
  return { pack: stored, added, replaced };
}
