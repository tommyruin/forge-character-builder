/**
 * Character surfaces: optional rules, adjustments, controls, ruleset modes,
 * and load issues.
 */

import { child, childElements, getAttr, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { elementById, type ElementLibrary, rulesetOf } from "../content/library.js";
import { itemBenefitsActive, planRemoveControlRecordEdits } from "../inventory/inventory.js";
import type { ParsedElement } from "../content/parser.js";
import type { CharacterState, RegisteredElement } from "./state.js";
import { evaluateRequirements, type RequirementContext } from "../selection/expr.js";
import {
  ENGINE_INTERNAL_ELEMENTS,
  attrValueRange,
  createRegistrationContext,
  escapeXml,
  nodeByPath,
  registerElement,
  renderNodes,
  renderWrapperOpen,
  selectionOptions,
  type RawEdit,
  type SelectionRule,
} from "../selection/selection.js";
import { computeStatistics, validTreeIds } from "../statistics/calculator.js";
import { engineError } from "../errors.js";

// ---------------------------------------------------------------------------
// Optional rules
// ---------------------------------------------------------------------------

export interface OptionalRuleDto {
  key: string;
  kind: string;
  elementId: string;
  name: string;
  source: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  eligible: boolean;
  unavailableReason: string | null;
}

/** The two options enabled on a fresh character. */
const DEFAULT_ENABLED_OPTIONS: ReadonlySet<string> = new Set([
  "ID_INTERNAL_OPTION_ALLOW_FEATS",
  "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING",
]);

/** Optional-class-feature items: corpus category setter value. */
const OPTIONAL_CLASS_FEATURE_CATEGORY = "Optional Class Features";

/** Item name prefix "{Class}, LV{NN}: " stripped from the optional-rules DTO name. */
const OCF_NAME_PREFIX = /^.*?, LV\d+: /;

/** Reason shown for an enabled OCF whose grant requirements no longer hold. */
const OCF_INELIGIBLE_REASON = "No longer applies to this character. Disable it to remove its effects.";

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRegistered(state: CharacterState, id: string): boolean {
  return state.sum.elements.some((e) => e.id === id);
}

/**
 * True when the character carries `id` as a control record in its equipment.
 *
 * A control item conveys its benefits from the inventory: the statistics
 * calculator applies an active item's grants, and the sheet renders the
 * features it grants. So a carried record is as "on" as a sum registration,
 * and the control has to say so — otherwise a switch reads OFF for something
 * that is visibly applying.
 */
function hasActiveControlRecord(state: CharacterState, library: ElementLibrary, id: string): boolean {
  return state.items.some((item) => item.itemId === id && itemBenefitsActive(library, item));
}

/** Whether a control element is on, by either representation. */
export function isControlEnabled(state: CharacterState, library: ElementLibrary, id: string): boolean {
  return isRegistered(state, id) || hasActiveControlRecord(state, library, id);
}

/** True when the element's ruleset tag passes the character's ruleset mode (mirrors selection.ts isEligible). */
function passesRulesetMode(state: CharacterState, library: ElementLibrary, id: string): boolean {
  if (state.rulesetMode === "2014" && rulesetOf(library, id) === "2024") return false;
  if (state.rulesetMode === "2024" && rulesetOf(library, id) === "2014") return false;
  return true;
}

/**
 * OCF items visible on the character: items whose grant requirements and
 * ruleset tag both currently hold, plus enabled items that no longer
 * qualify (so the user can see and disable them instead of the feature
 * silently vanishing while its granted effects keep applying).
 */
function optionalClassFeatureCandidates(
  state: CharacterState,
  library: ElementLibrary,
): Array<{ element: ParsedElement; eligible: boolean }> {
  const ctx = createRegistrationContext(state, library);
  const out: Array<{ element: ParsedElement; eligible: boolean }> = [];
  for (const element of library.byType.get("Item") ?? []) {
    const category = element.setters.find((s) => s.name === "category")?.value;
    if (category !== OPTIONAL_CLASS_FEATURE_CATEGORY) continue;
    const grants = element.rules.filter((rule) => rule.kind === "grant");
    if (grants.length === 0) continue;
    const id = element.identity.id;
    const eligible =
      passesRulesetMode(state, library, id) && grants.every((grant) => evaluateRequirements(grant.requirements, ctx));
    if (!eligible && !isControlEnabled(state, library, id)) continue;
    out.push({ element, eligible });
  }
  return out;
}

/** Optional rules DTO: Option elements + eligible OCF items, options first. */
export function getOptionalRules(state: CharacterState, library: ElementLibrary): OptionalRuleDto[] {
  const ctx = createRegistrationContext(state, library);
  const rules: OptionalRuleDto[] = [];

  const options = (library.byType.get("Option") ?? [])
    .map((element) => {
      const id = element.identity.id;
      const eligible = evaluateRequirements(element.requirements, ctx);
      return {
        key: `option:${id}`,
        kind: "option",
        elementId: id,
        name: element.identity.name,
        source: element.identity.source,
        description: element.descriptionXml ?? "",
        enabled: isRegistered(state, id),
        defaultEnabled: DEFAULT_ENABLED_OPTIONS.has(id),
        eligible,
        unavailableReason: eligible ? null : "The requirements for this option are not met.",
      };
    })
    .sort((a, b) => ordinalCompare(a.name, b.name));
  rules.push(...options);

  const items = optionalClassFeatureCandidates(state, library)
    .map(({ element, eligible }) => {
      const id = element.identity.id;
      return {
        key: `item:${id}`,
        kind: "optional-class-feature",
        elementId: id,
        name: element.identity.name.replace(OCF_NAME_PREFIX, ""),
        source: element.identity.source,
        description: element.descriptionXml ?? "",
        enabled: isControlEnabled(state, library, id),
        defaultEnabled: false,
        eligible,
        unavailableReason: eligible ? null : OCF_INELIGIBLE_REASON,
      };
    })
    .sort((a, b) => ordinalCompare(a.name, b.name));
  rules.push(...items);
  return rules;
}

// ---------------------------------------------------------------------------
// Character adjustments
// ---------------------------------------------------------------------------

export interface CharacterAdjustmentDto {
  key: string;
  elementId: string;
  name: string;
  source: string;
  category: string;
  description: string;
  enabled: boolean;
}

/**
 * Adjustment categories (category setter values), in display group order.
 * Items are added to a character by registering them (the "equip to enable"
 * convention).
 */
const ADJUSTMENT_CATEGORIES: readonly string[] = [
  "Additional Arcane Trickster Spell",
  "Additional Artificer Spell",
  "Additional Bard Spell",
  "Additional Cleric Spell",
  "Additional Druid Spell",
  "Additional Eldritch Knight Spell",
  "Additional Feature",
  "Additional Language",
  "Additional Paladin Spell",
  "Additional Proficiency",
  "Additional Ranger Spell",
  "Additional Sorcerer Spell",
  "Additional Warlock Spell",
  "Additional Wizard Spell",
  "Supernatural Gifts",
];

export function getCharacterAdjustments(state: CharacterState, library: ElementLibrary): CharacterAdjustmentDto[] {
  const restricted = new Set(state.restrictedElements);
  const out: CharacterAdjustmentDto[] = [];
  for (const type of ["Item", "Magic Item"]) {
    for (const element of library.byType.get(type) ?? []) {
      const category = element.setters.find((s) => s.name === "category")?.value ?? "";
      const hidden = element.setters.find((s) => s.name === "inventory-hidden")?.value === "true";
      // The adjustment categories, plus the inventory-hidden mounts-and-vehicles
      // entry (the PHB24 camel; other mounts are not listed).
      if (!ADJUSTMENT_CATEGORIES.includes(category) && !(hidden && category === "Mounts & Vehicles")) continue;
      if (restricted.has(element.identity.id)) continue;
      out.push({
        key: `item:${element.identity.id}`,
        elementId: element.identity.id,
        name: element.identity.name,
        source: element.identity.source,
        category,
        description: element.descriptionXml ?? "",
        enabled: isControlEnabled(state, library, element.identity.id),
      });
    }
  }
  const categoryRank = new Map(ADJUSTMENT_CATEGORIES.map((c, i) => [c, i]));
  out.sort(
    (a, b) =>
      (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99) ||
      ordinalCompare(a.name, b.name) ||
      ordinalCompare(a.elementId, b.elementId),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Character controls
// ---------------------------------------------------------------------------

export interface CharacterControlDto {
  key: string;
  elementId: string;
  name: string;
  type: string;
  enabled: boolean;
}

/** The union of the option: and item: control keys with their enabled state. */
export function getCharacterControls(state: CharacterState, library: ElementLibrary): CharacterControlDto[] {
  const out: CharacterControlDto[] = [];
  for (const rule of getOptionalRules(state, library)) {
    out.push({
      key: rule.key,
      elementId: rule.elementId,
      name: rule.name,
      type: rule.kind === "option" ? "Option" : "Item",
      enabled: rule.enabled,
    });
  }
  for (const adjustment of getCharacterAdjustments(state, library)) {
    if (out.some((c) => c.key === adjustment.key)) continue;
    const element = library.byId.get(adjustment.elementId);
    out.push({
      key: adjustment.key,
      elementId: adjustment.elementId,
      name: adjustment.name,
      type: element?.identity.type ?? "Item",
      enabled: adjustment.enabled,
    });
  }
  return out;
}

/**
 * Registers/unregisters an item element (and its granted children) in the
 * document, appending the node after the level wrappers and its sum entries
 * at the end, mirroring the controls PUT.
 */
export function planItemEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  itemId: string,
  enabled: boolean,
): RawEdit[] {
  const element = library.byId.get(itemId);
  if (!element || (element.identity.type !== "Item" && element.identity.type !== "Magic Item")) {
    throw engineError("not-found", `item '${itemId}' not found`);
  }
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) throw engineError("not-found", "elements section not found");
  const raw = document.raw;
  const edits: RawEdit[] = [];
  const existing = childElements(elementsNode, "element").find((node) => getAttr(node, "id") === itemId);

  if (enabled) {
    if (existing) return edits;
    const ctx = createRegistrationContext(state, library);
    const nodes = registerElement(element, library, state, ctx, new Set());
    const children = renderNodes(nodes ?? [], 4);
    const open = `<element type="${escapeXml(element.identity.type)}" name="${escapeXml(element.identity.name)}" id="${escapeXml(itemId)}"`;
    const pad = "\t\t\t";
    const nodeText = children === "" ? `${open} />` : `${open}>\r\n${children}\r\n${pad}</element>`;
    const insertAt = elementsNode.closeStart ?? elementsNode.end;
    edits.push({ start: insertAt, end: insertAt, replacement: `\r\n${pad}${nodeText}` });
    const entries = [itemId, ...ctx.ids.filter((id) => id !== itemId)].map((id) => ({
      type: resolveElementType(library, id),
      id,
    }));
    edits.push(...planSumAppendEdits(document, entries));
    edits.push(...planElementsCountEdits(document, state, 1));
  } else {
    // A control item can be on by either representation: registered in the
    // elements tree, or carried as an equipment record (the shape imported
    // documents use, and what addItem produces). Switching it off has to clear both.
    for (const carried of state.items.filter((item) => item.itemId === itemId)) {
      edits.push(...planRemoveControlRecordEdits(document, carried.identifier));
    }
    if (!existing) return edits;
    edits.push(removeNodeEdit(raw, existing));
    const remaining = (document.root.build.sum?.elements() ?? [])
      .map((e) => ({ type: e.type ?? "", id: e.id ?? "" }))
      .filter((e) => e.id !== itemId && !isSubtreeId(document, itemId, e.id));
    edits.push(...planSumReplaceEdits(document, remaining));
    edits.push(...planElementsCountEdits(document, state, 0));
  }
  return edits;
}

/** True when `id` is registered inside the item node's subtree in the document. */
function isSubtreeId(document: Dnd5eDocument, itemId: string, id: string): boolean {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return false;
  const item = childElements(elementsNode, "element").find((node) => getAttr(node, "id") === itemId);
  if (!item) return false;
  const ids = new Set<string>();
  const walk = (node: Dnd5eNode): void => {
    const own = getAttr(node, "id");
    if (own) ids.add(own);
    for (const childNode of childElements(node, "element")) walk(childNode);
  };
  walk(item);
  return ids.has(id);
}

// ---------------------------------------------------------------------------
// Ruleset modes
// ---------------------------------------------------------------------------

export interface RulesetChangeItemDto {
  ruleName: string;
  ruleType: string;
  previousElementId: string;
  previousElementName: string;
  previousSource: string;
  newElementId: string | null;
  newElementName: string | null;
  newSource: string | null;
}

export interface RulesetModeDto {
  mode: string;
  availableModes: string[];
  rules2014Count: number;
  rules2024Count: number;
  sharedCount: number;
  incompatibleWith2014: RulesetChangeItemDto[];
  incompatibleWith2024: RulesetChangeItemDto[];
}

export const RULESET_MODES: readonly string[] = ["all", "2014", "2024"];

/** Filled selection-rule wrappers whose registered element is exclusive to the other ruleset. */
function incompatibleItems(
  state: CharacterState,
  library: ElementLibrary,
  exclusiveTag: "2014" | "2024",
): RulesetChangeItemDto[] {
  const out: RulesetChangeItemDto[] = [];
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.requiredLevel !== undefined && (node.registered ?? "") !== "") {
        const element = library.byId.get(node.registered!);
        if (element && rulesetOf(library, element.identity.id) === exclusiveTag) {
          out.push({
            ruleName: node.name,
            ruleType: node.type,
            previousElementId: element.identity.id,
            previousElementName: element.identity.name,
            previousSource: element.identity.source,
            newElementId: null,
            newElementName: null,
            newSource: null,
          });
        }
      }
      walk(node.children);
    }
  };
  walk(state.elements);
  return out;
}

export function getRulesetMode(state: CharacterState, library: ElementLibrary): RulesetModeDto {
  return {
    mode: state.rulesetMode,
    availableModes: [...RULESET_MODES],
    rules2014Count: library.rulesetCounts.rules2014Count,
    rules2024Count: library.rulesetCounts.rules2024Count,
    sharedCount: library.rulesetCounts.sharedCount,
    incompatibleWith2014: incompatibleItems(state, library, "2024"),
    incompatibleWith2024: incompatibleItems(state, library, "2014"),
  };
}

/** The same-name+type element from the counterpart ruleset's sources. */
function rulesetAlternative(
  library: ElementLibrary,
  type: string,
  name: string,
  target: "2014" | "2024",
): ParsedElement | undefined {
  for (const element of library.byType.get(type) ?? []) {
    if (element.identity.name !== name) continue;
    if (library.ruleset.get(element.identity.id) !== target) continue;
    return element;
  }
  return undefined;
}

export interface RulesetChangeResult {
  mode: string;
  repaired: RulesetChangeItemDto[];
  removed: RulesetChangeItemDto[];
  unresolved: RulesetChangeItemDto[];
}

/** The repair/remove plan for switching `mode` (pure; document edits elsewhere). */
export function computeRulesetChange(
  state: CharacterState,
  library: ElementLibrary,
  mode: "2014" | "2024",
): RulesetChangeResult {
  const repaired: RulesetChangeItemDto[] = [];
  const removed: RulesetChangeItemDto[] = [];
  const unresolved: RulesetChangeItemDto[] = [];
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.requiredLevel !== undefined && (node.registered ?? "") !== "") {
        const previous = library.byId.get(node.registered!);
        if (previous && rulesetOf(library, previous.identity.id) !== "shared" && rulesetOf(library, previous.identity.id) !== mode) {
          const base = {
            ruleName: node.name,
            ruleType: node.type,
            previousElementId: previous.identity.id,
            previousElementName: previous.identity.name,
            previousSource: previous.identity.source,
          };
          const alternative = rulesetAlternative(library, node.type, previous.identity.name, mode);
          if (alternative) {
            repaired.push({
              ...base,
              newElementId: alternative.identity.id,
              newElementName: alternative.identity.name,
              newSource: alternative.identity.source,
            });
          } else {
            const item: RulesetChangeItemDto = { ...base, newElementId: null, newElementName: null, newSource: null };
            removed.push(item);
            unresolved.push(item);
          }
        }
      }
      walk(node.children);
    }
  };
  walk(state.elements);
  return { mode, repaired, removed, unresolved };
}

/** Element ids of a wrapper subtree in the state tree (for sum replacement). */
function stateSubtreeIds(nodes: RegisteredElement[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: RegisteredElement[]): void => {
    for (const node of list) {
      if (node.id) ids.add(node.id);
      if ((node.registered ?? "") !== "") ids.add(node.registered!);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

function wrapperAtPath(state: CharacterState, path: number[]): RegisteredElement | null {
  let nodes = state.elements;
  let node: RegisteredElement | undefined;
  for (const index of path) {
    node = nodes[index];
    if (!node) return null;
    nodes = node.children;
  }
  return node ?? null;
}

/** Wrapper nodes with paths for every filled selection rule, in tree order. */
function filledWrapperPaths(state: CharacterState): Array<{ node: RegisteredElement; path: number[] }> {
  const out: Array<{ node: RegisteredElement; path: number[] }> = [];
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (node.requiredLevel !== undefined && (node.registered ?? "") !== "") {
        out.push({ node, path: here });
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  return out;
}

/** Byte edits for the <ruleset mode="..."> tag only (e.g. switching back to "all"). */
export function planRulesetTagEdit(document: Dnd5eDocument, mode: string): RawEdit[] {
  const raw = document.raw;
  const rulesetNode = document.root.node ? child(document.root.node, "ruleset") : null;
  if (rulesetNode) {
    const range = attrValueRange(raw, rulesetNode, "mode");
    return range ? [{ start: range.start, end: range.end, replacement: mode }] : [];
  }
  const buildNode = document.root.build.node;
  const insertAt = buildNode ? buildNode.start : raw.length;
  return [{ start: insertAt, end: insertAt, replacement: `\t<ruleset mode="${mode}" />\r\n` }];
}

/**
 * Byte edits for a ruleset-mode switch: the mode tag, each affected wrapper
 * region (repaired: re-registered alternative subtree; removed: cleared
 * wrapper), and the <sum> entries of affected subtrees.
 */
export function planRulesetModeEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  mode: "2014" | "2024",
): RawEdit[] {
  const raw = document.raw;
  const edits: RawEdit[] = [];

  const rulesetNode = document.root.node ? child(document.root.node, "ruleset") : null;
  if (rulesetNode) {
    const range = attrValueRange(raw, rulesetNode, "mode");
    if (range) edits.push({ start: range.start, end: range.end, replacement: mode });
  } else {
    const buildNode = document.root.build.node;
    const insertAt = buildNode ? buildNode.start : raw.length;
    edits.push({ start: insertAt, end: insertAt, replacement: `\t<ruleset mode="${mode}" />\r\n` });
  }

  const change = computeRulesetChange(state, library, mode);
  const sumView = document.root.build.sum;
  let nextSum = (sumView?.elements() ?? []).map((e) => ({ type: e.type ?? "", id: e.id ?? "" }));

  // Each change item consumes a distinct wrapper. Items nested inside another
  // affected wrapper are dropped before any edit is emitted: the ancestor's
  // replacement rewrites (or clears) that whole byte range, and a second edit
  // inside it would corrupt the document.
  const wrappers = filledWrapperPaths(state);
  const matchedPaths = new Set<string>();
  const matches: Array<{ item: RulesetChangeItemDto; node: RegisteredElement; path: number[] }> = [];
  for (const item of [...change.repaired, ...change.removed]) {
    const found = wrappers.find(
      ({ node, path }) =>
        node.type === item.ruleType &&
        node.name === item.ruleName &&
        node.registered === item.previousElementId &&
        !matchedPaths.has(path.join("/")),
    );
    if (!found) continue;
    matchedPaths.add(found.path.join("/"));
    matches.push({ item, node: found.node, path: found.path });
  }
  const isNestedInMatch = (path: number[]): boolean =>
    matches.some(
      (other) => other.path.length < path.length && other.path.every((step, i) => path[i] === step),
    );

  for (const { item, node: wrapper, path } of matches) {
    if (isNestedInMatch(path)) continue;
    const docWrapper = nodeByPath(document, path);
    if (!docWrapper) continue;
    const pad = indentOf(raw, docWrapper);
    const oldIds = stateSubtreeIds([wrapper]);

    if (item.newElementId !== null) {
      const alternative = library.byId.get(item.newElementId)!;
      const ctx = createRegistrationContext(state, library);
      const nodes = registerElement(alternative, library, state, ctx, new Set());
      const children = renderNodes(nodes ?? [], pad.length + 1);
      const open = renderWrapperOpen({
        type: wrapper.type,
        name: wrapper.name,
        requiredLevel: wrapper.requiredLevel ?? 1,
        number: wrapper.number,
        checksum: wrapper.checksum ?? "",
        registered: alternative.identity.id,
      });
      edits.push({
        start: docWrapper.start,
        end: docWrapper.end,
        replacement: children === "" ? `${open} />` : `${open}>\r\n${children}\r\n${pad}</element>`,
      });
      const positions = nextSum.map((entry, i) => (oldIds.has(entry.id) ? i : -1)).filter((i) => i >= 0);
      const first = positions[0] ?? -1;
      nextSum = nextSum.filter((entry) => !oldIds.has(entry.id));
      if (first >= 0) {
        const newEntries = [...ctx.ids].map((id) => ({ type: resolveElementType(library, id), id }));
        nextSum.splice(first, 0, ...newEntries);
      }
    } else {
      const open = renderWrapperOpen({
        type: wrapper.type,
        name: wrapper.name,
        requiredLevel: wrapper.requiredLevel ?? 1,
        number: wrapper.number,
        checksum: wrapper.checksum ?? "",
        registered: "",
      });
      edits.push({ start: docWrapper.start, end: docWrapper.end, replacement: `${open} />` });
      nextSum = nextSum.filter((entry) => !oldIds.has(entry.id));
    }
  }

  if (sumView) {
    const sumNode = sumView.node;
    const inner = `\r\n${nextSum
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
    const count = attrValueRange(raw, sumNode, "element-count");
    if (count) edits.push({ start: count.start, end: count.end, replacement: String(nextSum.length) });
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Load issues
// ---------------------------------------------------------------------------

export interface LoadIssueDto {
  kind: string;
  ruleType: string;
  ruleName: string;
  requiredLevel: number | null;
  previousElementId: string;
  previousElementName: string | null;
  message: string;
}

const ELEMENT_MISSING_MESSAGE = "A granted feature could not be restored; the content that provided it may have changed.";
const EQUIPMENT_MISSING_MESSAGE = "An inventory item no longer exists in the loaded content.";
const SELECTION_INVALIDATED_MESSAGE =
  "The previously chosen option could not be restored; it may have been removed or is no longer a legal choice.";

function candidateSuffix(candidates: string[]): string {
  return candidates.length === 0 ? "" : ` Available candidates include: ${candidates.join(", ")}.`;
}

function resolvesInLibrary(library: ElementLibrary, id: string): boolean {
  return elementById(library, id) !== undefined || ENGINE_INTERNAL_ELEMENTS.has(id);
}

function ruleWithPath(wrapper: RegisteredElement, path: number[]): SelectionRule {
  return {
    identifier: "",
    type: wrapper.type,
    name: wrapper.name,
    requiredLevel: wrapper.requiredLevel ?? 1,
    hasSelection: (wrapper.registered ?? "") !== "",
    selectedElementIds: (wrapper.registered ?? "") !== "" ? [wrapper.registered!] : [],
    path,
  };
}

/**
 * First 5 candidate ids (alphabetical) for an invalidated wrapper rule.
 * Candidates come from the nearest ancestor element node whose id resolves
 * (the granting element); wrapper ancestors with unresolvable registered
 * elements stop the scan (observed: no candidates for rules under a
 * missing element).
 */
/**
 * First 5 candidate ids (alphabetical) for an invalidated wrapper rule.
 * Candidates come from the nearest ancestor element node whose id resolves
 * (the granting element); wrapper ancestors with unresolvable registered
 * elements stop the scan (observed: no candidates for rules under a
 * missing element). Eligibility uses the valid registered set (observed:
 * an expertise option whose skill is invalid drops out).
 */
function invalidatedCandidates(
  state: CharacterState,
  library: ElementLibrary,
  wrapper: RegisteredElement,
  path: number[],
  validRegistered: Set<string>,
): string[] {
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const ancestor = wrapperAtPath(state, path.slice(0, depth));
    if (!ancestor) return [];
    if (ancestor.requiredLevel !== undefined) {
      if ((ancestor.registered ?? "") !== "" && !resolvesInLibrary(library, ancestor.registered!)) return [];
      continue;
    }
    if (ancestor.id === "") continue;
    if (!resolvesInLibrary(library, ancestor.id)) return [];
    const rule = ruleWithPath(wrapper, path);
    return selectionOptions(state, library, rule, loadRequirementContext(state, library, validRegistered))
      .sort((a, b) => ordinalCompare(a.name, b.name) || ordinalCompare(a.id, b.id))
      .map((option) => option.id)
      .slice(0, 5);
  }
  return [];
}

/**
 * The load-time eligibility context: element atoms resolve against the valid
 * registered set; ability/type/level atoms resolve for real (observed:
 * the PHB24 Actor feat drops out of the candidates with charisma 9).
 */
function loadRequirementContext(
  state: CharacterState,
  library: ElementLibrary,
  validRegistered: Set<string>,
): RequirementContext {
  // Stat-path atoms resolve against the computed statistics, lazily and once
  // per context (mirrors createRegistrationContext).
  let statValues: Record<string, number> | null = null;
  return {
    hasElement: (id: string) => validRegistered.has(id),
    hasType: (type: string) => {
      const wanted = type.toLowerCase();
      for (const id of validRegistered) {
        if (resolveElementType(library, id).toLowerCase() === wanted) return true;
      }
      return false;
    },
    ability: (name: string) => {
      const key = ABILITY_BY_NAME[name];
      if (key) return state.abilities[key];
      statValues ??= computeStatistics(state, library);
      return name in statValues ? statValues[name]! : Number.NaN;
    },
    level: state.level,
  };
}

const ABILITY_BY_NAME: Record<string, keyof CharacterState["abilities"]> = {
  str: "strength",
  strength: "strength",
  dex: "dexterity",
  dexterity: "dexterity",
  con: "constitution",
  constitution: "constitution",
  int: "intelligence",
  intelligence: "intelligence",
  wis: "wisdom",
  wisdom: "wisdom",
  cha: "charisma",
  charisma: "charisma",
};

/**
 * Element-level requirement validation against the valid registered set.
 * Multiclass variant requirements are not re-checked (see isEligible).
 */
function wrapperElementValid(
  state: CharacterState,
  library: ElementLibrary,
  element: ParsedElement,
  validRegistered: Set<string>,
): boolean {
  if (element.identity.type === "Multiclass") return true;
  return evaluateRequirements(element.requirements, loadRequirementContext(state, library, validRegistered));
}

/**
 * Load-issue generation: equipment items first, then invalidated selection
 * wrappers, then missing granted elements (each pass in tree/equipment
 * order). Messages are the pinned verbatim strings.
 */
export function buildLoadIssues(state: CharacterState, library: ElementLibrary): LoadIssueDto[] {
  const issues: LoadIssueDto[] = [];

  for (const item of state.items) {
    if (item.itemId !== "" && !resolvesInLibrary(library, item.itemId)) {
      issues.push({
        kind: "equipmentMissing",
        ruleType: "Item",
        ruleName: item.name,
        requiredLevel: null,
        previousElementId: item.itemId,
        previousElementName: null,
        message: EQUIPMENT_MISSING_MESSAGE,
      });
    }
  }

  const valid = validTreeIds(state, library);
  const validRegistered = new Set(registeredSumIds(state).filter((id) => valid.has(id)));

  const wrapperWalk = (nodes: RegisteredElement[], path: number[], parentValid: boolean): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      const registered = node.registered ?? "";
      let nodeValid: boolean;
      if (node.requiredLevel !== undefined) {
        if (node.isList === true) {
          nodeValid = true;
          if (registered !== "" && !parentValid) {
            issues.push({
              kind: "selectionInvalidated",
              ruleType: node.type,
              ruleName: node.name,
              requiredLevel: node.requiredLevel ?? null,
              previousElementId: registered,
              previousElementName: null,
              message: SELECTION_INVALIDATED_MESSAGE,
            });
          }
        } else {
          nodeValid = registered === "" || valid.has(registered);
          if (registered !== "" && !nodeValid) {
            const element = library.byId.get(registered);
            const candidates = invalidatedCandidates(state, library, node, here, validRegistered);
            issues.push({
              kind: "selectionInvalidated",
              ruleType: node.type,
              ruleName: node.name,
              requiredLevel: node.requiredLevel ?? null,
              previousElementId: registered,
              previousElementName: element ? element.identity.name : null,
              message: SELECTION_INVALIDATED_MESSAGE + candidateSuffix(candidates),
            });
          } else if (registered !== "") {
            const element = library.byId.get(registered);
            if (!element) {
              issues.push({
                kind: "selectionInvalidated",
                ruleType: node.type,
                ruleName: node.name,
                requiredLevel: node.requiredLevel ?? null,
                previousElementId: registered,
                previousElementName: null,
                message: SELECTION_INVALIDATED_MESSAGE + candidateSuffix(invalidatedCandidates(state, library, node, here, validRegistered)),
              });
            } else if (!wrapperElementValid(state, library, element, validRegistered)) {
              issues.push({
                kind: "selectionInvalidated",
                ruleType: node.type,
                ruleName: node.name,
                requiredLevel: node.requiredLevel ?? null,
                previousElementId: registered,
                previousElementName: element.identity.name,
                message: SELECTION_INVALIDATED_MESSAGE + candidateSuffix(invalidatedCandidates(state, library, node, here, validRegistered)),
              });
            }
          }
        }
      } else {
        nodeValid = node.id === "" || valid.has(node.id);
      }
      wrapperWalk(node.children, here, parentValid && nodeValid);
    });
  };
  wrapperWalk(state.elements, [], true);

  const elementWalk = (nodes: RegisteredElement[], parentValid: boolean): void => {
    for (const node of nodes) {
      if (node.requiredLevel !== undefined) {
        const registered = node.registered ?? "";
        const wrapperValid = node.isList === true || registered === "" || valid.has(registered);
        if (!wrapperValid) continue;
        elementWalk(node.children, parentValid && wrapperValid);
        continue;
      }
      if (node.id !== "" && node.type !== "Item" && node.type !== "Magic Item" && !valid.has(node.id)) {
        const element = library.byId.get(node.id);
        issues.push({
          kind: "elementMissing",
          ruleType: node.type,
          ruleName: node.name,
          requiredLevel: node.requiredLevel ?? null,
          previousElementId: node.id,
          previousElementName: element ? element.identity.name : null,
          message: ELEMENT_MISSING_MESSAGE,
        });
      }
      elementWalk(node.children, parentValid && (node.id === "" || valid.has(node.id)));
    }
  };
  elementWalk(state.elements, true);

  return issues;
}

function registeredSumIds(state: CharacterState): string[] {
  return state.sum.elements.map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Shared document helpers
// ---------------------------------------------------------------------------

function indentOf(raw: string, node: Dnd5eNode): string {
  let lineStart = node.start;
  while (lineStart > 0 && (raw[lineStart - 1] === "\t" || raw[lineStart - 1] === " ")) lineStart--;
  return raw.slice(lineStart, node.start);
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

function planElementsCountEdits(document: Dnd5eDocument, state: CharacterState, itemDelta: number): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const raw = document.raw;
  const edits: RawEdit[] = [];
  const itemCount = countItemNodes(state.elements);
  const registered = state.levelCount + filledWrapperCount(state.elements) + state.options.size + itemCount + itemDelta;
  const rc = attrValueRange(raw, elementsNode, "registered-count");
  if (rc) edits.push({ start: rc.start, end: rc.end, replacement: String(registered) });
  return edits;
}

export function countItemNodes(nodes: RegisteredElement[]): number {
  let count = 0;
  const walk = (list: RegisteredElement[]): void => {
    for (const node of list) {
      if (node.id !== "" && (node.type === "Item" || node.type === "Magic Item")) count++;
      walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

function filledWrapperCount(nodes: RegisteredElement[]): number {
  let count = 0;
  const walk = (list: RegisteredElement[]): void => {
    for (const node of list) {
      if (node.requiredLevel !== undefined && (node.registered ?? "") !== "") count++;
      walk(node.children);
    }
  };
  walk(nodes);
  return count;
}

function resolveElementType(library: ElementLibrary, id: string): string {
  return library.byId.get(id)?.identity.type ?? ENGINE_INTERNAL_ELEMENTS.get(id)?.identity.type ?? "";
}
