/**
 * Requirement reconciliation over an already-built character.
 *
 * Registering an element materialises the `<select>` wrappers and `<grant>`
 * targets its rules make eligible *at that moment* (`registerElement`). A great
 * deal of corpus content, though, gates those rules on marker elements that
 * something else registers later: a 2024 background grants
 * `ID_INTERNAL_GRANTS_BACKGROUND_ASI`, which is what switches off a race's own
 * ability-score choice, and Tasha's `ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE`
 * swaps a race's fixed language grants for a pick list. Whichever order the
 * player works in, those decisions have to be revisited whenever the set of
 * registered ids moves.
 *
 * `reconcileRegistrationRules` is that revisit: one sweep finds every rule whose
 * `requirements` no longer agree with the document and returns the edits that
 * bring it back in line. The service runs it after each registering mutation
 * and repeats to a fixpoint.
 *
 * Two deliberate limits keep the sweep clear of machinery that already owns its
 * own bookkeeping:
 *
 * - only rules carrying a `requirements` expression. A rule without one can
 *   never change its mind, so there is nothing to reconcile and nothing to
 *   disturb.
 * - only rules with no `level` attribute. Level-gated rules belong to the
 *   leveling planner, which materialises them under the `<element type="Level">`
 *   node of the level that granted them rather than under their owning element;
 *   re-deriving them here would duplicate them in the wrong place. A rule
 *   carrying both a level and a requirements expression is therefore left alone.
 */

import type { ElementLibrary } from "../content/library.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import type { GrantRule, ParsedElement, Rule, SelectRule } from "../content/parser.js";
import { countItemNodes } from "../character/options.js";
import { nestedInsertEdits, planElementsCountEdits, planSumReplaceEdits } from "../progression/leveling.js";
import { evaluateRequirements } from "./expr.js";
import {
  ENGINE_INTERNAL_ELEMENTS,
  createRegistrationContext,
  filledWrapperCount,
  nodeByPath,
  registerElement,
  removeNodeEdit,
  resolveElementType,
  resolveGrant,
  selectionRuleChecksum,
  subtreeIds,
  type RawEdit,
  type TreeNode,
} from "./selection.js";

/** One rule the sweep switched on or off, for diagnostics and tests. */
export interface RuleFlip {
  kind: "select-added" | "select-removed" | "grant-added" | "grant-removed";
  /** The element whose rule flipped. */
  ownerId: string;
  /** Wrapper checksum for selects, granted element id for grants. */
  key: string;
}

export interface RuleReconcileResult {
  edits: RawEdit[];
  changed: boolean;
  flips: RuleFlip[];
}

type WrapperNode = TreeNode & { kind: "wrapper" };

const NOTHING: RuleReconcileResult = { edits: [], changed: false, flips: [] };

/** True when a rule is in scope for reconciliation (see the module header). */
function reconcilable(rule: Rule): rule is SelectRule | GrantRule {
  if (rule.kind !== "select" && rule.kind !== "grant") return false;
  return rule.level === undefined && (rule.requirements ?? "").trim() !== "";
}

/** `[level:5]`, `[level:barbarian:3]`, `level:5` — a level test, not an element test. */
const LEVEL_ATOM = /\blevel\s*:/u;

/**
 * True when a rule may be switched *off* again. Rules whose requirements test a
 * level are excluded: losing a level is the delevel planner's business, and it
 * carries a snapshot so the levels can be restored. It is also what keeps an
 * optional class feature applied after a delevel takes its class level away —
 * the feature stays until the player disables the item, rather than silently
 * evaporating while the item still reads as enabled.
 */
function removable(rule: SelectRule | GrantRule): boolean {
  return !LEVEL_ATOM.test(rule.requirements ?? "");
}

/** The library element a tree node stands for (wrappers carry it as `registered`). */
function ownerElement(library: ElementLibrary, node: RegisteredElement): ParsedElement | undefined {
  const id = node.id || node.registered || "";
  if (id === "") return undefined;
  return library.byId.get(id) ?? ENGINE_INTERNAL_ELEMENTS.get(id);
}

/** The wrapper a select rule spawns for slot `number` (mirrors registerElement). */
function wrapperFor(ownerId: string, select: SelectRule, count: number, number: number): WrapperNode {
  return {
    kind: "wrapper",
    type: select.type,
    name: select.name ?? select.type,
    requiredLevel: select.level ?? 1,
    number: count > 1 ? number : undefined,
    checksum: selectionRuleChecksum(ownerId, select, number),
    isList: select.type === "List",
  };
}

/**
 * The child holding the wrapper this select slot would spawn, if any. The
 * checksum is the reliable key — `number` is not read back off the document —
 * but characters written by other tools carry foreign or empty checksums, so
 * fall back to the wrapper's identifying attributes. `taken` keeps a rule with
 * several slots from binding twice to the same sibling.
 */
function findWrapper(
  node: RegisteredElement,
  wrapper: WrapperNode,
  taken: ReadonlySet<RegisteredElement>,
): RegisteredElement | undefined {
  return node.children.find(
    (child) =>
      child.id === "" &&
      child.requiredLevel !== undefined &&
      !taken.has(child) &&
      (child.checksum !== undefined && child.checksum !== ""
        ? child.checksum === wrapper.checksum
        : child.type === wrapper.type &&
          child.name === wrapper.name &&
          child.requiredLevel === wrapper.requiredLevel),
  );
}

/**
 * What makes two wrappers the same choice to a player, regardless of which
 * element declared them. Content sometimes offers one choice from two places:
 * the shipped wizard's Spellcasting feature declares a "Find Familiar"
 * Companion pick gated on knowing the spell, and the spell declares the same
 * pick itself. Only one of them should become a picker.
 */
function wrapperIdentity(wrapper: { type: string; name: string; requiredLevel?: number }): string {
  return `${wrapper.type}|${wrapper.name}|${wrapper.requiredLevel ?? 1}`;
}

/**
 * Which element already supplies each distinct choice. Built over the whole
 * tree rather than from the rules the sweep examines, because the rule that
 * spawned an existing wrapper often carries no requirements at all and so is
 * never examined — the shipped Find Familiar select is exactly that. First
 * claim wins, so a picker the player may already have used is never displaced
 * by a duplicate the sweep would otherwise add.
 */
function claimedChoices(nodes: readonly RegisteredElement[], into = new Map<string, string>()): Map<string, string> {
  for (const node of nodes) {
    const ownerId = node.id || node.registered || "";
    for (const child of node.children) {
      if (child.requiredLevel === undefined || child.id !== "") continue;
      const key = wrapperIdentity(child);
      if (!into.has(key)) into.set(key, ownerId);
    }
    claimedChoices(node.children, into);
  }
  return into;
}

function findGrantChild(node: RegisteredElement, targetId: string): RegisteredElement | undefined {
  return node.children.find((child) => child.id === targetId);
}

interface Removal {
  path: number[];
  ids: Set<string>;
  flip: RuleFlip;
}

interface Addition {
  parentPath: number[];
  insertIndex: number;
  nodes: TreeNode[];
  sumIds: string[];
  flips: RuleFlip[];
}

const startsWith = (path: number[], prefix: number[]): boolean =>
  prefix.length <= path.length && prefix.every((index, position) => path[position] === index);

/** Class/Multiclass container paths and the class level reached in each. */
function classContainers(state: CharacterState): Array<{ path: number[]; level: number }> {
  const levels = new Map<string, number>();
  for (const entry of state.levelHistory) {
    levels.set(entry.classId, Math.max(levels.get(entry.classId) ?? 0, entry.classLevel));
  }
  const out: Array<{ path: number[]; level: number }> = [];
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      const registered = node.registered ?? "";
      if ((node.type === "Class" || node.type === "Multiclass") && registered !== "") {
        out.push({ path: here, level: levels.get(registered) ?? state.level });
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  return out;
}

/**
 * Plans the edits that bring requirement-gated select and grant rules back in
 * line with the character's registered elements. Returns `changed: false` and
 * no edits when every rule already agrees — the common case, and what keeps
 * this off the byte-fidelity path for mutations that flip nothing.
 */
export function reconcileRegistrationRules(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
): RuleReconcileResult {
  if (document.root.build.elements?.node === undefined) return NOTHING;

  // `level=` inside a class container means that class's level, everywhere else
  // the character's — the same split the leveling planner makes. Requirement
  // atoms like [level:3] read ctx.level, so the context follows the walk.
  const containers = classContainers(state);
  const contexts = new Map<number, ReturnType<typeof createRegistrationContext>>();
  const contextFor = (level: number): ReturnType<typeof createRegistrationContext> => {
    let ctx = contexts.get(level);
    if (ctx === undefined) {
      ctx = createRegistrationContext(state, library, [], level);
      contexts.set(level, ctx);
    }
    return ctx;
  };
  const levelAt = (path: number[]): number => {
    let level = state.level;
    let depth = 0;
    for (const container of containers) {
      if (container.path.length > depth && startsWith(path, container.path)) {
        level = container.level;
        depth = container.path.length;
      }
    }
    return level;
  };

  const removals: Removal[] = [];
  const additions: Addition[] = [];

  // Pass A — everything the current registrations switch off, decided against
  // the pre-sweep registered set so no removal depends on walk order.
  const takenWrappers = new Set<RegisteredElement>();
  const claimed = claimedChoices(state.elements);
  const walkRemovals = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      const owner = ownerElement(library, node);
      if (owner !== undefined) {
        const ctx = contextFor(levelAt(here));
        for (const rule of owner.rules) {
          if (!reconcilable(rule)) continue;
          const eligible = evaluateRequirements(rule.requirements, ctx);
          if (rule.kind === "select") {
            const count = rule.number ?? 1;
            for (let number = 1; number <= count; number++) {
              const wrapper = wrapperFor(owner.identity.id, rule, count, number);
              const child = findWrapper(node, wrapper, takenWrappers);
              if (child === undefined) continue;
              takenWrappers.add(child);
              if (eligible || !removable(rule)) continue;
              removals.push({
                path: [...here, node.children.indexOf(child)],
                ids: subtreeIds([child]),
                flip: { kind: "select-removed", ownerId: owner.identity.id, key: wrapper.checksum ?? "" },
              });
            }
            continue;
          }
          if (rule.kind !== "grant" || eligible || !removable(rule)) continue;
          const target = resolveGrant(rule, library);
          if (target === undefined) continue;
          const child = findGrantChild(node, target.identity.id);
          if (child === undefined) continue;
          removals.push({
            path: [...here, node.children.indexOf(child)],
            ids: subtreeIds([child]),
            flip: { kind: "grant-removed", ownerId: owner.identity.id, key: target.identity.id },
          });
        }
      }
      walkRemovals(node.children, here);
    });
  };
  walkRemovals(state.elements, []);

  // Only the outermost removal in a branch gets an edit; the rest ride along
  // inside its subtree.
  const outermost = removals.filter(
    (candidate) =>
      !removals.some(
        (other) =>
          other !== candidate && other.path.length < candidate.path.length && startsWith(candidate.path, other.path),
      ),
  );
  const staleIds = new Set<string>();
  for (const removal of outermost) for (const id of removal.ids) staleIds.add(id);

  // Pass B — what the post-removal state switches on. Dropping the stale ids
  // from each context lets a disable/enable pair settle in a single sweep: a
  // race's fixed language grants come back as its customized-language picks go.
  for (const ctx of contexts.values()) {
    for (const id of staleIds) ctx.registered.delete(id);
  }
  const walkAdditions = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (outermost.some((removal) => startsWith(here, removal.path))) return;
      const owner = ownerElement(library, node);
      if (owner !== undefined) {
        const ctx = contextFor(levelAt(here));
        const spawned: TreeNode[] = [];
        const sumIds: string[] = [];
        const flips: RuleFlip[] = [];
        for (const rule of owner.rules) {
          if (!reconcilable(rule)) continue;
          if (!evaluateRequirements(rule.requirements, ctx)) continue;
          if (rule.kind === "select") {
            const count = rule.number ?? 1;
            for (let number = 1; number <= count; number++) {
              const wrapper = wrapperFor(owner.identity.id, rule, count, number);
              if (findWrapper(node, wrapper, new Set()) !== undefined) continue;
              const claimant = claimed.get(wrapperIdentity(wrapper));
              if (claimant !== undefined && claimant !== owner.identity.id) continue;
              spawned.push(wrapper);
              flips.push({ kind: "select-added", ownerId: owner.identity.id, key: wrapper.checksum ?? "" });
            }
            continue;
          }
          if (rule.kind !== "grant") continue;
          const target = resolveGrant(rule, library);
          if (target === undefined) continue;
          if (ctx.registered.has(target.identity.id) || ctx.ids.includes(target.identity.id)) continue;
          if (findGrantChild(node, target.identity.id) !== undefined) continue;
          const before = ctx.ids.length;
          const registered = registerElement(target, library, state, ctx, new Set());
          if (registered === null) continue;
          spawned.push({ kind: "element", element: target, children: registered });
          sumIds.push(...ctx.ids.slice(before));
          flips.push({ kind: "grant-added", ownerId: owner.identity.id, key: target.identity.id });
        }
        if (spawned.length > 0) {
          // Appended rather than slotted into rule order: appending keeps every
          // existing sibling's index, and so its selection-rule path, stable.
          additions.push({ parentPath: here, insertIndex: node.children.length, nodes: spawned, sumIds, flips });
        }
      }
      walkAdditions(node.children, here);
    });
  };
  walkAdditions(state.elements, []);

  if (outermost.length === 0 && additions.length === 0) return NOTHING;

  const edits: RawEdit[] = [];
  for (const removal of outermost) {
    const node = nodeByPath(document, removal.path);
    if (node !== null) edits.push(removeNodeEdit(document.raw, node));
  }
  if (additions.length > 0) {
    edits.push(
      ...nestedInsertEdits(
        document,
        additions.map(({ parentPath, insertIndex, nodes }) => ({ parentPath, insertIndex, nodes })),
      ),
    );
  }

  const sum = [
    ...state.sum.elements.filter((entry) => !staleIds.has(entry.id)),
    ...additions.flatMap((addition) => addition.sumIds).map((id) => ({ type: resolveElementType(library, id), id })),
  ];
  edits.push(...planSumReplaceEdits(document, sum));

  // An empty wrapper does not count as registered, so only a removed *filled*
  // wrapper (or a removed item) moves the tally; additions never do.
  const surviving = pruneTree(state.elements, staleIds);
  edits.push(
    ...planElementsCountEdits(
      document,
      state.levelCount,
      state.levelCount + filledWrapperCount(surviving) + state.options.size + countItemNodes(surviving),
    ),
  );

  return {
    edits,
    changed: true,
    flips: [...outermost.map((removal) => removal.flip), ...additions.flatMap((addition) => addition.flips)],
  };
}

function pruneTree(nodes: RegisteredElement[], stale: ReadonlySet<string>): RegisteredElement[] {
  return nodes
    .filter((node) => {
      const id = node.id || node.registered || "";
      return id === "" || !stale.has(id);
    })
    .map((node) => ({ ...node, children: pruneTree(node.children, stale) }));
}
