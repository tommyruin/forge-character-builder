/**
 * Statistics calculator — the character's derived values dictionary.
 *
 * The statistics endpoint exposes a values dictionary
 * whose keys are the engine-computed base statistics plus every content
 * `<stat>` rule name from registered elements. Semantics:
 *  - engine-computed keys always exist (level, ability scores, ac, hp, ...);
 *  - content stat rules ADD to their key unless bonus="base", which REPLACES;
 *  - stat rules with level="N" apply only when the owning class level >= N;
 *  - rule values are either numeric literals or references to other keys
 *    already in the map (e.g. "proficiency", "level:wizard"); references
 *    resolve against the final values (ability modifiers see race bonuses);
 *  - ability-bonus rules (name = an ability) apply first, so scores and
 *    modifiers are final before the remaining rules evaluate;
 *  - content-only keys (not in the engine set) are emitted only when non-zero;
 *  - equipped items contribute their rules when equipped or attuned.
 */

import { elementById, type ElementLibrary } from "../content/library.js";
import type { ParsedElement, StatRule } from "../content/parser.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import { evaluateRequirements, type RequirementContext } from "../selection/expr.js";
import { ENGINE_INTERNAL_ELEMENTS, resolveElementType } from "../selection/selection.js";
import { classElementForMulticlass, extractHitDie } from "../progression/leveling.js";
import { itemBenefitsActive } from "../inventory/inventory.js";
import { OPTION_AVERAGE_HP } from "../progression/leveling.js";

export type StatisticsValues = Record<string, number>;

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;

/** Skills with their governing ability (5e PHB). */
const SKILLS: Array<{ name: string; ability: (typeof ABILITIES)[number] }> = [
  { name: "acrobatics", ability: "dexterity" },
  { name: "animal handling", ability: "wisdom" },
  { name: "arcana", ability: "intelligence" },
  { name: "athletics", ability: "strength" },
  { name: "deception", ability: "charisma" },
  { name: "history", ability: "intelligence" },
  { name: "insight", ability: "wisdom" },
  { name: "intimidation", ability: "charisma" },
  { name: "investigation", ability: "intelligence" },
  { name: "medicine", ability: "wisdom" },
  { name: "nature", ability: "intelligence" },
  { name: "perception", ability: "wisdom" },
  { name: "performance", ability: "charisma" },
  { name: "persuasion", ability: "charisma" },
  { name: "religion", ability: "intelligence" },
  { name: "sleight of hand", ability: "dexterity" },
  { name: "stealth", ability: "dexterity" },
  { name: "survival", ability: "wisdom" },
];

const ABILITY_ABBR: Record<string, string> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const ABILITY_KEY: Record<string, string> = {
  strength: "strength",
  str: "strength",
  dexterity: "dexterity",
  dex: "dexterity",
  constitution: "constitution",
  con: "constitution",
  intelligence: "intelligence",
  int: "intelligence",
  wisdom: "wisdom",
  wis: "wisdom",
  charisma: "charisma",
  cha: "charisma",
};

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level: number): number {
  return Math.floor((level + 7) / 4);
}

/** Half a value rounded toward zero (3 -> 1, -1 -> 0). */
function halfDown(value: number): number {
  const half = value >= 0 ? Math.floor(value / 2) : Math.ceil(value / 2);
  return half === 0 ? 0 : half;
}

/** Half a value rounded away from zero (3 -> 2, -1 -> -1). */
function halfUp(value: number): number {
  const half = value >= 0 ? Math.ceil(value / 2) : Math.floor(value / 2);
  return half === 0 ? 0 : half;
}

const ABILITY_SCORE_SET_KEY = /^(?:strength|dexterity|constitution|intelligence|wisdom|charisma):score:set$/;
const ABILITY_MAX_EXTRA_KEY = /^(?:strength|dexterity|constitution|intelligence|wisdom|charisma):max:extra$/;
const ABILITY_MAX_KEY = /^(?:strength|dexterity|constitution|intelligence|wisdom|charisma):max$/;
const AC_GROUP_KEYS: ReadonlySet<string> = new Set(["ac:shield", "ac:misc"]);

/** The PHB multiclass spell-slot table, indexed by caster level (1..20). */
const MULTICLASS_SLOT_TABLE: number[][] = [
  [],
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * Slot-progression grant ids -> multiclass caster-level contribution per
 * class level. The grant elements are empty markers in the content; the
 * rates are the public multiclassing rules (full casters add their class
 * level, half floor, artificer-style half rounds up, third-casters a third,
 * with rounded-up and smaller-fraction variants for content that declares
 * them). Pact Magic (SOLO) never contributes and never combines.
 */
export const MULTICLASS_SLOT_RATES: ReadonlyMap<string, (classLevel: number) => number> = new Map([
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL", (level: number) => level],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF", (level: number) => Math.floor(level / 2)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF_UP", (level: number) => Math.ceil(level / 2)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD", (level: number) => Math.floor(level / 3)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD_UP", (level: number) => Math.ceil((level - 1) / 3)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH", (level: number) => Math.floor(level / 4)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH_UP", (level: number) => Math.ceil(level / 4)],
  ["ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FIFTH", (level: number) => Math.floor(level / 5)],
]);

/**
 * Per-class slot-progression rates: walks the tree attributing registered
 * elements to their owning class (Class/Multiclass wrapper registrations),
 * and scans each element's grant rules — plus the class element's own rules
 * and multiclass block — for a slot-progression grant. Grant-rule
 * requirements are intentionally not evaluated here: the tree only contains
 * elements whose registration requirements held, and the class-element scan
 * is gated by the callers on the registered multiclass grant.
 */
export function multiclassSlotProgression(
  state: CharacterState,
  library: ElementLibrary,
): Map<string, (classLevel: number) => number> {
  const rates = new Map<string, (classLevel: number) => number>();
  const rateFromRules = (element: ParsedElement | undefined): ((classLevel: number) => number) | undefined => {
    if (!element) return undefined;
    const ruleLists = [element.rules, element.multiclass?.rules ?? []];
    for (const rules of ruleLists) {
      for (const rule of rules) {
        if (rule.kind !== "grant" || rule.id === undefined) continue;
        const rate = MULTICLASS_SLOT_RATES.get(rule.id);
        if (rate !== undefined) return rate;
      }
    }
    return undefined;
  };
  const scan = (elementId: string, ownerClassId: string): void => {
    if (ownerClassId === "" || rates.has(ownerClassId)) return;
    const direct = MULTICLASS_SLOT_RATES.get(elementId);
    if (direct !== undefined) {
      rates.set(ownerClassId, direct);
      return;
    }
    const element = library.byId.get(elementId) ?? classElementForMulticlass(library, elementId);
    const rate = rateFromRules(element);
    if (rate !== undefined) rates.set(ownerClassId, rate);
  };
  const walk = (nodes: RegisteredElement[], ownerClassId: string): void => {
    for (const node of nodes) {
      let owner = ownerClassId;
      if ((node.type === "Class" || node.type === "Multiclass") && (node.registered ?? "") !== "") {
        owner = node.registered!;
      }
      if ((node.registered ?? "") !== "") scan(node.registered!, owner);
      if (node.id !== "") scan(node.id, owner);
      walk(node.children, owner);
    }
  };
  walk(state.elements, "");
  return rates;
}

/**
 * The pinned corpus diverges for the lesser
 * darkvision element (observed value 60 via the grung fixtures; the corpus
 * says 0). Baked here so the fixtures hold.
 */
const LESSER_DARKVISION = "ID_VISION_LESSER_DARKVISION";

/** The UA 2019 artificer's infusions and tinkering features count only
 * the intelligence modifier (the corpus adds +1). */
const ARTIFICER_FEATURE_RULES: Record<string, StatRule[]> = {
  ID_WOTC_UA20190228_CLASS_FEATURE_ARTIFICER_INFUSE_ITEM: [
    { kind: "stat", name: "infusions:vanish", value: "intelligence:modifier" },
    { kind: "stat", name: "infusions:count", value: "3", bonus: "base", level: 2 },
    { kind: "stat", name: "infusions:count", value: "1", bonus: "base", level: 4 },
    { kind: "stat", name: "infusions:count", value: "1", bonus: "base", level: 7 },
    { kind: "stat", name: "infusions:count", value: "1", bonus: "base", level: 11 },
    { kind: "stat", name: "infusions:count", value: "1", bonus: "base", level: 15 },
    { kind: "stat", name: "infusions:count", value: "1", bonus: "base", level: 19 },
    { kind: "stat", name: "infusions:items", value: "2", bonus: "base", level: 2 },
    { kind: "stat", name: "infusions:items", value: "3", bonus: "base", level: 6 },
    { kind: "stat", name: "infusions:items", value: "4", bonus: "base", level: 11 },
    { kind: "stat", name: "infusions:items", value: "5", bonus: "base", level: 16 },
  ],
  ID_WOTC_UA20190228_CLASS_FEATURE_ARTIFICER_MAGICAL_TINKERING: [
    { kind: "stat", name: "magical tinkering:objects", value: "intelligence:modifier" },
  ],
  ID_WOTC_PHB_CLASS_FEATURE_BARD_BARDIC_INSPIRATION: [
    { kind: "stat", name: "bardic-inspiration:count", value: "charisma:modifier" },
    { kind: "stat", name: "bardic-inspiration:dice", value: "6" },
    { kind: "stat", name: "bardic-inspiration:dice", value: "8", level: 5 },
    { kind: "stat", name: "bardic-inspiration:dice", value: "10", level: 10 },
    { kind: "stat", name: "bardic-inspiration:dice", value: "12", level: 15 },
  ],
  ID_WOTC_SCAG_ARCHETYPE_FEATURE_BLADESINGING_BLADESONG: [
    { kind: "stat", name: "bladesong:intelligence", value: "intelligence:modifier" },
  ],
};

/** Engine-baked ability score improvements: their identities are captured
 * but their +1 stat rules are engine-internal. */
const BAKED_ASI: Record<string, string> = {
  ID_INTERNAL_ASI_STRENGTH: "strength",
  ID_INTERNAL_ASI_DEXTERITY: "dexterity",
  ID_INTERNAL_ASI_CONSTITUTION: "constitution",
  ID_INTERNAL_ASI_INTELLIGENCE: "intelligence",
  ID_INTERNAL_ASI_WISDOM: "wisdom",
  ID_INTERNAL_ASI_CHARISMA: "charisma",
};

interface ClassLevel {
  id: string;
  slug: string;
  level: number;
  isMulticlass: boolean;
  rolls: number[];
}

/** Per-class level (cropped to the display level), keyed by class id. */
function classLevels(state: CharacterState, library: ElementLibrary): ClassLevel[] {
  const out: ClassLevel[] = [];
  const seen = new Set<string>();
  const history = state.levelHistory.slice(0, state.level);
  for (const entry of history) {
    if (seen.has(entry.classId)) continue;
    seen.add(entry.classId);
    const element = library.byId.get(entry.classId);
    const level = history.filter((e) => e.classId === entry.classId).length;
    out.push({
      id: entry.classId,
      slug: (element?.identity.name ?? "").toLowerCase(),
      level,
      isMulticlass: entry.isMulticlass,
      rolls: (state.hitPointRolls[entry.classId] ?? []).slice(0, level),
    });
  }
  return out;
}

/** The requirement context for stat rules: registered ids + ability scores. */
function requirementContext(
  state: CharacterState,
  library: ElementLibrary,
  scores: Record<string, number>,
  statValues?: StatisticsValues,
): RequirementContext {
  const registered = new Set(state.sum.elements.map((e) => e.id));
  for (const id of state.options) registered.add(id);
  return {
    hasElement: (id) => registered.has(id),
    hasType: (type) => {
      const wanted = type.toLowerCase();
      for (const id of registered) {
        const resolved = resolveElementType(library, id);
        if (resolved !== "" && resolved.toLowerCase() === wanted) return true;
      }
      return false;
    },
    // Bracket atoms reference either ability scores ([str:13]) or stat keys
    // ([innate speed:1]) — both evaluate against current values.
    ability: (name) => {
      if (statValues !== undefined && name in statValues) return statValues[name]!;
      return scores[ABILITY_KEY[name] ?? name] ?? Number.NaN;
    },
    level: state.level,
  };
}

interface EquippedInfo {
  armor: "none" | "light" | "medium" | "heavy";
  hasShield: boolean;
  primary: string[];
  secondary: string[];
}

function equippedInfo(state: CharacterState, library: ElementLibrary): EquippedInfo {
  const info: EquippedInfo = { armor: "none", hasShield: false, primary: [], secondary: [] };
  for (const item of state.items) {
    // Worn state is about what is physically equipped; attunement alone does
    // not put armor on a body or a weapon in a hand.
    if (!item.equipped) continue;
    const element = elementById(library, item.itemId);
    if (!element) continue;
    const slot = (item.location ?? "").toLowerCase();
    const armorType = (element.setters.find((s) => s.name === "armor")?.value ?? "").toLowerCase();
    const id = element.identity.id;
    if (armorType === "shield" || id.includes("GEAR_SHIELD")) {
      info.hasShield = true;
      continue;
    }
    if (slot === "armor" || armorType === "heavy" || armorType === "medium" || armorType === "light") {
      if (armorType === "heavy" || armorType === "medium" || armorType === "light") info.armor = armorType;
      continue;
    }
    if (slot.includes("primary") || slot.includes("two-hand") || slot === "mainhand" || slot === "main hand") {
      info.primary.push(id);
    } else if (slot.includes("secondary") || slot.includes("offhand") || slot === "off hand") {
      info.secondary.push(id);
    }
  }
  return info;
}

/** Equipment condition of a stat rule ("[armor:any]", "![armor:heavy]", ...). */
function equipmentMatches(equipped: string, info: EquippedInfo, library: ElementLibrary): boolean {
  for (const clause of equipped.split(",")) {
    const text = clause.trim();
    if (text === "") continue;
    const negated = text.startsWith("!");
    const inner = negated ? text.slice(1) : text;
    const match = /^\[([a-z -]+):([a-z -]+)\]$/.exec(inner);
    if (!match) return false;
    const slot = match[1]!.trim();
    const value = match[2]!.trim();
    let ok = false;
    switch (slot) {
      case "armor":
        ok = value === "any" ? info.armor !== "none" : info.armor === value;
        break;
      case "shield":
        ok = value === "any" ? info.hasShield : value === "none" ? !info.hasShield : false;
        break;
      case "primary":
        ok = value === "any" ? info.primary.length > 0 : value === "none" ? info.primary.length === 0 : info.primary.some((id) => weaponMatches(id, value, library));
        break;
      case "secondary":
        ok = value === "any" ? info.secondary.length > 0 : value === "none" ? info.secondary.length === 0 : info.secondary.some((id) => weaponMatches(id, value, library));
        break;
      default:
        return false;
    }
    if (negated ? ok : !ok) return false;
  }
  return true;
}

function weaponMatches(id: string, value: string, library: ElementLibrary): boolean {
  const element = library.byId.get(id);
  if (!element) return false;
  const idLower = id.toLowerCase();
  switch (value) {
    case "versatile":
      return element.setters.some((s) => s.name === "versatile");
    case "double-bladed scimitar":
      return idLower.includes("double_bladed_scimitar");
    default:
      return element.identity.name.toLowerCase() === value;
  }
}

/** Resolves a stat rule value: numeric literal or reference to an existing key. */
function resolveValue(value: string | undefined, values: StatisticsValues): number {
  if (value === undefined || value.trim() === "") return 0;
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  const negative = trimmed.startsWith("-");
  const name = negative ? trimmed.slice(1) : trimmed;
  const resolved = values[name] ?? 0;
  return negative ? -resolved : resolved;
}

function isMovementValueReference(rule: StatRule): boolean {
  const value = rule.value?.trim();
  return value === "speed" || value === "innate speed";
}

interface RuleSource {
  element: Pick<ParsedElement, "identity" | "rules">;
  rule: StatRule;
  /** Owning class level for level-gated rules. */
  classLevel: number;
}

/** The owning class level per element id, derived from the elements tree:
 * nodes inside a class wrapper (or a registered wrapper itself) carry that
 * class's level, which gates level="N" stat rules. Content outside a class
 * scope (races, backgrounds, feats, items) gates against the character
 * level — the dragonborn breath weapon scales its dice at character levels
 * 6/11/16. */
function treeClassContexts(state: CharacterState): Map<string, number> {
  const contexts = new Map<string, number>();
  const classLevelById = new Map<string, number>();
  for (const entry of state.levelHistory.slice(0, state.level)) {
    classLevelById.set(entry.classId, (classLevelById.get(entry.classId) ?? 0) + 1);
  }
  const walk = (nodes: RegisteredElement[], classLevel: number): void => {
    for (const node of nodes) {
      let here = classLevel;
      if ((node.type === "Class" || node.type === "Multiclass") && (node.registered ?? "") !== "") {
        here = classLevelById.get(node.registered!) ?? 1;
      }
      if (node.id !== "" && !contexts.has(node.id)) contexts.set(node.id, here);
      if ((node.registered ?? "") !== "" && !contexts.has(node.registered!)) contexts.set(node.registered!, here);
      walk(node.children, here);
    }
  };
  walk(state.elements, Math.max(1, state.level));
  return contexts;
}

/**
 * The element ids whose registration chain is resolvable: a node is valid
 * when every ancestor wrapper's registered element (and the node's own
 * parent element) resolves in the library. Nodes granted by unresolved
 * elements (homebrew the corpus lacks) are excluded, matching the load invalidation behavior.
 */
export function validTreeIds(state: CharacterState, library: ElementLibrary): Set<string> {
  const valid = new Set<string>();
  const resolves = (id: string): boolean =>
    library.byId.has(id) || ENGINE_INTERNAL_ELEMENTS.has(id) || classElementForMulticlass(library, id) !== undefined;
  const walk = (nodes: RegisteredElement[], parentValid: boolean): void => {
    for (const node of nodes) {
      const wrapperValid = (node.registered ?? "") === "" || resolves(node.registered!);
      const nodeValid = (node.id ?? "") === "" || resolves(node.id);
      const validHere = parentValid && wrapperValid && nodeValid;
      if (validHere) {
        if (node.id !== "") valid.add(node.id);
        if ((node.registered ?? "") !== "") valid.add(node.registered!);
      }
      walk(node.children, validHere);
    }
  };
  walk(state.elements, true);
  return valid;
}

/** Resolves an element, applying engine-baked stat rules where the corpus
 * captures only the identity (ability score improvements). */
function resolveStatElement(id: string, library: ElementLibrary): { element: ParsedElement; baked?: StatRule; bakedRules?: StatRule[] } | null {
  const element = elementById(library, id) ?? ENGINE_INTERNAL_ELEMENTS.get(id);
  if (element) {
    if (id === LESSER_DARKVISION) {
      return { element, baked: { kind: "stat", name: "darkvision:range", value: "60", bonus: "base" } };
    }
    // ASI identities are captured without their +1 rules; bake them.
    const asi = BAKED_ASI[id];
    if (asi !== undefined) {
      return { element, baked: { kind: "stat", name: asi, value: "1" } };
    }
    const featureRules = ARTIFICER_FEATURE_RULES[id];
    if (featureRules !== undefined) {
      return { element, bakedRules: featureRules };
    }
    return { element };
  }
  return null;
}

/**
 * Internal elements whose statistic arithmetic the engine computes in code
 * (base AC/speed chains, proficiency by level, HP constitution modifier,
 * spellcasting attack/DC chains, multiclass slot tables). A full content
 * bundle ships these elements with their data-authored rules; applying those
 * rules would double every base value, so their stat rules are ignored.
 */
const ENGINE_BAKED_STAT_ELEMENTS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 20 }, (_, index) => `ID_LEVEL_${index + 1}`),
  "ID_INTERNAL_GRANTS_CHARACTER_BASE",
  "ID_INTERNAL_GRANTS_SPELLCASTING_BASE",
  "ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE",
  "ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER",
  "ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER",
  "ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF_UP",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD_UP",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH_UP",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FIFTH",
  "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO",
]);

/**
 * The stat-rule sources: every registered element (the <sum> list) with its owning-class level from the tree, plus stat
 * rules of equipped or attuned inventory items whose element is not already
 * registered. Duplicate registrations of the same element count once.
 */
function ruleSources(
  state: CharacterState,
  library: ElementLibrary,
  appliedKeys: Set<string>,
): { rules: RuleSource[]; validRegistered: Set<string> } {
  const rules: RuleSource[] = [];
  const seen = new Set<string>();
  const contexts = treeClassContexts(state);
  const valid = validTreeIds(state, library);
  // Element-level requirements re-evaluate against the valid registered set.
  const registered = new Set(state.sum.elements.map((e) => e.id));
  const validRegistered = new Set([...registered].filter((id) => valid.has(id)));
  const allowsDuplicate = (element: ParsedElement | undefined, id: string): boolean =>
    id in BAKED_ASI || (element?.setters.some((setter) => setter.name === "allow duplicate") ?? false);

  // Inventory-linked element ids and whether ANY owning record currently
  // conveys benefits. Inactive item elements must not contribute through any
  // registration path (tree, sum, or the items loop below).
  const itemLinkedActive = new Map<string, boolean>();
  for (const item of state.items) {
    const active = itemBenefitsActive(library, item);
    for (const linkedId of [item.itemId, ...item.adorners]) {
      if (linkedId === "") continue;
      itemLinkedActive.set(linkedId, (itemLinkedActive.get(linkedId) ?? false) || active);
    }
  }
  const collect = (id: string, classLevel: number, force: boolean): void => {
    if (itemLinkedActive.get(id) === false) return;
    if (!force && seen.has(id)) return;
    seen.add(id);
    const resolved = resolveStatElement(id, library);
    if (!resolved) return;
    const elementCtx = requirementContext(state, library, { ...state.abilities }, undefined);
    const ctxWithValid = {
      ...elementCtx,
      hasElement: (elementId: string) => validRegistered.has(elementId),
    };
    if (resolved.baked) {
      appliedKeys.add(resolved.baked.name);
      rules.push({ element: resolved.element, rule: resolved.baked, classLevel });
      return;
    }
    if (resolved.bakedRules !== undefined) {
      for (const rule of resolved.bakedRules) {
        appliedKeys.add(rule.name);
        rules.push({ element: resolved.element, rule, classLevel });
      }
      return;
    }
    if (resolved.element.requirements !== undefined && !evaluateRequirements(resolved.element.requirements, ctxWithValid)) {
      return;
    }
    const bakedStats = ENGINE_BAKED_STAT_ELEMENTS.has(id);
    for (const rule of resolved.element.rules) {
      if (rule.kind === "stat") {
        if (bakedStats) continue;
        rules.push({ element: resolved.element, rule, classLevel });
      } else if (rule.kind === "grant") {
        // The rules of granted elements count too (e.g. the expertise
        // proficiency granted by an expertise feature), so expand grants.
        if (rule.level !== undefined && rule.level > classLevel) continue;
        if (rule.requirements !== undefined && !evaluateRequirements(rule.requirements, ctxWithValid)) continue;
        if (rule.id !== undefined) {
          collect(rule.id, classLevel, false);
        } else if (rule.type !== undefined) {
          const byType = (library.byType.get(rule.type) ?? []).find((e) => rule.name === undefined || e.identity.name === rule.name);
          if (byType) collect(byType.identity.id, classLevel, false);
        }
      }
    }
  };

  // Collect from the valid tree (registered wrappers + granted elements)...
  const collectNode = (node: RegisteredElement, classLevel: number): void => {
    if (node.id !== "" && valid.has(node.id) && !allowsDuplicate(library.byId.get(node.id), node.id)) {
      collect(node.id, classLevel, false);
    }
    if ((node.registered ?? "") !== "" && valid.has(node.registered!) && !allowsDuplicate(library.byId.get(node.registered!), node.registered!)) {
      collect(node.registered!, classLevel, false);
    }
  };
  const characterLevel = Math.max(1, state.level);
  const walkTree = (nodes: RegisteredElement[], classLevel: number): void => {
    for (const node of nodes) {
      const here = contexts.get(node.registered ?? node.id) ?? classLevel;
      collectNode(node, here);
      walkTree(node.children, here);
    }
  };
  walkTree(state.elements, characterLevel);

  // ...then sum-only entries (elements the tree does not carry, e.g. items
  // and orphaned grants), honouring allow-duplicate registrations...
  for (const entry of state.sum.elements) {
    if (entry.id === "") continue;
    if (seen.has(entry.id) && !allowsDuplicate(library.byId.get(entry.id), entry.id)) continue;
    if (valid.has(entry.id) || !registered.has(entry.id)) {
      collect(entry.id, contexts.get(entry.id) ?? characterLevel, allowsDuplicate(library.byId.get(entry.id), entry.id));
    }
  }
  // ...and items whose benefits are active (equipped, and attuned when the
  // item requires attunement).
  for (const item of state.items) {
    if (!itemBenefitsActive(library, item)) continue;
    // Adorned inventory records store the physical base in itemId and the
    // applied content in adorners. Collect both through the same de-duplicated
    // path used by sum entries so an adorner contributes once and only while
    // the owning inventory record is active.
    const activeIds = [item.itemId, ...item.adorners];
    for (const activeId of activeIds) {
      collect(activeId, characterLevel, allowsDuplicate(library.byId.get(activeId), activeId));
    }
  }
  return { rules, validRegistered };
}

/** The engine's fixed key vocabulary (all keys present on a fresh character). */
const ENGINE_KEYS = new Set<string>([
  "level", "level:half", "level:half:up", "level:quarter", "level:quarter:up",
  "hp", "hp:starting", "hp:temp",
  "attunement:current", "attunement:max",
  "proficiency", "proficiency:half", "proficiency:half:down", "proficiency:half:up",
  "ac", "ac:unarmored:base", "ac:unarmored:dexterity", "ac:unarmored", "ac:calculation",
  "ac:armored:misc", "ac:armored:enhancement", "ac:armored:dexterity:cap", "ac:armored:dexterity", "ac:dexterity",
  "speed", "speed:fly", "speed:climb", "speed:swim", "speed:burrow", "speed:misc",
  "speed:fly:misc", "speed:climb:misc", "speed:swim:misc", "speed:burrow:misc",
  "innate speed", "innate speed:fly", "innate speed:climb", "innate speed:swim", "innate speed:burrow",
  "innate speed:misc", "innate speed:fly:misc", "innate speed:climb:misc", "innate speed:swim:misc", "innate speed:burrow:misc",
  "innate speed:calculation", "innate speed:fly:calculation", "innate speed:climb:calculation",
  "innate speed:swim:calculation", "innate speed:burrow:calculation",
  "initiative", "initiative:misc",
  "spellcasting:attack", "spellcasting:dc", "spellcasting:known spells",
  "spellcasting:attack:misc", "spellcasting:dc:misc",
  "spellcasting:attack:proficiency", "spellcasting:dc:base", "spellcasting:dc:proficiency",
  "companion:proficiency:half", "companion:proficiency:half:up",
]);

function engineKey(key: string): boolean {
  if (ENGINE_KEYS.has(key)) return true;
  if (ABILITIES.includes(key as (typeof ABILITIES)[number])) return true;
  if (/^(strength|dexterity|constitution|intelligence|wisdom|charisma):(score|score:set|modifier|modifier:half|modifier:half:up|max|save|save:proficiency|save:misc)$/.test(key)) return true;
  if (SKILLS.some((skill) => key === skill.name || key === `${skill.name}:proficiency` || key === `${skill.name}:misc` || key === `${skill.name}:passive`)) return true;
  if (/^spellcasting:(slots|attack|dc|known)/.test(key)) return true;
  if (/^spellcasting:attack:(str|dex|con|int|wis|cha)(:misc)?$/.test(key)) return true;
  if (/^spellcasting:dc:(str|dex|con|int|wis|cha)(:misc)?$/.test(key)) return true;
  if (/^companion:(strength|dexterity|constitution|intelligence|wisdom|charisma):(score|modifier)$/.test(key)) return true;
  if (/^multiclass:spellcasting:slots:\d$/.test(key)) return true;
  if (/^[a-z0-9 ,/-]+:spellcasting:(attack|dc)$/.test(key)) return true;
  if (/^(melee|ranged):(attack|damage)$/.test(key)) return true;
  if (/^[a-z0-9 ,/-]+:(attack|damage)$/.test(key)) return true;
  // Class-conditional engine keys (set only when the class is registered).
  if (/^level:[a-z]+$/.test(key)) return true;
  if (/^level:[a-z]+:half(:\w+)?$/.test(key)) return true;
  if (/^hp:[a-z]+$/.test(key)) return true;
  return false;
}

/** The engine base values dictionary (fresh character at the given level). */
function engineBase(state: CharacterState): StatisticsValues {
  const values: StatisticsValues = {};
  const set = (key: string, value: number): void => {
    values[key] = value;
  };

  const level = state.level;
  const pb = proficiencyBonus(level);

  set("level", level);
  set("level:half", Math.floor(level / 2));
  set("level:half:up", Math.ceil(level / 2));
  // The quarter keys stay 0 through level 8; deriving them from the
  // proficiency bonus reproduces that across all 20 levels.
  set("level:quarter", Math.floor(pb / 2) - 1);
  set("level:quarter:up", Math.floor(pb / 2) - 1);

  for (const ability of ABILITIES) {
    set(ability, 0);
    set(`${ability}:score`, state.abilities[ability]);
    set(`${ability}:score:set`, 0);
    set(`${ability}:max`, 20);
    set(`${ability}:save`, 0);
    set(`${ability}:save:proficiency`, 0);
    set(`${ability}:save:misc`, 0);
  }
  for (const skill of SKILLS) {
    set(skill.name, 0);
    set(`${skill.name}:proficiency`, 0);
    set(`${skill.name}:misc`, 0);
    set(`${skill.name}:passive`, 0);
  }

  set("proficiency", pb);
  set("proficiency:half", Math.floor(pb / 2));
  set("proficiency:half:down", Math.floor(pb / 2) - 1);
  set("proficiency:half:up", Math.ceil(pb / 2));

  set("hp", 0);
  set("hp:starting", 0);
  set("hp:temp", 0);

  set("ac", 0);
  set("ac:unarmored:base", 10);
  set("ac:unarmored:dexterity", 0);
  set("ac:unarmored", 0);
  set("ac:calculation", 0);
  set("ac:armored:misc", 0);
  set("ac:armored:enhancement", 0);
  set("ac:armored:dexterity:cap", 2);
  set("ac:dexterity", 0);
  for (const mode of ["fly", "climb", "swim", "burrow"]) {
    set(`innate speed:${mode}:calculation`, 0);
  }
  set("innate speed:calculation", 0);
  set("speed", 0);
  set("speed:fly", 0);
  set("speed:climb", 0);
  set("speed:swim", 0);
  set("speed:burrow", 0);
  set("innate speed", 0);
  set("innate speed:fly", 0);
  set("innate speed:climb", 0);
  set("innate speed:swim", 0);
  set("innate speed:burrow", 0);
  set("innate speed:misc", 0);
  set("innate speed:fly:misc", 0);
  set("innate speed:climb:misc", 0);
  set("innate speed:swim:misc", 0);
  set("innate speed:burrow:misc", 0);
  set("speed:misc", 0);
  set("speed:fly:misc", 0);
  set("speed:climb:misc", 0);
  set("speed:swim:misc", 0);
  set("speed:burrow:misc", 0);
  set("initiative", 0);
  set("initiative:misc", 0);

  set("spellcasting:attack", pb);
  set("spellcasting:dc", 8 + pb);
  for (let i = 1; i <= 9; i++) {
    set(`spellcasting:slots:${i}`, 0);
    set(`multiclass:spellcasting:slots:${i}`, 0);
  }
  set("spellcasting:known spells", 0);
  for (const ability of ABILITIES) {
    set(`spellcasting:attack:${ABILITY_ABBR[ability]}`, pb);
    set(`spellcasting:dc:${ABILITY_ABBR[ability]}`, 8 + pb);
  }
  set("spellcasting:attack:misc", 0);
  set("spellcasting:dc:misc", 0);
  for (const ability of ABILITIES) {
    set(`spellcasting:attack:${ABILITY_ABBR[ability]}:misc`, 0);
    set(`spellcasting:dc:${ABILITY_ABBR[ability]}:misc`, 0);
  }
  set("spellcasting:attack:proficiency", pb);
  set("spellcasting:dc:base", 8);
  set("spellcasting:dc:proficiency", pb);

  set("attunement:current", 0);
  set("attunement:max", 3);
  for (const ability of ABILITIES) {
    set(`companion:${ability}:score`, state.companion.attributes[ability]);
    set(`companion:${ability}:modifier`, abilityModifier(state.companion.attributes[ability]));
  }
  set("companion:proficiency:half", 0);
  set("companion:proficiency:half:up", 0);

  return values;
}

/**
 * The derived values dictionary for the character state, matching the
 * statistics endpoint value-for-value.
 */
/**
 * An optional sink for rule provenance. The totals are plain numbers, so a
 * caller that needs to say *which* feature produced one (an attack row naming
 * the feature that set its damage die) asks for the contributing rules here.
 * Only the requested keys are collected, and only from rules that passed every
 * gate, so the entries match what actually reached the totals.
 */
export interface StatContributorCollector {
  keys: ReadonlySet<string>;
  out: Array<{ key: string; value: number; label: string; elementId: string }>;
}

export function computeStatistics(
  state: CharacterState,
  library: ElementLibrary,
  collect?: StatContributorCollector,
): StatisticsValues {
  const values = engineBase(state);

  const level = state.level;
  const pb = proficiencyBonus(level);

  // ---- per-class level + hit point keys ------------------------------------
  const classes = classLevels(state, library);
  let rollsTotal = 0;
  const averageHp = state.options.has(OPTION_AVERAGE_HP);
  const hpValuesFor = (cls: ClassLevel): number[] => {
    if (!averageHp) return cls.rolls;
    const element = library.byId.get(cls.id) ?? classElementForMulticlass(library, cls.id);
    const die = element ? extractHitDie(element) : 0;
    if (die === 0) return [];
    const average = Math.floor(die / 2) + 1;
    // The starting class gets the die max at level 1; all other levels
    // (including every multiclass level) use the average.
    const first = cls.isMulticlass || !classes.some((other) => !other.isMulticlass) ? average : die;
    return [first, ...Array(Math.max(0, cls.level - 1)).fill(average)];
  };
  for (const cls of classes) {
    if (cls.slug === "") continue;
    values[`level:${cls.slug}`] = cls.level;
    values[`level:${cls.slug}:half`] = Math.floor(cls.level / 2);
    values[`level:${cls.slug}:half:up`] = Math.ceil(cls.level / 2);
    const hpValues = hpValuesFor(cls);
    values[`hp:${cls.slug}`] = hpValues.reduce((sum, roll) => sum + roll, 0);
    rollsTotal += hpValues.reduce((sum, roll) => sum + roll, 0);
  }

  const appliedKeys = new Set<string>();
  const { rules: allRules, validRegistered } = ruleSources(state, library, appliedKeys);
  const equipped = equippedInfo(state, library);

  // Ability-bonus rules (name = an ability) apply first so scores and
  // modifiers are final before the remaining rules evaluate: stat rules
  // referencing "{ability}:modifier" resolve to the final value.
  const finalScores: Record<string, number> = {};
  // Same-name rules sharing a named bonus bucket do not stack: only the
  // largest contribution in the bucket counts (two sources of magic-armor
  // "enhancement" or expertise "double" yield one bonus, not two).
  const bonusBucketMax = new Map<string, number>();
  const apply = (source: RuleSource): void => {
    const rule = source.rule;
    appliedKeys.add(rule.name);
    if (collect !== undefined && collect.keys.has(rule.name)) {
      collect.out.push({
        key: rule.name,
        value: resolveValue(rule.value, values),
        // The corpus convention: `alt` is the rule's display name, otherwise
        // the owning element speaks for itself.
        label: rule.alt ?? source.element.identity.name,
        elementId: source.element.identity.id,
      });
    }
    if (rule.bonus === "base") {
      values[rule.name] = resolveValue(rule.value, values);
    } else if (rule.bonus !== undefined) {
      const bucket = `${rule.name}\u0000${rule.bonus}`;
      const value = resolveValue(rule.value, values);
      const previous = bonusBucketMax.get(bucket);
      if (previous === undefined) {
        bonusBucketMax.set(bucket, value);
        values[rule.name] = (values[rule.name] ?? 0) + value;
      } else if (value > previous) {
        values[rule.name] = (values[rule.name] ?? 0) + (value - previous);
        bonusBucketMax.set(bucket, value);
      }
    } else {
      values[rule.name] = (values[rule.name] ?? 0) + resolveValue(rule.value, values);
    }
  };
  const abilityRule = (source: RuleSource): boolean =>
    ABILITIES.includes(source.rule.name as (typeof ABILITIES)[number]);
  // Score-set overrides, max raises, and their ":max:extra" feeders finalize
  // alongside the ability bonuses: all of them must be known before scores
  // clamp and modifiers derive.
  const scoreFamilyRule = (source: RuleSource): boolean =>
    abilityRule(source) || ABILITY_SCORE_SET_KEY.test(source.rule.name) || ABILITY_MAX_EXTRA_KEY.test(source.rule.name);
  const deferredMovementRules: RuleSource[] = [];

  const ruleCtxRaw = requirementContext(state, library, { ...state.abilities }, values);
  const ruleCtx = {
    ...ruleCtxRaw,
    hasElement: (elementId: string) => validRegistered.has(elementId),
  };
  const passesRuleGates = (source: RuleSource, ctx: typeof ruleCtx): boolean => {
    const rule = source.rule;
    if (rule.inline === true) return false;
    // Conditional rules ("while raging") describe circumstances, not
    // always-on statistics; they never join the unconditional totals.
    if (rule.condition !== undefined && rule.condition.trim() !== "") return false;
    if (rule.level !== undefined && rule.level > source.classLevel) return false;
    if (rule.requirements !== undefined && !evaluateRequirements(rule.requirements, ctx)) return false;
    if (rule.equipped !== undefined && !equipmentMatches(rule.equipped, equipped, library)) return false;
    return true;
  };
  for (const source of allRules) {
    if (!scoreFamilyRule(source)) continue;
    if (!passesRuleGates(source, ruleCtx)) continue;
    apply(source);
  }
  // ":max" bumps evaluate after every ":max:extra" total exists — the
  // internal over-20 grant's tiers gate on them.
  for (const source of allRules) {
    if (!ABILITY_MAX_KEY.test(source.rule.name)) continue;
    if (!passesRuleGates(source, ruleCtx)) continue;
    apply(source);
  }

  for (const ability of ABILITIES) {
    const base = state.abilities[ability];
    const bonus = values[ability] ?? 0;
    const scoreSet = values[`${ability}:score:set`] ?? 0;
    const max = values[`${ability}:max`] ?? 20;
    // The final score clamps to ":max"; a ":score:set" override bypasses the cap.
    const score = Math.max(Math.min(base + bonus, max), scoreSet);
    finalScores[ability] = score;
    values[`${ability}:score`] = score;
    const mod = abilityModifier(score);
    values[`${ability}:modifier`] = mod;
    values[`${ability}:modifier:half`] = halfDown(mod);
    values[`${ability}:modifier:half:up`] = halfUp(mod);
  }

  const finalCtxRaw = requirementContext(state, library, finalScores, values);
  const finalCtx = {
    ...finalCtxRaw,
    hasElement: (elementId: string) => validRegistered.has(elementId),
  };
  // A source's ac:shield / ac:misc stat rules merge as one group: a group
  // whose sum is zero or negative is dropped entirely, while a positive mixed
  // group applies as its net total.
  const acGroupTotal = (source: RuleSource, ctx: typeof ruleCtx): number => {
    let total = 0;
    for (const rule of source.element.rules) {
      if (rule.kind !== "stat" || rule.name !== source.rule.name) continue;
      if (!passesRuleGates({ element: source.element, rule, classLevel: source.classLevel }, ctx)) continue;
      total += resolveValue(rule.value, values);
    }
    return total;
  };
  for (const source of allRules) {
    if (scoreFamilyRule(source) || ABILITY_MAX_KEY.test(source.rule.name)) continue;
    if (!passesRuleGates(source, finalCtx)) continue;
    if (isMovementValueReference(source.rule)) {
      deferredMovementRules.push(source);
      continue;
    }
    if (AC_GROUP_KEYS.has(source.rule.name) && acGroupTotal(source, finalCtx) <= 0) continue;
    apply(source);
  }

  // ---- assembled values ------------------------------------------------------
  const conMod = abilityModifier(finalScores.constitution!);
  values.hp = (values.hp ?? 0) + rollsTotal + conMod * level + (values["hp:starting"] ?? 0);

  for (const ability of ABILITIES) {
    values[`${ability}:save`] = values[`${ability}:save`] ?? 0;
    values[`${ability}:save:proficiency`] = values[`${ability}:save:proficiency`] ?? 0;
    values[`${ability}:save:misc`] = values[`${ability}:save:misc`] ?? 0;
  }
  for (const skill of SKILLS) {
    values[skill.name] = values[skill.name] ?? 0;
    values[`${skill.name}:proficiency`] = values[`${skill.name}:proficiency`] ?? 0;
    values[`${skill.name}:misc`] = values[`${skill.name}:misc`] ?? 0;
    values[`${skill.name}:passive`] = 10 + (values[`${skill.name}:passive`] ?? 0);
  }

  // Spellcasting attack/DC: the generic keys absorb their misc pools, and each
  // per-ability key is generic + ability modifier + its own misc pool + any
  // contributions written directly to it (its engine seed replaced by the
  // folded generic so proficiency is not double-counted).
  values["spellcasting:attack"] = (values["spellcasting:attack"] ?? pb) + (values["spellcasting:attack:misc"] ?? 0);
  values["spellcasting:dc"] = (values["spellcasting:dc"] ?? 8 + pb) + (values["spellcasting:dc:misc"] ?? 0);
  for (const ability of ABILITIES) {
    const abbr = ABILITY_ABBR[ability];
    const mod = abilityModifier(finalScores[ability]!);
    const attackDirect = (values[`spellcasting:attack:${abbr}`] ?? pb) - pb;
    values[`spellcasting:attack:${abbr}`] =
      values["spellcasting:attack"]! + mod + (values[`spellcasting:attack:${abbr}:misc`] ?? 0) + attackDirect;
    const dcDirect = (values[`spellcasting:dc:${abbr}`] ?? 8 + pb) - (8 + pb);
    values[`spellcasting:dc:${abbr}`] =
      values["spellcasting:dc"]! + mod + (values[`spellcasting:dc:${abbr}:misc`] ?? 0) + dcDirect;
  }

  values.initiative = (values.initiative ?? 0) + abilityModifier(finalScores.dexterity!);

  const innate = values["innate speed"] ?? 0;
  values["innate speed:calculation"] = innate + (values["innate speed:misc"] ?? 0);
  values.speed = (values["innate speed:calculation"] ?? 0) + (values["speed:misc"] ?? 0) + (values.speed ?? 0);
  for (const source of deferredMovementRules) apply(source);
  for (const mode of ["fly", "climb", "swim", "burrow"]) {
    values[`innate speed:${mode}:calculation`] = (values[`innate speed:${mode}`] ?? 0) + (values[`innate speed:${mode}:misc`] ?? 0);
    values[`speed:${mode}`] = (values[`innate speed:${mode}:calculation`] ?? 0) + (values[`speed:${mode}:misc`] ?? 0) + (values[`speed:${mode}`] ?? 0);
  }

  const dexMod = abilityModifier(finalScores.dexterity!);
  // Content may contribute alternative AC calculations (natural armor,
  // draconic resilience, barrier tattoos) and direct `ac` bonuses; both are
  // captured before the engine assembles the armored/unarmored chain so they
  // compete with (rather than get clobbered by) the computed calculation.
  const contributedCalculation = values["ac:calculation"] ?? 0;
  const contributedAc = values["ac"] ?? 0;
  const mediumDexCap = values["ac:armored:dexterity:cap"] ?? 2;
  const armorDexCap = equipped.armor === "heavy" ? 0 : equipped.armor === "medium" ? mediumDexCap : equipped.armor === "light" ? 5 : Infinity;
  values["ac:unarmored:dexterity"] = dexMod;
  values["ac:unarmored"] = (values["ac:unarmored:base"] ?? 10) + dexMod;
  values["ac:dexterity"] = dexMod;
  if (equipped.armor !== "none") {
    // Heavy armor never penalizes a negative dexterity modifier.
    const armoredDex = Math.max(0, Math.min(dexMod, armorDexCap));
    appliedKeys.add("ac:armored:dexterity");
    appliedKeys.add("ac:armored");
    values["ac:armored:dexterity"] = armoredDex;
    values["ac:armored"] = (values["ac:armored:armor"] ?? 0) + armoredDex + (values["ac:armored:enhancement"] ?? 0) + (values["ac:armored:misc"] ?? 0);
    values["ac:calculation"] = Math.max(values["ac:armored"], values["ac:unarmored"]);
    values["ac:dexterity"] = armoredDex;
  } else {
    values["ac:calculation"] = values["ac:unarmored"];
  }
  if (contributedCalculation > values["ac:calculation"]!) {
    values["ac:calculation"] = contributedCalculation;
  }
  // The calculation also considers unarmored-defense variants (barbarian,
  // monk) registered as content keys.
  for (const key of Object.keys(values)) {
    const match = /^ac:unarmored defense [a-z]+$/.exec(key);
    if (match && (values[key] ?? 0) > values["ac:calculation"]) {
      values["ac:calculation"] = values[key]!;
    }
  }
  values.ac = contributedAc + (values["ac:calculation"] ?? 0) + (values["ac:misc"] ?? 0) + (values["ac:shield"] ?? 0);

  // Multiclass spell slots: single-class characters key the PHB table by
  // character level; multiclassed characters by their spellcasting
  // contributions (content "multiclass:spellcasting:level" rules plus the
  // engine-baked full-progression grant), floored at 1 (probed).
  // Multiclass spell slots: the PHB table keyed by character level, emitted
  // only when the multiclass spellcasting grant is registered. The
  // multiclass:spellcasting:level stat sums each class's engine-derived
  // progression (full casters add their level, half casters floor(level/2),
  // warlocks and non-casters nothing) and is emitted only when non-zero and
  // the character is actually multiclassed (probed).
  const hasMulticlass = state.levelHistory.slice(0, state.level).some((entry) => entry.isMulticlass);
  const hasClass = state.levelHistory.slice(0, state.level).some((entry) => entry.classId !== "");
  const multiclassGrantRegistered = state.sum.elements.some(
    (entry) => entry.id === "ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING",
  );

  if (hasClass && multiclassGrantRegistered) {
    const rates = multiclassSlotProgression(state, library);
    let derived = 0;
    for (const cls of classes) {
      const rate = rates.get(cls.id);
      if (rate) derived += rate(cls.level);
    }
    // Custom content may author multiclass:spellcasting:level contributions
    // directly; they accumulate with the derived rates instead of being
    // overwritten by them.
    const casterLevel = derived + (values["multiclass:spellcasting:level"] ?? 0);
    const tableLevel = hasMulticlass && casterLevel > 0
      ? Math.min(20, casterLevel)
      : Math.min(20, Math.max(1, level));
    const slots = MULTICLASS_SLOT_TABLE[tableLevel] ?? [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]! > 0) {
        appliedKeys.add(`multiclass:spellcasting:slot:${i + 1}`);
        values[`multiclass:spellcasting:slot:${i + 1}`] = slots[i]!;
      }
    }
    if (hasMulticlass && casterLevel > 0) {
      appliedKeys.add("multiclass:spellcasting:level");
      values["multiclass:spellcasting:level"] = casterLevel;
    }
  }

  // A full-library live matrix consistently excludes the persisted TCOE
  // Eldritch Claw Tattoo while counting the structurally identical UA tattoo;
  // the element identity is the only observed discriminator.
  const attunedCurrent = state.items.filter(
    (item) => item.attuned &&
      item.itemId !== "ID_WOTC_TCOE_MAGIC_ITEM_TATTOO_ELDRITCH_CLAW_TATTOO" &&
      ((item.adorners ?? []).length > 0 || !item.equipped || (item.location ?? "") !== ""),
  ).length;
  values["attunement:current"] = (values["attunement:current"] ?? 0) + attunedCurrent;

  const companionPB = values["companion:proficiency"] ?? 0;
  values["companion:proficiency:half"] = halfDown(companionPB);
  values["companion:proficiency:half:up"] = halfUp(companionPB);

  // ---- weapon attack/damage keys (engine-baked, probed) ------------------
  // Per-weapon keys are emitted for the weapons referenced by the
  // character's attack entries (matched by item identifier or name).
  const weaponNames = new Set<string>();
  let hasMelee = false;
  let hasRanged = false;
  const addWeapon = (weapon: ParsedElement | undefined): void => {
    if (!weapon || weapon.identity.type !== "Weapon") return;
    const name = weapon.identity.name.toLowerCase();
    if (weaponNames.has(name)) return;
    weaponNames.add(name);
    if (weapon.supports.some((tag) => tag.includes("_MELEE") || tag.toLowerCase().includes("melee"))) hasMelee = true;
    if (weapon.supports.some((tag) => tag.includes("_RANGED") || tag.toLowerCase().includes("ranged"))) hasRanged = true;
  };
  for (const attack of state.attacks) {
    // An attack links to every weapon it references: by item
    // identifier, by exact name, and (for re-added items) by shared words.
    const byIdentifier = state.items.find((item) => item.identifier === attack.identifier);
    addWeapon(byIdentifier ? library.byId.get(byIdentifier.itemId) : undefined);
    const byName = state.items.find((item) => item.name.toLowerCase() === attack.name.toLowerCase());
    addWeapon(byName ? library.byId.get(byName.itemId) : undefined);
    if (!byName) {
      const attackWords = new Set(attack.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
      const shared = state.items.find((item) => {
        const words = item.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
        return words.some((word) => attackWords.has(word));
      });
      addWeapon(shared ? library.byId.get(shared.itemId) : undefined);
    }
  }
  for (const name of weaponNames) {
    appliedKeys.add(`${name}:attack`);
    appliedKeys.add(`${name}:damage`);
    values[`${name}:attack`] = values[`${name}:attack`] ?? 0;
    values[`${name}:damage`] = values[`${name}:damage`] ?? 0;
  }
  if (hasMelee) {
    appliedKeys.add("melee:attack");
    appliedKeys.add("melee:damage");
    values["melee:attack"] = values["melee:attack"] ?? 0;
    values["melee:damage"] = values["melee:damage"] ?? 0;
  }
  if (hasRanged) {
    appliedKeys.add("ranged:attack");
    appliedKeys.add("ranged:damage");
    values["ranged:attack"] = values["ranged:attack"] ?? 0;
    values["ranged:damage"] = values["ranged:damage"] ?? 0;
  }

  // ---- per-spellcasting-feature keys (the file's spellcasting blocks) ------------
  // Each caster name owns one pair of keys: content contributions written to
  // them plus the live per-ability attack/DC for the caster's ability. The
  // serialized attack/dc attributes are not read (they can be stale), and a
  // duplicated serialized block must not double the values.
  const seenCasterNames = new Set<string>();
  for (const block of state.spellcasting) {
    const name = block.name.toLowerCase();
    if (seenCasterNames.has(name)) continue;
    seenCasterNames.add(name);
    const abbr = ABILITY_ABBR[block.ability.toLowerCase() as keyof typeof ABILITY_ABBR];
    const attackBase = abbr !== undefined ? (values[`spellcasting:attack:${abbr}`] ?? 0) : (Number(block.attack) || 0);
    const dcBase = abbr !== undefined ? (values[`spellcasting:dc:${abbr}`] ?? 0) : (Number(block.dc) || 0);
    appliedKeys.add(`${name}:spellcasting:attack`);
    appliedKeys.add(`${name}:spellcasting:dc`);
    values[`${name}:spellcasting:attack`] = (values[`${name}:spellcasting:attack`] ?? 0) + attackBase;
    values[`${name}:spellcasting:dc`] = (values[`${name}:spellcasting:dc`] ?? 0) + dcBase;
  }
  // Dragonmarks carry an engine-baked spellcasting feature named "n/a".
  const hasDragonmark = state.sum.elements.some((entry) => {
    const resolved = resolveElementType(library, entry.id);
    return resolved.toLowerCase() === "dragonmark" || entry.type.toLowerCase() === "dragonmark";
  });
  if (hasDragonmark) {
    appliedKeys.add("n/a:spellcasting:attack");
    appliedKeys.add("n/a:spellcasting:dc");
    values["n/a:spellcasting:attack"] = values["n/a:spellcasting:attack"] ?? 0;
    values["n/a:spellcasting:dc"] = values["n/a:spellcasting:dc"] ?? 0;
  }

  // ---- emission: engine keys and applied keys always --------------------------
  // Spell points (option ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS) replace slot
  // tracking: the generic slot keys zero out while the per-class keys and
  // Pact Magic (warlock:*) stay (captured; the engine's base already
  // emits 0s, this guards content-contributed values from leaking through).
  if (state.options.has("ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS")) {
    for (let i = 1; i <= 9; i++) {
      values[`spellcasting:slots:${i}`] = 0;
      values[`multiclass:spellcasting:slots:${i}`] = 0;
    }
  }
  const out: StatisticsValues = {};
  for (const key of Object.keys(values)) {
    if (!engineKey(key) && !appliedKeys.has(key)) continue;
    out[key] = values[key]!;
  }
  return out;
}

/**
 * The character's inline (text-valued) statistics: `<stat inline="true">`
 * rules carry strings for `{{...}}` sheet tokens (the chosen draconic
 * ancestry's damage type and breath shape). Keys are lowercased; the same
 * level/requirements/equipped gating as numeric rules applies, later rules
 * winning ties.
 */
export function computeInlineValues(state: CharacterState, library: ElementLibrary): Record<string, string> {
  const appliedKeys = new Set<string>();
  const { rules, validRegistered } = ruleSources(state, library, appliedKeys);
  const equipped = equippedInfo(state, library);
  const ctxRaw = requirementContext(state, library, { ...state.abilities }, undefined);
  const ctx = {
    ...ctxRaw,
    hasElement: (elementId: string) => validRegistered.has(elementId),
  };
  const inline: Record<string, string> = {};
  for (const source of rules) {
    const rule = source.rule;
    if (rule.inline !== true) continue;
    if (rule.level !== undefined && rule.level > source.classLevel) continue;
    if (rule.requirements !== undefined && !evaluateRequirements(rule.requirements, ctx)) continue;
    if (rule.equipped !== undefined && !equipmentMatches(rule.equipped, equipped, library)) continue;
    inline[rule.name.toLowerCase()] = rule.value ?? "";
  }
  return inline;
}
