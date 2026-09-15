/**
 * Item-owned registrations: the sweep that keeps an inventory item's own
 * grant subtree in step with whether the item conveys its benefits.
 *
 * An inventory record has up to two registered elements. The **base** is the
 * physical Weapon or Armor it is built on; the equip/attune/storage planners
 * in `inventory.ts` own that one, writing the base, the base's direct grants
 * and the adorner id into the `<sum>` and an Armor node into the elements
 * tree. The **content** element is the record's own magic: the adorner of an
 * adorned record, or a slotless item worn in its own right. That one is what
 * this module owns.
 *
 * Content registrations take the shape a saved `.dnd5e` file carries: a
 * top-level `<element type="Magic Item" name id>` node holding the elements
 * the item grants, followed in the `<sum>` by the item and everything the
 * registration pulled in. An item with no grant or select rules registers as
 * a sum entry alone, with no node — the same distinction saved files make.
 * That node form is what puts item-granted senses, spells and choices in
 * front of the reader: the vision list, the spell projections and the pending
 * selection rules all read the element tree, never the flat `<sum>`.
 *
 * The sweep is idempotent and runs after every inventory mutation and on
 * import, so a file written in the older flat form (a sum entry and its
 * grants with no node) gains its node the first time it is opened and is
 * left alone afterwards.
 *
 * It moves the registered count only for a worn slotless item, which nothing
 * else counts. An adorned record is tallied as two registrations by its base
 * registration from the moment the base registers, so the adorner's own
 * subtree coming and going leaves the count where saved characters put it.
 */

import { childElements, getAttr, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { elementById, type ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import type { CharacterState } from "../character/state.js";
import { isPhysicalEquipment } from "../content/equipment/categories.js";
import {
  attrValueRange,
  createRegistrationContext,
  escapeXml,
  registerElement,
  removeNodeEdit,
  renderNodes,
  resolveElementType,
  type RawEdit,
  type TreeNode,
} from "../selection/selection.js";
import { baseRegistrationPresent, contentElementOf, isAdornerElement, itemBenefitsActive } from "./inventory.js";

export interface ItemRegistrationPlan {
  edits: RawEdit[];
  changed: boolean;
}

const NOTHING: ItemRegistrationPlan = { edits: [], changed: false };

interface SumEntry {
  type: string;
  id: string;
}

interface RegistrationTarget {
  element: ParsedElement;
  /** Some record carrying this element currently conveys its benefits. */
  wanted: boolean;
  /**
   * How many records' base registrations already carry this element's `<sum>`
   * entry. The equip/attune planners write the adorner's id alongside the base
   * and take it away again with it, so the sweep must neither duplicate nor
   * strip an entry they own.
   */
  baseOwned: number;
}

/**
 * True when the element is one an inventory record registers on its own
 * behalf: real equipment that is not the physical Weapon or Armor a record is
 * built on. Control records (optional class features, supernatural gifts,
 * adjustment proxies) are not physical equipment and keep their own planner.
 */
export function isItemContentElement(element: ParsedElement | undefined): boolean {
  if (element === undefined) return false;
  if (element.identity.type === "Weapon" || element.identity.type === "Armor") return false;
  return isPhysicalEquipment(element);
}

/** The element ids a grant rule of `element` names directly. */
function directGrantIds(element: ParsedElement): string[] {
  const ids: string[] = [];
  for (const rule of element.rules) {
    if (rule.kind === "grant" && rule.id !== undefined && rule.id !== "") ids.push(rule.id);
  }
  return ids;
}

/**
 * Whether the element registers as a node at all. An element with nothing to
 * grant or choose has no subtree to carry, and saved files give it a sum
 * entry only.
 */
function registersAsNode(element: ParsedElement): boolean {
  if (element.children.length > 0) return true;
  return element.rules.some((rule) => rule.kind === "grant" || rule.kind === "select");
}

/** True when a top-level elements node is an inventory item's own registration. */
export function isItemRegistrationNode(library: ElementLibrary, node: Dnd5eNode): boolean {
  const id = getAttr(node, "id");
  if (id === null || id === "") return false;
  return isItemContentElement(elementById(library, id));
}

/** Every element id inside a document node, the node's own id first. */
export function subtreeIdsOf(node: Dnd5eNode): string[] {
  const ids: string[] = [];
  const walk = (current: Dnd5eNode): void => {
    const id = getAttr(current, "id");
    if (id !== null && id !== "") ids.push(id);
    const registered = getAttr(current, "registered");
    if (registered !== null && registered !== "") ids.push(registered);
    for (const child of childElements(current, "element")) walk(child);
  };
  walk(node);
  return ids;
}

/** The registered ids of the elements tree outside the item-owned nodes. */
function idsOutsideItemNodes(elementsNode: Dnd5eNode, itemNodes: ReadonlySet<Dnd5eNode>): Set<string> {
  const ids = new Set<string>();
  for (const node of childElements(elementsNode, "element")) {
    if (itemNodes.has(node)) continue;
    for (const id of subtreeIdsOf(node)) ids.add(id);
  }
  return ids;
}

/**
 * The index a new item registration inserts after: the last structural Level
 * entry plus everything already registered ahead of the class subtrees. This
 * is the position the equip and attune planners use, and where saved files
 * carry their item entries.
 */
function levelAnchorIndex(sum: readonly SumEntry[]): number {
  let anchor = -1;
  sum.forEach((entry, index) => {
    if (entry.type === "Level") anchor = index;
  });
  while (anchor + 1 < sum.length && sum[anchor + 1]!.type !== "Class" && sum[anchor + 1]!.type !== "Multiclass") {
    anchor++;
  }
  return anchor;
}

/** The node text of an item registration (the layout saved files carry). */
function renderRegistrationNode(element: ParsedElement, nodes: TreeNode[]): string {
  const open =
    `<element type="${escapeXml(element.identity.type)}"` +
    ` name="${escapeXml(element.identity.name)}"` +
    ` id="${escapeXml(element.identity.id)}"`;
  const children = renderNodes(nodes, 4);
  return children === "" ? `${open} />` : `${open}>\r\n${children}\r\n\t\t\t</element>`;
}

/**
 * The ids an item registration contributes, counted per id. Callers that
 * decide whether an element is "already registered" elsewhere need to
 * discount what the items themselves put there.
 */
export function itemOwnedRegistrationIds(document: Dnd5eDocument, library: ElementLibrary): Map<string, number> {
  const counts = new Map<string, number>();
  const elementsNode = document.root.build.elements?.node;
  if (elementsNode === undefined) return counts;
  for (const node of childElements(elementsNode, "element")) {
    const id = getAttr(node, "id");
    if (id === null || id === "") continue;
    if (!isItemContentElement(elementById(library, id))) continue;
    for (const subId of subtreeIdsOf(node)) counts.set(subId, (counts.get(subId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Plans the edits that bring item-owned registrations back in line with the
 * inventory. Returns `changed: false` and no edits when every item already
 * agrees — the common case, and what keeps this off the byte-fidelity path
 * for mutations and imports that change nothing.
 */
export function planItemRegistrationSweep(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
): ItemRegistrationPlan {
  const elementsNode = document.root.build.elements?.node;
  const sumView = document.root.build.sum;
  if (elementsNode === undefined || sumView === undefined || sumView === null) return NOTHING;

  const targets = new Map<string, RegistrationTarget>();
  for (const item of state.items) {
    const content = contentElementOf(library, item);
    if (content === undefined) continue;
    const id = content.identity.id;
    const target = targets.get(id) ?? { element: content, wanted: false, baseOwned: 0 };
    if (itemBenefitsActive(library, item)) target.wanted = true;
    if (item.adorners.length > 0 && baseRegistrationPresent(library, item)) target.baseOwned += 1;
    targets.set(id, target);
  }

  const itemNodes = new Map<string, Dnd5eNode>();
  for (const node of childElements(elementsNode, "element")) {
    const id = getAttr(node, "id");
    if (id === null || id === "" || itemNodes.has(id)) continue;
    if (!isItemContentElement(elementById(library, id))) continue;
    itemNodes.set(id, node);
  }
  const outside = idsOutsideItemNodes(elementsNode, new Set(itemNodes.values()));

  const sum: SumEntry[] = sumView.elements().map((entry) => ({ type: entry.type ?? "", id: entry.id ?? "" }));
  let sumChanged = false;
  const removeInstance = (id: string): void => {
    const index = sum.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    sum.splice(index, 1);
    sumChanged = true;
  };

  const nodeRemovals: Dnd5eNode[] = [];
  const nodeAdditions: string[] = [];
  let countDelta = 0;

  // Registrations that are no longer wanted: the node and one sum instance
  // per id it registered, minus whatever the base planners own.
  for (const [id, node] of itemNodes) {
    const target = targets.get(id);
    if (target !== undefined && target.wanted) continue;
    nodeRemovals.push(node);
    let baseOwned = target?.baseOwned ?? 0;
    for (const subId of subtreeIdsOf(node)) {
      if (subId === id && baseOwned > 0) {
        baseOwned--;
        continue;
      }
      removeInstance(subId);
    }
    // The record may be gone entirely, so the element decides, not the target.
    if (!isAdornerElement(elementById(library, id))) countDelta -= 1;
  }

  // The same for registrations carried as sum entries alone (an item with
  // nothing to grant, or a file written before item nodes existed).
  const flatIds: string[] = [];
  for (const entry of sum) {
    if (entry.id === "" || itemNodes.has(entry.id) || outside.has(entry.id)) continue;
    if (flatIds.includes(entry.id)) continue;
    if (!isItemContentElement(elementById(library, entry.id))) continue;
    flatIds.push(entry.id);
  }
  for (const id of flatIds) {
    const target = targets.get(id);
    if (target !== undefined && target.wanted) continue;
    const element = elementById(library, id)!;
    const anchor = sum.findIndex((entry) => entry.id === id);
    if (anchor < 0) continue;
    const run = flatRunAfter(sum, anchor, element);
    for (const runId of run) removeInstance(runId);
    if ((target?.baseOwned ?? 0) === 0) removeInstance(id);
    if (!isAdornerElement(element)) countDelta -= 1;
  }

  // Registrations that are wanted and absent, or present only in the flat
  // form of an older file.
  for (const [id, target] of targets) {
    if (!target.wanted || itemNodes.has(id)) continue;
    const element = target.element;
    const ctx = createRegistrationContext(state, library);
    const nodes = registerElement(element, library, state, ctx, new Set()) ?? [];
    const registeredIds = ctx.ids.length > 0 ? ctx.ids : [id];

    const anchor = sum.findIndex((entry) => entry.id === id);
    const present = new Set<string>();
    let insertAt: number;
    if (anchor >= 0) {
      present.add(id);
      const run = flatRunAfter(sum, anchor, element);
      for (const runId of run) present.add(runId);
      insertAt = anchor + 1 + run.length;
    } else {
      insertAt = levelAnchorIndex(sum) + 1;
    }
    const missing = registeredIds
      .filter((registeredId) => !present.has(registeredId))
      .map((registeredId) => ({ type: resolveElementType(library, registeredId), id: registeredId }));
    if (missing.length > 0) {
      sum.splice(insertAt, 0, ...missing);
      sumChanged = true;
    }
    if (registersAsNode(element)) nodeAdditions.push(renderRegistrationNode(element, nodes));
    // A flat registration the older writer left behind already counted once.
    if (!isAdornerElement(element) && anchor < 0) countDelta += 1;
  }

  const edits: RawEdit[] = [];
  for (const node of nodeRemovals) edits.push(removeNodeEdit(document.raw, node));
  if (nodeAdditions.length > 0) {
    const at = elementsNode.closeStart ?? elementsNode.end;
    edits.push({ start: at, end: at, replacement: nodeAdditions.map((text) => `\r\n\t\t\t${text}`).join("") });
  }
  if (sumChanged) {
    const sumNode = sumView.node;
    const inner = `\r\n${sum
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
    const count = attrValueRange(document.raw, sumNode, "element-count");
    if (count) edits.push({ start: count.start, end: count.end, replacement: String(sum.length) });
  }
  if (countDelta !== 0) {
    const range = attrValueRange(document.raw, elementsNode, "registered-count");
    if (range) {
      edits.push({ start: range.start, end: range.end, replacement: String(state.registeredCount + countDelta) });
    }
  }
  return edits.length === 0 ? NOTHING : { edits, changed: true };
}

/**
 * The element's own grant ids following its sum entry: the run the older
 * writer produced for a registration with no node. Reading the run back is
 * what lets the migration keep those entries in place instead of writing a
 * second copy of them under the node.
 */
function flatRunAfter(sum: readonly SumEntry[], anchor: number, element: ParsedElement): string[] {
  const pending = new Set(directGrantIds(element));
  const run: string[] = [];
  let cursor = anchor + 1;
  while (cursor < sum.length && pending.has(sum[cursor]!.id)) {
    pending.delete(sum[cursor]!.id);
    run.push(sum[cursor]!.id);
    cursor++;
  }
  return run;
}
