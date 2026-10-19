// Which pick list a subclass or a subspecies answers to. A class offers its subclasses through a
// select of type Archetype on one of its features, and a species offers subspecies through a
// select of type Sub Race or Race Variant, both naming a tag (`supports`). A pack's own class or
// species states its tag in its draft; a book's is found by reading the rules of the element and of
// the features it grants, which the content API returns as XML.

import { subclassTagOf } from '@forge-cb/engine/custom';

const MAX_ELEMENTS = 60;

/** What the parents of a kind are: the template of the pack element, the book type, the select types. */
export const PARENT_KINDS = {
  subclass: { parentTemplate: 'class', parentType: 'Class', selects: ['Archetype'], grants: ['Class Feature'], noun: 'class' },
  subspecies: { parentTemplate: 'species', parentType: 'Race', selects: ['Sub Race', 'Race Variant'], grants: ['Racial Trait'], noun: 'species' },
};

/** The classes or species a pack makes, with the tag their pick answers to (null when they offer none). */
export function packParents(pack, kind) {
  const spec = PARENT_KINDS[kind];
  const out = [];
  for (const element of pack?.elements ?? []) {
    const draft = element.customDraft;
    if (!draft || draft.template !== spec.parentTemplate) continue;
    if (kind === 'subclass') {
      out.push({ id: draft.id, name: draft.name, tag: draft.subclass ? subclassTagOf(draft) : null, kind: null });
    } else {
      out.push({ id: draft.id, name: draft.name, tag: draft.subspecies ? draft.subspecies.tag?.trim() || draft.name.trim() : null, kind: draft.subspecies?.kind ?? null });
    }
  }
  return out;
}

const unescapeXml = (text) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

/** The `<select>` and `<grant>` rules of a rules block, as `{ name, attrs }`; a rule's own children do not matter here. */
function readRules(xml) {
  if (!xml) return [];
  const rules = [];
  for (const tag of xml.matchAll(/<(select|grant)\b([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const attr of tag[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[attr[1]] = unescapeXml(attr[2]);
    rules.push({ name: tag[1], attrs });
  }
  return rules;
}

/**
 * The tag a loaded class or species' subclass or subspecies pick answers to, found by walking the
 * element and the features it grants; null when it offers none. Resolves to `{ tag, kind }`, where
 * `kind` is the select's type.
 */
export async function findPickTag(api, id, kind) {
  const spec = PARENT_KINDS[kind];
  const queue = [id];
  const seen = new Set();
  while (queue.length > 0 && seen.size < MAX_ELEMENTS) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const element = await api.content.element(next);
    for (const rule of readRules(element?.rules)) {
      const { type, supports, id: grantId } = rule.attrs;
      if (rule.name === 'select' && spec.selects.includes(type) && supports) return { tag: supports, kind: type };
      if (rule.name === 'grant' && spec.grants.includes(type) && grantId) queue.push(grantId);
    }
  }
  return null;
}
