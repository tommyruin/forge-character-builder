/**
 * DM grants: add/remove granted feats and ability-score elements, and the
 * grants DTO. Element registration mirrors the planItemEdits raw-edit style
 * (character/options.ts): the element node is appended after the level
 * wrappers, the sum entries at the end, and the registered count updated.
 * Spell grants reuse the magic planners' <additional> surface.
 */

import { childElements, getAttr, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { allowsDuplicate, type ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import {
  attrValueRange,
  createRegistrationContext,
  escapeXml,
  filledWrapperCount,
  registerElement,
  renderNodes,
  resolveElementType,
  type RawEdit,
} from "../selection/selection.js";
import { engineError } from "../errors.js";

export interface GrantedElementDto {
  kind: "spell" | "feat" | "ability";
  id: string;
  name: string;
  source: string;
}

export type DmGrantsDto = GrantedElementDto[];

/** Grantable element types: corpus types registered as standalone nodes. */
const GRANTED_TYPES: ReadonlySet<string> = new Set(["Feat", "Ability Score Improvement"]);

const isRegistered = (state: CharacterState, id: string): boolean =>
  state.sum.elements.some((entry) => entry.id === id);

/** The number of top-level granted nodes (selection-registered feats live inside level wrappers). */
function countGrantedNodes(nodes: CharacterState["elements"]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.id !== "" && GRANTED_TYPES.has(node.type)) count++;
  }
  return count;
}

/** Top-level Item/Magic Item nodes (mirrors the item-control count). */
function countItemNodes(nodes: CharacterState["elements"]): number {
  let count = 0;
  const walk = (list: CharacterState["elements"]): void => {
    for (const node of list) {
      if (node.id !== "" && (node.type === "Item" || node.type === "Magic Item")) count++;
      walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

/** True when `id` is registered inside the granted node's subtree in the document. */
function isSubtreeId(document: Dnd5eDocument, grantId: string, id: string): boolean {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return false;
  const grant = childElements(elementsNode, "element").find((node) => getAttr(node, "id") === grantId);
  if (!grant) return false;
  const ids = new Set<string>();
  const walk = (node: Dnd5eNode): void => {
    const own = getAttr(node, "id");
    if (own) ids.add(own);
    for (const childNode of childElements(node, "element")) walk(childNode);
  };
  walk(grant);
  return ids.has(id);
}

function removeNodeEdit(raw: string, node: Dnd5eNode): RawEdit {
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start -= 1;
  if (start > 0 && raw[start - 1] === "\r") start -= 1;
  return { start, end: node.end, replacement: "" };
}

function planSumAppendEdits(document: Dnd5eDocument, entries: Array<{ type: string; id: string }>): RawEdit[] {
  const edits: RawEdit[] = [];
  const sumView = document.root.build.sum;
  if (!sumView) return edits;
  const sumNode = sumView.node;
  const all = [...sumView.elements().map((e) => ({ type: e.type ?? "", id: e.id ?? "" })), ...entries];
  const inner = `\r\n${all
    .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
    .join("\r\n")}\r\n\t\t`;
  edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
  const count = attrValueRange(document.raw, sumNode, "element-count");
  if (count) edits.push({ start: count.start, end: count.end, replacement: String(all.length) });
  return edits;
}

function planSumReplaceEdits(document: Dnd5eDocument, remaining: Array<{ type: string; id: string }>): RawEdit[] {
  const sumView = document.root.build.sum;
  if (!sumView) return [];
  const sumNode = sumView.node;
  const inner = `\r\n${remaining
    .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
    .join("\r\n")}\r\n\t\t`;
  const edits: RawEdit[] = [{ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner }];
  const count = attrValueRange(document.raw, sumNode, "element-count");
  if (count) edits.push({ start: count.start, end: count.end, replacement: String(remaining.length) });
  return edits;
}

/** Recomputes the elements registered-count after a grant delta. */
function planRegisteredCountEdit(document: Dnd5eDocument, state: CharacterState, delta: number): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const registered =
    state.levelCount +
    filledWrapperCount(state.elements) +
    state.options.size +
    countItemNodes(state.elements) +
    countGrantedNodes(state.elements) +
    delta;
  const rc = attrValueRange(document.raw, elementsNode, "registered-count");
  if (!rc) return [];
  return [{ start: rc.start, end: rc.end, replacement: String(registered) }];
}

/**
 * Registers granted elements (all-or-nothing: validation runs before any
 * edit is produced). Mirrors planItemEdits: each element node is appended
 * after the level wrappers, its sum entries at the end, and the registered
 * count is raised by the number of granted ids.
 */
function planGrantedRegistrations(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  ids: string[],
  type: string,
  label: string,
): RawEdit[] {
  const seen = new Set<string>();
  const elements = ids.map((id) => {
    const element = library.byId.get(id);
    if (!element || element.identity.type !== type) {
      throw engineError("not-found", `${label} '${id}' not found`);
    }
    // Allow-duplicate elements (the +1 ability score improvements) may be
    // granted repeatedly — the same id twice in one request is a +2.
    if (!allowsDuplicate(element)) {
      if (seen.has(id)) {
        throw engineError("conflict", `${label} '${id}' is already granted`);
      }
      if (isRegistered(state, id)) {
        throw engineError("conflict", `${label} '${id}' is already granted`);
      }
    }
    seen.add(id);
    return element;
  });
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) throw engineError("not-found", "elements section not found");
  const insertAt = elementsNode.closeStart ?? elementsNode.end;
  const pad = "\t\t\t";
  const edits: RawEdit[] = [];
  const allIds: string[] = [];
  for (const element of elements) {
    const id = element.identity.id;
    const ctx = createRegistrationContext(state, library);
    const nodes = registerElement(element, library, state, ctx, new Set());
    const children = renderNodes(nodes ?? [], 4);
    const open = `<element type="${escapeXml(element.identity.type)}" name="${escapeXml(element.identity.name)}" id="${escapeXml(id)}"`;
    const nodeText = children === "" ? `${open} />` : `${open}>\r\n${children}\r\n${pad}</element>`;
    edits.push({ start: insertAt, end: insertAt, replacement: `\r\n${pad}${nodeText}` });
    allIds.push(id, ...ctx.ids.filter((granted) => granted !== id));
  }
  const entries = allIds.map((id) => ({ type: resolveElementType(library, id), id }));
  edits.push(...planSumAppendEdits(document, entries));
  edits.push(...planRegisteredCountEdit(document, state, ids.length));
  return edits;
}

/** Removes granted elements (all-or-nothing validation). */
function planGrantedRemovals(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  ids: string[],
  label: string,
): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) throw engineError("not-found", "elements section not found");
  const raw = document.raw;
  const edits: RawEdit[] = [];
  // Allow-duplicate elements can be granted more than once; each requested
  // id removes exactly one instance (one element node, one sum entry).
  const removeCounts = new Map<string, number>();
  for (const id of ids) removeCounts.set(id, (removeCounts.get(id) ?? 0) + 1);
  for (const [id, count] of removeCounts) {
    // Only DIRECT top-level nodes are DM grants; a selection result nests
    // inside a level/class wrapper and must not be removable here (its sum
    // entries belong to the selection, not to a grant).
    const existing = childElements(elementsNode, "element").filter((node) => getAttr(node, "id") === id);
    if (existing.length < count || !isRegistered(state, id)) {
      throw engineError("not-found", `${label} '${id}' is not granted`);
    }
    for (const node of existing.slice(0, count)) edits.push(removeNodeEdit(raw, node));
  }
  const sumBudget = new Map(removeCounts);
  const remaining = (document.root.build.sum?.elements() ?? [])
    .map((e) => ({ type: e.type ?? "", id: e.id ?? "" }))
    .filter((e) => {
      const budget = sumBudget.get(e.id) ?? 0;
      if (budget > 0) {
        sumBudget.set(e.id, budget - 1);
        return false;
      }
      return !ids.some((id) => id !== e.id && isSubtreeId(document, id, e.id));
    });
  edits.push(...planSumReplaceEdits(document, remaining));
  edits.push(...planRegisteredCountEdit(document, state, -ids.length));
  return edits;
}

/** Registers/unregisters a Feat element into the character's elements tree. */
export function planGrantedFeatEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  featId: string,
  action: "add" | "remove",
): RawEdit[] {
  if (action === "add") return planGrantedRegistrations(document, state, library, [featId], "Feat", "feat");
  return planGrantedRemovals(document, state, library, [featId], "feat");
}

/**
 * Registers/unregisters Ability Score Improvement elements (e.g. the
 * ID_INTERNAL_ASI_* corpus features). Multi-id operations are all-or-nothing.
 */
export function planGrantedAbilityScoreEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  abilityElementIds: string[],
  action: "add" | "remove",
): RawEdit[] {
  if (action === "add") {
    return planGrantedRegistrations(document, state, library, abilityElementIds, "Ability Score Improvement", "ability score");
  }
  return planGrantedRemovals(document, state, library, abilityElementIds, "ability score");
}

/**
 * The grants DTO: the character's <additional> spells (DM-granted source),
 * followed by the registered Feat and Ability Score Improvement elements
 * granted at the TOP LEVEL of the elements tree. Selection results (feats/
 * ASIs picked through class feat rules) nest inside level/class wrappers and
 * are never DM grants (Valerian/Samurai2 fixture evidence).
 */
export function buildDmGrantsDto(state: CharacterState, library: ElementLibrary): DmGrantsDto {
  const out: GrantedElementDto[] = [];
  if (state.magic !== null) {
    for (const spell of state.magic.additional) {
      if (!spell.source.startsWith("Additional Spell")) continue;
      out.push({ kind: "spell", id: spell.id, name: spell.name, source: spell.source });
    }
  }
  for (const node of state.elements) {
    if (node.id === "" || (node.type !== "Feat" && node.type !== "Ability Score Improvement")) continue;
    const element = library.byId.get(node.id);
    out.push({
      kind: node.type === "Feat" ? "feat" : "ability",
      id: node.id,
      name: element?.identity.name ?? node.name,
      source: element?.identity.source ?? "",
    });
  }
  return out;
}
