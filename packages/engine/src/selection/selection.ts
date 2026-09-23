/**
 * Selection engine.
 *
 * Operates over the character state (character/state.ts) and the parsed
 * document (dnd5e/document.ts). Selections are recorded twice for consistency:
 * `setSelection` transforms the state tree directly, while
 * `planSelectionEdits` computes byte-range edits for the document so
 * `exportCharacterXml` reflects the selection; the service applies the edits
 * and re-maps state from the fresh document.
 *
 * Fixture-derived conventions implemented here (see fixtures/characters/*):
 * - select rules spawn pending wrappers BEFORE grant rules register elements
 *   (Billy.dnd5e background: all wrappers precede granted elements);
 * - spawned wrappers are placed inside the element node that declares the
 *   select rule (tst.dnd5e: the Sub Race wrapper nests in the Gnome Subrace
 *   trait);
 * - every grant registers by requirements evaluation, including Grants-type
 *   marker grants (probed; tst/Billy predate the marker grants);
 * - <sum> entries insert after their parent's registered subtree (or after
 *   the last entry outside the class container for level content), matching
 *   the observed exported order;
 * - the race display shows the subrace name once a subrace is registered,
 *   otherwise the race name; <archetype> display is never written.
 */

import { randomUuid } from "../platform.js";
import { child, childElements, getAttr, getAttrRaw, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { allowsDuplicate, rulesetOf, type ElementLibrary } from "../content/library.js";
import { isSpellcastingExtension, type GrantRule, type ParsedElement, type Rule, type SelectRule } from "../content/parser.js";
import type { CharacterState, RegisteredElement, SumElement } from "../character/state.js";
import { computeStatistics } from "../statistics/calculator.js";
import { engineError } from "../errors.js";
import { evaluateRequirements, type RequirementContext } from "./expr.js";
import {
  isRestrictedForCharacter,
  isSourceRestricted,
} from "../content/access.js";

export { isRestrictedForCharacter };

/** A pending selection-rule instance (a wrapper awaiting a registered element). */
export interface SelectionRule {
  /** Stable per-session id (crypto.randomUUID), remembered on the state. */
  identifier: string;
  type: string;
  name: string;
  requiredLevel: number;
  hasSelection: boolean;
  selectedElementIds: string[];
  /** Engine-internal: element-child index path into the elements tree. */
  path: number[];
}

export interface SelectionOption {
  id: string;
  name: string;
  source: string;
  /** The option DTO spells the literal kind "element". */
  kind: string;
  canInspect: boolean;
  detail: string | null;
}

/** A byte-range edit over the document raw text. */
export interface RawEdit {
  start: number;
  end: number;
  replacement: string;
}

export type TreeNode =
  | { kind: "element"; element: ParsedElement; children: TreeNode[] }
  | {
      kind: "wrapper";
      type: string;
      name: string;
      requiredLevel: number;
      number?: number;
      checksum?: string;
      /** Auto-registered default selection (pinned companion defaults). */
      registered?: string;
      /** Inline list selections retain their selected text in the wrapper body. */
      listText?: string;
      isList?: boolean;
      children?: TreeNode[];
    };

export interface RegistrationContext extends RequirementContext {
  registered: Set<string>;
  /** Running list of ids registered by the current registration call. */
  ids: string[];
}

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export { escapeXml };

function crc32Hex(value: string): string {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function selectionRuleChecksum(elementId: string, select: SelectRule, number: number): string {
  const name = select.name ?? select.type;
  const requiredLevel = select.level ?? 1;
  const supports = select.type === "Spell" ? (select.supports ?? "") : "";
  return crc32Hex(`${elementId}${name}${select.type}${requiredLevel}${number}${supports}`);
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

function requirementContext(
  state: CharacterState,
  library?: ElementLibrary,
  extraIds: string[] = [],
  levelOverride?: number,
): RegistrationContext {
  const registered = new Set(state.sum.elements.map((e) => e.id));
  for (const id of state.options) registered.add(id);
  for (const id of extraIds) registered.add(id);
  const classLevels = new Map<string, number>();
  for (const entry of state.levelHistory) {
    const element = library?.byId.get(entry.classId);
    if (!element) continue;
    const slug = element.identity.name.toLowerCase();
    classLevels.set(slug, entry.classLevel);
  }
  // Stat-path atoms ([innate speed:climb:1], [strength:max:extra:2]) resolve
  // against the computed statistics, lazily and once per context: plain
  // ability names must stay cheap, and most requirement strings never carry a
  // stat path.
  let statValues: Record<string, number> | null = null;
  const statValue = (name: string): number => {
    if (!library) return Number.NaN;
    statValues ??= computeStatistics(state, library);
    return name in statValues ? statValues[name]! : Number.NaN;
  };
  return {
    hasElement: (id) => registered.has(id),
    // Includes ids registered during the current operation (e.g. the class
    // id while its pending grants are reconciled). Requirement atoms spell
    // types lowercase ([type:class]); corpus types are capitalized.
    hasType: (type) => {
      if (library) {
        const wanted = type.toLowerCase();
        for (const id of registered) {
          if (resolveElementType(library, id).toLowerCase() === wanted) return true;
        }
        return false;
      }
      return state.sum.elements.some((entry) => entry.type.toLowerCase() === type.toLowerCase());
    },
    ability: (name) => {
      const key = ABILITY_BY_NAME[name];
      return key ? state.abilities[key] : statValue(name);
    },
    level: levelOverride ?? state.level,
    classLevel: (name) => classLevels.get(name) ?? 0,
    registered,
    ids: [],
  };
}

export { requirementContext as createRegistrationContext };

function isEligible(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  ctx: RequirementContext,
  candidate: ParsedElement,
  allowedRegisteredId?: string,
  authored = authoredSelectResolution(state, library, rule),
  supports = authored.select ? expandSelectSupports(state, library, authored.select) : undefined,
): boolean {
  if (candidate.identity.type !== rule.type) return false;
  if (isRestrictedForCharacter(state, library, candidate)) return false;
  if (!evaluateRequirements(candidate.requirements, ctx)) return false;
  if (
    ctx.hasElement(candidate.identity.id) &&
    candidate.identity.id !== allowedRegisteredId &&
    !allowsDuplicate(candidate)
  ) return false;
  // A wrapper that could belong to more than one authored rule must not fall
  // through to an unrestricted picker. Keep its saved value in the character,
  // but fail closed for any new choice until its identity is unambiguous.
  if (authored.hasCandidates && (authored.select === undefined || !authored.active)) return false;
  if (supports !== undefined && !matchesSupports(supports, candidate)) return false;
  return true;
}

interface AuthoredSelectResolution {
  /** Whether the owning element authors any select with this wrapper's type/name/level. */
  hasCandidates: boolean;
  /** The authored select that spawned the wrapper, when it can be identified. */
  select?: SelectRule;
  /** Owner path + owner id + rule index: distinct for selects sharing a label. */
  identity?: string;
  /** Whether the identified select's level and requirements hold now. */
  active: boolean;
}

/**
 * Identifies the authored select behind a wrapper. Several selects on one
 * element can share a type, name and level while filtering differently (the
 * 2014 Arcane Trickster's one free Wizard spell and two Enchantment/Illusion
 * spells), so the label alone is not an identity:
 *
 * 1. a checksum matching exactly one candidate slot names that select;
 * 2. otherwise (old or foreign checksums) the wrapper's position in the run
 *    of same-label siblings, when that run has exactly the shape the active
 *    candidates would emit;
 * 3. otherwise the sole candidate, if there is only one.
 *
 * Anything else stays unresolved: callers keep its saved value but offer no
 * new picks rather than guessing a filter.
 */
function authoredSelectResolution(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
): AuthoredSelectResolution {
  if (rule.path.length < 2) return { hasCandidates: false, active: false };
  const parentPath = rule.path.slice(0, -1);
  const parent = elementAtPath(state.elements, parentPath);
  const parentId = parent?.id || parent?.registered;
  const element = parentId ? library.byId.get(parentId) : undefined;
  if (parent === null || parentId === undefined || element === undefined) {
    return { hasCandidates: false, active: false };
  }

  const candidates = element.rules.flatMap((candidate, ruleIndex) =>
    candidate.kind === "select" &&
    candidate.type === rule.type &&
    (candidate.name ?? candidate.type) === rule.name &&
    (candidate.level ?? 1) === rule.requiredLevel
      ? [{ select: candidate, ruleIndex }]
      : [],
  );
  if (candidates.length === 0) return { hasCandidates: false, active: false };

  let ctx: RequirementContext | undefined;
  const isActive = (select: SelectRule): boolean =>
    selectEligible(select, state, (ctx ??= requirementContext(state, library)));
  const resolved = (select: SelectRule, ruleIndex: number, active = isActive(select)): AuthoredSelectResolution => ({
    hasCandidates: true,
    select,
    identity: `${parentPath.join(".")}|${parentId}#${ruleIndex}`,
    active,
  });

  const wrapper = elementAtPath(state.elements, rule.path);
  const checksum = wrapper?.checksum ?? "";
  if (checksum !== "") {
    const matches = candidates.filter(({ select }) => {
      const count = select.number ?? 1;
      for (let number = 1; number <= count; number++) {
        if (selectionRuleChecksum(parentId, select, number) === checksum) return true;
      }
      return false;
    });
    if (matches.length === 1) return resolved(matches[0]!.select, matches[0]!.ruleIndex);
  }

  const active = candidates.filter(({ select }) => isActive(select));
  const sameLabel = parent.children.filter((node) =>
    node.requiredLevel === rule.requiredLevel && node.type === rule.type && node.name === rule.name,
  );
  const expected = active.flatMap(({ select, ruleIndex }) => {
    const count = select.number ?? 1;
    return Array.from({ length: count }, (_, slot) => ({
      select,
      ruleIndex,
      number: count > 1 ? slot + 1 : undefined,
    }));
  });
  const position = wrapper === null ? -1 : sameLabel.indexOf(wrapper);
  if (
    position >= 0 &&
    sameLabel.length === expected.length &&
    sameLabel.every((node, index) => node.number === undefined || node.number === expected[index]!.number)
  ) {
    const match = expected[position]!;
    return resolved(match.select, match.ruleIndex, true);
  }

  // A sole candidate keeps the pre-identity behavior for old checksums,
  // including partial saved groups (an inactive one still groups, but offers
  // nothing new).
  if (candidates.length === 1) return resolved(candidates[0]!.select, candidates[0]!.ruleIndex);
  return { hasCandidates: true, active: false };
}

/**
 * The key that decides which adjacent wrappers form one numbered group:
 * the authored select's identity when the owning element authors one, the
 * parent-scoped label (type, name, required level) for wrappers no element
 * authors or when no library is at hand, and null for a wrapper whose
 * authored select is ambiguous — that one never merges with a neighbour.
 */
export function selectionRuleGroupKey(
  state: CharacterState,
  library: ElementLibrary | undefined,
  rule: SelectionRule,
): string | null {
  if (library !== undefined) {
    const resolution = authoredSelectResolution(state, library, rule);
    if (resolution.hasCandidates) return resolution.identity ?? null;
  }
  return `${rule.path.slice(0, -1).join(".")}|${rule.type}|${rule.name}|${rule.requiredLevel}`;
}

/**
 * The select rule that spawned the wrapper (its supports filter), found on
 * the granting element's rules; undefined when the wrapper is engine-baked
 * or its authored select cannot be identified (see authoredSelectResolution).
 * $(spellcasting:list) and $(spellcasting:slots) references in the supports
 * are expanded against the character (the select's spellcasting name and the
 * caster's highest spell-slot level; see expandSelectSupports).
 */
export function selectRuleFor(state: CharacterState, library: ElementLibrary, rule: SelectionRule): SelectRule | undefined {
  return authoredSelectResolution(state, library, rule).select;
}

export function selectSupportsFor(state: CharacterState, library: ElementLibrary, rule: SelectionRule): string | undefined {
  const select = selectRuleFor(state, library, rule);
  return select ? expandSelectSupports(state, library, select) : undefined;
}

/**
 * Whether resolving the rule allocates ability score points. Most sources
 * author these as `Ability Score Improvement` selects (classes, 2024
 * backgrounds, half-feats), but racial traits carry their own select type and
 * a few feats (2014 Resilient's "Resilient (Feat)") hide the choice behind an
 * oddly named sub-select. The client groups flagged rules under Ability
 * Scores so every ability bump lands in one place.
 *
 * Deliberately not flagged: ancestry pickers such as "Dwarven Subrace" or
 * "Dragonborn Variant", whose candidates bundle stats without being ability
 * choices, and the 2024 classes' level-4 "Ability Score Improvement (X N)"
 * picker, which is a `Feat` select that chooses between the Ability Score
 * Improvement feat and any other feat — the feat's own nested allocation
 * carries the flag instead.
 */
export function allocatesAbilityScores(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
): boolean {
  const select = selectRuleFor(state, library, rule);
  if (select === undefined) return false;
  if (select.type === "Ability Score Improvement") return true;
  if (select.type !== "Feat Feature" && select.type !== "Racial Trait") return false;
  if (/^(custom\s+)?ability score (increase|improvement)\b/i.test(select.name ?? "")) return true;
  // A sub-choice whose candidates each raise an ability: its candidates all
  // carry an ability <stat> (unlike, say, Magic Initiate's spellcasting
  // ability sub-features, which only rename the caster's ability).
  const supports = selectSupportsFor(state, library, rule);
  if (supports === undefined) return false;
  const candidates = (library.byType.get(select.type) ?? []).filter((candidate) =>
    matchesSupports(supports, candidate),
  );
  return (
    candidates.length > 0 &&
    candidates.every((candidate) =>
      candidate.rules.some(
        (entry) => entry.kind === "stat" && ABILITY_BY_NAME[entry.name] !== undefined,
      ),
    )
  );
}

/** Resolves an inline `<item>` for a List wrapper without treating it as a library element. */
export function selectionListItemForPath(
  state: CharacterState,
  library: ElementLibrary,
  path: number[],
  selectionId: string,
): { id: string; text: string } | null {
  const node = elementAtPath(state.elements, path);
  if (!node || node.type !== "List") return null;
  const select = selectRuleFor(state, library, {
    identifier: "",
    type: node.type,
    name: node.name,
    requiredLevel: node.requiredLevel ?? 1,
    hasSelection: Boolean(node.registered),
    selectedElementIds: node.registered ? [node.registered] : [],
    path,
  });
  return select?.items?.find((item) => item.id === selectionId) ?? null;
}

export function selectionListItemForRule(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  selectionId: string,
): { id: string; text: string } | null {
  return selectionListItemForPath(state, library, rule.path, selectionId);
}

/**
 * The registered spell-list extensions targeting the named caster:
 * non-id `<extend>` texts are supports expressions OR-ed into the list, and
 * `ID_`-prefixed entries name individual spells admitted at their own level.
 */
export function spellListExtensions(
  state: CharacterState,
  library: ElementLibrary,
  casterName: string,
): { expressions: string[]; spellIds: string[] } {
  const expressions: string[] = [];
  const spellIds: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: { id: string; children: { id: string }[] }[]): void => {
    for (const node of nodes) {
      const element = library.byId.get(node.id);
      const block = element?.spellcasting;
      if (
        block !== undefined &&
        isSpellcastingExtension(block) &&
        (block.all === true || block.name.toLowerCase() === casterName.toLowerCase()) &&
        !seen.has(node.id)
      ) {
        seen.add(node.id);
        for (const entry of block.extend) {
          const trimmed = entry.trim();
          if (trimmed === "") continue;
          if (trimmed.startsWith("ID_")) {
            for (const id of trimmed.split(",").map((part) => part.trim()).filter((part) => part !== "")) {
              spellIds.push(id);
            }
          } else {
            expressions.push(trimmed);
          }
        }
      }
      walk(node.children as never);
    }
  };
  walk(state.elements as never);
  return { expressions, spellIds };
}

/** The registered non-extension spellcasting block with the given name. */
function casterBlockNamed(
  state: CharacterState,
  library: ElementLibrary,
  casterName: string,
): { name: string; list?: string } | undefined {
  let found: { name: string; list?: string } | undefined;
  const walk = (nodes: { id: string; children: { id: string }[] }[]): void => {
    for (const node of nodes) {
      if (found !== undefined) return;
      const block = library.byId.get(node.id)?.spellcasting;
      if (block !== undefined && !isSpellcastingExtension(block) && block.name === casterName) {
        found = block;
        return;
      }
      walk(node.children as never);
    }
  };
  walk(state.elements as never);
  return found;
}

/**
 * Expands the dynamic tokens of a select's supports filter against the
 * character:
 * - `$(spellcasting:list)` becomes the caster's base list expression OR-ed
 *   with every registered extension expression;
 * - `$(spellcasting:slots)` becomes the OR of every slot level from 1 up to
 *   the caster's highest slot level (its own class's progression at the level
 *   slotCeilingClassLevel picks when derivable, else the serialized slots);
 * - extension spell ids are admitted by id when their own level fits.
 */
const supportsExpansionCache = new WeakMap<
  CharacterState,
  Map<SelectRule, { revision: number; value: string | undefined }>
>();

function expandSelectSupports(state: CharacterState, library: ElementLibrary, select: SelectRule): string | undefined {
  if (select.supports === undefined) return undefined;
  const casterName = select.spellcasting ?? state.spellcasting[0]?.name ?? "";
  const hasListToken = select.supports.includes("$(spellcasting:list)");
  const hasSlotsToken = select.supports.includes("$(spellcasting:slots)");
  if (!hasListToken && !hasSlotsToken) return select.supports;

  // The expansion depends only on (state, rule, library revision) — never on
  // the candidate being tested — so option loops over thousands of candidates
  // reuse one expansion instead of re-deriving it per candidate.
  const revision = library.revision ?? 0;
  let perState = supportsExpansionCache.get(state);
  const cached = perState?.get(select);
  if (cached !== undefined && cached.revision === revision) return cached.value;
  const value = expandSelectSupportsUncached(state, library, select, casterName, hasListToken, hasSlotsToken);
  if (perState === undefined) {
    perState = new Map();
    supportsExpansionCache.set(state, perState);
  }
  perState.set(select, { revision, value });
  return value;
}

function expandSelectSupportsUncached(
  state: CharacterState,
  library: ElementLibrary,
  select: SelectRule,
  casterName: string,
  hasListToken: boolean,
  hasSlotsToken: boolean,
): string | undefined {

  const extensions = spellListExtensions(state, library, casterName);
  const baseList = casterBlockNamed(state, library, casterName)?.list ?? casterName;
  const listParts = [baseList, ...extensions.expressions].filter((part) => part.trim() !== "");
  const listExpression = listParts.length > 1 ? `(${listParts.map((part) => `(${part})`).join("||")})` : (listParts[0] ?? casterName);

  const ceilingLevel = select.type === "Spell" ? slotCeilingClassLevel(state, library, select, casterName) : undefined;
  const progressionSlots =
    ceilingLevel !== undefined ? spellSlotLevelAtClassLevel(library, casterName, ceilingLevel) : 0;
  const maxSlot = progressionSlots > 0 ? progressionSlots : maxSpellSlotLevel(state);
  const levels = Array.from({ length: maxSlot }, (_, index) => String(index + 1));
  // No slot level yet: a token that cannot match anything (mirrors the
  // reference builder's unmatchable sentinel).
  const slotsExpression = levels.length === 0 ? "99" : `(${levels.join("||")})`;

  let expression = (select.supports ?? "")
    .replaceAll("$(spellcasting:list)", listExpression)
    .replaceAll("$(spellcasting:slots)", slotsExpression);
  if (hasListToken && extensions.spellIds.length > 0) {
    // Slot-gated selects admit extension spells of a castable level; the
    // cantrip select (no slots token) admits only level-0 extensions.
    const admitted = hasSlotsToken ? new Set(levels) : new Set(["0"]);
    const idGroups = extensions.spellIds.filter((id) => {
      const level = library.byId.get(id)?.setters.find((setter) => setter.name === "level")?.value?.trim();
      return level !== undefined && admitted.has(level);
    });
    if (idGroups.length > 0) {
      expression = `(${expression})${idGroups.map((id) => `||(${id})`).join("")}`;
    }
  }
  return expression;
}

/**
 * The highest spell-slot level the named caster's progression yields at the
 * given class level. Stat values may reference other progression statistics
 * (the warlock slot table references `…:slots:count`, including negated
 * references that retire lower slots); references resolve against the
 * running totals in document order.
 */
const spellcastingByCasterCache = new WeakMap<
  ElementLibrary,
  { revision: number; byCaster: Map<string, ParsedElement[]> }
>();

/** Spellcasting-block elements grouped by caster name, rebuilt per library revision. */
function spellcastingElementsFor(library: ElementLibrary, casterName: string): readonly ParsedElement[] {
  const revision = library.revision ?? 0;
  let cached = spellcastingByCasterCache.get(library);
  if (cached === undefined || cached.revision !== revision) {
    const byCaster = new Map<string, ParsedElement[]>();
    for (const element of library.byId.values()) {
      const name = element.spellcasting?.name;
      if (name === undefined) continue;
      const list = byCaster.get(name);
      if (list === undefined) byCaster.set(name, [element]);
      else list.push(element);
    }
    cached = { revision, byCaster };
    spellcastingByCasterCache.set(library, cached);
  }
  return cached.byCaster.get(casterName) ?? [];
}

function spellSlotLevelAtClassLevel(
  library: ElementLibrary,
  casterName: string,
  classLevel: number,
): number {
  let highest = 0;
  for (const element of spellcastingElementsFor(library, casterName)) {
    highest = Math.max(highest, highestSlotLevelFromRules(element.rules, casterName, classLevel));
  }
  return highest;
}

/**
 * The class level a select's `$(spellcasting:slots)` ceiling is read at.
 * Spells known are the caster's current repertoire: every one of those choices
 * may hold a spell of any level the caster has slots for now, so the ceiling
 * follows its current level in its own class. Spellbook selects keep the level
 * that granted them, because a wizard copies those spells in when it gains the
 * level, of a level it had slots for then. Undefined when neither is known.
 */
function slotCeilingClassLevel(
  state: CharacterState,
  library: ElementLibrary,
  select: SelectRule,
  casterName: string,
): number | undefined {
  // A prepared caster without a full known list acquires spells individually
  // into a book. This also covers Savant and homebrew book choices regardless
  // of their display names; ordinary prepared casters know their whole list.
  const source = state.magic?.casters.find((block) => block.name === casterName)?.source;
  const casting = source === undefined ? undefined : library.byId.get(source)?.spellcasting;
  const isSpellbook = casting?.prepare === true && casting.listKnown !== true;
  const current = isSpellbook ? 0 : casterClassLevel(state, library, casterName);
  return current > 0 ? current : select.level;
}

/**
 * The highest spell level a Spell select admits from its caster's own slot
 * progression: read at the level slotCeilingClassLevel picks when the select
 * carries `$(spellcasting:slots)`, else at the level that granted it (those
 * selects fix their spell level in the supports). 0 when the progression
 * cannot be derived. The spell-browse projection and the delevel planner use
 * it so they agree with the select on what it accepts.
 */
export function spellSlotCeilingFor(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  casterName?: string,
): number {
  const select = selectRuleFor(state, library, rule);
  const caster = casterName ?? select?.spellcasting ?? state.spellcasting[0]?.name ?? "";
  const classLevel =
    select !== undefined && (select.supports ?? "").includes("$(spellcasting:slots)")
      ? slotCeilingClassLevel(state, library, select, caster)
      : rule.requiredLevel;
  return classLevel !== undefined ? spellSlotLevelAtClassLevel(library, caster, classLevel) : 0;
}

/**
 * The character's level in the class that owns the named caster (see
 * classOwnsCaster), counting multiclass-variant levels toward their class.
 * 0 when no class in the level history owns it.
 */
export function casterClassLevel(state: CharacterState, library: ElementLibrary, casterName: string): number {
  const owners = casterOwnersFor(library, casterName);
  if (owners.casterIds.size === 0) return 0;
  const ownsCaster = new Map<string, boolean>();
  let level = 0;
  for (const entry of state.levelHistory.slice(0, state.level)) {
    if (entry.isPending) continue;
    let owns = ownsCaster.get(entry.classId);
    if (owns === undefined) {
      const direct = library.byId.get(entry.classId);
      const element = direct?.identity.type === "Multiclass" || direct === undefined
        ? classForMulticlassVariant(library, entry.classId)
        : direct;
      owns = element !== undefined && classOwnsCaster(element, owners);
      ownsCaster.set(entry.classId, owns);
    }
    if (owns) level += 1;
  }
  return level;
}

interface CasterOwners {
  /** The elements carrying the caster's own (non-extension) spellcasting block. */
  casterIds: ReadonlySet<string>;
  /**
   * The elements whose Archetype select admits a subclass granting one of
   * them — the class feature offering the subclass choice (2014 "Martial
   * Archetype", 2024 "Level 3: Fighter Subclass"), or a class declaring it.
   */
  subclassOffererIds: ReadonlySet<string>;
}

const casterOwnersCache = new WeakMap<ElementLibrary, { revision: number; byCaster: Map<string, CasterOwners> }>();

/** See CasterOwners; derived once per caster name and library revision. */
function casterOwnersFor(library: ElementLibrary, casterName: string): CasterOwners {
  const revision = library.revision ?? 0;
  let cached = casterOwnersCache.get(library);
  if (cached === undefined || cached.revision !== revision) {
    cached = { revision, byCaster: new Map() };
    casterOwnersCache.set(library, cached);
  }
  let owners = cached.byCaster.get(casterName);
  if (owners === undefined) {
    const casterIds = new Set(
      spellcastingElementsFor(library, casterName)
        .filter((element) => element.spellcasting !== undefined && !isSpellcastingExtension(element.spellcasting))
        .map((element) => element.identity.id),
    );
    const subclassTags = (library.byType.get("Archetype") ?? [])
      .filter((element) => grantsAnyOf(element, casterIds))
      .map((element) => new Set([...element.supports.map((tag) => tag.trim()), element.identity.id]));
    const subclassOffererIds = new Set<string>();
    if (subclassTags.length > 0) {
      for (const element of library.byId.values()) {
        const offers = element.rules.some(
          (rule) =>
            rule.kind === "select" &&
            rule.type === "Archetype" &&
            rule.supports !== undefined &&
            subclassTags.some((tags) => evaluateSupportsExpression(rule.supports!, tags)),
        );
        if (offers) subclassOffererIds.add(element.identity.id);
      }
    }
    owners = { casterIds, subclassOffererIds };
    cached.byCaster.set(casterName, owners);
  }
  return owners;
}

function grantsAnyOf(element: ParsedElement, ids: ReadonlySet<string>): boolean {
  return element.rules.some((rule) => rule.kind === "grant" && rule.id !== undefined && ids.has(rule.id));
}

/**
 * True when the class carries the caster's spellcasting block or offers a
 * subclass that does — itself or through a feature it grants. The subclass
 * route is how the Eldritch Knight and Arcane Trickster, whose blocks sit on
 * archetype features, belong to the fighter and the rogue, whose levels their
 * slot tables are keyed on.
 */
function classOwnsCaster(element: ParsedElement, owners: CasterOwners): boolean {
  const id = element.identity.id;
  return (
    owners.casterIds.has(id) ||
    grantsAnyOf(element, owners.casterIds) ||
    owners.subclassOffererIds.has(id) ||
    grantsAnyOf(element, owners.subclassOffererIds)
  );
}

/** The class element declaring the multiclass variant id (leveling.ts has the same lookup; importing it would cycle). */
function classForMulticlassVariant(library: ElementLibrary, multiclassId: string): ParsedElement | undefined {
  for (const element of library.byType.get("Class") ?? []) {
    if (element.multiclass?.id === multiclassId) return element;
  }
  return undefined;
}

/** See spellSlotLevelAtClassLevel; shared with the spell-browse projection. */
export function highestSlotLevelFromRules(
  rules: readonly Rule[],
  casterName: string,
  classLevel: number,
): number {
  const prefix = `${casterName.toLowerCase()}:spellcasting:`;
  const slotsPrefix = `${prefix}slots:`;
  const totals = new Map<string, number>();
  const resolve = (raw: string | undefined): number => {
    const trimmed = (raw ?? "").trim();
    if (trimmed === "") return 0;
    if (/^[+-]?\d+$/.test(trimmed)) return Number(trimmed);
    const negative = trimmed.startsWith("-");
    const name = negative ? trimmed.slice(1) : trimmed;
    const referenced = totals.get(name) ?? 0;
    return negative ? -referenced : referenced;
  };
  for (const rule of rules) {
    if (rule.kind !== "stat" || !rule.name.startsWith(prefix)) continue;
    if (rule.level !== undefined && rule.level > classLevel) continue;
    totals.set(rule.name, (totals.get(rule.name) ?? 0) + resolve(rule.value));
  }
  let highest = 0;
  for (const [name, total] of totals) {
    if (!name.startsWith(slotsPrefix) || total <= 0) continue;
    const slotLevel = Number.parseInt(name.slice(slotsPrefix.length), 10);
    if (Number.isFinite(slotLevel)) highest = Math.max(highest, slotLevel);
  }
  return highest;
}

/** The highest spell-slot level with a non-zero count. */
function maxSpellSlotLevel(state: CharacterState): number {
  let max = 0;
  for (const casting of state.spellcasting) {
    for (const [key, value] of Object.entries(casting.slots)) {
      const match = key.match(/^s(\d+)$/);
      if (!match) continue;
      const level = Number(match[1]);
      if (level > max && Number(value) > 0) max = level;
    }
  }
  return max;
}

/**
 * Select-supports matching: the corpus encodes AND with "," (or "&"), OR with
 * "|" runs, and groups sub-expressions with parentheses (an expanded spell
 * list reads "Wizard,(Enchantment||Illusion)"). A bare tag tests membership
 * in the candidate's tag set; "!" negates. The candidate's tag set is its
 * <supports> list plus its own id (proficiency selections name candidates
 * by id), its level setter value (selects carry numeric level tags such
 * as the cantrip level "0"), and its school setter value.
 */
export function matchesSupports(selectSupports: string, candidate: ParsedElement): boolean {
  const have = new Set(candidate.supports.map((tag) => tag.trim()));
  have.add(candidate.identity.id);
  const level = candidate.setters.find((setter) => setter.name === "level")?.value;
  if (level !== undefined) have.add(level.trim());
  // Spells carry their school as a setter, not a supports tag, while the
  // school-restricted selects (an evoker's Evocation Savant) name the school
  // in their supports expression.
  const school = candidate.setters.find((setter) => setter.name === "school")?.value;
  if (school !== undefined && school.trim() !== "") have.add(school.trim());
  return evaluateSupportsExpression(selectSupports, have);
}

/** Evaluates a supports expression (see matchesSupports) against a tag set. */
export function evaluateSupportsExpression(expression: string, have: ReadonlySet<string>): boolean {
  type Token = { kind: "open" | "close" | "and" | "or" } | { kind: "tag"; text: string };
  const tokens: Token[] = [];
  let buffer = "";
  const flush = (): void => {
    const tag = buffer.trim();
    buffer = "";
    if (tag !== "") tokens.push({ kind: "tag", text: tag });
  };
  for (const char of expression) {
    if (char === "(" || char === ")") {
      flush();
      tokens.push({ kind: char === "(" ? "open" : "close" });
    } else if (char === "," || char === "&") {
      flush();
      if (tokens[tokens.length - 1]?.kind !== "and") tokens.push({ kind: "and" });
    } else if (char === "|") {
      flush();
      if (tokens[tokens.length - 1]?.kind !== "or") tokens.push({ kind: "or" });
    } else {
      buffer += char;
    }
  }
  flush();

  let position = 0;
  const parseUnit = (): boolean => {
    const token = tokens[position];
    if (token === undefined) return false;
    if (token.kind === "open") {
      position += 1;
      const value = parseOr();
      if (tokens[position]?.kind === "close") position += 1;
      return value;
    }
    if (token.kind === "tag") {
      position += 1;
      return token.text.startsWith("!") ? !have.has(token.text.slice(1).trim()) : have.has(token.text);
    }
    // Stray separator/close: skip it so a malformed expression cannot loop.
    position += 1;
    return false;
  };
  const parseAnd = (): boolean => {
    let value = parseUnit();
    while (tokens[position]?.kind === "and") {
      position += 1;
      const next = parseUnit();
      value = value && next;
    }
    return value;
  };
  const parseOr = (): boolean => {
    let value = parseAnd();
    while (tokens[position]?.kind === "or") {
      position += 1;
      const next = parseAnd();
      value = value || next;
    }
    return value;
  };
  return parseOr();
}

/** All pending selection rules in tree order, with session-stable identifiers. */
export function pendingSelectionRules(state: CharacterState): SelectionRule[] {
  const ids = state.selectionRuleIds ?? new Map<string, string>();
  const rules: SelectionRule[] = [];
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (node.requiredLevel !== undefined) {
        const key = here.join(".");
        if (!ids.has(key)) ids.set(key, randomUuid());
        if ((node.registered ?? "") === "") {
          const identifier = ids.get(key)!;
          rules.push({
            identifier,
            type: node.type,
            name: node.name,
            requiredLevel: node.requiredLevel,
            hasSelection: false,
            selectedElementIds: [],
            path: here,
          });
        }
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  for (const key of [...ids.keys()]) {
    const path = key.split(".").map(Number);
    const node = elementAtPath(state.elements, path);
    if (!node || node.requiredLevel === undefined) ids.delete(key);
  }
  return rules;
}

/**
 * Resolves a rule by its session identifier, filled or pending. Returns null
 * when the identifier is unknown or its tree node is no longer a rule wrapper.
 */
export function selectionRuleFor(state: CharacterState, identifier: string): SelectionRule | null {
  const ids = state.selectionRuleIds ?? new Map<string, string>();
  let key: string | undefined;
  for (const [path, id] of ids) {
    if (id === identifier) {
      key = path;
      break;
    }
  }
  if (key === undefined) return null;
  const path = key.split(".").map(Number);
  const node = elementAtPath(state.elements, path);
  if (!node || node.requiredLevel === undefined) return null;
  const filled = (node.registered ?? "") !== "";
  return {
    identifier,
    type: node.type,
    name: node.name,
    requiredLevel: node.requiredLevel,
    hasSelection: filled,
    selectedElementIds: filled ? [node.registered!] : [],
    path,
  };
}

/** Resolves a rule identifier to a numbered slot in its adjacent wrapper group. */
export function selectionRuleForSlot(
  state: CharacterState,
  identifier: string,
  number?: number,
  library?: ElementLibrary,
): SelectionRule | null {
  const rule = selectionRuleFor(state, identifier);
  if (!rule || number === undefined) return rule;
  return selectionSlotRule(state, rule, number, library);
}

/** The numbered wrapper selected by a request; slots are clamped to the group. */
export function selectionSlotRule(
  state: CharacterState,
  rule: SelectionRule,
  number: number,
  library?: ElementLibrary,
): SelectionRule {
  const group = wrapperGroup(state, rule, library);
  const requestedSlot = Number.isFinite(number) ? Math.trunc(number) : 1;
  return group[Math.max(0, Math.min(requestedSlot - 1, group.length - 1))] ?? rule;
}

/**
 * The adjacent numbered slots belonging to one authored select, in slot
 * order. Same-label neighbours spawned by a different select (the 2014 Arcane
 * Trickster's free and school-restricted level-3 spells) form their own group.
 */
export function selectionRuleGroup(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
): SelectionRule[] {
  return wrapperGroup(state, rule, library);
}

/**
 * Adjacent wrappers sharing the rule's type, name, required level and group
 * key (selectionRuleGroupKey); an ambiguous wrapper is a group of its own.
 */
function wrapperGroup(state: CharacterState, rule: SelectionRule, library?: ElementLibrary): SelectionRule[] {
  const parentPath = rule.path.slice(0, -1);
  const memberIndex = rule.path[rule.path.length - 1] ?? 0;
  const siblings = parentPath.length === 0 ? state.elements : elementAtPath(state.elements, parentPath)?.children;
  const member = siblings?.[memberIndex];
  if (siblings === undefined || member === undefined || member.requiredLevel === undefined) return [rule];
  const key = selectionRuleGroupKey(state, library, rule);
  if (key === null) return [rule];
  const same = (index: number): boolean => {
    const candidate = siblings[index]!;
    if (candidate.requiredLevel !== member.requiredLevel || candidate.type !== member.type || candidate.name !== member.name) {
      return false;
    }
    return selectionRuleGroupKey(state, library, ruleForNode(state, candidate, [...parentPath, index], "")) === key;
  };
  let start = memberIndex;
  while (start > 0 && same(start - 1)) start--;
  let end = memberIndex + 1;
  while (end < siblings.length && same(end)) end++;
  return siblings
    .slice(start, end)
    .map((node, offset) => ruleForNode(state, node, [...parentPath, start + offset], rule.identifier));
}

function ruleForNode(
  state: CharacterState,
  node: RegisteredElement,
  path: number[],
  fallbackIdentifier: string,
): SelectionRule {
  const registered = node.registered ?? "";
  return {
    identifier: state.selectionRuleIds.get(path.join(".")) ?? fallbackIdentifier,
    type: node.type,
    name: node.name,
    requiredLevel: node.requiredLevel ?? 1,
    hasSelection: registered !== "",
    selectedElementIds: registered !== "" ? [registered] : [],
    path,
  };
}

/** Candidates for a rule: same type, requirements met, source allowed, not yet selected. */
export function selectionOptions(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  ctx?: RequirementContext,
): SelectionOption[] {
  if (rule.type === "List") {
    const select = selectRuleFor(state, library, rule);
    return (select?.items ?? []).map((item) => ({
      id: item.id,
      name: item.text,
      source: "",
      kind: "element",
      canInspect: false,
      detail: null,
    }));
  }
  const requirementCtx = ctx ?? requirementContext(state, library);
  const authored = authoredSelectResolution(state, library, rule);
  const supports = authored.select ? expandSelectSupports(state, library, authored.select) : undefined;
  if (authored.hasCandidates && (authored.select === undefined || !authored.active)) return [];
  // Reopening a filled rule must keep its current value in the option list. For a
  // numbered group the rule passed here is the individual slot, so this also
  // permits replacing that slot without making the other slots selectable twice.
  const allowedRegisteredId = rule.selectedElementIds.find((id): id is string => id !== null);
  const out: SelectionOption[] = [];
  for (const candidate of library.byType.get(rule.type) ?? []) {
    if (!isEligible(state, library, rule, requirementCtx, candidate, allowedRegisteredId, authored, supports)) continue;
    out.push({
      id: candidate.identity.id,
      name: candidate.identity.name,
      source: candidate.identity.source,
      kind: "element",
      canInspect: !candidate.compendiumHidden,
      detail: null,
    });
  }
  if (rule.type === "Multiclass") {
    out.sort((left, right) => {
      const name = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
      if (name !== 0) return name;
      return compareMulticlassSources(library, left, right);
    });
  }
  return out;
}

/** Whether a rule has at least one legal candidate without materializing the option DTO list. */
export function hasAvailableSelectionOptions(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  ctx?: RequirementContext,
): boolean {
  if (rule.type === "List") {
    const select = selectRuleFor(state, library, rule);
    return (select?.items?.length ?? 0) > 0;
  }
  const requirementCtx = ctx ?? requirementContext(state, library);
  const authored = authoredSelectResolution(state, library, rule);
  const supports = authored.select ? expandSelectSupports(state, library, authored.select) : undefined;
  if (authored.hasCandidates && (authored.select === undefined || !authored.active)) return false;
  const allowedRegisteredId = rule.selectedElementIds.find((id): id is string => id !== null);
  return (library.byType.get(rule.type) ?? []).some((candidate) =>
    isEligible(state, library, rule, requirementCtx, candidate, allowedRegisteredId, authored, supports),
  );
}

function compareMulticlassSources(
  library: ElementLibrary,
  left: SelectionOption,
  right: SelectionOption,
): number {
  const rulesetRank = { "2014": 0, "2024": 1, shared: 2 } as const;
  const rulesetDifference = rulesetRank[rulesetOf(library, left.id)] - rulesetRank[rulesetOf(library, right.id)];
  if (rulesetDifference !== 0) return rulesetDifference;

  const sourceMetadata = (sourceName: string): { playtest: boolean; release: number } => {
    const source = [...library.sources.values()].find((candidate) => candidate.identity.name === sourceName);
    const setter = (name: string): string | undefined => source?.setters.find((entry) => entry.name === name)?.value;
    return {
      playtest: setter("playtest")?.toLowerCase() === "true",
      release: Number(setter("release") ?? 0),
    };
  };
  const leftSource = sourceMetadata(left.source);
  const rightSource = sourceMetadata(right.source);
  if (leftSource.playtest !== rightSource.playtest) return leftSource.playtest ? 1 : -1;
  if (leftSource.release !== rightSource.release) {
    return leftSource.playtest
      ? leftSource.release - rightSource.release
      : rightSource.release - leftSource.release;
  }
  const source = left.source.localeCompare(right.source, "en", { sensitivity: "base" });
  return source !== 0 ? source : left.id.localeCompare(right.id, "en", { sensitivity: "base" });
}

export function selectEligible(select: SelectRule, state: CharacterState, ctx: RequirementContext): boolean {
  if (select.level !== undefined && select.level > ctx.level) return false;
  return evaluateRequirements(select.requirements, ctx);
}

export function grantEligible(grant: GrantRule, state: CharacterState, ctx: RequirementContext): boolean {
  if (grant.level !== undefined && grant.level > ctx.level) return false;
  return evaluateRequirements(grant.requirements, ctx);
}

/**
 * Engine-internal elements that have no corpus definition but do appear in
 * saved characters (ID_SIZE_SMALL / ID_SIZE_MEDIUM are registered by name).
 * Sources follow the registered-elements DTO, so ID_SIZE_* reports
 * "Player’s Handbook". This list covers the ids seen in the .dnd5e format;
 * extend it if another engine-baked id turns up.
 */
function internalElement(id: string, name: string, type: string, rules: Rule[] = [], source = "Internal"): ParsedElement {
  return {
    identity: { id, name, type, source },
    rules,
    setters: [],
    supports: [],
    compendiumHidden: true,
    sheets: [],
    children: [],
    declaredBy: "internal",
  };
}

export const ENGINE_INTERNAL_ELEMENTS: ReadonlyMap<string, ParsedElement> = new Map([
  ["ID_SIZE_SMALL", internalElement("ID_SIZE_SMALL", "Small", "Size", [], "Player’s Handbook")],
  ["ID_SIZE_MEDIUM", internalElement("ID_SIZE_MEDIUM", "Medium", "Size", [], "Player’s Handbook")],
  ["ID_INTERNAL_GRANT_MULTICLASS", internalElement("ID_INTERNAL_GRANT_MULTICLASS", "Multiclass", "Grants")],
  [
    "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_POISON",
    internalElement("ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_POISON", "Resistance (Poison)", "Condition"),
  ],
  // The <append id="ID_INTERNAL_GRANTS_CHARACTER_BASE"> block of
  // testdata/core/internal.xml grants the Ability Score Maximum Over 20
  // element; the base grant itself is baked into the level-1 template.
  [
    "ID_INTERNAL_GRANTS_CHARACTER_BASE",
    internalElement("ID_INTERNAL_GRANTS_CHARACTER_BASE", "Base", "Grants", [
      { kind: "grant", type: "Grants", id: "ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20" },
    ]),
  ],
]);

export function resolveElementType(library: ElementLibrary, id: string): string {
  return (
    library.byId.get(id)?.identity.type ??
    ENGINE_INTERNAL_ELEMENTS.get(id)?.identity.type ??
    ""
  );
}

export function resolveGrant(grant: GrantRule, library: ElementLibrary): ParsedElement | undefined {
  if (grant.id !== undefined) {
    return library.byId.get(grant.id) ?? ENGINE_INTERNAL_ELEMENTS.get(grant.id);
  }
  if (grant.type !== undefined) {
    const list = library.byType.get(grant.type) ?? [];
    if (grant.name !== undefined) return list.find((e) => e.identity.name === grant.name);
  }
  return undefined;
}

/**
 * Re-registers pending grants on already-registered elements whose
 * requirements newly evaluate true (the fixpoint behavior). Walks
 * the tree in order; grants whose target is already registered are skipped.
 */
export interface ReconcileGroup {
  parentPath: number[];
  nodes: TreeNode[];
  sumIds: string[];
}

export function reconcilePendingGrants(
  state: CharacterState,
  library: ElementLibrary,
  ctx: RegistrationContext,
): ReconcileGroup[] {
  const groups: ReconcileGroup[] = [];
  const walk = (nodes: RegisteredElement[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      // Imported race identities live on the empty selection wrapper rather
      // than on a child node, so their engine markers need this lookup path.
      const registeredId = node.id !== "" ? node.id : node.type === "Race" ? node.registered : undefined;
      if (registeredId) {
        const element = library.byId.get(registeredId) ?? ENGINE_INTERNAL_ELEMENTS.get(registeredId);
        if (element) {
          const before = ctx.ids.length;
          const children: TreeNode[] = [];
          for (const rule of element.rules) {
            if (rule.kind !== "grant") continue;
            const target = resolveGrant(rule, library);
            if (!target) continue;
            if (ctx.registered.has(target.identity.id) || ctx.ids.includes(target.identity.id)) continue;
            if (!grantEligible(rule, state, ctx)) continue;
            const registered = registerElement(target, library, state, ctx, new Set());
            if (registered !== null) {
              children.push({ kind: "element", element: target, children: registered });
            }
          }
          if (children.length > 0) {
            groups.push({ parentPath: here, nodes: children, sumIds: ctx.ids.slice(before) });
          }
        }
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  return groups;
}

/** Ids (element + registered-wrapper ids) inside a registered subtree. */
export function subtreeIds(nodes: RegisteredElement[]): Set<string> {
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

/** The main-class wrapper node (registered), for sum anchoring. */
function mainClassWrapper(state: CharacterState): RegisteredElement | null {
  for (const level of state.elements) {
    for (const child of level.children) {
      if (child.type === "Class" && (child.registered ?? "") !== "") return child;
    }
  }
  return null;
}

export type SumAnchor =
  /** After the last sum entry inside the node's subtree (defaults to the node's own entry). */
  | { mode: "after-subtree"; path: number[] }
  /** After the last sum entry NOT inside the container's subtree (default: the main class wrapper). */
  | { mode: "after-last-outside-container"; containerPath?: number[] }
  /** After structural level entries, before every registered class-content subtree. */
  | { mode: "after-last-outside-classes" }
  /** After the last entry of the container's subtree (default: the main class wrapper). */
  | { mode: "container-end"; containerPath?: number[] }
  | { mode: "end" };

export interface SumInsert {
  anchor: SumAnchor;
  entries: SumElement[];
}

/**
 * Orders the sum entries after an insertion batch, mirroring the observed behavior:
 * new entries insert after their parent's registered subtree (or after the
 * last entry outside the class/multiclass container for level content), so
 * the flat list tracks the tree's registration order.
 */
export function orderSumEntries(
  existing: SumElement[],
  state: CharacterState,
  inserts: SumInsert[],
): SumElement[] {
  const out = [...existing];
  const containerOf = (path: number[] | undefined): RegisteredElement | null =>
    path ? elementAtPath(state.elements, path) : mainClassWrapper(state);
  const anchorOf = (anchor: SumAnchor): number => {
    switch (anchor.mode) {
      case "end":
        return out.length - 1;
      case "after-last-outside-container": {
        const container = containerOf(anchor.containerPath);
        if (!container) return out.length - 1;
        const inside = subtreeIds([container]);
        let last = -1;
        for (let i = 0; i < out.length; i++) {
          if (!inside.has(out[i]!.id)) last = i;
        }
        return last;
      }
      case "after-last-outside-classes": {
        const inside = new Set<string>();
        const walk = (nodes: RegisteredElement[]): void => {
          for (const node of nodes) {
            if (
              (node.type === "Class" || node.type === "Multiclass") &&
              (node.registered ?? "") !== ""
            ) {
              for (const id of subtreeIds([node])) inside.add(id);
            } else {
              walk(node.children);
            }
          }
        };
        walk(state.elements);
        let last = -1;
        for (let i = 0; i < out.length; i++) {
          if (!inside.has(out[i]!.id)) last = i;
        }
        return last;
      }
      case "container-end": {
        const container = containerOf(anchor.containerPath);
        if (!container) return out.length - 1;
        const inside = subtreeIds([container]);
        let last = -1;
        for (let i = 0; i < out.length; i++) {
          if (inside.has(out[i]!.id)) last = i;
        }
        return last;
      }
      case "after-subtree": {
        const node = elementAtPath(state.elements, anchor.path);
        if (!node) return out.length - 1;
        const inside = subtreeIds([node]);
        let last = out.findIndex((entry) => entry.id === node.id);
        for (let i = 0; i < out.length; i++) {
          if (inside.has(out[i]!.id)) last = i;
        }
        return last;
      }
    }
  };
  const ordered = [...inserts]
    .map((insert) => ({ insert, anchor: anchorOf(insert.anchor) }))
    .sort((a, b) => b.anchor - a.anchor);
  for (const { insert, anchor } of ordered) {
    if (insert.entries.length === 0) continue;
    out.splice(anchor + 1, 0, ...insert.entries);
  }
  return out;
}

/**
 * Registers the element and its subtree: nested corpus children first, then
 * select rules (spawning pending wrappers), then grant rules (recursively
 * registering elements), cycle-guarded and de-duplicated. Returns null when
 * the element does not register (its own requirements evaluate false, it is
 * already registered, or it is mid-registration); callers must skip the node.
 */
export function registerElement(
  element: ParsedElement,
  library: ElementLibrary,
  state: CharacterState,
  ctx: RegistrationContext,
  visited: Set<string>,
): TreeNode[] | null {
  const id = element.identity.id;
  if (!evaluateRequirements(element.requirements, ctx)) return null;
  if (ctx.ids.includes(id)) return [];
  if (visited.has(id)) return [];
  visited.add(id);
  ctx.registered.add(id);
  ctx.ids.push(id);

  const nodes: TreeNode[] = [];
  // TODO: corpus elements with nested <element> children (feature
  // replacements) — ordering relative to rules not yet fixture-verified.
  for (const child of element.children) {
    const registered = registerElement(child, library, state, ctx, visited);
    if (registered !== null) nodes.push({ kind: "element", element: child, children: registered });
  }
  const selects = element.rules.filter(
    (rule): rule is SelectRule => rule.kind === "select" && selectEligible(rule, state, ctx),
  );
  const grants = element.rules.filter(
    (rule): rule is GrantRule => rule.kind === "grant" && grantEligible(rule, state, ctx),
  );
  for (const select of selects) {
    const count = select.number ?? 1;
    for (let i = 1; i <= count; i++) {
      const wrapper: TreeNode = {
        kind: "wrapper",
        type: select.type,
        name: select.name ?? select.type,
        requiredLevel: select.level ?? 1,
        number: count > 1 ? i : undefined,
        checksum: selectionRuleChecksum(element.identity.id, select, i),
        isList: select.type === "List",
      };
      // Reference-pinned: a Companion select with a default auto-registers it as
      // soon as the rule becomes available (the Battle Smith's Steel Defender).
      if (i === 1 && select.type === "Companion" && select.default !== undefined) {
        const defaultElement = library.byId.get(select.default);
        if (defaultElement !== undefined && defaultElement.identity.type === select.type) {
          const eligible =
            evaluateRequirements(defaultElement.requirements, ctx) &&
            !ctx.hasElement(defaultElement.identity.id) &&
            !isSourceRestricted(state, library, defaultElement.identity.source) &&
            (state.rulesetMode !== "2014" || rulesetOf(library, defaultElement.identity.id) !== "2024") &&
            (state.rulesetMode !== "2024" || rulesetOf(library, defaultElement.identity.id) !== "2014") &&
            (select.supports === undefined ||
              matchesSupports(select.supports, defaultElement));
          if (eligible) {
            const registered = registerElement(defaultElement, library, state, ctx, visited);
            if (registered !== null) {
              wrapper.registered = select.default;
              wrapper.children = registered;
            }
          }
        }
      }
      nodes.push(wrapper);
    }
  }
  for (const grant of grants) {
    const target = resolveGrant(grant, library);
    if (!target) continue;
    const registered = registerElement(target, library, state, ctx, visited);
    if (registered !== null) {
      nodes.push({ kind: "element", element: target, children: registered });
    }
  }
  visited.delete(id);
  return nodes;
}

export function toStateNodes(nodes: TreeNode[]): RegisteredElement[] {
  return nodes.map((node) =>
    node.kind === "wrapper"
      ? {
          type: node.type,
          name: node.name,
          id: "",
          requiredLevel: node.requiredLevel,
          number: node.number,
          checksum: node.checksum ?? "",
          registered: node.registered ?? "",
          listText: node.listText,
          isList: node.isList,
          children: node.registered === undefined ? [] : toStateNodes(node.children ?? []),
        }
      : {
          type: node.element.identity.type,
          name: node.element.identity.name,
          id: node.element.identity.id,
          children: toStateNodes(node.children),
        },
  );
}

function elementAtPath(nodes: RegisteredElement[], path: number[]): RegisteredElement | null {
  let current = nodes;
  let node: RegisteredElement | undefined;
  for (const index of path) {
    node = current[index];
    if (!node) return null;
    current = node.children;
  }
  return node ?? null;
}

function cloneTree(nodes: RegisteredElement[]): RegisteredElement[] {
  return nodes.map((node) => ({ ...node, children: cloneTree(node.children) }));
}

function cloneState(state: CharacterState): CharacterState {
  return {
    ...state,
    elements: cloneTree(state.elements),
    sum: { ...state.sum, elements: [...state.sum.elements] },
    hitPointRolls: { ...state.hitPointRolls },
    levelHistory: [...state.levelHistory],
    levelRegistrations: [...state.levelRegistrations],
    selectionRuleIds: new Map(state.selectionRuleIds ?? []),
  };
}

export function filledWrapperCount(nodes: RegisteredElement[]): number {
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

function applyDisplay(state: CharacterState, library: ElementLibrary, type: string, fallback: string): void {
  const selectedName = (types: ReadonlySet<string>): string | null => {
    let found: string | null = null;
    const walk = (nodes: RegisteredElement[]): void => {
      for (const node of nodes) {
        if (found !== null) return;
        if (node.requiredLevel !== undefined && types.has(node.type) && (node.registered ?? "") !== "") {
          found = library.byId.get(node.registered!)?.identity.name ?? null;
        }
        walk(node.children);
      }
    };
    walk(state.elements);
    return found;
  };

  if (type === "Race" || type === "Sub Race") {
    state.race = selectedName(new Set(["Sub Race"])) ?? selectedName(new Set(["Race"])) ?? fallback;
  } else if (type === "Class") {
    state.klass = selectedName(new Set(["Class"])) ?? fallback;
  } else if (type === "Background") {
    state.background = selectedName(new Set(["Background"])) ?? fallback;
  }
}

/** Removes a selected wrapper and any grant nodes whose grant requirements no longer hold. */
function removeInvalidGrantChildren(state: CharacterState, library: ElementLibrary): void {
  for (;;) {
    const ctx = requirementContext(state, library);
    const stale = new Set<string>();
    const walk = (nodes: RegisteredElement[]): void => {
      for (const node of nodes) {
        const ownerId = node.id || node.registered || "";
        const owner = ownerId === "" ? undefined : library.byId.get(ownerId) ?? ENGINE_INTERNAL_ELEMENTS.get(ownerId);
        if (owner) {
          for (const child of node.children) {
            const childId = child.id || child.registered || "";
            if (childId === "") continue;
            const grants = owner.rules.filter(
              (candidate): candidate is GrantRule =>
                candidate.kind === "grant" && resolveGrant(candidate, library)?.identity.id === childId,
            );
            if (grants.length > 0 && !grants.some((grant) => grantEligible(grant, state, ctx))) {
              for (const id of subtreeIds([child])) stale.add(id);
            }
          }
        }
        walk(node.children);
      }
    };
    walk(state.elements);
    if (stale.size === 0) return;

    const prune = (nodes: RegisteredElement[]): RegisteredElement[] =>
      nodes
        .filter((node) => !stale.has(node.id || node.registered || ""))
        .map((node) => ({ ...node, children: prune(node.children) }));
    state.elements = prune(state.elements);
    state.sum.elements = state.sum.elements.filter((entry) => !stale.has(entry.id));
    state.sum.elementCount = state.sum.elements.length;
  }
}

/** Pure state transition for clearing one selection slot. */
export function clearSelection(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
): CharacterState {
  const wrapper = elementAtPath(state.elements, rule.path);
  if (!wrapper) throw engineError("not-found", `selection rule '${rule.type}' not found`);
  const next = cloneState(state);
  const nextWrapper = elementAtPath(next.elements, rule.path);
  if (!nextWrapper) throw engineError("not-found", `selection rule '${rule.type}' not found`);
  const removed = subtreeIds([wrapper]);
  nextWrapper.registered = "";
  delete nextWrapper.listText;
  nextWrapper.children = [];
  next.sum.elements = next.sum.elements.filter((entry) => !removed.has(entry.id));
  next.sum.elementCount = next.sum.elements.length;
  removeInvalidGrantChildren(next, library);
  next.registeredCount = next.levelCount + filledWrapperCount(next.elements) + next.options.size;
  applyDisplay(next, library, rule.type, "");
  return next;
}

/**
 * Registers `selectionId` into the rule's wrapper, transforming the state
 * (elements tree, sum, registered-count, display properties) in place of the
 * document edit the service performs. Pure with respect to the input state.
 */
export function setSelection(
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  selectionId: string,
  _number = 1,
  hitRolls?: number[],
): CharacterState {
  const wrapper = elementAtPath(state.elements, rule.path);
  if (!wrapper) throw engineError("not-found", `selection rule '${rule.type}' not found`);
  const replacing = (wrapper.registered ?? "") !== "";
  if (rule.requiredLevel > state.level) {
    throw engineError("invalid-argument", `selection rule '${rule.type}' requires level ${rule.requiredLevel}`);
  }
  if (rule.type === "List") {
    const listItem = selectionListItemForRule(state, library, rule, selectionId);
    if (!listItem) throw engineError("not-found", `list option '${selectionId}' not found`);
    const base = replacing ? clearSelection(state, library, rule) : cloneState(state);
    const next = base;
    const nextWrapper = elementAtPath(next.elements, rule.path);
    if (!nextWrapper) throw engineError("not-found", `selection rule '${rule.type}' not found`);
    nextWrapper.registered = selectionId;
    nextWrapper.listText = listItem.text;
    nextWrapper.children = [];
    next.registeredCount = next.levelCount + filledWrapperCount(next.elements) + next.options.size;
    return next;
  }
  const element = library.byId.get(selectionId);
  if (!element) throw engineError("not-found", `element '${selectionId}' not found`);
  if (element.identity.type !== rule.type) {
    throw engineError("invalid-argument", `element '${selectionId}' is not of type '${rule.type}'`);
  }
  const base = replacing ? clearSelection(state, library, rule) : cloneState(state);
  const ctx = requirementContext(base, library);
  if (!isEligible(base, library, rule, ctx, element)) {
    throw engineError("invalid-argument", `element '${selectionId}' is not eligible for rule '${rule.type}'`);
  }

  const nodes = registerElement(element, library, base, ctx, new Set()) ?? [];
  const selectionIds = ctx.ids.slice();
  const reconcile = reconcilePendingGrants(base, library, ctx);
  const next = base;
  const nextWrapper = elementAtPath(next.elements, rule.path);
  if (!nextWrapper) throw engineError("not-found", `selection rule '${rule.type}' not found`);
  nextWrapper.registered = selectionId;
  nextWrapper.children = toStateNodes(nodes);
  for (const group of reconcile) {
    const parent = elementAtPath(next.elements, group.parentPath);
    if (parent) parent.children.push(...toStateNodes(group.nodes));
  }
  const inserted = selectionIds.map((id) => ({
    type: resolveElementType(library, id),
    id,
  }));
  // Sibling grants the pick made eligible follow their parent's subtree on a
  // replacing pick too: the tree already holds them, and statistics, detail
  // and requirements read the sum.
  const reconcileInserts: SumInsert[] = reconcile.map((group) => ({
    anchor: { mode: "after-subtree", path: group.parentPath } as const,
    entries: group.sumIds.map((id) => ({ type: resolveElementType(library, id), id })),
  }));
  const inserts: SumInsert[] = [
    { anchor: replacing ? { mode: "end" } : { mode: "after-last-outside-container" }, entries: inserted },
    ...reconcileInserts,
  ];
  next.sum = {
    elementCount: 0,
    elements: orderSumEntries(next.sum.elements, next, inserts),
  };
  next.sum.elementCount = next.sum.elements.length;
  next.registeredCount = next.levelCount + filledWrapperCount(next.elements) + next.options.size;
  applyDisplay(next, library, rule.type, element.identity.name);
  if (rule.type === "Class" && hitRolls !== undefined && hitRolls.length > 0) {
    next.hitPointRolls = { ...next.hitPointRolls, [selectionId]: [...hitRolls] };
  }
  return next;
}

export function nodeByPath(document: Dnd5eDocument, path: number[]): Dnd5eNode | null {
  const elements = document.root.build.elements;
  let node = elements?.node ?? null;
  if (!node) return null;
  for (const index of path) {
    const children = childElements(node, "element");
    if (index >= children.length) return null;
    node = children[index]!;
  }
  return node;
}

/** The whitespace prefix of a node's line (for indentation of inserted content). */
export function linePrefix(raw: string, node: Dnd5eNode): string {
  let lineStart = node.start;
  while (lineStart > 0 && (raw[lineStart - 1] === "\t" || raw[lineStart - 1] === " ")) lineStart--;
  return raw.slice(lineStart, node.start);
}

export function attrValueRange(raw: string, node: Dnd5eNode, name: string): { start: number; end: number } | null {
  const tag = raw.slice(node.start, node.openEnd);
  const marker = `${name}="`;
  const index = tag.indexOf(marker);
  if (index < 0) return null;
  const start = node.start + index + marker.length;
  const quote = raw.indexOf('"', start);
  if (quote < 0) return null;
  return { start, end: quote };
}

export function renderWrapperOpen(wrapper: {
  type: string;
  name: string;
  requiredLevel: number;
  number?: number;
  checksum: string;
  registered: string;
  isList?: boolean;
}): string {
  let out = `<element type="${escapeXml(wrapper.type)}" name="${escapeXml(wrapper.name)}" requiredLevel="${wrapper.requiredLevel}"`;
  if (wrapper.number !== undefined) out += ` number="${wrapper.number}"`;
  out += ` checksum="${escapeXml(wrapper.checksum)}" registered="${escapeXml(wrapper.registered)}"`;
  if (wrapper.isList) out = out.replace(/ registered="/u, ` isList="true" registered="`);
  return out;
}

export function renderNodes(nodes: TreeNode[], depth: number): string {
  return nodes.map((node) => renderNode(node, depth)).join("\r\n");
}

function renderNode(node: TreeNode, depth: number): string {
  const pad = "\t".repeat(depth);
  if (node.kind === "wrapper") {
    const open = renderWrapperOpen({
      type: node.type,
      name: node.name,
      requiredLevel: node.requiredLevel,
      number: node.number,
      checksum: node.checksum ?? "",
      registered: node.registered ?? "",
      isList: node.isList,
    });
    if (node.registered === undefined || node.children === undefined) {
      return `${pad}${open} />`;
    }
    const children = renderNodes(node.children, depth + 1);
    if (node.listText !== undefined) {
      return `${pad}${open}>${escapeXml(node.listText)}</element>`;
    }
    return `${pad}${open}>\r\n${children}\r\n${pad}</element>`;
  }
  const identity = node.element.identity;
  const open = `<element type="${escapeXml(identity.type)}" name="${escapeXml(identity.name)}" id="${escapeXml(identity.id)}"`;
  const children = renderNodes(node.children, depth + 1);
  return children === "" ? `${pad}${open} />` : `${pad}${open}>\r\n${children}\r\n${pad}</element>`;
}

function backgroundCharacteristicTag(name: string): string | null {
  switch (name) {
    case "Personality Trait": return "background-traits";
    case "Ideal": return "background-ideals";
    case "Bond": return "background-bonds";
    case "Flaw": return "background-flaws";
    default: return null;
  }
}

function backgroundCharacteristicValue(state: CharacterState, name: string): string | null {
  if (backgroundCharacteristicTag(name) === null) return null;
  const values: string[] = [];
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.isList === true && node.name === name && node.listText !== undefined) values.push(node.listText);
      walk(node.children);
    }
  };
  walk(state.elements);
  return name === "Personality Trait" ? values.join("\r\n") : (values[0] ?? "");
}

function backgroundCharacteristicEditFor(
  document: Dnd5eDocument,
  name: string,
  value: string,
): RawEdit | null {
  const tag = backgroundCharacteristicTag(name);
  const input = document.root.build.input?.node;
  const node = tag && input ? child(input, tag) : null;
  if (!node) return null;
  const raw = document.raw;
  const encoded = (region: string): string =>
    region.includes("<![CDATA[")
      ? `<![CDATA[${value.replaceAll("]]>", "]]><![CDATA[>")}]]>`
      : escapeXml(value);
  if (node.closeStart !== null) {
    const region = node.raw.slice(node.openEnd - node.start, node.closeStart - node.start);
    return { start: node.openEnd, end: node.closeStart, replacement: encoded(region) };
  }
  const open = raw.slice(node.start, node.openEnd).replace(/\/\s*>$/u, ">");
  return { start: node.start, end: node.end, replacement: `${open}${encoded("")}</${node.name}>` };
}

function displayEditFor(document: Dnd5eDocument, type: string, name: string): RawEdit | null {
  const tag =
    type === "Race" || type === "Sub Race" ? "race" : type === "Class" ? "class" : type === "Background" ? "background" : null;
  if (!tag) return null;
  const display = document.root.displayProperties.node;
  if (!display) return null;
  const node = childElements(display).find((child) => child.name === tag) ?? null;
  if (!node || node.selfClosing) return null;
  const end = node.closeStart ?? node.openEnd;
  const region = node.raw.slice(node.openEnd - node.start, end - node.start);
  const replacement = region.includes("<![CDATA[")
    ? `<![CDATA[${name.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`
    : escapeXml(name);
  return { start: node.openEnd, end, replacement };
}

function stateNodeToTree(node: RegisteredElement, library: ElementLibrary): TreeNode {
  if (node.requiredLevel !== undefined) {
    const registered = node.registered ?? "";
    return {
      kind: "wrapper",
      type: node.type,
      name: node.name,
      requiredLevel: node.requiredLevel,
      number: node.number,
      checksum: node.checksum,
      registered: registered === "" ? undefined : registered,
      listText: node.listText,
      isList: node.isList,
      children: registered === "" ? undefined : node.children.map((child) => stateNodeToTree(child, library)),
    };
  }
  const element = library.byId.get(node.id) ?? ENGINE_INTERNAL_ELEMENTS.get(node.id);
  if (!element) throw engineError("not-found", `element '${node.id}' not found`);
  return { kind: "element", element, children: node.children.map((child) => stateNodeToTree(child, library)) };
}

export function removeNodeEdit(raw: string, node: Dnd5eNode): RawEdit {
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start--;
  if (start > 0 && raw[start - 1] === "\r") start--;
  return { start, end: node.end, replacement: "" };
}

function staleDocumentNodes(document: Dnd5eDocument, wrapper: Dnd5eNode, stale: ReadonlySet<string>): Dnd5eNode[] {
  const elements = document.root.build.elements?.node;
  if (!elements || stale.size === 0) return [];
  const found: Dnd5eNode[] = [];
  const walk = (node: Dnd5eNode): void => {
    if (node.start >= wrapper.start && node.end <= wrapper.end) return;
    const id = getAttr(node, "id") ?? getAttr(node, "registered");
    if (id !== null && stale.has(id)) {
      found.push(node);
      return;
    }
    for (const child of childElements(node, "element")) walk(child);
  };
  for (const child of childElements(elements, "element")) walk(child);
  return found.filter((node, index) =>
    !found.some((ancestor, ancestorIndex) =>
      ancestorIndex !== index && ancestor.start <= node.start && ancestor.end >= node.end,
    ),
  );
}

/**
 * Computes the byte edits that record a selection in the document: the
 * wrapper region, the <sum> entries + element-count, the elements
 * registered-count, and the display-properties text. Validates eligibility
 * the same way selectionOptions does. Checksum values for newly spawned
 * wrappers are emitted empty (algorithm unknown; TODO).
 */
export function planSelectionEdits(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  rule: SelectionRule,
  selectionId: string | null,
  _number = 1,
): RawEdit[] {
  const wrapper = nodeByPath(document, rule.path);
  if (!wrapper) throw engineError("not-found", `selection rule '${rule.type}' not found in document`);
  const currentRegistered = getAttr(wrapper, "registered") ?? "";
  const replacing = currentRegistered !== "";
  const desired = selectionId === null
    ? clearSelection(state, library, rule)
    : setSelection(state, library, rule, selectionId, _number);
  const desiredWrapper = elementAtPath(desired.elements, rule.path);
  if (!desiredWrapper) throw engineError("not-found", `selection rule '${rule.type}' not found in desired state`);
  const raw = document.raw;
  const edits: RawEdit[] = [];

  // The wrapper's leading indentation lives outside its byte region; reuse
  // the existing line prefix so children/close-tag indentation matches.
  let lineStart = wrapper.start;
  while (lineStart > 0 && (raw[lineStart - 1] === "\t" || raw[lineStart - 1] === " ")) lineStart--;
  const pad = raw.slice(lineStart, wrapper.start);

  const existingNumber = getAttr(wrapper, "number");
  const open = renderWrapperOpen({
    type: getAttr(wrapper, "type") ?? rule.type,
    name: getAttr(wrapper, "name") ?? rule.name,
    requiredLevel: Number(getAttr(wrapper, "requiredLevel") ?? rule.requiredLevel),
    number: existingNumber === null ? undefined : Number(existingNumber),
    checksum: getAttrRaw(wrapper, "checksum") ?? "",
    registered: desiredWrapper.registered ?? "",
    isList: getAttr(wrapper, "isList") === "true" || desiredWrapper.isList === true,
  });
  const childrenText = renderNodes(
    desiredWrapper.children.map((child) => stateNodeToTree(child, library)),
    pad.length + 1,
  );
  const replacement = desiredWrapper.registered === ""
    ? open + " />"
    : desiredWrapper.isList
      ? `${open}>${escapeXml(desiredWrapper.listText ?? "")}</element>`
      : childrenText === ""
        ? open + " />"
        : `${open}>\r\n${childrenText}\r\n${pad}</element>`;
  edits.push({ start: wrapper.start, end: wrapper.end, replacement });
  if (rule.type === "List") {
    const value = backgroundCharacteristicValue(desired, rule.name);
    if (value !== null) {
      const edit = backgroundCharacteristicEditFor(document, rule.name, value);
      if (edit) edits.push(edit);
    }
  }

  const stale = new Set(state.sum.elements.map((entry) => entry.id));
  for (const entry of desired.sum.elements) stale.delete(entry.id);
  const staleNodes = staleDocumentNodes(document, wrapper, stale);

  let reconcile: ReconcileGroup[] = [];
  if (selectionId !== null && rule.type !== "List") {
    const base = replacing ? clearSelection(state, library, rule) : cloneState(state);
    const element = library.byId.get(selectionId);
    if (!element) throw engineError("not-found", `element '${selectionId}' not found`);
    const ctx = requirementContext(base, library);
    registerElement(element, library, base, ctx, new Set());
    reconcile = reconcilePendingGrants(base, library, ctx);
  }

  // Pending grants that newly flipped (class selection enables the
  // multiclass/ability-maximum grants): rebuild the parent regions.
  for (const group of reconcile) {
    const parent = nodeByPath(document, group.parentPath);
    if (!parent) throw engineError("not-found", "reconcile parent node not found in document");
    const parentPad = linePrefix(raw, parent);
    const staleInParent = staleNodes.some((node) => node.start >= parent.start && node.end <= parent.end);
    // A replacement may remove and re-grant the same id. Its sum membership
    // never changes, so staleNodes cannot identify the old XML child.
    const existingIds = new Set(childElements(parent, "element").map((child) => getAttr(child, "id")));
    const replacesExisting = group.nodes.some((node) => node.kind === "element" && existingIds.has(node.element.identity.id));
    if (staleInParent || replacesExisting) {
      const desiredParent = elementAtPath(desired.elements, group.parentPath);
      if (!desiredParent) throw engineError("not-found", "reconcile parent missing from desired state");
      const openTag = raw.slice(parent.start, parent.openEnd);
      const inner = renderNodes(
        desiredParent.children.map((child) => stateNodeToTree(child, library)),
        parentPad.length + 1,
      );
      const openText = parent.selfClosing && openTag.endsWith("/>") ? `${openTag.slice(0, -2)}>` : openTag;
      edits.push({
        start: parent.selfClosing ? parent.start : parent.openEnd,
        end: parent.selfClosing ? parent.end : parent.closeStart ?? parent.openEnd,
        replacement: parent.selfClosing
          ? `${openText}\r\n${inner}\r\n${parentPad}</element>`
          : `\r\n${inner}\r\n${parentPad}`,
      });
    } else if (parent.selfClosing) {
      const openTag = raw.slice(parent.start, parent.openEnd);
      const openText = openTag.endsWith("/>") ? `${openTag.slice(0, -2)}>` : openTag;
      const inner = renderNodes(group.nodes, parentPad.length + 1);
      edits.push({
        start: parent.start,
        end: parent.end,
        replacement: `${openText}\r\n${inner}\r\n${parentPad}</element>`,
      });
    } else {
      const inner = renderNodes(group.nodes, parentPad.length + 1);
      edits.push({
        start: parent.closeStart ?? parent.openEnd,
        end: parent.closeStart ?? parent.openEnd,
        replacement: `\r\n${inner}`,
      });
    }
  }

  // A stale node inside a region the reconcile loop above already rebuilt
  // wholesale (from `desiredParent.children`) must not also get its own
  // removal edit: the two edits' byte ranges would overlap and corrupt the
  // document when applied. Reconcile already dropped it.
  const reconcileParents = reconcile
    .map((group) => nodeByPath(document, group.parentPath))
    .filter((node): node is Dnd5eNode => node !== null);
  for (const node of staleNodes) {
    const coveredByReconcile = reconcileParents.some((parent) => node.start >= parent.start && node.end <= parent.end);
    if (!coveredByReconcile) edits.push(removeNodeEdit(raw, node));
  }

  // The sum is rewritten in the anchored order. A replacement
  // drops the former selection's subtree entries and appends the new ones
  // at the end (chronological order).
  const sumView = document.root.build.sum;
  if (sumView) {
    const sumNode = sumView.node;
    const entries = desired.sum.elements;
    const inner = `\r\n${entries
      .map((entry) => `\t\t\t<element type="${escapeXml(entry.type)}" id="${escapeXml(entry.id)}" />`)
      .join("\r\n")}\r\n\t\t`;
    edits.push({ start: sumNode.openEnd, end: sumNode.closeStart ?? sumNode.openEnd, replacement: inner });
    const count = attrValueRange(raw, sumNode, "element-count");
    if (count) edits.push({ start: count.start, end: count.end, replacement: String(entries.length) });
  }

  const elementsNode = document.root.build.elements?.node ?? null;
  if (elementsNode) {
    const count = attrValueRange(raw, elementsNode, "registered-count");
    if (count) {
      edits.push({ start: count.start, end: count.end, replacement: String(desired.registeredCount) });
    }
  }

  const displayValues: Array<[string, string, string]> = [
    ["Race", state.race, desired.race],
    ["Class", state.klass, desired.klass],
    ["Background", state.background, desired.background],
  ];
  for (const [type, before, after] of displayValues) {
    if (before === after) continue;
    const displayEdit = displayEditFor(document, type, after);
    if (displayEdit) edits.push(displayEdit);
  }

  return edits;
}

/** Applies byte-range edits from the end backwards so offsets stay valid. */
export function applyRawEdits(raw: string, edits: RawEdit[]): string {
  let out = raw;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}
