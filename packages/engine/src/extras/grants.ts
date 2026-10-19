import { STANDALONE_FEATURE_TYPES, registrationCount } from "../character/registration-count.js";
/**
 * DM grants: add/remove granted feature elements (feats, ability scores,
 * traits, custom features ...), and the grants DTO. Element registration
 * mirrors the planItemEdits raw-edit style (character/options.ts): the element
 * node is appended after the level wrappers, the sum entries at the end, and
 * the registered count updated. Spell grants reuse the magic planners'
 * <additional> surface.
 */

import { childElements, getAttr, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import type { DmGrantDto } from "@forge-cb/api";
import { characterPackOwners } from "../content/character-packs.js";
import { allowsDuplicate, type ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import type { CharacterState } from "../character/state.js";
import { buildSectionOfType, contentOrigin } from "../custom/placement.js";
import {
  attrValueRange,
  createRegistrationContext,
  escapeXml,
  registerElement,
  renderNodes,
  resolveElementType,
  type RawEdit,
} from "../selection/selection.js";
import { engineError } from "../errors.js";
import {
  isItemRegistrationNode,
  itemOwnedRegistrationIds,
  subtreeIdsOf as subtreeIdsOfNode,
} from "../inventory/item-registration.js";

export type GrantedElementDto = DmGrantDto;

export type DmGrantsDto = DmGrantDto[];

/**
 * The element types a top-level grant may register: the feature types that
 * stand on their own, plus the plain tokens a DM hands out (a language, a
 * proficiency, a sense). Physical items join through the inventory, spells
 * through <additional>, and a class, race or background through the build.
 */
export const GRANTABLE_FEATURE_TYPES: ReadonlySet<string> = STANDALONE_FEATURE_TYPES;

/** Whether an element may be granted at the top level. */
export function isGrantableFeature(element: ParsedElement): boolean {
  return GRANTABLE_FEATURE_TYPES.has(element.identity.type);
}


/** How many times the id appears in the `<sum>`. */
const registeredCountOf = (state: CharacterState, id: string): number =>
  state.sum.elements.filter((entry) => entry.id === id).length;

/**
 * Whether the element is already a DM grant. An element an active inventory
 * item registers is not: the item owns that copy and takes it away again when
 * it stops conveying its benefits, so the DM must still be able to grant the
 * same element in their own right.
 */
const isGranted = (
  state: CharacterState,
  itemOwned: ReadonlyMap<string, number>,
  id: string,
): boolean => registeredCountOf(state, id) > (itemOwned.get(id) ?? 0);

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
  const registered = registrationCount(state) + delta;
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
  accepts: (element: ParsedElement) => boolean,
  label: string,
): RawEdit[] {
  const seen = new Set<string>();
  const itemOwned = itemOwnedRegistrationIds(document, library);
  const elements = ids.map((id) => {
    const element = library.byId.get(id);
    // Another character's own custom content is not this character's to be granted.
    const owners = characterPackOwners(library, id);
    if (!element || !accepts(element) || (owners !== undefined && !owners.has(state.id))) {
      throw engineError("not-found", `${label} '${id}' not found`);
    }
    // Allow-duplicate elements (the +1 ability score improvements) may be
    // granted repeatedly — the same id twice in one request is a +2.
    if (!allowsDuplicate(element)) {
      if (seen.has(id)) {
        throw engineError("conflict", `${label} '${id}' is already granted`);
      }
      if (isGranted(state, itemOwned, id)) {
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
  const itemOwned = itemOwnedRegistrationIds(document, library);
  // Each removed node gives up one sum instance of every id it registered.
  // Another registration — a second grant, or an active item's own subtree —
  // may hold its own copy of the same id, so budget the removals instead of
  // sweeping every match out of the list.
  const sumBudget = new Map(removeCounts);
  for (const [id, count] of removeCounts) {
    // Only DIRECT top-level nodes are DM grants; a selection result nests
    // inside a level/class wrapper and must not be removable here (its sum
    // entries belong to the selection, not to a grant).
    const existing = childElements(elementsNode, "element").filter((node) => getAttr(node, "id") === id);
    const grantNodes = existing.filter((node) => !isItemRegistrationNode(library, node));
    if (grantNodes.length < count || !isGranted(state, itemOwned, id)) {
      throw engineError("not-found", `${label} '${id}' is not granted`);
    }
    for (const node of grantNodes.slice(0, count)) {
      edits.push(removeNodeEdit(raw, node));
      for (const subId of subtreeIdsOfNode(node)) {
        if (subId === id) continue;
        sumBudget.set(subId, (sumBudget.get(subId) ?? 0) + 1);
      }
    }
  }
  const remaining = (document.root.build.sum?.elements() ?? [])
    .map((e) => ({ type: e.type ?? "", id: e.id ?? "" }))
    .filter((e) => {
      const budget = sumBudget.get(e.id) ?? 0;
      if (budget > 0) {
        sumBudget.set(e.id, budget - 1);
        return false;
      }
      return true;
    });
  edits.push(...planSumReplaceEdits(document, remaining));
  edits.push(...planRegisteredCountEdit(document, state, -ids.length));
  return edits;
}

/**
 * Registers/unregisters any grantable feature element (book, homebrew, or the
 * character's own pack) at the top level of the character's elements tree.
 */
export function planGrantedElementEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  elementId: string,
  action: "add" | "remove",
): RawEdit[] {
  if (action === "add") {
    return planGrantedRegistrations(document, state, library, [elementId], isGrantableFeature, "element");
  }
  return planGrantedRemovals(document, state, library, [elementId], "element");
}

/** Registers/unregisters a Feat element into the character's elements tree. */
export function planGrantedFeatEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  featId: string,
  action: "add" | "remove",
): RawEdit[] {
  if (action === "add") {
    return planGrantedRegistrations(document, state, library, [featId], (element) => element.identity.type === "Feat", "feat");
  }
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
    return planGrantedRegistrations(
      document,
      state,
      library,
      abilityElementIds,
      (element) => element.identity.type === "Ability Score Improvement",
      "ability score",
    );
  }
  return planGrantedRemovals(document, state, library, abilityElementIds, "ability score");
}

/**
 * The grants DTO: the character's <additional> spells (DM-granted source),
 * followed by the registered grantable elements (feats, ability score
 * improvements, traits, custom features ...) granted at the TOP LEVEL of the
 * elements tree. Selection results (feats/ASIs picked through class feat
 * rules) nest inside level/class wrappers and are never DM grants
 * (Valerian/Samurai2 fixture evidence).
 */
export function buildDmGrantsDto(state: CharacterState, library: ElementLibrary): DmGrantsDto {
  const out: DmGrantsDto = [];
  if (state.magic !== null) {
    for (const spell of state.magic.additional) {
      if (!spell.source.startsWith("Additional Spell")) continue;
      const origin = contentOrigin(library, spell.id);
      out.push({
        kind: "spell",
        id: spell.id,
        name: spell.name,
        source: spell.source,
        type: "Spell",
        isCustom: origin !== "book",
        origin,
        section: null,
      });
    }
  }
  for (const node of state.elements) {
    if (node.id === "" || !GRANTABLE_FEATURE_TYPES.has(node.type)) continue;
    const element = library.byId.get(node.id);
    const origin = contentOrigin(library, node.id);
    out.push({
      kind: node.type === "Feat" ? "feat" : node.type === "Ability Score Improvement" ? "ability" : "feature",
      id: node.id,
      name: element?.identity.name ?? node.name,
      source: element?.identity.source ?? "",
      type: node.type,
      isCustom: origin !== "book",
      origin,
      section: buildSectionOfType(node.type),
    });
  }
  return out;
}
