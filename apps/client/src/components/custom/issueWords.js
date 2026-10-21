// Validation messages in the author's words. The engine writes its issues for any caller (a path in
// the draft and a rule such as "pick the element that is granted"); the dialogs, Pack health and
// Load into builder all show them through here, so an author never reads "element", "block" or a
// path like "blocks[0].supports".

import { typeLabel } from './draftModel';

// Rules the engine states in its own terms, said plainly. Those not listed are already plain.
const PLAIN = new Map([
  ['pick the element that is granted', 'choose what it grants'],
  ['name the element that is granted', 'type the name of what it grants'],
  ['pick the kind of element that is granted from the menu', 'pick what it grants from the menu'],
  ['a grant names an element by id or by type and name', 'choose what it grants from the list, or type its name'],
  ['pick the element from the list', 'pick one from the list'],
  ['pick the element or optional rule this condition names', 'pick what this condition needs: something the character has, or an optional rule'],
  ['pick the element type this condition names', 'pick what kind of thing this condition checks'],
  ['pick the element this adds to', 'pick what this adds to'],
  ['name the kind of element this replaces', 'say what kind of thing this replaces'],
  ['a choice with its own items has the type List', 'a choice with your own items offers Your list'],
  ['this target takes a plain number', 'this one takes a plain number'],
]);

const BLOCK_PLACES = { choice: 'Player choice', modifier: 'Bonus', grant: 'Grant' };
const LIST_PLACES = { trackers: 'Uses per rest', scales: 'Grows with level', features: 'Feature', levels: 'Level' };

const grantAt = (draft, path) => {
  const found = /^blocks\[(\d+)\]/.exec(path ?? '');
  const block = found ? draft?.blocks?.[Number(found[1])] : null;
  return block?.kind === 'grant' ? block : null;
};

/** One issue's rule, plainly (lowercase, no place, no full stop). */
export function plainIssueMessage(issue, draft = null) {
  const path = issue.path ?? '';
  const message = issue.message ?? '';
  const grant = grantAt(draft, path);
  // An empty grant names what it is waiting for: "choose the spell to grant".
  if (grant && /\.target\.(id|name)$/.test(path)) {
    const kind = typeLabel(grant.target?.type ?? '').toLowerCase();
    if (kind) return grant.target?.by === 'name' ? `type the name of the ${kind} to grant` : `choose the ${kind} to grant`;
  }
  if (/supports|filter/.test(path) || /^a filter/.test(message)) {
    if (/^a filter tag cannot be empty/.test(message)) return 'a Has the tag filter is empty or uses one of , & | ( ) !; type a tag or remove the filter';
    if (/^a filter group needs at least one filter/.test(message)) return 'a filter group is empty; add a filter to it or remove it';
  }
  return PLAIN.get(message) ?? message;
}

// The part of the draft an issue is about, in the editor's words ("Player choice 2").
export function issuePlace(draft, path = '') {
  const block = /^blocks\[(\d+)\]/.exec(path);
  if (block) {
    const index = Number(block[1]);
    const kind = draft?.blocks?.[index]?.kind;
    const place = BLOCK_PLACES[kind] ?? 'Effect';
    const same = (draft?.blocks ?? []).filter((entry) => entry.kind === kind);
    const nth = (draft?.blocks ?? []).slice(0, index + 1).filter((entry) => entry.kind === kind).length;
    return same.length > 1 ? `${place} ${nth}` : place;
  }
  const list = /^(\w+)\[(\d+)\]/.exec(path);
  if (list && LIST_PLACES[list[1]]) {
    return (draft?.[list[1]] ?? []).length > 1 ? `${LIST_PLACES[list[1]]} ${Number(list[2]) + 1}` : LIST_PLACES[list[1]];
  }
  return '';
}

/** One draft issue as a sentence an author can act on: where it is, then what to do. */
export function plainDraftIssue(draft, issue) {
  const place = issuePlace(draft, issue.path);
  const message = plainIssueMessage(issue, draft);
  const sentence = place ? `${place}: ${message}` : message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
