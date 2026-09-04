/**
 * Attacks surface: DTO construction, attack computations, and .dnd5e
 * document edit planning.
 *
 * The rules this surface implements:
 *  - equipping a weapon auto-creates an attack row at the TOP of the stored
 *    list; unequipping keeps the row (isCurrentlyEquipped flips); removing
 *    the item removes the row; re-equipping keeps the existing row in place;
 *    never-equipped weapons have no row.
 *  - the row's bonus is "ability modifier + proficiency (when the character
 *    is proficient with the weapon) + enhancement" and its damage is
 *    "dice + ability modifier + enhancement", recomputed from the current
 *    scores on every read. The default ability is the higher of STR/DEX for
 *    finesse weapons, DEX for ranged weapons, STR otherwise; the range is
 *    the weapon's range setter or "5 ft"; the description is the weapon's
 *    property list ("Ammunition, Two-Handed", "Versatile", ...), with
 *    "Mastery: <Name>" appended when the character has chosen that 2024
 *    weapon's mastery property.
 *  - a weapon owned but never equipped has no row; `createAttack` with
 *    `{mode: "weapon", identifier}` appends one from `getAttackOptions`.
 *  - manual, calculated, and linked-spell rows are appended at the END of the stored list;
 *    manual rows show their stored strings with every non-empty display
 *    field overridden; calculated rows recompute bonus/damage and carry the
 *    computation breakdown (ability/proficiency/miscellaneous contributions
 *    with zero-valued misc omitted); spell rows follow the current known-spell
 *    option while retaining explicit display-field overrides.
 *  - unarmed rows carry no inventory item: their die, default ability, and
 *    riders come from the character's content statistics (see unarmed.ts), and
 *    proficiency always applies. They are created on request and appended at
 *    the END of the stored list.
 *  - hiding a row nulls its sheetPosition and renumbers the rest; showing
 *    restores it; move swaps stored order; deletion is rejected for an
 *    equipped weapon's automatic row.
 */

import { randomUuid } from "../platform.js";
import { childElements, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { engineError } from "../errors.js";
import { escapeXml } from "../selection/selection.js";
import { elementById, type ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import type { AbilityScores, AttackState, CharacterState } from "../character/state.js";
import type { RawEdit } from "../selection/selection.js";
import { computeStatistics, type StatisticsValues } from "../statistics/calculator.js";
import { buildMagicAttackOptions, type MagicAttackSpellOptionDto } from "../magic/reconcile.js";
import {
  UNARMED_SOURCE_KEYS,
  resolveUnarmedProfile,
  type StatContributor,
} from "./unarmed.js";

export interface AttackBonusContribution {
  label: string;
  value: number;
}

export interface AttackModifierInfo {
  id: string;
  name: string;
  field: string;
  effect: string;
}

export interface AttackComputationDto {
  attackBonusContributions: AttackBonusContribution[];
  appliedModifiers: AttackModifierInfo[];
  sourceNotes: string[];
  attackCount: number;
  isPerHit: boolean;
}

export interface AttackCalculationDto {
  source: string;
  ability: string;
  useProficiency: boolean;
  attackMiscBonus: number;
  damageDice: string;
  addAbilityToDamage: boolean;
  damageMiscBonus: number;
  damageType: string;
  casterIdentifier: string | null;
}

/** The unarmed block of an unarmed strike row (`dice` "" follows the content). */
export interface AttackUnarmedDto {
  dice: string;
}

export interface AttackSourceDto {
  casterIdentifier: string;
  spellId: string;
  warning: string;
  beamCount: number;
}

export interface AttackGeneratedDto {
  name: string;
  range: string;
  bonus: string;
  damage: string;
  description: string;
}

/**
 * The weapon mastery property a 2024 weapon carries, and whether this
 * character has chosen it (a mastery only applies to a weapon whose mastery
 * property the character has selected through a Weapon Mastery feature).
 */
export interface AttackMasteryDto {
  name: string;
  active: boolean;
}

/** A weapon in the inventory with no attack row yet (`createAttack` input). */
export interface AttackWeaponOptionDto {
  identifier: string;
  itemId: string;
  name: string;
  isEquipped: boolean;
}

export interface AttackDto {
  id: string;
  name: string;
  range: string;
  bonus: string;
  damage: string;
  description: string;
  isDisplayed: boolean;
  isAutomatic: boolean;
  isCurrentlyEquipped: boolean;
  sheetPosition: number | null;
  kind: string;
  abilityMode: string | null;
  ability: string | null;
  defaultAbility: string | null;
  generated: AttackGeneratedDto | null;
  overriddenFields: string[];
  calculation: AttackCalculationDto | null;
  source: AttackSourceDto | null;
  unarmed: AttackUnarmedDto | null;
  computation: AttackComputationDto | null;
  /** The weapon's mastery property (2024 weapons only), else null. */
  mastery: AttackMasteryDto | null;
}

export interface AttackOptionsDto {
  abilities: Array<{ name: string; abbreviation: string }>;
  casters: Array<unknown>;
  spells: Array<unknown>;
  /** The row `createAttack({mode: "unarmed"})` would produce right now. */
  unarmed: AttackGeneratedDto | null;
  /** Owned weapons with no attack row (`createAttack({mode: "weapon"})`). */
  weapons: AttackWeaponOptionDto[];
}

/** The magic rows merged into the attack options (spellcasting domain). */
export interface MagicAttackOptionsMerged {
  casters: Array<{ identifier: string; name: string; ability: string; attackModifier: number }>;
  spells: Array<{ casterIdentifier: string; casterName: string; spellId: string; spellName: string; level: number }>;
}

const ABILITY_NAMES: Array<{ name: string; abbreviation: string }> = [
  { name: "Strength", abbreviation: "STR" },
  { name: "Dexterity", abbreviation: "DEX" },
  { name: "Constitution", abbreviation: "CON" },
  { name: "Intelligence", abbreviation: "INT" },
  { name: "Wisdom", abbreviation: "WIS" },
  { name: "Charisma", abbreviation: "CHA" },
];

const ABILITY_KEY: Record<string, keyof AbilityScores> = {
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

/** Weapon property tag -> display name (with a suffix fallback). */
const PROPERTY_NAMES: Record<string, string> = {
  AMMUNITION: "Ammunition",
  FINESSE: "Finesse",
  HEAVY: "Heavy",
  LIGHT: "Light",
  LOADING: "Loading",
  REACH: "Reach",
  SPECIAL: "Special",
  THROWN: "Thrown",
  TWOHANDED: "Two-Handed",
  VERSATILE: "Versatile",
};

const PROPERTY_ID_NAMES: Record<string, string> = {
  ID_WOTC_DMG_WEAPON_PROPERTY_FIREARM_AMMUNITION: "Ammunition",
};

const propertyName = (tag: string): string => {
  if (PROPERTY_ID_NAMES[tag] !== undefined) return PROPERTY_ID_NAMES[tag]!;
  const suffix = tag.replace(/^ID_INTERNAL_WEAPON_PROPERTY_/, "");
  if (PROPERTY_NAMES[suffix] !== undefined) return PROPERTY_NAMES[suffix]!;
  return suffix
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/** The pinned display identity of an unarmed strike row. */
const UNARMED_STRIKE_NAME = "Unarmed Strike";
const UNARMED_STRIKE_RANGE = "5 ft";

const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

const proficiencyBonus = (level: number): number => Math.floor((level + 7) / 4);

const scoreFor = (state: CharacterState, abilityName: string): number => {
  const key = ABILITY_KEY[abilityName.toLowerCase()];
  return key === undefined ? 0 : state.abilities[key];
};

const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

const bonusString = (value: number): string => `${signed(value)} vs AC`;

/** Weapon damage strings always carry the signed bonus, e.g. "1d6+0". */
const weaponDamageString = (dice: string, bonus: number, type: string): string =>
  `${dice}${signed(bonus)}${type === "" ? "" : ` ${type}`}`;

/** Calculated damage strings omit a zero bonus, e.g. "1d4 cold". */
const calculatedDamageString = (dice: string, bonus: number, type: string): string =>
  `${dice}${bonus === 0 ? "" : signed(bonus)}${type === "" ? "" : ` ${type}`}`;

const setterValue = (element: ParsedElement | undefined, name: string): string | undefined =>
  element?.setters.find((s) => s.name === name)?.value;

const setterType = (element: ParsedElement | undefined, name: string): string | undefined =>
  element?.setters.find((s) => s.name === name)?.attrs?.type;

const effectiveElement = (library: ElementLibrary, item: { itemId: string; adorners: string[] }): ParsedElement | undefined =>
  item.adorners.length > 0 ? elementById(library, item.adorners[0]!) : elementById(library, item.itemId);

/** The weapon's default attack ability (finesse: higher of STR/DEX; ranged: DEX). */
function weaponDefaultAbility(state: CharacterState, base: ParsedElement, statistics: StatisticsValues): string {
  const supports = base.supports.join(" ");
  const ranged =
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_FIREARM");
  if (ranged) return "Dexterity";
  const finesse = supports.includes("ID_INTERNAL_WEAPON_PROPERTY_FINESSE");
  if (finesse) {
    const dexterity = statistics["dexterity:modifier"] ?? abilityModifier(state.abilities.dexterity);
    const strength = statistics["strength:modifier"] ?? abilityModifier(state.abilities.strength);
    return dexterity > strength ? "Dexterity" : "Strength";
  }
  return "Strength";
}

function weaponCategory(base: ParsedElement): "melee" | "ranged" | null {
  const supports = base.supports.join(" ");
  if (
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_MELEE")
  ) {
    return "melee";
  }
  if (
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_RANGED") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_FIREARM") ||
    supports.includes("ID_INTERNAL_WEAPON_CATEGORY_FIREARMS")
  ) {
    return "ranged";
  }
  return null;
}

/** True when the character's registrations include the weapon's proficiency. */
function isProficient(state: CharacterState, base: ParsedElement): boolean {
  const proficiency = setterValue(base, "proficiency");
  if (proficiency === undefined || proficiency === "") return false;
  return state.sum.elements.some((e) => e.id === proficiency);
}

/** The weapon's enhancement bonus (magic item setter). */
function enhancementOf(element: ParsedElement | undefined): number {
  const value = setterValue(element, "enhancement");
  if (value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The property list of a weapon ("Ammunition, Two-Handed", "Versatile", ...). */
function weaponProperties(base: ParsedElement): string {
  const names = base.supports
    .filter((tag) => tag.startsWith("ID_INTERNAL_WEAPON_PROPERTY_") || PROPERTY_ID_NAMES[tag] !== undefined)
    .map(propertyName);
  return names.join(", ");
}

// ---------------------------------------------------------------------------
// Weapon mastery (2024)
// ---------------------------------------------------------------------------

/**
 * The mastery property names the loaded content defines.
 *
 * Mastery is content-driven, not id-driven: a mastery property is one that a
 * "Weapon Mastery" feature can be chosen for, and those features are named
 * "<Weapon> (<Mastery>)". Deriving the name set from them is what separates a
 * mastery tag from the other non-internal weapon-property tags a weapon may
 * carry (the DMG firearm properties, "Special (Hoopak)", ...). With no 2024
 * content loaded the set is empty and no weapon reports a mastery, which is
 * the right answer: the rule does not exist in that character's content.
 */
const masteryNamesByLibrary = new WeakMap<ElementLibrary, { revision: number; names: Set<string> }>();

function masteryPropertyNames(library: ElementLibrary): Set<string> {
  const revision = library.revision ?? 0;
  const cached = masteryNamesByLibrary.get(library);
  if (cached !== undefined && cached.revision === revision) return cached.names;
  const names = new Set<string>();
  for (const element of library.byType.get("Class Feature") ?? []) {
    if (!element.supports.includes("Weapon Mastery")) continue;
    const match = /\(([^()]+)\)\s*$/.exec(element.identity.name);
    if (match !== null) names.add(match[1]!);
  }
  masteryNamesByLibrary.set(library, { revision, names });
  return names;
}

/** The weapon's mastery property name, or null when it has none. */
function weaponMasteryName(library: ElementLibrary, base: ParsedElement): string | null {
  const masteries = masteryPropertyNames(library);
  if (masteries.size === 0) return null;
  for (const tag of base.supports) {
    if (tag.startsWith("ID_INTERNAL_") || !tag.includes("WEAPON_PROPERTY_")) continue;
    const element = library.byId.get(tag);
    if (element === undefined || element.identity.type !== "Weapon Property") continue;
    if (masteries.has(element.identity.name)) return element.identity.name;
  }
  return null;
}

/** The mastery choices this character has registered, computed once per pass. */
export interface MasteryContext {
  /** The weapon-proficiency ids the chosen masteries require. */
  requirements: Set<string>;
  /** The chosen features' names ("Greataxe (Cleave)"), for content without requirements. */
  names: Set<string>;
}

const EMPTY_MASTERY_CONTEXT: MasteryContext = { requirements: new Set(), names: new Set() };

/** The registered "Weapon Mastery" features of a character. */
export function masteryContext(state: CharacterState, library: ElementLibrary): MasteryContext {
  const requirements = new Set<string>();
  const names = new Set<string>();
  for (const registered of state.sum.elements) {
    const element = library.byId.get(registered.id);
    if (element === undefined || !element.supports.includes("Weapon Mastery")) continue;
    if (element.requirements !== undefined && element.requirements !== "") {
      requirements.add(element.requirements);
    }
    names.add(element.identity.name);
  }
  return { requirements, names };
}

/**
 * The weapon's mastery property and whether this character has chosen it.
 *
 * A chosen mastery is a Class Feature requiring the weapon's own proficiency
 * element, which is the same id the weapon's `proficiency` setter names. The
 * name fallback covers content that spells the choice out in the feature name
 * without carrying a requirement.
 */
function weaponMastery(
  library: ElementLibrary,
  base: ParsedElement,
  context: MasteryContext,
): AttackMasteryDto | null {
  const name = weaponMasteryName(library, base);
  if (name === null) return null;
  const proficiency = setterValue(base, "proficiency") ?? "";
  const active =
    (proficiency !== "" && context.requirements.has(proficiency)) ||
    context.names.has(`${base.identity.name} (${name})`);
  return { name, active };
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** The attack options DTO (static ability list). */
export function buildAttackOptionsDto(): AttackOptionsDto {
  return { abilities: ABILITY_NAMES, casters: [], spells: [], unarmed: null, weapons: [] };
}

/**
 * The owned weapons with no attack row yet.
 *
 * Equipping a weapon creates its row automatically; a weapon that has never
 * been equipped has none, and this is how one is offered to `createAttack`.
 * The duplicate guard is the one `planAutoAttackInsertEdits` uses, so the two
 * entry points cannot disagree about what "already has a row" means.
 */
export function weaponsWithoutRows(state: CharacterState, library: ElementLibrary): AttackWeaponOptionDto[] {
  const options: AttackWeaponOptionDto[] = [];
  for (const item of state.items) {
    if (state.attacks.some((row) => row.identifier === item.identifier)) continue;
    const base = elementById(library, item.itemId);
    if (base === undefined || base.identity.type !== "Weapon") continue;
    const effective = effectiveElement(library, item);
    options.push({
      identifier: item.identifier,
      itemId: item.itemId,
      name: effective?.identity.name ?? base.identity.name,
      isEquipped: item.equipped,
    });
  }
  return options;
}

/**
 * The generated block of the unarmed strike row the character would get.
 *
 * The editor shows this before the row exists so that adding one is not a
 * blind action; it is the same resolution the created row will use.
 */
export function buildUnarmedPreview(state: CharacterState, library: ElementLibrary): AttackGeneratedDto {
  const contributors: StatContributor[] = [];
  const statistics = computeStatistics(state, library, { keys: UNARMED_SOURCE_KEYS, out: contributors });
  return resolveUnarmedRow(state, statistics, newUnarmedAttackRow(), contributors).generated!;
}

interface ResolvedRow {
  name: string;
  range: string;
  bonus: string;
  damage: string;
  description: string;
  generated: AttackGeneratedDto | null;
  overriddenFields: string[];
  ability: string | null;
  defaultAbility: string | null;
  abilityMode: string | null;
  calculation: AttackCalculationDto | null;
  computation: AttackComputationDto | null;
  source?: AttackSourceDto;
  mastery?: AttackMasteryDto | null;
}

const SPELL_OVERRIDE_FIELDS = ["name", "range", "bonus", "damage", "description"] as const;
type SpellOverrideField = (typeof SPELL_OVERRIDE_FIELDS)[number];

/** The computation DTO of a calculated row (pinned labels). */
function computationOf(state: CharacterState, calculation: NonNullable<AttackState["calculation"]>): AttackComputationDto {
  const modifier = abilityModifier(scoreFor(state, calculation.ability));
  const proficiency = proficiencyBonus(state.level);
  const contributions: AttackBonusContribution[] = [{ label: calculation.ability, value: modifier }];
  if (calculation.useProficiency) contributions.push({ label: "Proficiency", value: proficiency });
  if (calculation.attackMiscBonus !== 0) contributions.push({ label: "Miscellaneous", value: calculation.attackMiscBonus });
  return {
    attackBonusContributions: contributions,
    appliedModifiers: [],
    sourceNotes: [],
    attackCount: 1,
    isPerHit: true,
  };
}

/** The calculation DTO of a calculated row. */
function calculationDtoOf(calculation: NonNullable<AttackState["calculation"]>): AttackCalculationDto {
  return {
    source: calculation.source,
    ability: calculation.ability,
    useProficiency: calculation.useProficiency,
    attackMiscBonus: calculation.attackMiscBonus,
    damageDice: calculation.damageDice,
    addAbilityToDamage: calculation.addAbilityToDamage,
    damageMiscBonus: calculation.damageMiscBonus,
    damageType: calculation.damageType,
    casterIdentifier: calculation.casterIdentifier === "" ? null : calculation.casterIdentifier,
  };
}

/** Resolves a weapon row against the current character state. */
function resolveWeaponRow(
  state: CharacterState,
  library: ElementLibrary,
  statistics: StatisticsValues,
  row: AttackState,
  item: { itemId: string; adorners: string[]; equipped: boolean; attuned?: boolean; location?: string } | undefined,
  masteries: MasteryContext,
): ResolvedRow {
  const base = item ? elementById(library, item.itemId) : undefined;
  const effective = item ? effectiveElement(library, item) : undefined;
  if (item === undefined || base === undefined || base.identity.type !== "Weapon" || effective === undefined) {
    // The item is gone or its element is not in the corpus: fall back to the
    // stored strings (imported rows of unknown items; Big Barb probe).
    return {
      name: row.name,
      range: row.range,
      bonus: row.attack,
      damage: row.damage,
      description: row.description,
      generated: null,
      overriddenFields: [],
      ability: row.ability === "" ? null : row.ability,
      defaultAbility: null,
      abilityMode: row.abilityMode,
      calculation: null,
      computation: null,
      mastery: null,
    };
  }
  const defaultAbility = weaponDefaultAbility(state, base, statistics);
  const ability = row.abilityMode === "explicit" && row.ability !== "" ? row.ability : defaultAbility;
  const abilityKey = ABILITY_KEY[ability.toLowerCase()];
  const modifier = abilityKey === undefined
    ? abilityModifier(scoreFor(state, ability))
    : (statistics[`${abilityKey}:modifier`] ?? abilityModifier(state.abilities[abilityKey]));
  const proficiency = isProficient(state, base) ? proficiencyBonus(state.level) : 0;
  // An attunement-requiring weapon fights as its mundane base until attuned;
  // the enhancement bonus only applies once the wielder is attuned to it.
  const requiresAttunement = setterValue(effective, "attunement") === "true";
  const enhancement = requiresAttunement && item.attuned !== true ? 0 : enhancementOf(effective);
  const category = weaponCategory(base);
  const statisticName = base.identity.name.toLowerCase();
  const categoryAttack = category === null ? 0 : (statistics[`${category}:attack`] ?? 0);
  const categoryDamage = category === null ? 0 : (statistics[`${category}:damage`] ?? 0);
  const attackTotal = modifier + proficiency + enhancement + categoryAttack + (statistics[`${statisticName}:attack`] ?? 0);
  // A versatile weapon wielded in both hands deals its versatile die. The
  // state carries the document's display location ("Two-Handed").
  const versatileDice = item.location === "Two-Handed" ? setterValue(base, "versatile") : undefined;
  const dice = versatileDice ?? setterValue(base, "damage") ?? "";
  const type = setterType(base, "damage") ?? "";
  const damageTotal = modifier + enhancement + categoryDamage + (statistics[`${statisticName}:damage`] ?? 0);
  const range = setterValue(base, "range") ?? "5 ft";
  // A mastery property only reads as part of the weapon once the character has
  // chosen it, so an unchosen one is reported but never printed on the sheet.
  const mastery = weaponMastery(library, base, masteries);
  const properties = weaponProperties(base);
  const description = mastery !== null && mastery.active
    ? [properties, `Mastery: ${mastery.name}`].filter((part) => part !== "").join(", ")
    : properties;
  // The generated block is the item's own row: the item's name and the values
  // computed with the row's effective ability (the current bonus/damage stays
  // there even after an explicit ability override).
  const generated: AttackGeneratedDto = {
    name: effective.identity.name,
    range,
    bonus: bonusString(attackTotal),
    damage: weaponDamageString(dice, damageTotal, type),
    description,
  };
  // A row written before the mastery suffix existed carries the bare property
  // list; that is still generated text, not a description typed by hand.
  const generatedDescription = (value: string): boolean => value === description || value === properties;
  const overriddenFields: string[] = [];
  if (row.name !== "" && row.name !== generated.name) overriddenFields.push("name");
  if (row.range !== "" && row.range !== generated.range) overriddenFields.push("range");
  if (row.description !== "" && !generatedDescription(row.description)) overriddenFields.push("description");
  return {
    name: row.name === "" ? generated.name : row.name,
    range: row.range === "" ? generated.range : row.range,
    bonus: bonusString(attackTotal),
    damage: weaponDamageString(dice, damageTotal, type),
    description: row.description === "" || generatedDescription(row.description) ? description : row.description,
    generated,
    overriddenFields,
    ability,
    defaultAbility,
    abilityMode: row.abilityMode,
    calculation: null,
    computation: null,
    mastery,
  };
}

/**
 * Resolves an unarmed strike row against the current character state.
 *
 * Unlike a weapon row there is no element to read from, so the die, the default
 * ability, and the riders all come from the statistics map. Proficiency is
 * always added: every character is proficient with unarmed strikes, while the
 * corpus only grants the unarmed-strike proficiency element through Simple
 * Melee Weapons, so gating on `isProficient` would wrongly deny it to (for
 * example) a druid.
 */
function resolveUnarmedRow(
  state: CharacterState,
  statistics: StatisticsValues,
  row: AttackState,
  contributors: readonly StatContributor[] = [],
): ResolvedRow {
  const profile = resolveUnarmedProfile(
    statistics as unknown as Record<string, number>,
    state.abilities,
    contributors,
  );
  const defaultAbility = profile.defaultAbility;
  const ability = row.abilityMode === "explicit" && row.ability !== "" ? row.ability : defaultAbility;
  const abilityKey = ABILITY_KEY[ability.toLowerCase()];
  const modifier = abilityKey === undefined
    ? abilityModifier(scoreFor(state, ability))
    : (statistics[`${abilityKey}:modifier`] ?? abilityModifier(state.abilities[abilityKey]));
  const proficiency = proficiencyBonus(state.level);
  const attackTotal = modifier + proficiency + profile.attackRiders;
  const damageTotal = modifier + profile.damageRiders;
  const override = row.unarmed?.dice ?? "";
  const dice = override === "" ? profile.dice : override;
  const contributions: AttackBonusContribution[] = [
    { label: ability, value: modifier },
    { label: "Proficiency", value: proficiency },
  ];
  if (profile.attackRiders !== 0) contributions.push({ label: "Bonuses", value: profile.attackRiders });
  const sourceNotes = [...profile.notes];
  if (override !== "") {
    sourceNotes.unshift(
      profile.dieSource === null
        ? `Damage die set to ${override} by hand.`
        : `Damage die set to ${override} by hand, replacing ${profile.dice} from ${profile.dieSource}.`,
    );
  } else if (profile.dieSource !== null) {
    sourceNotes.unshift(`${profile.dieSource} sets the damage die to ${profile.dice}.`);
  }
  // Each rider is both a pill (the feature's name) and a note (what it does),
  // because the pill's effect text is a tooltip and a touch reader never sees it.
  const appliedModifiers: AttackModifierInfo[] = [];
  for (const rider of profile.riderSources) {
    const parts = [
      rider.attack === 0 ? "" : `${signed(rider.attack)} to hit`,
      rider.damage === 0 ? "" : `${signed(rider.damage)} damage`,
    ].filter((part) => part !== "");
    if (parts.length === 0) continue;
    appliedModifiers.push({
      id: rider.elementId,
      name: rider.name,
      field: rider.attack !== 0 && rider.damage !== 0
        ? "attack and damage"
        : rider.attack !== 0 ? "attack" : "damage",
      effect: parts.join(", "),
    });
    sourceNotes.push(`${rider.name} adds ${parts.join(" and ")}.`);
  }
  const generated: AttackGeneratedDto = {
    name: UNARMED_STRIKE_NAME,
    range: UNARMED_STRIKE_RANGE,
    bonus: bonusString(attackTotal),
    damage: weaponDamageString(dice, damageTotal, profile.damageType),
    description: "",
  };
  const overriddenFields: string[] = [];
  if (row.name !== "" && row.name !== generated.name) overriddenFields.push("name");
  if (row.range !== "" && row.range !== generated.range) overriddenFields.push("range");
  if (row.description !== "") overriddenFields.push("description");
  return {
    name: row.name === "" ? generated.name : row.name,
    range: row.range === "" ? generated.range : row.range,
    bonus: generated.bonus,
    damage: generated.damage,
    description: row.description,
    generated,
    overriddenFields,
    ability,
    defaultAbility,
    abilityMode: row.abilityMode,
    calculation: null,
    computation: {
      attackBonusContributions: contributions,
      appliedModifiers,
      sourceNotes,
      attackCount: 1,
      isPerHit: true,
    },
  };
}

/** Resolves a calculated row against the current character state. */
function resolveCalculatedRow(state: CharacterState, row: AttackState): ResolvedRow {
  const calculation = row.calculation!;
  const modifier = abilityModifier(scoreFor(state, calculation.ability));
  const proficiency = calculation.useProficiency ? proficiencyBonus(state.level) : 0;
  const attackTotal = modifier + proficiency + calculation.attackMiscBonus;
  const damageBonus = (calculation.addAbilityToDamage ? modifier : 0) + calculation.damageMiscBonus;
  const bonus = bonusString(attackTotal);
  const damage = calculatedDamageString(calculation.damageDice, damageBonus, calculation.damageType);
  const overriddenFields: string[] = [];
  if (row.name !== "") overriddenFields.push("name");
  if (row.range !== "") overriddenFields.push("range");
  if (row.description !== "") overriddenFields.push("description");
  return {
    name: row.name,
    range: row.range,
    bonus,
    damage,
    description: row.description,
    generated: { name: "", range: "", bonus, damage, description: "" },
    overriddenFields,
    ability: calculation.ability,
    defaultAbility: null,
    abilityMode: null,
    calculation: calculationDtoOf(calculation),
    computation: computationOf(state, calculation),
  };
}

/** Resolves a manual row (stored strings; every non-empty field overridden). */
function resolveManualRow(row: AttackState): ResolvedRow {
  const overriddenFields: string[] = [];
  if (row.name !== "") overriddenFields.push("name");
  if (row.range !== "") overriddenFields.push("range");
  if (row.attack !== "") overriddenFields.push("bonus");
  if (row.damage !== "") overriddenFields.push("damage");
  if (row.description !== "") overriddenFields.push("description");
  return {
    name: row.name,
    range: row.range,
    bonus: row.attack,
    damage: row.damage,
    description: row.description,
    generated: null,
    overriddenFields,
    ability: null,
    defaultAbility: null,
    abilityMode: null,
    calculation: null,
    computation: null,
  };
}

/** Resolves a spell row from its stable caster name and the current spell option. */
function resolveSpellRow(
  row: AttackState,
  options: MagicAttackSpellOptionDto[],
): ResolvedRow {
  const link = row.spell!;
  const option = options.find(
    (candidate) =>
      candidate.spellId === link.spellId &&
      candidate.casterName === link.casterName,
  );
  const generated: AttackGeneratedDto = option === undefined
    ? {
        name: row.name,
        range: row.range,
        bonus: row.attack,
        damage: row.damage,
        description: row.description,
      }
    : {
        name: option.spellName,
        range: option.range,
        bonus: option.bonus,
        damage: option.damage,
        description: option.description,
      };
  const overriddenFields = link.overriddenFields.filter(
    (field): field is SpellOverrideField =>
      SPELL_OVERRIDE_FIELDS.includes(field as SpellOverrideField),
  );
  const overridden = (field: SpellOverrideField): boolean =>
    overriddenFields.includes(field);
  const warning = option?.warning ??
    (option === undefined ? "The linked spell is no longer known by this caster." : "");
  return {
    name: overridden("name") ? row.name : generated.name,
    range: overridden("range") ? row.range : generated.range,
    bonus: overridden("bonus") ? row.attack : generated.bonus,
    damage: overridden("damage") ? row.damage : generated.damage,
    description: overridden("description") ? row.description : generated.description,
    generated,
    overriddenFields,
    ability: null,
    defaultAbility: null,
    abilityMode: null,
    calculation: null,
    computation: option?.computation ?? null,
    source: {
      casterIdentifier: option?.casterIdentifier ?? "",
      spellId: link.spellId,
      warning,
      beamCount: option?.beamCount ?? 1,
    },
  };
}

function resolveRow(
  state: CharacterState,
  library: ElementLibrary,
  statistics: StatisticsValues,
  row: AttackState,
  spellOptions: MagicAttackSpellOptionDto[],
  item?: { itemId: string; adorners: string[]; equipped: boolean; attuned?: boolean; location?: string },
  contributors: readonly StatContributor[] = [],
  masteries: MasteryContext = EMPTY_MASTERY_CONTEXT,
): { resolved: ResolvedRow; itemEquipped: boolean } {
  const resolvedItem =
    item ?? state.items.find((i) => i.identifier === row.identifier);
  if (row.kind === "weapon") {
    return {
      resolved: resolveWeaponRow(state, library, statistics, row, resolvedItem, masteries),
      itemEquipped: resolvedItem?.equipped ?? false,
    };
  }
  if (row.kind === "spell" && row.spell !== undefined) {
    return { resolved: resolveSpellRow(row, spellOptions), itemEquipped: false };
  }
  if (row.kind === "unarmed") {
    return { resolved: resolveUnarmedRow(state, statistics, row, contributors), itemEquipped: false };
  }
  if (row.calculation !== null) {
    return { resolved: resolveCalculatedRow(state, row), itemEquipped: false };
  }
  return { resolved: resolveManualRow(row), itemEquipped: false };
}

/** The per-character inputs every row resolution shares, computed once per pass. */
function rowResolutionContext(
  state: CharacterState,
  library: ElementLibrary,
): {
  statistics: StatisticsValues;
  spellOptions: MagicAttackSpellOptionDto[];
  contributors: StatContributor[];
  masteries: MasteryContext;
} {
  const contributors: StatContributor[] = [];
  const collector = state.attacks.some((row) => row.kind === "unarmed")
    ? { keys: UNARMED_SOURCE_KEYS, out: contributors }
    : undefined;
  const statistics = computeStatistics(state, library, collector);
  const spellOptions = state.attacks.some((row) => row.kind === "spell")
    ? buildMagicAttackOptions(
        state,
        library,
        statistics as unknown as Record<string, number>,
        state.magicCasterIds,
      ).spells
    : [];
  const masteries = state.attacks.some((row) => row.kind === "weapon")
    ? masteryContext(state, library)
    : EMPTY_MASTERY_CONTEXT;
  return { statistics, spellOptions, contributors, masteries };
}

/** The attacks DTO: rows in stored order, sheet positions among displayed rows. */
export function buildAttacksDto(state: CharacterState, library: ElementLibrary): AttackDto[] {
  let displayed = 0;
  const { statistics, spellOptions, contributors, masteries } = rowResolutionContext(state, library);
  return state.attacks.map((row) => {
    const { resolved, itemEquipped } = resolveRow(state, library, statistics, row, spellOptions, undefined, contributors, masteries);
    const isDisplayed = row.displayed;
    if (isDisplayed) displayed++;
    return {
      id: row.id,
      name: resolved.name,
      range: resolved.range,
      bonus: resolved.bonus,
      damage: resolved.damage,
      description: resolved.description,
      isDisplayed,
      isAutomatic: row.kind === "weapon",
      isCurrentlyEquipped: itemEquipped,
      sheetPosition: isDisplayed ? displayed : null,
      kind: row.kind,
      abilityMode: resolved.abilityMode,
      ability: resolved.ability,
      defaultAbility: resolved.defaultAbility,
      generated: resolved.generated,
      overriddenFields: resolved.overriddenFields,
      calculation: resolved.calculation,
      source: resolved.source ?? null,
      unarmed: row.kind === "unarmed" ? { dice: row.unarmed?.dice ?? "" } : null,
      computation: resolved.computation,
      mastery: resolved.mastery ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Document edit planning
// ---------------------------------------------------------------------------

const escapeAttr = (value: string): string => escapeXml(value).replaceAll('"', "&quot;");

const toCdata = (value: string): string => `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

function attacksNode(document: Dnd5eDocument): Dnd5eNode {
  const node = document.root.build.input?.attacks()?.node;
  if (!node) throw engineError("not-found", "attacks section not found");
  return node;
}

function attackNodes(document: Dnd5eDocument): Dnd5eNode[] {
  return childElements(attacksNode(document), "attack");
}

/** The row's own indentation (the node's line prefix, e.g. four tabs). */
function indentOf(raw: string, node: Dnd5eNode): string {
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  return raw.slice(start, node.start);
}

/** The inter-row separator (line ending + row indentation). */
function rowSeparator(document: Dnd5eDocument): string {
  const node = attacksNode(document);
  const raw = document.raw;
  const attacks = attackNodes(document);
  const description = childElements(node, "description")[0];
  const from = description ? description.end : node.openEnd;
  const to = attacks[0] ? attacks[0].start : (node.closeStart ?? node.end);
  const between = raw.slice(from, to);
  const line = between.includes("\r\n") ? "\r\n" : "\n";
  const indent = attacks[0] ? indentOf(raw, attacks[0]) : "\t\t\t\t";
  return `${line}${indent}`;
}

/** Renders a full <attack> node (row line + description child + close tag).
 * The first line carries no indent (the caller's separator/region provides
 * it); inner lines are indented one tab beyond the row's indent. */
function renderAttackNode(row: AttackState, resolved: ResolvedRow, indent: string, line: string): string {
  const attrs: string[] = [
    `id="${row.id}"`,
    `identifier="${escapeAttr(row.identifier)}"`,
    `name="${escapeAttr(resolved.name)}"`,
    `range="${escapeAttr(resolved.range)}"`,
    `attack="${escapeAttr(resolved.bonus)}"`,
    `damage="${escapeAttr(resolved.damage)}"`,
    `displayed="${row.displayed ? "true" : "false"}"`,
    `kind="${row.kind}"`,
    `ability-mode="${row.abilityMode}"`,
  ];
  if (row.kind === "spell" && row.spell !== undefined) {
    attrs.push(`caster-name="${escapeAttr(row.spell.casterName)}"`);
    attrs.push(`spell-id="${escapeAttr(row.spell.spellId)}"`);
    attrs.push(`overridden-fields="${escapeAttr(row.spell.overriddenFields.join(","))}"`);
  }
  if (row.kind === "unarmed" && (row.unarmed?.dice ?? "") !== "") {
    attrs.push(`unarmed-dice="${escapeAttr(row.unarmed!.dice)}"`);
  }
  if (row.calculation !== null) {
    attrs.push(`calculation-source="${escapeAttr(row.calculation.source)}"`);
  }
  attrs.push(`proficient="${row.calculation !== null && row.calculation.useProficiency ? "true" : "false"}"`);
  attrs.push(`attack-misc="${row.calculation !== null ? row.calculation.attackMiscBonus : 0}"`);
  if (row.calculation !== null) {
    attrs.push(`damage-dice="${escapeAttr(row.calculation.damageDice)}"`);
  }
  attrs.push(`ability-damage="${row.calculation !== null && row.calculation.addAbilityToDamage ? "true" : "false"}"`);
  attrs.push(`damage-misc="${row.calculation !== null ? row.calculation.damageMiscBonus : 0}"`);
  if (row.calculation !== null) {
    attrs.push(`damage-type="${escapeAttr(row.calculation.damageType)}"`);
  }
  if (row.kind !== "manual" && resolved.ability !== null) {
    attrs.push(`ability="${escapeAttr(resolved.ability)}"`);
  }
  const lines = [
    `<attack ${attrs.join(" ")}>`,
    `${indent}\t<description>${toCdata(resolved.description)}</description>`,
    `${indent}</attack>`,
  ];
  return lines.join(line);
}

/** The resolved display of a row (for new rows the state fields are the source). */
function resolvedOf(
  state: CharacterState,
  library: ElementLibrary,
  row: AttackState,
  item?: { itemId: string; adorners: string[]; equipped: boolean; attuned?: boolean },
): ResolvedRow {
  const contributors: StatContributor[] = [];
  const statistics = computeStatistics(
    state,
    library,
    row.kind === "unarmed" ? { keys: UNARMED_SOURCE_KEYS, out: contributors } : undefined,
  );
  const spellOptions = row.kind === "spell"
    ? buildMagicAttackOptions(
        state,
        library,
        statistics as unknown as Record<string, number>,
        state.magicCasterIds,
      ).spells
    : [];
  const masteries = row.kind === "weapon" ? masteryContext(state, library) : EMPTY_MASTERY_CONTEXT;
  return resolveRow(state, library, statistics, row, spellOptions, item, contributors, masteries).resolved;
}

/** Edits that insert a new row at the top (automatic weapon rows) or the end. */
export function planInsertAttackEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  row: AttackState,
  atTop: boolean,
  item?: { itemId: string; adorners: string[]; equipped: boolean; attuned?: boolean },
): RawEdit[] {
  const node = attacksNode(document);
  const raw = document.raw;
  const resolved = resolvedOf(state, library, row, item);
  const rowText = renderAttackNode(row, resolved, "\t\t\t\t", raw.includes("\r\n") ? "\r\n" : "\n");
  const attacks = attackNodes(document);
  const description = childElements(node, "description")[0];
  const insertAt = atTop
    ? (description ? description.end : node.openEnd)
    : attacks.length > 0
      ? attacks[attacks.length - 1]!.end
      : (description ? description.end : node.openEnd);
  return [{ start: insertAt, end: insertAt, replacement: rowSeparator(document) + rowText }];
}

/** Edits that replace a row node with its current resolution. */
export function planRewriteAttackEdits(state: CharacterState, document: Dnd5eDocument, library: ElementLibrary, row: AttackState): RawEdit[] {
  const node = attackNodes(document).find((n) => getAttrId(n) === row.id);
  if (!node) throw engineError("not-found", `attack '${row.id}' not found`);
  const raw = document.raw;
  const resolved = resolvedOf(state, library, row);
  const rowText = renderAttackNode(row, resolved, indentOf(raw, node), raw.includes("\r\n") ? "\r\n" : "\n");
  return [{ start: node.start, end: node.end, replacement: rowText }];
}

function getAttrId(node: Dnd5eNode): string | null {
  for (const [name, value] of node.attrs) {
    if (name === "id") return value;
  }
  return null;
}

/**
 * Edits that bring every stored row up to its current resolution. Rows whose
 * text is already current are skipped, so a pass that changes nothing yields
 * no edits. Rows without a matching node (imported rows carry a derived
 * session id that never appears in the file) are left as they are.
 */
export function planRewriteAllAttackEdits(state: CharacterState, document: Dnd5eDocument, library: ElementLibrary): RawEdit[] {
  if (!document.root.build.input?.attacks()?.node || state.attacks.length === 0) return [];
  const raw = document.raw;
  const line = raw.includes("\r\n") ? "\r\n" : "\n";
  const nodesById = new Map<string, Dnd5eNode>();
  for (const node of attackNodes(document)) {
    const id = getAttrId(node);
    if (id !== null) nodesById.set(id, node);
  }
  const { statistics, spellOptions, contributors, masteries } = rowResolutionContext(state, library);
  const edits: RawEdit[] = [];
  for (const row of state.attacks) {
    const node = nodesById.get(row.id);
    if (node === undefined) continue;
    const { resolved } = resolveRow(state, library, statistics, row, spellOptions, undefined, contributors, masteries);
    const rowText = renderAttackNode(row, resolved, indentOf(raw, node), line);
    if (rowText === raw.slice(node.start, node.end)) continue;
    edits.push({ start: node.start, end: node.end, replacement: rowText });
  }
  return edits;
}

/** Edits that remove a row node (with its leading whitespace). */
export function planRemoveAttackEdits(document: Dnd5eDocument, attackId: string): RawEdit[] {
  const node = attackNodes(document).find((n) => getAttrId(n) === attackId);
  if (!node) return [];
  const raw = document.raw;
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start -= 1;
  if (start > 0 && raw[start - 1] === "\r") start -= 1;
  return [{ start, end: node.end, replacement: "" }];
}

/** Edits that swap two adjacent row nodes (move up/down). */
export function planMoveAttackEdits(document: Dnd5eDocument, attackId: string, direction: "up" | "down"): RawEdit[] {
  const nodes = attackNodes(document);
  const index = nodes.findIndex((n) => getAttrId(n) === attackId);
  if (index < 0) throw engineError("not-found", `attack '${attackId}' not found`);
  const other = direction === "up" ? index - 1 : index + 1;
  if (other < 0 || other >= nodes.length) return [];
  const a = nodes[Math.min(index, other)]!;
  const b = nodes[Math.max(index, other)]!;
  const raw = document.raw;
  const between = raw.slice(a.end, b.start);
  return [
    {
      start: a.start,
      end: b.end,
      replacement: raw.slice(b.start, b.end) + between + raw.slice(a.start, a.end),
    },
  ];
}

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

/** A fresh automatic weapon row for an inventory item. */
export function newWeaponAttackRow(
  state: CharacterState,
  library: ElementLibrary,
  item: { identifier: string; itemId: string; adorners: string[] },
): AttackState {
  const base = elementById(library, item.itemId);
  const effective = effectiveElement(library, item);
  const defaultAbility = base !== undefined && base.identity.type === "Weapon"
    ? weaponDefaultAbility(state, base, computeStatistics(state, library))
    : "Strength";
  return {
    id: randomUuid().replace(/-/g, ""),
    identifier: item.identifier,
    name: effective?.identity.name ?? base?.identity.name ?? "",
    range: "",
    attack: "",
    damage: "",
    displayed: true,
    ability: defaultAbility,
    kind: "weapon",
    abilityMode: "default",
    description: "",
    calculation: null,
  };
}

/**
 * A fresh unarmed strike row (created at the end of the stored list).
 * `dice` is a manual damage-die override; "" follows the character's content.
 */
export function newUnarmedAttackRow(dice = ""): AttackState {
  return {
    id: randomUuid().replace(/-/g, ""),
    identifier: "",
    name: "",
    range: "",
    attack: "",
    damage: "",
    displayed: true,
    ability: "",
    kind: "unarmed",
    abilityMode: "default",
    description: "",
    calculation: null,
    unarmed: { dice },
  };
}

/** A fresh manual row (created at the end of the stored list). */
export function newManualAttackRow(body: {
  name?: string;
  range?: string;
  bonus?: string;
  damage?: string;
  description?: string;
}): AttackState {
  return {
    id: randomUuid().replace(/-/g, ""),
    identifier: "",
    name: body.name ?? "",
    range: body.range ?? "",
    attack: body.bonus ?? "",
    damage: body.damage ?? "",
    displayed: true,
    ability: "",
    kind: "manual",
    abilityMode: "default",
    description: body.description ?? "",
    calculation: null,
  };
}

/** A fresh calculated row (created at the end of the stored list). */
export function newCalculatedAttackRow(body: Record<string, unknown>): AttackState {
  return {
    id: randomUuid().replace(/-/g, ""),
    identifier: "",
    name: String(body.name ?? ""),
    range: String(body.range ?? ""),
    attack: "",
    damage: "",
    displayed: true,
    ability: String(body.abilityName ?? ""),
    kind: "calculated",
    abilityMode: "default",
    description: String(body.description ?? ""),
    calculation: {
      source: String(body.calculationSource ?? "ability"),
      ability: String(body.abilityName ?? ""),
      useProficiency: body.useProficiency === true,
      attackMiscBonus: Number(body.attackMiscBonus ?? 0),
      damageDice: String(body.damageDice ?? ""),
      addAbilityToDamage: body.addAbilityToDamage === true,
      damageMiscBonus: Number(body.damageMiscBonus ?? 0),
      damageType: String(body.damageType ?? ""),
      casterIdentifier: String(body.casterIdentifier ?? ""),
    },
  };
}

/** A row linked to a known spell; generated fields continue to follow the spell. */
export function newSpellAttackRow(
  body: Record<string, unknown>,
  option: MagicAttackSpellOptionDto,
): AttackState {
  const overriddenFields = SPELL_OVERRIDE_FIELDS.filter(
    (field) => body[field] !== undefined && body[field] !== null,
  );
  return {
    id: randomUuid().replace(/-/g, ""),
    identifier: "",
    name: body.name === undefined || body.name === null ? "" : String(body.name),
    range: body.range === undefined || body.range === null ? "" : String(body.range),
    attack: body.bonus === undefined || body.bonus === null ? "" : String(body.bonus),
    damage: body.damage === undefined || body.damage === null ? "" : String(body.damage),
    displayed: true,
    ability: "",
    kind: "spell",
    abilityMode: "default",
    description: body.description === undefined || body.description === null ? "" : String(body.description),
    calculation: null,
    spell: {
      casterName: option.casterName,
      spellId: option.spellId,
      overriddenFields,
    },
  };
}

/** Edits that auto-create a weapon row when an item is equipped. */
export function planAutoAttackInsertEdits(
  state: CharacterState,
  document: Dnd5eDocument,
  library: ElementLibrary,
  item: { identifier: string; itemId: string; adorners: string[]; equipped?: boolean; attuned?: boolean },
): RawEdit[] {
  const base = elementById(library, item.itemId);
  if (base === undefined || base.identity.type !== "Weapon") return [];
  const existing = state.attacks.some((row) => row.identifier === item.identifier);
  if (existing) return [];
  const row = newWeaponAttackRow(state, library, item);
  // Attunement state travels with the item context: a weapon equipped after
  // being attuned must bake its enhanced values into the inserted row.
  return planInsertAttackEdits(state, document, library, row, true, {
    itemId: item.itemId,
    adorners: item.adorners,
    equipped: item.equipped ?? true,
    attuned: item.attuned,
  });
}

/** Edits that remove the automatic row of an inventory item. */
export function planItemAttackRemovalEdits(document: Dnd5eDocument, identifier: string): RawEdit[] {
  const node = attackNodes(document).find((n) => {
    for (const [name, value] of n.attrs) {
      if (name === "identifier" && value === identifier) return true;
    }
    return false;
  });
  if (!node) return [];
  const raw = document.raw;
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start -= 1;
  if (start > 0 && raw[start - 1] === "\r") start -= 1;
  return [{ start, end: node.end, replacement: "" }];
}
