/**
 * Leveling/progression engine.
 *
 * Operates over the character state and the parsed document, computing
 * byte-range edits (RawEdit) for the service to apply, plus the session
 * records the service must merge into the remapped state (per-level
 * registration records and the delevel snapshot).
 *
 * Fixture-derived conventions implemented here (see fixtures/characters/*):
 * - main-class level wrappers 2+ are empty self-closing <element type="Level"
 *   name="N" id="ID_LEVEL_N" /> nodes; all features for all levels register
 *   inside the Class wrapper of the Level 1 wrapper (Billy.dnd5e);
 * - rndhp holds 20 pre-rolled hit die values per class (in class order),
 *   rolled once at class registration, on the class's starting level wrapper;
 * - the starting multiclass wrapper carries multiclass="true" starting="true"
 *   rndhp="..." class="ID_*_MULTICLASS_X" and holds a "Multiclass" selection
 *   wrapper (registered = the multiclass variant id) followed by
 *   ID_INTERNAL_MULTICLASS_LEVEL_N (Grung Assasin.dnd5e);
 * - the multiclass variant's registration order is: block select wrappers,
 *   class level-1 grants (requirements referencing the multiclass id flip),
 *   block grants, then class level-2+ grants (Grung Assasin.dnd5e tree order);
 * - the hit die size is authored as the class's "hd" setter ("d8"); class
 *   description prose ("Hit Dice: 1d8 per rogue level" in 2014 books,
 *   "Hit Point Die ... D8" in 2024 books) is the fallback when absent.
 */

import { randomUuid } from "../platform.js";
import { child, childElements, getAttr, parseDnd5e, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { mapToState } from "../character/mapping.js";
import type { ElementLibrary } from "../content/library.js";
import type { GrantRule, ParsedElement, SelectRule } from "../content/parser.js";
import type { CharacterState, DelevelSnapshot, LevelRegistrationRecord, RegisteredElement } from "../character/state.js";
import { engineError } from "../errors.js";
import { evaluateRequirements } from "../selection/expr.js";
import {
  applyRawEdits,
  attrValueRange,
  createRegistrationContext,
  filledWrapperCount,
  grantEligible,
  nodeByPath,
  orderSumEntries,
  reconcilePendingGrants,
  registerElement,
  renderNodes,
  renderWrapperOpen,
  resolveElementType,
  resolveGrant,
  selectionRuleChecksum,
  toStateNodes,
  type RawEdit,
  type RegistrationContext,
  type SelectionRule,
  type TreeNode,
} from "../selection/selection.js";

export const OPTION_FEATS = "ID_INTERNAL_OPTION_ALLOW_FEATS";
export const OPTION_MULTICLASSING = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";
export const OPTION_AVERAGE_HP = "ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP";
export const GRANT_MULTICLASS = "ID_INTERNAL_GRANT_MULTICLASS";
export const MAX_LEVEL = 20;
export const ROLL_COUNT = 20;

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Hit die size from the class's hd setter ("d8" -> 8), else description prose. */
export function extractHitDie(classElement: ParsedElement): number {
  const setter = classElement.setters.find((s) => s.name === "hd")?.value.trim() ?? "";
  const fromSetter = /^1?d(\d+)$/i.exec(setter);
  if (fromSetter) return Number(fromSetter[1]);
  const text = (classElement.descriptionXml ?? "").replace(/<[^>]+>/g, " ");
  const match = /Hit Dice:\s*1d(\d+)/.exec(text) ?? /Hit Point Die\s*:?\s*1?[dD](\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

/** 20 pre-rolled hit die values in 1..die (rolled once per class). */
export function rollHitPoints(classElement: ParsedElement, rng: () => number): number[] {
  const die = extractHitDie(classElement);
  const rolls: number[] = [];
  for (let i = 0; i < ROLL_COUNT; i++) rolls.push(1 + Math.floor(rng() * die));
  return rolls;
}

/** Main-class creation starts with the hit-die maximum, then uses the normal roll sequence. */
function rollMainClassHitPoints(classElement: ParsedElement, rng: () => number): number[] {
  const rolls = rollHitPoints(classElement, rng);
  const die = extractHitDie(classElement);
  if (rolls.length > 0 && die > 0) rolls[0] = die;
  return rolls;
}

/**
 * One splice into an element registered by an earlier level: the wrappers of
 * its level-gated selects and the targets of its level-gated grants, which
 * this level has just unlocked.
 */
export interface NestedNodeGroup {
  parentPath: number[];
  insertIndex: number;
  nodes: TreeNode[];
  /**
   * Sum entries of the elements the nested grants registered, in order. Kept
   * out of the level record: delevel reads the ids back off the document nodes
   * it removes, so nothing needs them once the edits are planned.
   */
  sumIds?: string[];
}

export interface LevelApplication {
  /** Tree nodes to append under the class wrapper (state-level). */
  nodes: TreeNode[];
  /** Element ids registered by this application (sum entries, in order). */
  sumIds: string[];
  /** Level-gated rules declared by features registered at an earlier level. */
  nestedAddedNodes?: NestedNodeGroup[];
}

/**
 * Applies one class level's content: select rules spawn wrappers (number
 * picks, requiredLevel = select level or 1), grant rules register their
 * targets recursively (cycle-guarded, deduped). Level-1 applies levelless
 * rules; the multiclass variant additionally folds its <multiclass> block
 * rules in after the class's level-1 grants, with the flip-marker context.
 */
export function applyClassLevel(
  state: CharacterState,
  library: ElementLibrary,
  classElement: ParsedElement,
  level: number,
  opts: { multiclass?: boolean } = {},
): LevelApplication {
  const multiclass = opts.multiclass === true;
  const block = multiclass ? classElement.multiclass : undefined;
  const ctx = createRegistrationContext(state, library, multiclass && block ? [block.id] : [], level);
  const classSelects = classElement.rules.filter((rule): rule is SelectRule => rule.kind === "select");
  const classGrants = classElement.rules.filter((rule): rule is GrantRule => rule.kind === "grant");
  const blockSelects = block ? block.rules.filter((rule): rule is SelectRule => rule.kind === "select") : [];
  const blockGrants = block ? block.rules.filter((rule): rule is GrantRule => rule.kind === "grant") : [];

  const selects: SelectRule[] = [];
  const selectOwners = new Map<SelectRule, string>();
  const grants: GrantRule[] = [];
  const eligible = (requirements: string | undefined): boolean => evaluateRequirements(requirements, ctx);
  const isPrerequisiteGrant = (grant: GrantRule): boolean => grant.id === "ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE";
  if (multiclass && level === 1) {
    for (const select of classSelects) {
      if ((select.level ?? 1) === 1 && eligible(select.requirements)) {
        selects.push(select);
        selectOwners.set(select, classElement.identity.id);
      }
    }
    for (const select of blockSelects) {
      if (eligible(select.requirements)) {
        selects.push(select);
        selectOwners.set(select, block!.id);
      }
    }
    for (const grant of classGrants) {
      if (isPrerequisiteGrant(grant)) continue;
      if ((grant.level ?? 1) === 1) grants.push(grant);
    }
    for (const grant of blockGrants) {
      if (eligible(grant.requirements)) grants.push(grant);
    }
  } else {
    for (const select of classSelects) {
      if ((select.level ?? 1) === level && eligible(select.requirements)) {
        selects.push(select);
        selectOwners.set(select, classElement.identity.id);
      }
    }
    for (const grant of classGrants) {
      if ((grant.level ?? 1) === level && eligible(grant.requirements)) grants.push(grant);
    }
  }

  const nodes: TreeNode[] = [];
  for (const select of selects) {
    const count = select.number ?? 1;
    for (let i = 1; i <= count; i++) {
      nodes.push({
        kind: "wrapper",
        type: select.type,
        name: select.name ?? select.type,
        requiredLevel: select.level ?? 1,
        number: count > 1 ? i : undefined,
        checksum: selectionRuleChecksum(selectOwners.get(select) ?? classElement.identity.id, select, i),
      });
    }
  }
  const visited = new Set<string>();
  const registerGrants = (candidates: GrantRule[]): void => {
    for (const grant of candidates) {
      if (!eligible(grant.requirements)) continue;
      const target = resolveGrant(grant, library);
      if (!target) continue;
      if (ctx.ids.includes(target.identity.id)) continue;
      const registered = registerElement(target, library, state, ctx, visited);
      if (registered !== null) {
        nodes.push({ kind: "element", element: target, children: registered });
      }
    }
  };
  registerGrants(grants);
  if (multiclass && level === 1) {
    registerGrants(classGrants.filter((grant) => !isPrerequisiteGrant(grant) && (grant.level ?? 1) === 1));
  }
  return { nodes, sumIds: ctx.ids };
}

/** Splices each nested wrapper group into its parent element in the document. */
export function nestedInsertEdits(
  document: Dnd5eDocument,
  nested: LevelApplication["nestedAddedNodes"],
): RawEdit[] {
  const raw = document.raw;
  const edits: RawEdit[] = [];
  for (const group of nested ?? []) {
    const parent = nodeByPath(document, group.parentPath);
    if (!parent) throw engineError("not-found", "nested level-rule parent not found in document");
    const parentPad = linePrefix(raw, parent);
    const nestedText = renderNodes(group.nodes, parentPad.length + 1);
    const children = childElements(parent, "element");
    const insertionNode = children[group.insertIndex];
    if (insertionNode !== undefined) {
      const insertionPad = linePrefix(raw, insertionNode);
      edits.push({
        start: insertionNode.start,
        end: insertionNode.start,
        replacement: `${nestedText}\r\n${insertionPad}`,
      });
    } else if (parent.selfClosing) {
      const openTag = raw.slice(parent.start, parent.openEnd);
      const openText = openTag.endsWith("/>") ? `${openTag.slice(0, -2)}>` : openTag;
      edits.push({
        start: parent.start,
        end: parent.end,
        replacement: `${openText}\r\n${nestedText}\r\n${parentPad}</element>`,
      });
    } else {
      edits.push({
        start: parent.closeStart ?? parent.openEnd,
        end: parent.closeStart ?? parent.openEnd,
        replacement: `\r\n${nestedText}`,
      });
    }
  }
  return edits;
}

/**
 * Rebases nested-node paths from the pre-level-up tree onto the post-level-up
 * one. The raw edits resolve their parents against the document as it stands
 * *before* the level is applied, but the stored record is replayed by delevel
 * *after* — and applying a level appends a Level wrapper straight after the
 * last one, pushing down every top-level node that follows it (registered items
 * live there). Class containers nest inside an earlier Level wrapper, so their
 * paths never move.
 */
function rebaseNestedPaths(
  state: CharacterState,
  nested: LevelApplication["nestedAddedNodes"],
): LevelRegistrationRecord["nestedAddedNodes"] {
  if (nested === undefined) return undefined;
  let lastLevel = -1;
  state.elements.forEach((node, index) => {
    if (node.type === "Level") lastLevel = index;
  });
  const insertedAt = lastLevel + 1;
  return nested.map(({ parentPath, insertIndex, nodes }) =>
    parentPath.length > 0 && parentPath[0]! >= insertedAt
      ? { parentPath: [parentPath[0]! + 1, ...parentPath.slice(1)], insertIndex, nodes }
      : { parentPath, insertIndex, nodes },
  );
}

/** The record form of a nested group: the planner's sum bookkeeping is not persisted. */
function recordNestedGroups(nested: LevelApplication["nestedAddedNodes"]): LevelRegistrationRecord["nestedAddedNodes"] {
  return nested?.map(({ parentPath, insertIndex, nodes }) => ({ parentPath, insertIndex, nodes }));
}

/** Sum inserts for the elements a level's nested grants registered. */
function nestedSumInserts(
  library: ElementLibrary,
  nested: LevelApplication["nestedAddedNodes"],
): Array<{ anchor: { mode: "after-subtree"; path: number[] }; entries: Array<{ type: string; id: string }> }> {
  return (nested ?? [])
    .filter((group) => (group.sumIds?.length ?? 0) > 0)
    .map((group) => ({
      anchor: { mode: "after-subtree" as const, path: group.parentPath },
      entries: (group.sumIds ?? []).map((id) => ({ type: resolveElementType(library, id), id })),
    }));
}

/** True when the node already holds the wrapper this select would spawn. */
function hasWrapperFor(node: RegisteredElement, wrapper: TreeNode & { kind: "wrapper" }): boolean {
  return node.children.some((child) =>
    child.id === "" &&
    (child.checksum !== undefined && child.checksum !== ""
      ? child.checksum === wrapper.checksum
      : child.type === wrapper.type &&
        child.name === wrapper.name &&
        child.requiredLevel === wrapper.requiredLevel &&
        (child.number ?? 1) === (wrapper.number ?? 1)),
  );
}

/**
 * Applies the level-gated rules of elements that were already registered at an
 * earlier level: the `<select>` wrappers they spawn, and the targets of their
 * `<grant>` rules.
 *
 * Registering an element materialises only the rules eligible at that moment
 * (`registerElement`), so a feature registered at level 3 leaves its `level="5"`
 * rules behind. The requirement sweep deliberately skips level-gated rules
 * (`reconcile-rules.ts` header), which makes this the one place that ever fires
 * them: without it a Draconic Sorcerer never gains Fear, and an Oath of
 * Devotion paladin never gains its 5th/9th/13th/17th-level oath spells.
 *
 * Two passes, because "level" means different things either side of a class
 * wrapper (the reference engine ran class features through a per-class
 * progression manager and everything else through the shared one):
 *
 * - inside the levelled class container, `level=` is the CLASS level, so a
 *   `level="4"` feature on one class must not fire when another class reaches 4;
 * - everywhere else — items (the Additional Features adjustments), races,
 *   backgrounds, feats — `level=` is the CHARACTER level. Those nodes are
 *   siblings of the class container, so the class walk never reaches them;
 *   without this pass their later wrappers are unreachable (an adjustment
 *   item's 4th-level bonus feat, a race's level-3 choice).
 */
function withNestedLevelRules(
  state: CharacterState,
  library: ElementLibrary,
  application: LevelApplication,
  classId: string,
  isMulticlass: boolean,
  classLevel: number,
  totalLevel: number,
  // "level-up" walks the tree as it stands BEFORE the new level is applied;
  // "replay" reconstructs the records of an imported document, whose tree
  // already holds everything the level added.
  mode: "level-up" | "replay",
): LevelApplication {
  const newlyRegistered = new Set(application.sumIds);
  const extraIds = [...application.sumIds, ...(isMulticlass ? [classId] : [])];
  const nestedAddedNodes: NestedNodeGroup[] = [];

  const collect = (
    nodes: RegisteredElement[],
    path: number[],
    matchLevel: number,
    ctx: ReturnType<typeof createRegistrationContext>,
    skipClassContainers: boolean,
  ): void => {
    nodes.forEach((node, index) => {
      if (skipClassContainers && (node.type === "Class" || node.type === "Multiclass")) return;
      const here = [...path, index];
      // The element a node stands for: a registered element, or — for a filled
      // selection wrapper — the element the player picked into it. A subclass,
      // a feat and a chosen race are all wrappers, and their later features are
      // declared by exactly these rules ("Level 7: Remarkable Athlete" is a
      // `level="7"` grant on the Champion element the Archetype wrapper holds).
      // Which level gates them follows the wrapper's container, as everywhere
      // else: inside a class subtree the class level, outside it the character
      // level. The class container itself is never an owner — pass one starts
      // below it and pass two skips it — so `applyClassLevel` keeps sole charge
      // of the class's own rules.
      const ownerId = node.id !== "" ? node.id : (node.registered ?? "");
      const element = ownerId === "" || newlyRegistered.has(ownerId) ? undefined : library.byId.get(ownerId);
      if (element !== undefined) {
        const wrappers: TreeNode[] = [];
        for (const select of element.rules) {
          if (
            select.kind !== "select" ||
            select.level !== matchLevel ||
            !evaluateRequirements(select.requirements, ctx)
          ) {
            continue;
          }
          const count = select.number ?? 1;
          for (let number = 1; number <= count; number++) {
            const wrapper: TreeNode = {
              kind: "wrapper",
              type: select.type,
              name: select.name ?? select.type,
              requiredLevel: select.level,
              number: count > 1 ? number : undefined,
              checksum: selectionRuleChecksum(element.identity.id, select, number),
            };
            // Registering an element already spawns every select eligible at
            // that moment, so an item equipped — or a subclass chosen — at or
            // above the gate level brought its wrapper with it; don't add a
            // second one. Replay wants the mirror image: the wrapper standing
            // in the imported tree is the evidence that this level spawned it,
            // and recording one that is not there would only cost the level its
            // removability.
            if (mode === "replay" ? hasWrapperFor(node, wrapper) : !hasWrapperFor(node, wrapper)) {
              wrappers.push(wrapper);
            }
          }
        }
        const granted: TreeNode[] = [];
        const sumIds: string[] = [];
        for (const grant of element.rules) {
          if (grant.kind !== "grant" || grant.level !== matchLevel || !grantEligible(grant, state, ctx)) continue;
          const target = resolveGrant(grant, library);
          if (target === undefined || ctx.ids.includes(target.identity.id)) continue;
          const alreadyThere = node.children.some((child) => child.id === target.identity.id);
          // Level-up plans what the tree is missing; replay reads back what a
          // level put there. An imported tree already holds the target (and its
          // sum entry, so `ctx.registered` knows it), which is exactly the
          // evidence that this level is the one that registered it.
          if (mode === "replay" ? !alreadyThere : alreadyThere || ctx.registered.has(target.identity.id)) continue;
          const before = ctx.ids.length;
          const registered = registerElement(target, library, state, ctx, new Set());
          if (registered === null) continue;
          granted.push({ kind: "element", element: target, children: registered });
          sumIds.push(...ctx.ids.slice(before));
        }
        if (wrappers.length > 0 || granted.length > 0) {
          const firstAtOrAboveLevel = node.children.findIndex(
            (child) => child.requiredLevel !== undefined && child.requiredLevel >= matchLevel,
          );
          const firstRegisteredChild = node.children.findIndex((child) => child.requiredLevel === undefined);
          nestedAddedNodes.push({
            parentPath: here,
            // Wrappers belong among the element's other wrappers, ahead of its
            // registered children; a grant-only splice appends, which keeps
            // every existing sibling's index — and so its selection-rule path —
            // where it was (the same trade `reconcileRegistrationRules` makes).
            insertIndex:
              wrappers.length === 0
                ? node.children.length
                : firstAtOrAboveLevel >= 0
                  ? firstAtOrAboveLevel
                  : firstRegisteredChild < 0
                    ? node.children.length
                    : firstRegisteredChild,
            nodes: [...wrappers, ...granted],
            ...(sumIds.length === 0 ? {} : { sumIds }),
          });
        }
      }
      collect(node.children, here, matchLevel, ctx, skipClassContainers);
    });
  };

  // classId "" is the pending-multiclass level: it raises the character level
  // without advancing any class, so only the character-level pass applies.
  const containerPath = classId === "" ? undefined : containerPathOf(state, classId, isMulticlass);
  const container = classId === "" ? null : stateContainerNode(state, classId, isMulticlass);
  if (containerPath !== undefined && container !== null) {
    collect(
      container.children,
      containerPath,
      classLevel,
      createRegistrationContext(state, library, extraIds, classLevel),
      false,
    );
  }
  collect(
    state.elements,
    [],
    totalLevel,
    createRegistrationContext(state, library, extraIds, totalLevel),
    true,
  );

  return nestedAddedNodes.length === 0 ? application : { ...application, nestedAddedNodes };
}

/**
 * Whether the node now standing at a position is the one a level's plan put
 * there. Identity only — a wrapper by its rule (type, name, level, checksum),
 * a registered element by its id. What hangs off it is deliberately not
 * compared: the requirement sweep adds and removes rules underneath registered
 * elements long after the level that registered them, and a level whose
 * content has since been reconciled is still that level's content.
 */
function isAppliedNode(expected: TreeNode, actual: RegisteredElement): boolean {
  if (expected.kind === "wrapper") {
    if (
      actual.id !== "" ||
      actual.type !== expected.type ||
      actual.name !== expected.name ||
      actual.requiredLevel !== expected.requiredLevel
    ) {
      return false;
    }
    // Characters written by other tools carry foreign or empty checksums, so
    // an absent one on either side is not a mismatch.
    const expectedChecksum = expected.checksum ?? "";
    const actualChecksum = actual.checksum ?? "";
    return expectedChecksum === "" || actualChecksum === "" || expectedChecksum === actualChecksum;
  }
  return actual.id === expected.element.identity.id && actual.type === expected.element.identity.type;
}

/**
 * The children the requirement sweep may have added under an element since a
 * level registered its content: the targets of grants, and the wrappers of
 * selects, whose rule carries requirements and no level (`reconcileRegistrationRules`
 * owns exactly those). Enabling multiclassing, for instance, registers the
 * prerequisite grant into the class container long after the level that filled it.
 */
function reconciledChildKeys(library: ElementLibrary, ownerId: string): Set<string> {
  const keys = new Set<string>();
  const element = ownerId === "" ? undefined : library.byId.get(ownerId);
  if (element === undefined) return keys;
  for (const rule of element.rules) {
    if (rule.kind !== "grant" && rule.kind !== "select") continue;
    if (rule.level !== undefined || (rule.requirements ?? "").trim() === "") continue;
    if (rule.kind === "grant") {
      const target = resolveGrant(rule, library);
      if (target !== undefined) keys.add(target.identity.id);
    } else {
      keys.add(`select:${rule.type}|${rule.name ?? rule.type}`);
    }
  }
  return keys;
}

function isReconciledChild(node: RegisteredElement, keys: Set<string>): boolean {
  return node.id !== "" ? keys.has(node.id) : keys.has(`select:${node.type}|${node.name}`);
}

/**
 * Where a level's nodes sit among `actual`, in ascending order, or null when
 * one of them is gone. `direction` says which end the level's content is
 * anchored to: everything a level appends goes to the end of its class
 * container ("last"), except a multiclass start, which opens its own container
 * ("first"). Only reconciled children may stand between them and that end —
 * anything else there means the record no longer describes this tree, and
 * removing by position would take unrelated content with it.
 */
function locateAppliedNodes(
  actual: RegisteredElement[],
  expected: TreeNode[],
  direction: "first" | "last",
  reconciled: Set<string>,
  bound = direction === "last" ? actual.length : 0,
): number[] | null {
  const indices: number[] = [];
  if (direction === "last") {
    let cursor = bound - 1;
    for (let index = expected.length - 1; index >= 0; index--) {
      while (cursor >= 0 && !isAppliedNode(expected[index]!, actual[cursor]!)) {
        if (!isReconciledChild(actual[cursor]!, reconciled)) return null;
        cursor--;
      }
      if (cursor < 0) return null;
      indices.unshift(cursor);
      cursor--;
    }
    return indices;
  }
  let cursor = bound;
  for (const node of expected) {
    while (cursor < actual.length && !isAppliedNode(node, actual[cursor]!)) {
      if (!isReconciledChild(actual[cursor]!, reconciled)) return null;
      cursor++;
    }
    if (cursor >= actual.length) return null;
    indices.push(cursor);
    cursor++;
  }
  return indices;
}

/** Contiguous runs of ascending indices, for one removal edit per run. */
function indexRuns(indices: number[]): number[][] {
  const runs: number[][] = [];
  for (const index of indices) {
    const run = runs[runs.length - 1];
    if (run !== undefined && run[run.length - 1] === index - 1) run.push(index);
    else runs.push([index]);
  }
  return runs;
}

/**
 * Where a contiguous block of recorded nodes sits among `actual`, preferring
 * the position it was written at. A level's nested selects are spliced in as
 * one run at a fixed index, so anything inserted ahead of them since — by the
 * requirement sweep, or by a level that has already been taken back — moves
 * the whole run rather than breaking it up.
 */
function locateNodeRun(actual: RegisteredElement[], expected: TreeNode[], preferred: number): number[] | null {
  const matchesAt = (start: number): boolean =>
    start >= 0 &&
    start + expected.length <= actual.length &&
    expected.every((node, offset) => isAppliedNode(node, actual[start + offset]!));
  const at = (start: number): number[] => expected.map((_, offset) => start + offset);
  if (matchesAt(preferred)) return at(preferred);
  for (let start = 0; start + expected.length <= actual.length; start++) {
    if (matchesAt(start)) return at(start);
  }
  return null;
}

/** Removes the listed child positions, highest first so the rest keep theirs. */
function removeIndices<T>(list: T[], indices: number[]): void {
  for (const index of [...indices].sort((left, right) => right - left)) list.splice(index, 1);
}

/**
 * Where a level's nested selects — the wrappers it spliced into items, races,
 * backgrounds and feats rather than into its class container — are now. The
 * recorded parent path is an absolute tree position, so anything added or
 * removed ahead of it renumbers it; the wrappers themselves name the rule they
 * came from, so fall back to finding whichever parent still holds them.
 */
function resolveNestedParent(
  state: CharacterState,
  nested: { parentPath: number[]; insertIndex: number; nodes: unknown[] },
): { path: number[]; indices: number[] } | null {
  const expected = nested.nodes as TreeNode[];
  if (expected.length === 0) return { path: nested.parentPath, indices: [] };
  const locate = (parent: RegisteredElement): number[] | null =>
    locateNodeRun(parent.children, expected, nested.insertIndex);
  const recorded = pathToNode(state.elements, nested.parentPath);
  const atRecorded = recorded === null ? null : locate(recorded);
  if (atRecorded !== null) return { path: nested.parentPath, indices: atRecorded };
  let found: { path: number[]; indices: number[] } | null = null;
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      if (found !== null) return;
      const here = [...path, index];
      const located = locate(node);
      if (located !== null) {
        found = { path: here, indices: located };
        return;
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  return found;
}

function stateContainerNode(
  state: CharacterState,
  classId: string,
  isMulticlass: boolean,
): RegisteredElement | null {
  const walk = (nodes: RegisteredElement[]): RegisteredElement | null => {
    for (const node of nodes) {
      const matches = isMulticlass
        ? node.type === "Multiclass" && (node.registered ?? "") === classId
        : node.type === "Class" && (node.registered ?? "") === classId;
      if (matches) return node;
      const nested = walk(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return walk(state.elements);
}

/**
 * Rebuilds removable-level metadata from an imported document. A record is
 * accepted only when replaying the public class rules produces the exact
 * corresponding suffix (or multiclass-start prefix) of the imported tree.
 * Unexplained trees stay non-removable instead of risking unrelated content.
 */
export function reconstructLevelRegistrations(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
): LevelRegistrationRecord[] {
  if (state.level <= 1 || state.levelHistory.length !== state.level) return [];
  const wrappers = levelWrappers(document);
  const stateWrappers = state.elements.filter((node) => node.type === "Level");
  if (wrappers.length !== state.levelHistory.length || stateWrappers.length !== wrappers.length) return [];

  const sumIds = new Set(state.sum.elements.map((entry) => entry.id));
  const cursors = new Map<string, number>();
  const nestedCursors = new Map<string, number>();
  const applications = new Map<number, LevelApplication>();
  const recordsFrom = (start: number): LevelRegistrationRecord[] =>
    state.levelHistory.slice(start).map((entry, offset) => {
      const application = applications.get(start + offset)!;
      const addedElementIds = entry.isMulticlass && entry.isClassStart
        ? [`ID_INTERNAL_MULTICLASS_LEVEL_${entry.totalLevel}`, entry.classId, ...application.sumIds]
        : [`ID_LEVEL_${entry.totalLevel}`, ...application.sumIds];
      return {
        totalLevel: entry.totalLevel,
        classId: entry.classId,
        classLevel: entry.classLevel,
        isMulticlass: entry.isMulticlass,
        isClassStart: entry.isClassStart,
        addedElementIds,
        addedNodes: application.nodes,
        // No rebase here: replay walks the imported tree, which already holds
        // every level wrapper, so these paths are final already.
        ...(application.nestedAddedNodes === undefined
          ? {}
          : { nestedAddedNodes: recordNestedGroups(application.nestedAddedNodes) }),
      };
    });
  const reconstructedSuffix = (failedIndex: number): LevelRegistrationRecord[] =>
    recordsFrom(failedIndex + 1);

  for (let index = state.levelHistory.length - 1; index >= 1; index--) {
    const entry = state.levelHistory[index]!;
    const wrapper = wrappers[index]!;
    const stateWrapper = stateWrappers[index]!;
    if (
      entry.totalLevel !== index + 1 ||
      stateWrapper.id !== `ID_LEVEL_${entry.totalLevel}` ||
      getAttr(wrapper, "id") !== stateWrapper.id ||
      !sumIds.has(stateWrapper.id)
    ) {
      return reconstructedSuffix(index);
    }

    const classElement = entry.isMulticlass
      ? classElementForMulticlass(library, entry.classId)
      : library.byId.get(entry.classId);
    if (!classElement || classElement.identity.type !== "Class") return reconstructedSuffix(index);
    const application = withNestedLevelRules(
      state,
      library,
      applyClassLevel(state, library, classElement, entry.classLevel, {
        multiclass: entry.isMulticlass,
      }),
      entry.classId,
      entry.isMulticlass,
      entry.classLevel,
      entry.totalLevel,
      "replay",
    );
    if (!application.sumIds.every((id) => sumIds.has(id))) return reconstructedSuffix(index);
    applications.set(index, application);

    const container = stateContainerNode(state, entry.classId, entry.isMulticlass);
    if (!container) return reconstructedSuffix(index);
    const key = `${entry.isMulticlass ? "multiclass" : "main"}:${entry.classId}`;
    const cursor = cursors.get(key) ?? container.children.length;
    const reconciled = reconciledChildKeys(library, entry.classId);
    if (entry.isMulticlass && entry.isClassStart) {
      if (locateAppliedNodes(container.children, application.nodes, "first", reconciled) === null) {
        return reconstructedSuffix(index);
      }
      cursors.set(key, 0);
      continue;
    }
    const located = locateAppliedNodes(container.children, application.nodes, "last", reconciled, cursor);
    if (located === null) return reconstructedSuffix(index);
    cursors.set(key, located[0] ?? cursor);
    for (const nested of application.nestedAddedNodes ?? []) {
      const parent = pathToNode(state.elements, nested.parentPath);
      if (!parent) return reconstructedSuffix(index);
      const nestedKey = nested.parentPath.join(".");
      const nestedCursor = nestedCursors.get(nestedKey) ?? nested.insertIndex;
      const nestedLocated = locateNodeRun(parent.children, nested.nodes, nestedCursor);
      if (nestedLocated === null || nestedLocated[nestedLocated.length - 1]! >= nestedCursor + nested.nodes.length) {
        return reconstructedSuffix(index);
      }
      nestedCursors.set(nestedKey, nestedLocated[0] ?? nestedCursor);
    }
  }

  return recordsFrom(1);
}

/** The main class id (the registered Class wrapper), or null. */
export function mainClassIdOf(state: CharacterState): string | null {
  for (const level of state.elements) {
    const wrapper = level.children.find((child) => child.type === "Class" && (child.registered ?? "") !== "");
    if (wrapper?.registered) return wrapper.registered;
  }
  return null;
}

/** The class element for a multiclass variant id (ID_*_MULTICLASS_X). */
export function classElementForMulticlass(library: ElementLibrary, multiclassId: string): ParsedElement | undefined {
  for (const element of library.byType.get("Class") ?? []) {
    if (element.multiclass?.id === multiclassId) return element;
  }
  return undefined;
}

/** The class element for a main class id or a multiclass variant id. */
function classElementFor(library: ElementLibrary, classId: string): ParsedElement | undefined {
  return library.byId.get(classId) ?? classElementForMulticlass(library, classId);
}

function linePrefix(raw: string, node: Dnd5eNode): string {
  let lineStart = node.start;
  while (lineStart > 0 && (raw[lineStart - 1] === "\t" || raw[lineStart - 1] === " ")) lineStart--;
  return raw.slice(lineStart, node.start);
}

/** Removes a contiguous node range including its preceding line break. */
function removeNodeEdit(raw: string, first: Dnd5eNode, last: Dnd5eNode): RawEdit {
  let start = first.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start -= 1;
  if (start > 0 && raw[start - 1] === "\r") start -= 1;
  return { start, end: last.end, replacement: "" };
}

function levelWrappers(document: Dnd5eDocument): Dnd5eNode[] {
  const elements = document.root.build.elements?.node;
  return elements ? childElements(elements, "element").filter((node) => getAttr(node, "type") === "Level") : [];
}

function mainClassWrapperNode(document: Dnd5eDocument): Dnd5eNode | null {
  const first = levelWrappers(document)[0];
  if (!first) return null;
  return childElements(first, "element").find((node) => getAttr(node, "type") === "Class") ?? null;
}

function multiclassContainerNode(document: Dnd5eDocument, multiclassId: string): Dnd5eNode | null {
  const start = levelWrappers(document).find(
    (node) =>
      getAttr(node, "multiclass") === "true" && getAttr(node, "starting") === "true" && getAttr(node, "class") === multiclassId,
  );
  if (!start) return null;
  return childElements(start, "element").find((node) => getAttr(node, "type") === "Multiclass") ?? null;
}

/** All element ids and registered wrapper ids in a document subtree. */
function subtreeSumIds(node: Dnd5eNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: Dnd5eNode): void => {
    const id = getAttr(n, "id");
    if (id) ids.add(id);
    const registered = getAttr(n, "registered");
    if (registered && registered !== "") ids.add(registered);
    for (const child of childElements(n, "element")) walk(child);
  };
  walk(node);
  return ids;
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

/** Replaces the <sum> children with `remaining` and rewrites element-count. */
export function planSumReplaceEdits(document: Dnd5eDocument, remaining: Array<{ type: string; id: string }>): RawEdit[] {
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

export function planElementsCountEdits(
  document: Dnd5eDocument,
  levelCount: number,
  registeredCount: number,
): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) return [];
  const raw = document.raw;
  const edits: RawEdit[] = [];
  const lc = attrValueRange(raw, elementsNode, "level-count");
  if (lc) edits.push({ start: lc.start, end: lc.end, replacement: String(levelCount) });
  const rc = attrValueRange(raw, elementsNode, "registered-count");
  if (rc) edits.push({ start: rc.start, end: rc.end, replacement: String(registeredCount) });
  return edits;
}

function planDisplayLevelEdit(document: Dnd5eDocument, level: number): RawEdit[] {
  const display = document.root.displayProperties.node;
  if (!display) return [];
  const node = childElements(display).find((n) => n.name === "level");
  if (!node || node.selfClosing) return [];
  return [{ start: node.openEnd, end: node.closeStart ?? node.openEnd, replacement: String(level) }];
}

function planDisplayClassEdit(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  level: number,
): RawEdit[] {
  const classes = new Map<string, { name: string; level: number }>();
  for (const entry of state.levelHistory.slice(0, level)) {
    const current = classes.get(entry.classId);
    if (current) {
      current.level++;
      continue;
    }
    const name = (
      library.byId.get(entry.classId) ?? classElementForMulticlass(library, entry.classId)
    )?.identity.name ?? entry.classId;
    classes.set(entry.classId, { name, level: 1 });
  }
  if (classes.size === 0) return [];
  const displayClass = classes.size === 1
    ? [...classes.values()][0]!.name
    : [...classes.values()].map((entry) => `${entry.name} (${entry.level})`).join(" / ");
  const display = document.root.displayProperties.node;
  const node = display ? childElements(display).find((candidate) => candidate.name === "class") : undefined;
  if (!node || node.selfClosing) return [];
  return [{ start: node.openEnd, end: node.closeStart ?? node.openEnd, replacement: displayClass }];
}

export interface LevelUpPlan {
  edits: RawEdit[];
  record: LevelRegistrationRecord;
}

function appendLevelEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  nextLevel: number,
  application: LevelApplication,
  classId: string,
  multiclass: boolean,
  levelEntry: { type: string; id: string },
): RawEdit[] {
  const raw = document.raw;
  const edits: RawEdit[] = [];
  const wrappers = levelWrappers(document);
  const lastLevel = wrappers[wrappers.length - 1];
  if (!lastLevel) throw engineError("not-found", "no level wrapper found");
  const levelPad = linePrefix(raw, lastLevel);
  const levelText = multiclass
    ? `${levelPad}<element type="Level" name="${nextLevel}" id="ID_LEVEL_${nextLevel}" multiclass="true" class="${escapeXml(classId)}" />`
    : `${levelPad}<element type="Level" name="${nextLevel}" id="ID_LEVEL_${nextLevel}" />`;
  edits.push({ start: lastLevel.end, end: lastLevel.end, replacement: `\r\n${levelText}` });

  const container = multiclass ? multiclassContainerNode(document, classId) : mainClassWrapperNode(document);
  if (!container || container.closeStart === null) {
    throw engineError("not-found", `class wrapper for '${classId}' not found`);
  }
  const pad = linePrefix(raw, container);
  const childrenText = renderNodes(application.nodes, pad.length + 1);
  if (childrenText !== "") {
    edits.push({ start: container.closeStart, end: container.closeStart, replacement: `\r\n${childrenText}` });
  }
  edits.push(...nestedInsertEdits(document, application.nestedAddedNodes));

  const containerPath = containerPathOf(state, classId, multiclass);
  const sumView = document.root.build.sum;
  if (sumView) {
    const existing = sumView.elements().map((e) => ({ type: e.type ?? "", id: e.id ?? "" }));
    const entries = orderSumEntries(
      existing,
      state,
      [
        {
          anchor: { mode: "after-last-outside-classes" },
          entries: [levelEntry],
        },
        {
          anchor: { mode: "container-end", containerPath },
          entries: application.sumIds.map((id) => ({ type: resolveElementType(library, id), id })),
        },
        ...nestedSumInserts(library, application.nestedAddedNodes),
      ],
    );
    const sumNode = sumView.node;
    const inner = `\r\n${entries
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
    const count = attrValueRange(raw, sumNode, "element-count");
    if (count) edits.push({ start: count.start, end: count.end, replacement: String(entries.length) });
  }
  edits.push(
    ...planElementsCountEdits(
      document,
      state.levelCount + 1,
      state.levelCount + 1 + filledWrapperCount(state.elements) + state.options.size,
    ),
  );
  edits.push(...planDisplayLevelEdit(document, nextLevel));
  edits.push(...planExperienceEdit(document, xpForLevel(nextLevel)));
  return edits;
}

/** State-tree path of the class/multiclass container wrapper. */
function containerPathOf(state: CharacterState, classId: string, multiclass: boolean): number[] | undefined {
  const walk = (nodes: RegisteredElement[], path: number[]): number[] | undefined => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const here = [...path, i];
      const matches = multiclass
        ? node.type === "Multiclass" && (node.registered ?? "") === classId
        : node.type === "Class" && (node.registered ?? "") === classId;
      if (matches) return here;
      const nested = walk(node.children, here);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(state.elements, []);
}

/** XP threshold of a character level (these are written on level-up). */
export function xpForLevel(level: number): number {
  const table = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
  if (level < 1) return 0;
  if (level >= table.length) return table[table.length - 1]!;
  return table[level]!;
}

/** Replaces the <experience> text (level thresholds on level-up, -50 on delevel). */
function planExperienceEdit(document: Dnd5eDocument, experience: number): RawEdit[] {
  const input = document.root.build.input;
  const node = input ? child(input.node, "experience") : null;
  if (!node || node.selfClosing) return [];
  const start = node.openEnd;
  const end = node.closeStart ?? node.openEnd;
  if (end - start <= 0) return [];
  return [{ start, end, replacement: String(experience) }];
}

/** Main-class level up: appends the empty Level N wrapper + level-N features. */
export function planLevelUpEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
): LevelUpPlan {
  if (state.level >= MAX_LEVEL) throw engineError("conflict", `cannot level up beyond level ${MAX_LEVEL}`);
  const classId = mainClassIdOf(state);
  if (!classId) throw engineError("conflict", "select a class before leveling up");
  const classElement = library.byId.get(classId);
  if (!classElement) throw engineError("not-found", `class '${classId}' not found`);
  const nextLevel = state.level + 1;
  const classLevel = state.levelHistory.filter((entry) => entry.classId === classId && !entry.isMulticlass).length + 1;
  const application = withNestedLevelRules(
    state,
    library,
    applyClassLevel(state, library, classElement, classLevel),
    classId,
    false,
    classLevel,
    nextLevel,
    "level-up",
  );
  const edits = appendLevelEdits(
    document,
    state,
    library,
    nextLevel,
    application,
    classId,
    false,
    { type: "Level", id: `ID_LEVEL_${nextLevel}` },
  );
  // A multiclassed character displays "Fighter (5) / Rogue (2)", so advancing
  // the main class moves that string too. Single-class documents keep whatever
  // they carry: their display never counts levels, and rewriting it would
  // overwrite the name an imported character was saved with.
  if (state.levelHistory.some((entry) => entry.isMulticlass)) {
    const nextHistory = {
      totalLevel: nextLevel,
      classId,
      classLevel,
      isMulticlass: false,
      isClassStart: false,
      isPending: false,
      canRemove: true,
    };
    edits.push(
      ...planDisplayClassEdit(
        document,
        { ...state, levelHistory: [...state.levelHistory, nextHistory] },
        library,
        nextLevel,
      ),
    );
  }
  return {
    edits,
    record: {
      totalLevel: nextLevel,
      classId,
      classLevel,
      isMulticlass: false,
      isClassStart: false,
      addedElementIds: [`ID_LEVEL_${nextLevel}`, ...application.sumIds],
      addedNodes: application.nodes,
      ...(application.nestedAddedNodes === undefined
        ? {}
        : { nestedAddedNodes: rebaseNestedPaths(state, application.nestedAddedNodes) }),
    },
  };
}

/** Multiclass level up: appends a multiclass level wrapper + the next class level features. */
export function planLevelUpMulticlassEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  multiclassId: string,
): LevelUpPlan {
  const classElement = classElementForMulticlass(library, multiclassId);
  if (!classElement) throw engineError("not-found", `multiclass variant '${multiclassId}' not found`);
  const history = state.levelHistory.filter((entry) => entry.classId === multiclassId && entry.isMulticlass);
  if (history.length === 0) throw engineError("conflict", `not multiclassing '${multiclassId}'`);
  if (state.level >= MAX_LEVEL) throw engineError("conflict", `cannot level up beyond level ${MAX_LEVEL}`);
  const classLevel = history[history.length - 1]!.classLevel + 1;
  const nextLevel = state.level + 1;
  const application = withNestedLevelRules(
    state,
    library,
    applyClassLevel(state, library, classElement, classLevel, { multiclass: true }),
    multiclassId,
    true,
    classLevel,
    nextLevel,
    "level-up",
  );
  const edits = appendLevelEdits(
    document,
    state,
    library,
    nextLevel,
    application,
    multiclassId,
    true,
    { type: "Level", id: `ID_LEVEL_${nextLevel}` },
  );
  const nextHistory = {
    totalLevel: nextLevel,
    classId: multiclassId,
    classLevel,
    isMulticlass: true,
    isClassStart: false,
    isPending: false,
    canRemove: true,
  };
  edits.push(
    ...planDisplayClassEdit(
      document,
      { ...state, levelHistory: [...state.levelHistory, nextHistory] },
      library,
      nextLevel,
    ),
  );
  return {
    edits,
    record: {
      totalLevel: nextLevel,
      classId: multiclassId,
      classLevel,
      isMulticlass: true,
      isClassStart: false,
      addedElementIds: [`ID_LEVEL_${nextLevel}`, ...application.sumIds],
      addedNodes: application.nodes,
      ...(application.nestedAddedNodes === undefined
        ? {}
        : { nestedAddedNodes: rebaseNestedPaths(state, application.nestedAddedNodes) }),
    },
  };
}

/**
 * Checksum for a spawned "Multiclass (Level N)" wrapper. Fixture-pinned
 * convention: the owning element is the level wrapper (ID_LEVEL_N), the
 * select is the Multiclass rule itself (8efd27e5 for level 2).
 */
function multiclassWrapperChecksum(level: number): string {
  return selectionRuleChecksum(`ID_LEVEL_${level}`, { kind: "select", type: "Multiclass", name: `Multiclass (Level ${level})`, level } as SelectRule, 1);
}

/** Adds the unresolved multiclass level, which is completed by setSelection. */
export function planNewMulticlassEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
): LevelUpPlan {
  if (!state.options.has(OPTION_MULTICLASSING)) {
    throw engineError("invalid-argument", "the multiclassing option is not enabled");
  }
  if (state.level <= 1) throw engineError("invalid-argument", "multiclassing requires a total level above 1");
  if (state.level >= MAX_LEVEL) throw engineError("conflict", `cannot level up beyond level ${MAX_LEVEL}`);
  if (state.levelHistory.some((entry) => entry.isPending)) {
    throw engineError("conflict", "resolve the pending multiclass before leveling up");
  }
  const mainClassId = mainClassIdOf(state);
  const mainClass = mainClassId ? library.byId.get(mainClassId) : undefined;
  if (!mainClassId || !mainClass) throw engineError("conflict", "select a class before multiclassing");
  if (
    mainClass.multiclass?.requirements !== undefined &&
    !evaluateRequirements(
      mainClass.multiclass.requirements,
      createRegistrationContext(state, library, [], state.level),
    )
  ) {
    throw engineError("invalid-argument", `prerequisites for '${mainClass.identity.name}' are not met`);
  }

  const wrappers = levelWrappers(document);
  const lastLevel = wrappers[wrappers.length - 1];
  if (!lastLevel) throw engineError("not-found", "no level wrapper found");
  const nextLevel = state.level + 1;
  const pad = linePrefix(document.raw, lastLevel);
  const innerPad = `${pad}\t`;
  const replacement =
    `\r\n${pad}<element type="Level" name="${nextLevel}" id="ID_LEVEL_${nextLevel}">` +
    `\r\n${innerPad}<element type="Multiclass" name="Multiclass (Level ${nextLevel})" requiredLevel="${nextLevel}" checksum="${multiclassWrapperChecksum(nextLevel)}" registered="" />` +
    `\r\n${innerPad}<element type="Grants" name="Multiclassing (Level ${nextLevel})" id="ID_INTERNAL_MULTICLASS_LEVEL_${nextLevel}" />` +
    `\r\n${pad}</element>`;
  // The pending multiclass level raises the character level on its own, so
  // character-level rules on items/races unlock here too.
  const application = withNestedLevelRules(
    state,
    library,
    { nodes: [], sumIds: [] },
    "",
    false,
    0,
    nextLevel,
    "level-up",
  );
  const edits: RawEdit[] = [{ start: lastLevel.end, end: lastLevel.end, replacement }];
  edits.push(...nestedInsertEdits(document, application.nestedAddedNodes));

  const sumView = document.root.build.sum;
  if (sumView) {
    const sumNode = sumView.node;
    const entries = orderSumEntries(
      sumView.elements().map((entry) => ({ type: entry.type ?? "", id: entry.id ?? "" })),
      state,
      [
        {
          anchor: { mode: "after-last-outside-container" },
          entries: [
            { type: "Level", id: `ID_LEVEL_${nextLevel}` },
            { type: "Grants", id: `ID_INTERNAL_MULTICLASS_LEVEL_${nextLevel}` },
          ],
        },
        ...nestedSumInserts(library, application.nestedAddedNodes),
      ],
    );
    const inner = `\r\n${entries
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
    const count = attrValueRange(document.raw, sumNode, "element-count");
    if (count) edits.push({ start: count.start, end: count.end, replacement: String(entries.length) });
  }
  edits.push(
    ...planElementsCountEdits(
      document,
      nextLevel,
      nextLevel + filledWrapperCount(state.elements) + state.options.size,
    ),
    ...planDisplayLevelEdit(document, nextLevel),
    ...planExperienceEdit(document, xpForLevel(nextLevel)),
  );
  return {
    edits,
    record: {
      totalLevel: nextLevel,
      classId: "",
      classLevel: 0,
      isMulticlass: true,
      isClassStart: false,
      addedElementIds: [`ID_LEVEL_${nextLevel}`, `ID_INTERNAL_MULTICLASS_LEVEL_${nextLevel}`],
      addedNodes: [],
      ...(application.nestedAddedNodes === undefined
        ? {}
        : { nestedAddedNodes: rebaseNestedPaths(state, application.nestedAddedNodes) }),
    },
  };
}

/** rndhp attribute insertion point of a level wrapper's open tag. */
function rndhpInsertion(document: Dnd5eDocument, levelNode: Dnd5eNode, rolls: number[]): RawEdit {
  const insertion = levelNode.selfClosing ? levelNode.openEnd - 2 : levelNode.openEnd - 1;
  return { start: insertion, end: insertion, replacement: ` rndhp="${rolls.join(",")}"` };
}

/** The starting level wrapper of a class (Level 1 for the main class). */
function startingLevelWrapper(document: Dnd5eDocument, classId: string, mainClassId: string | null): Dnd5eNode | null {
  const wrappers = levelWrappers(document);
  if (classId === mainClassId) return wrappers[0] ?? null;
  return wrappers.find(
    (node) => getAttr(node, "multiclass") === "true" && getAttr(node, "starting") === "true" && getAttr(node, "class") === classId,
  ) ?? null;
}

/**
 * Repairs roll arrays persisted while the class's hit die parsed as 0 (every
 * slot is 1). Real histories cannot look like this: the main class's first
 * slot is always the die maximum, and twenty natural 1s on a real die is not
 * a plausible roll record. Runs on level-shape mutations only, so unmodified
 * characters still export byte-identically.
 */
export function planHealDegenerateRollsEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  rng: () => number,
): RawEdit[] {
  const edits: RawEdit[] = [];
  const mainClassId = mainClassIdOf(state);
  const seen = new Set<string>();
  for (const entry of state.levelHistory.slice(0, state.level)) {
    if (entry.classId === "" || seen.has(entry.classId)) continue;
    seen.add(entry.classId);
    const classElement = classElementFor(library, entry.classId);
    if (!classElement) continue;
    const die = extractHitDie(classElement);
    const rolls = state.hitPointRolls[entry.classId] ?? [];
    if (die <= 1 || rolls.length === 0 || !rolls.every((value) => value === 1)) continue;
    const wrapper = startingLevelWrapper(document, entry.classId, mainClassId);
    if (!wrapper) continue;
    const range = attrValueRange(document.raw, wrapper, "rndhp");
    if (!range) continue;
    const fresh = entry.classId === mainClassId
      ? rollMainClassHitPoints(classElement, rng)
      : rollHitPoints(classElement, rng);
    edits.push({ start: range.start, end: range.end, replacement: fresh.join(",") });
  }
  return edits;
}

/** Registers the hit point roll of a class onto its starting level wrapper (rolled once). */
export function planClassRndhpEdit(
  document: Dnd5eDocument,
  state: CharacterState,
  classElement: ParsedElement,
  rng: () => number,
): RawEdit | null {
  const wrappers = levelWrappers(document);
  const level1 = wrappers[0];
  if (!level1) return null;
  if (getAttr(level1, "rndhp") !== null) return null;
  return rndhpInsertion(document, level1, rollMainClassHitPoints(classElement, rng));
}

export interface MulticlassStartPlan {
  edits: RawEdit[];
  record: LevelRegistrationRecord;
}

/**
 * Starts multiclassing into the variant `multiclassId` at the current total
 * level: transforms the last level wrapper into the starting multiclass
 * wrapper (multiclass/starting/rndhp/class attributes), registers the
 * multiclass variant's level-1 content (flip-marker semantics) and
 * ID_INTERNAL_MULTICLASS_LEVEL_N.
 */
export function planStartMulticlassEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  multiclassId: string,
  rng: () => number,
): MulticlassStartPlan {
  if (!state.options.has(OPTION_MULTICLASSING)) {
    throw engineError("invalid-argument", "the multiclassing option is not enabled");
  }
  if (state.level <= 1) throw engineError("invalid-argument", "multiclassing requires a total level above 1");
  const classElement = classElementForMulticlass(library, multiclassId);
  if (!classElement) throw engineError("not-found", `multiclass variant '${multiclassId}' not found`);
  const block = classElement.multiclass;
  if (!block) throw engineError("not-found", `multiclass variant '${multiclassId}' has no block`);
  const ctx = createRegistrationContext(state);
  if (!evaluateRequirements(block.requirements, ctx)) {
    throw engineError("invalid-argument", `prerequisites for '${classElement.identity.name}' are not met`);
  }
  // Multiclassing OUT of your existing class(es) requires meeting THEIR
  // multiclass prerequisite too, not just the target's — planNewMulticlassEdits
  // already checks this before a pending choice is created, but this function
  // is also called directly (CharacterService.startMulticlass), so the check
  // is repeated here rather than relying on every caller to have gone through
  // that path first.
  const mainClassId = mainClassIdOf(state);
  const mainClass = mainClassId ? library.byId.get(mainClassId) : undefined;
  if (
    mainClass?.multiclass?.requirements !== undefined &&
    !evaluateRequirements(mainClass.multiclass.requirements, createRegistrationContext(state, library, [], state.level))
  ) {
    throw engineError("invalid-argument", `prerequisites for '${mainClass.identity.name}' are not met`);
  }
  const already = state.levelHistory.some((entry) => entry.classId === multiclassId && entry.isMulticlass);
  if (already) throw engineError("conflict", `already multiclassing '${classElement.identity.name}'`);

  const totalLevel = state.level;
  const wrappers = levelWrappers(document);
  const lastLevel = wrappers[wrappers.length - 1];
  if (!lastLevel) throw engineError("not-found", "no level wrapper found");
  const pendingStart =
    state.levelHistory[state.levelHistory.length - 1]?.isPending === true &&
    childElements(lastLevel, "element").some(
      (node) => getAttr(node, "type") === "Multiclass" && (getAttr(node, "registered") ?? "") === "",
    );

  const application = applyClassLevel(state, library, classElement, 1, { multiclass: true });
  const rolls = rollHitPoints(classElement, rng);
  const raw = document.raw;
  const pad = linePrefix(raw, lastLevel);
  const innerPad = `${pad}\t`;

  const levelOpen = `<element type="Level" name="${totalLevel}" id="ID_LEVEL_${totalLevel}" multiclass="true" starting="true" rndhp="${rolls.join(",")}" class="${escapeXml(multiclassId)}">`;
  const wrapperOpen = `<element type="Multiclass" name="Multiclass (Level ${totalLevel})" requiredLevel="${totalLevel}" checksum="${multiclassWrapperChecksum(totalLevel)}" registered="${escapeXml(multiclassId)}">`;
  const cascade = renderNodes(application.nodes, innerPad.length + 1);
  const wrapperText =
    cascade === "" ? `${innerPad}${wrapperOpen} />` : `${innerPad}${wrapperOpen}\r\n${cascade}\r\n${innerPad}</element>`;
  const grantText = `${innerPad}<element type="Grants" name="Multiclassing (Level ${totalLevel})" id="ID_INTERNAL_MULTICLASS_LEVEL_${totalLevel}" />`;
  const replacement = `${levelOpen}\r\n${wrapperText}\r\n${grantText}\r\n${pad}</element>`;
  const edits: RawEdit[] = [{ start: lastLevel.start, end: lastLevel.end, replacement }];

  const sumEntries: Array<{ type: string; id: string }> = [
    ...(pendingStart ? [] : [{ type: "Grants", id: `ID_INTERNAL_MULTICLASS_LEVEL_${totalLevel}` }]),
    { type: "Multiclass", id: multiclassId },
    ...application.sumIds.map((id) => ({ type: resolveElementType(library, id), id })),
  ];
  edits.push(...planSumAppendEdits(document, sumEntries));
  edits.push(
    ...planElementsCountEdits(
      document,
      state.levelCount,
      state.levelCount + filledWrapperCount(state.elements) + state.options.size + 1,
    ),
  );
  const displayState: CharacterState = {
    ...state,
    levelHistory: [
      ...state.levelHistory.slice(0, -1),
      {
        totalLevel,
        classId: multiclassId,
        classLevel: 1,
        isMulticlass: true,
        isClassStart: true,
        isPending: false,
        canRemove: true,
      },
    ],
  };
  edits.push(...planDisplayClassEdit(document, displayState, library, totalLevel));
  return {
    edits,
    record: {
      totalLevel,
      classId: multiclassId,
      classLevel: 1,
      isMulticlass: true,
      isClassStart: true,
      addedElementIds: [`ID_INTERNAL_MULTICLASS_LEVEL_${totalLevel}`, multiclassId, ...application.sumIds],
      addedNodes: application.nodes,
    },
  };
}

/** Replaces the rndhp slot of (class, classLevel) on the class's starting wrapper. */
export function planSetHitPointRollEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  classId: string,
  classLevel: number,
  value: number,
): RawEdit[] {
  const classElement = classElementFor(library, classId);
  if (!classElement) throw engineError("not-found", `class '${classId}' not found`);
  if (!Number.isInteger(value) || value < 1) {
    throw engineError("invalid-argument", "hit point roll must be a positive integer");
  }
  const die = extractHitDie(classElement);
  if (die > 0 && value > die) {
    throw engineError("invalid-argument", `hit point roll must be at most the d${die} hit die`);
  }
  if (state.options.has(OPTION_AVERAGE_HP)) {
    throw engineError("invalid-argument", "hit point rolls cannot be edited while average hit points are enabled");
  }
  if (classId === mainClassIdOf(state) && classLevel === 1) {
    throw engineError("invalid-argument", "the main class's first level is fixed at the hit die maximum");
  }
  const history = state.levelHistory.filter((entry) => entry.classId === classId);
  if (classLevel < 1 || classLevel > history.length) {
    throw engineError("invalid-argument", `class level ${classLevel} out of range for '${classId}'`);
  }
  const wrapper = startingLevelWrapper(document, classId, mainClassIdOf(state));
  if (!wrapper) throw engineError("not-found", `starting level wrapper for '${classId}' not found`);
  const range = attrValueRange(document.raw, wrapper, "rndhp");
  if (!range) throw engineError("not-found", `no hit point rolls for '${classId}'`);
  const values = document.raw
    .slice(range.start, range.end)
    .split(",")
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => !Number.isNaN(n));
  return [{ start: range.start, end: range.end, replacement: values.map((v, i) => (i === classLevel - 1 ? value : v)).join(",") }];
}

interface FilledWrapper {
  node: RegisteredElement;
  path: number[];
}

/** Filled selection wrappers with requiredLevel above `level`, with tree paths. */
function wrappersAboveLevel(nodes: RegisteredElement[], level: number, path: number[] = []): FilledWrapper[] {
  const out: FilledWrapper[] = [];
  nodes.forEach((node, index) => {
    const here = [...path, index];
    if (node.requiredLevel !== undefined && (node.registered ?? "") !== "" && node.requiredLevel > level) {
      out.push({ node, path: here });
    }
    out.push(...wrappersAboveLevel(node.children, level, here));
  });
  return out;
}

function selectionRuleForPath(state: CharacterState, path: number[]): SelectionRule {
  const ids = state.selectionRuleIds ?? new Map<string, string>();
  const key = path.join(".");
  let identifier = ids.get(key);
  if (!identifier) {
    identifier = randomUuid();
    ids.set(key, identifier);
  }
  const node = pathToNode(state.elements, path);
  return {
    identifier,
    type: node?.type ?? "",
    name: node?.name ?? "",
    requiredLevel: node?.requiredLevel ?? 0,
    hasSelection: true,
    selectedElementIds: node?.registered ? [node.registered] : [],
    path,
  };
}

function pathToNode(nodes: RegisteredElement[], path: number[]): RegisteredElement | null {
  let current = nodes;
  let node: RegisteredElement | undefined;
  for (const index of path) {
    node = current[index];
    if (!node) return null;
    current = node.children;
  }
  return node ?? null;
}

export interface DelevelPlan {
  edits: RawEdit[];
  snapshot: DelevelSnapshot;
  removedLevel: number;
  requiredRepicks: SelectionRule[];
}

/**
 * Removes the last level: pops the Level wrapper, removes that level's
 * features from the class wrapper, drops the level's sum entries, and
 * unregisters selection wrappers whose requiredLevel exceeds the new total
 * (reported as requiredRepicks). The reconciled pre-removal document text and
 * records are kept in the snapshot for undoDelevel.
 */
export function planDelevelEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  opts: { mode: "last" | "class"; classId?: string },
): DelevelPlan {
  if (state.level <= 1) throw engineError("invalid-argument", "cannot delevel below level 1");
  const records = state.levelRegistrations;
  const record = records[records.length - 1];
  if (!record) throw engineError("conflict", "no level history to remove in this session");
  const current = state.levelHistory[state.levelHistory.length - 1];
  if (
    !current ||
    current.totalLevel !== record.totalLevel ||
    current.classId !== record.classId ||
    current.classLevel !== record.classLevel ||
    current.isMulticlass !== record.isMulticlass ||
    current.isClassStart !== record.isClassStart
  ) {
    throw engineError("conflict", "level registration record does not match the current level");
  }
  if (opts.mode === "class" && opts.classId !== undefined && opts.classId !== record.classId) {
    throw engineError("invalid-argument", `the last level belongs to '${record.classId}', not '${opts.classId}'`);
  }
  const newLevel = state.level - 1;

  const raw = document.raw;
  const edits: RawEdit[] = [];
  const snapshotReconcileEdits: RawEdit[] = [];
  const wrappers = levelWrappers(document);
  const lastLevelNode = wrappers[wrappers.length - 1];
  if (!lastLevelNode) throw engineError("not-found", "no level wrapper found");

  const removedSumIds = new Set<string>(record.addedElementIds);
  const removedStatePaths: number[][] = [];
  const isDescendantPath = (path: number[], prefix: number[]): boolean =>
    path.length >= prefix.length && prefix.every((part, index) => part === path[index]);
  const walked = pathsOf(state.elements);
  /** Where the level's own nodes were found in its class container. */
  let containerRemovals: number[] = [];
  if ((record.isMulticlass && record.isClassStart) || current.isPending) {
    for (const id of subtreeSumIds(lastLevelNode)) removedSumIds.add(id);
    edits.push(removeNodeEdit(raw, lastLevelNode, lastLevelNode));
    const lastLevel = walked
      .filter(({ node }) => node.type === "Level")
      .at(-1);
    if (lastLevel) removedStatePaths.push(lastLevel.path);
  } else {
    const container = record.isMulticlass
      ? multiclassContainerNode(document, record.classId)
      : mainClassWrapperNode(document);
    if (!container) throw engineError("not-found", `class wrapper for '${record.classId}' not found`);
    const children = childElements(container, "element");
    const stateContainer = stateContainerNode(state, record.classId, record.isMulticlass);
    const expectedNodes = record.addedNodes as TreeNode[];
    const located =
      stateContainer === null
        ? null
        : locateAppliedNodes(
            stateContainer.children,
            expectedNodes,
            "last",
            reconciledChildKeys(library, record.classId),
          );
    if (located === null || located.some((index) => index >= children.length)) {
      throw engineError(
        "internal",
        `level ${record.totalLevel} of '${record.classId}' is no longer in the document tree`,
      );
    }
    containerRemovals = located;
    for (const run of indexRuns(located)) {
      const removed = run.map((index) => children[index]!);
      for (const child of removed) {
        for (const id of subtreeSumIds(child)) removedSumIds.add(id);
      }
      edits.push(removeNodeEdit(raw, removed[0]!, removed[removed.length - 1]!));
    }
    const containerPath = walked.find(
      ({ node }) =>
        (record.isMulticlass ? node.type === "Multiclass" : node.type === "Class") &&
        (node.registered ?? "") === record.classId,
    )?.path;
    if (containerPath !== undefined) {
      for (const index of located) removedStatePaths.push([...containerPath, index]);
    }
    edits.push(removeNodeEdit(raw, lastLevelNode, lastLevelNode));
  }

  // Character-level selects live outside the class container — and outside the
  // removed Level node — so they must be taken back on every delevel branch,
  // including the pending-multiclass one that only drops the level wrapper.
  const nestedRemovals: Array<{ path: number[]; indices: number[] }> = [];
  for (const nested of record.nestedAddedNodes ?? []) {
    if (nested.nodes.length === 0) continue;
    const resolved = resolveNestedParent(state, nested);
    // A select nested inside the level's own content is deleted along with it.
    // Emitting a second edit for it would overlap the removal already planned
    // and cut the document mid-tag.
    if (resolved !== null && removedStatePaths.some((prefix) => isDescendantPath(resolved.path, prefix))) continue;
    const parent = resolved === null ? null : nodeByPath(document, resolved.path);
    const children = parent === null ? [] : childElements(parent, "element");
    if (resolved === null || parent === null || resolved.indices.some((index) => index >= children.length)) {
      throw engineError(
        "internal",
        `a level-gated choice added by level ${record.totalLevel} is no longer in the document tree`,
      );
    }
    nestedRemovals.push(resolved);
    for (const run of indexRuns(resolved.indices)) {
      const removed = run.map((index) => children[index]!);
      for (const child of removed) {
        for (const id of subtreeSumIds(child)) removedSumIds.add(id);
      }
      edits.push(removeNodeEdit(raw, removed[0]!, removed[removed.length - 1]!));
    }
    for (const index of resolved.indices) removedStatePaths.push([...resolved.path, index]);
  }

  // A partial verified suffix means the imported character used different
  // content rules; replaying unrelated grants would silently modernize it.
  const hasCompletePostStartHistory =
    records.length === state.levelHistory.length - 1 &&
    records.every((entry, index) => entry.totalLevel === index + 2);
  const reconcile = hasCompletePostStartHistory
    ? reconcilePendingGrants(state, library, createRegistrationContext(state, library)).filter(
        (group) => !removedStatePaths.some((prefix) => isDescendantPath(group.parentPath, prefix)),
      )
    : [];
  for (const group of reconcile) {
    const parent = nodeByPath(document, group.parentPath);
    if (!parent) throw engineError("not-found", "reconcile parent node not found in document");
    const parentPad = linePrefix(raw, parent);
    const inner = renderNodes(group.nodes, parentPad.length + 1);
    if (parent.selfClosing) {
      const openTag = raw.slice(parent.start, parent.openEnd);
      const openText = openTag.endsWith("/>") ? `${openTag.slice(0, -2)}>` : openTag;
      const edit = {
        start: parent.start,
        end: parent.end,
        replacement: `${openText}\r\n${inner}\r\n${parentPad}</element>`,
      };
      edits.push(edit);
      snapshotReconcileEdits.push(edit);
    } else {
      const edit = {
        start: parent.closeStart ?? parent.openEnd,
        end: parent.closeStart ?? parent.openEnd,
        replacement: `\r\n${inner}`,
      };
      edits.push(edit);
      snapshotReconcileEdits.push(edit);
    }
  }

  const invalidated = wrappersAboveLevel(state.elements, newLevel);
  // A wrapper that goes away with the level — whether it IS one of the removed
  // nodes or sits inside one — needs neither a re-pick nor a clear-the-pick
  // edit. Emitting one for a node that is also being deleted would overlap the
  // removal edit and corrupt the document.
  const goesAwayWithLevel = (path: number[]): boolean =>
    removedStatePaths.some((prefix) => isDescendantPath(path, prefix));
  const requiredRepicks = invalidated
    .filter(({ path }) => !goesAwayWithLevel(path))
    .map(({ path }) => selectionRuleForPath(state, path));
  for (const { node, path } of invalidated) {
    if (node.registered) removedSumIds.add(node.registered);
    for (const id of treeIds(node.children)) removedSumIds.add(id);
    if (goesAwayWithLevel(path)) continue;
    const docNode = nodeByPath(document, path);
    if (!docNode) continue;
    const open = renderWrapperOpen({
      type: node.type,
      name: node.name,
      requiredLevel: node.requiredLevel ?? 0,
      number: node.number,
      // The checksum derives from the parent's select rule, not the picked
      // element; clearing the pick keeps it.
      checksum: node.checksum ?? "",
      registered: "",
    });
    edits.push({ start: docNode.start, end: docNode.end, replacement: `${open} />` });
  }

  const sumView = document.root.build.sum;
  if (sumView) {
    const originalEntries = sumView
      .elements()
      .map((entry) => ({ type: entry.type ?? "", id: entry.id ?? "" }));
    const remaining = originalEntries.filter((entry) => !removedSumIds.has(entry.id));
    const reconcileAnchors = reconcile.map((group) => ({
      anchor: { mode: "after-subtree", path: group.parentPath } as const,
      entries: group.sumIds.map((id) => ({ type: resolveElementType(library, id), id })),
    }));
    const reconciled = orderSumEntries(
      remaining,
      state,
      reconcileAnchors,
    );
    edits.push(...planSumReplaceEdits(document, reconciled));
    if (reconcile.length > 0) {
      const snapshotEntries = orderSumEntries(originalEntries, state, reconcileAnchors);
      snapshotReconcileEdits.push(...planSumReplaceEdits(document, snapshotEntries));
    }
  }

  const simulated = cloneTree(state.elements);
  for (const group of reconcile) {
    const parent = pathToNode(simulated, group.parentPath);
    if (parent) parent.children.push(...toStateNodes(group.nodes));
  }
  // Before either branch: dropping the Level wrapper renumbers the top-level
  // nodes that follow it, which is where these parents live.
  for (const nested of nestedRemovals) {
    const parent = pathToNode(simulated, nested.path);
    if (parent) removeIndices(parent.children, nested.indices);
  }
  if ((record.isMulticlass && record.isClassStart) || current.isPending) {
    const levelIndex = simulated.map((node) => node.type).lastIndexOf("Level");
    if (levelIndex >= 0) simulated.splice(levelIndex, 1);
  } else {
    const container = findContainerNode(simulated, record);
    if (container) removeIndices(container, containerRemovals);
  }
  for (const { path } of invalidated) {
    const node = pathToNode(simulated, path);
    if (node) {
      node.registered = "";
      node.children = [];
    }
  }

  const removedFilledWrappers = filledWrapperCount(state.elements) - filledWrapperCount(simulated);
  const registeredCount = Math.max(0, state.registeredCount - 1 - removedFilledWrappers);
  edits.push(...planElementsCountEdits(document, state.levelCount - 1, registeredCount));
  edits.push(...planDisplayLevelEdit(document, newLevel));
  edits.push(...planDisplayClassEdit(document, state, library, newLevel));
  const experience = mapToExperience(document);
  if (experience !== null) edits.push(...planExperienceEdit(document, Math.max(0, experience - 50)));

  return {
    edits,
    snapshot: {
      documentRaw: applyRawEdits(document.raw, snapshotReconcileEdits),
      levelRegistrations: records,
      removedLevel: record.totalLevel,
      invalidatedWrappers: invalidated.map(({ node }) => node),
    },
    removedLevel: record.totalLevel,
    requiredRepicks,
  };
}

/** Restores the document text captured by the last delevel, with the <sum>
 * rebuilt options-first (the undo re-serializes the sum in that
 * order while leaving the rest of the tree byte-identical). */
export function planUndoDelevelEdits(state: CharacterState, document: Dnd5eDocument): RawEdit[] {
  const snapshot = state.delevelSnapshot;
  if (!snapshot) throw engineError("conflict", "no delevel to undo");
  const restored = parseDnd5e(snapshot.documentRaw);
  const sumView = restored.root.build.sum;
  let text = snapshot.documentRaw;
  if (sumView) {
    const entries = sumView.elements().map((e) => ({ type: e.type ?? "", id: e.id ?? "" }));
    const treeState = mapToState(restored, state.id);
    const optionIds = new Set<string>();
    const walk = (nodes: RegisteredElement[]): void => {
      for (const node of nodes) {
        if (node.type === "Option") {
          for (const id of subtreeIdsOf(node)) optionIds.add(id);
        }
        walk(node.children);
      }
    };
    walk(treeState.elements);
    const ordered = [...entries.filter((e) => optionIds.has(e.id)), ...entries.filter((e) => !optionIds.has(e.id))];
    const sumNode = sumView.node;
    const inner = `\r\n${ordered
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    text = text.slice(0, sumNode.openEnd) + inner + text.slice(sumNode.closeStart ?? sumNode.openEnd);
  }
  return [{ start: 0, end: document.raw.length, replacement: text }];
}

function subtreeIdsOf(node: RegisteredElement): Set<string> {
  const ids = new Set<string>();
  const walk = (n: RegisteredElement): void => {
    if (n.id) ids.add(n.id);
    if (n.registered && n.registered !== "") ids.add(n.registered);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return ids;
}

/** Current <experience> value of the document, or null when absent. */
function mapToExperience(document: Dnd5eDocument): number | null {
  const input = document.root.build.input;
  const node = input ? child(input.node, "experience") : null;
  if (!node || node.selfClosing) return null;
  const raw = document.raw.slice(node.openEnd, node.closeStart ?? node.openEnd);
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

function treeIds(nodes: RegisteredElement[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: RegisteredElement[]): void => {
    for (const node of list) {
      if (node.id) ids.add(node.id);
      if (node.registered && node.registered !== "") ids.add(node.registered);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

interface PathNode {
  node: RegisteredElement;
  path: number[];
}

function pathsOf(nodes: RegisteredElement[], path: number[] = [], out: PathNode[] = []): PathNode[] {
  nodes.forEach((node, index) => {
    const here = [...path, index];
    out.push({ node, path: here });
    pathsOf(node.children, here, out);
  });
  return out;
}

function cloneTree(nodes: RegisteredElement[]): RegisteredElement[] {
  return nodes.map((node) => ({ ...node, children: cloneTree(node.children) }));
}

/** State-level container (class wrapper / Multiclass wrapper) holding level nodes. */
function findContainerNode(nodes: RegisteredElement[], record: LevelRegistrationRecord): RegisteredElement[] | null {
  const walk = (list: RegisteredElement[]): RegisteredElement[] | null => {
    for (const node of list) {
      if (record.isMulticlass) {
        if (node.type === "Multiclass" && (node.registered ?? "") === record.classId) return node.children;
      } else if (node.type === "Class" && (node.registered ?? "") === record.classId) {
        return node.children;
      }
      const nested = walk(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return walk(nodes);
}

/** Enables/registers or disables/unregisters an optional-rule option element. */
export function planOptionEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  optionId: string,
  optionName: string,
  enabled: boolean,
): RawEdit[] {
  const elementsNode = document.root.build.elements?.node;
  if (!elementsNode) throw engineError("not-found", "elements section not found");
  const raw = document.raw;
  const edits: RawEdit[] = [];
  const existing = childElements(elementsNode, "element").find((node) => getAttr(node, "id") === optionId);

  if (enabled) {
    if (existing) return edits;
    const children = childElements(elementsNode, "element");
    const options = children.filter((node) => getAttr(node, "type") === "Option");
    const anchor = options[options.length - 1] ?? children[0] ?? elementsNode;
    const pad = linePrefix(raw, anchor);
    const insertAt = options.length > 0 ? anchor.end : elementsNode.openEnd;
    edits.push({
      start: insertAt,
      end: insertAt,
      replacement: `\r\n${pad}<element type="Option" name="${escapeXml(optionName)}" id="${optionId}" />`,
    });
    edits.push(...planSumAppendEdits(document, [{ type: "Option", id: optionId }]));
  } else {
    if (!existing) return edits;
    edits.push(removeNodeEdit(raw, existing, existing));
    const sumView = document.root.build.sum;
    if (sumView) {
      const remaining = sumView
        .elements()
        .filter((e) => e.id !== optionId)
        .map((e) => ({ type: e.type ?? "", id: e.id ?? "" }));
      edits.push(...planSumReplaceEdits(document, remaining));
    }
  }
  edits.push(
    ...planElementsCountEdits(
      document,
      state.levelCount,
      state.levelCount + filledWrapperCount(state.elements) + state.options.size + (enabled ? 1 : -1),
    ),
  );
  return edits;
}

export type { RegistrationContext };
