/**
 * The vocabulary a custom-element form offers, as plain data for the client.
 *
 * Authors pick from these menus instead of typing statistic keys, element
 * types or expressions. Every `id` here is a key the statistics calculator
 * reads (`statistics/calculator.ts`); the compiler maps a target and a mode to
 * the rule that realises them.
 */

import { WEAPON_CATEGORY_IDS } from "./base-items.js";
import {
  CUSTOM_ABILITIES,
  CUSTOM_OTHER_TYPE,
  type CustomAbility,
  type CustomCatalogTemplate,
  type CustomTemplate,
  type FilterNode,
  type ModifierMode,
  type SheetAction,
  type ShowsUnder,
  WEAPON_PROPERTY_IDS,
} from "./schema.js";

export interface ModifierTarget {
  /** The engine statistic key the target is stored under. */
  id: string;
  label: string;
  group: string;
  /** The modes the target accepts. */
  modes: readonly ModifierMode[];
  /** The bucket a `bestOf` modifier uses when its author names none. */
  defaultBucket?: string;
}

const ABILITY_LABEL: Record<CustomAbility, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

export const SKILL_NAMES = [
  "acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation",
  "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion",
  "sleight of hand", "stealth", "survival",
] as const;

const titleCase = (text: string): string => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

/** The skill proficiency elements a class or background offers a choice among, by the engine's ids. */
export const CUSTOM_SKILL_PROFICIENCIES: ReadonlyArray<{ id: string; label: string }> = SKILL_NAMES.map((skill) => ({
  id: `ID_PROFICIENCY_SKILL_${skill.replaceAll(" ", "").toUpperCase()}`,
  label: titleCase(skill),
}));

const abilityTargets: ModifierTarget[] = CUSTOM_ABILITIES.map((ability) => ({
  id: ability,
  label: `${ABILITY_LABEL[ability]} score`,
  group: "Ability scores",
  modes: ["add", "setBase", "bestOf"],
}));

const abilityMaxTargets: ModifierTarget[] = CUSTOM_ABILITIES.map((ability) => ({
  id: `${ability}:max`,
  label: `${ABILITY_LABEL[ability]} maximum`,
  group: "Ability maximums",
  modes: ["raiseMax"],
}));

const saveTargets: ModifierTarget[] = CUSTOM_ABILITIES.map((ability) => ({
  id: `${ability}:save:misc`,
  label: `${ABILITY_LABEL[ability]} saving throws`,
  group: "Saving throws",
  modes: ["add", "bestOf"],
}));

const skillTargets: ModifierTarget[] = SKILL_NAMES.map((skill) => ({
  id: `${skill}:misc`,
  label: `${titleCase(skill)} checks`,
  group: "Skills",
  modes: ["add", "bestOf"],
}));

const passiveTargets: ModifierTarget[] = (["perception", "investigation", "insight"] as const).map((skill) => ({
  id: `${skill}:passive`,
  label: `Passive ${titleCase(skill)}`,
  group: "Passive scores",
  modes: ["add", "bestOf"],
}));

const speedModes = [
  ["", "Walking"],
  [":fly", "Flying"],
  [":climb", "Climbing"],
  [":swim", "Swimming"],
  [":burrow", "Burrowing"],
] as const;

const speedTargets: ModifierTarget[] = speedModes.flatMap(([suffix, label]) => [
  { id: `speed${suffix}`, label: `${label} speed (at least)`, group: "Speed", modes: ["setBase"] as const },
  { id: `speed${suffix}:misc`, label: `${label} speed bonus`, group: "Speed", modes: ["add", "bestOf"] as const },
]);

/** The curated B1 target menu, in the order a form lists it. */
export const CUSTOM_MODIFIER_TARGETS: readonly ModifierTarget[] = [
  ...abilityTargets,
  ...abilityMaxTargets,
  ...saveTargets,
  ...skillTargets,
  ...passiveTargets,
  { id: "ac:misc", label: "Armor class bonus", group: "Armor class", modes: ["add", "bestOf"] },
  { id: "ac:calculation", label: "Armor class calculation", group: "Armor class", modes: ["setBase"] },
  { id: "hp", label: "Hit point maximum", group: "Hit points", modes: ["add"] },
  ...speedTargets,
  { id: "initiative", label: "Initiative", group: "Initiative", modes: ["add", "bestOf"] },
  { id: "attunement:max", label: "Attunement slots", group: "Attunement", modes: ["add", "setBase"] },
  { id: "extra attack:count", label: "Attacks per Attack action", group: "Attacks", modes: ["bestOf"], defaultBucket: "extra attack" },
  { id: "melee:attack", label: "Melee attack rolls", group: "Attacks", modes: ["add", "bestOf"] },
  { id: "melee:damage", label: "Melee damage rolls", group: "Attacks", modes: ["add", "bestOf"] },
  { id: "ranged:attack", label: "Ranged attack rolls", group: "Attacks", modes: ["add", "bestOf"] },
  { id: "ranged:damage", label: "Ranged damage rolls", group: "Attacks", modes: ["add", "bestOf"] },
  { id: "spellcasting:attack", label: "Spell attack bonus", group: "Spellcasting", modes: ["add", "bestOf"] },
  { id: "spellcasting:dc", label: "Spell save DC", group: "Spellcasting", modes: ["add", "bestOf"] },
];

export function modifierTarget(id: string): ModifierTarget | undefined {
  return CUSTOM_MODIFIER_TARGETS.find((target) => target.id === id);
}

export interface ValueReference {
  id: string;
  label: string;
}

/** The B1 references a modifier value may name. */
export const CUSTOM_VALUE_REFERENCES: readonly ValueReference[] = [
  { id: "proficiency", label: "Proficiency bonus" },
  { id: "proficiency:half", label: "Half proficiency bonus (down)" },
  { id: "proficiency:half:up", label: "Half proficiency bonus (up)" },
  { id: "level", label: "Character level" },
  { id: "level:half", label: "Half character level (down)" },
  { id: "level:half:up", label: "Half character level (up)" },
  ...CUSTOM_ABILITIES.map((ability) => ({ id: `${ability}:modifier`, label: `${ABILITY_LABEL[ability]} modifier` })),
  { id: "speed", label: "Walking speed" },
];

export function valueReference(id: string): ValueReference | undefined {
  return CUSTOM_VALUE_REFERENCES.find((reference) => reference.id === id);
}

export interface ShowsUnderOption {
  id: ShowsUnder;
  label: string;
  /** The element type an entry compiles to. */
  elementType: string;
  /** The Build tab section the entry lands in. */
  section: "race" | "class" | "feats" | "other";
}

export const CUSTOM_SHOWS_UNDER: readonly ShowsUnderOption[] = [
  { id: "race", label: "Species", elementType: "Racial Trait", section: "race" },
  { id: "class", label: "Class", elementType: "Class Feature", section: "class" },
  { id: "feats", label: "Feats", elementType: "Feat", section: "feats" },
  { id: "other", label: "Other", elementType: CUSTOM_OTHER_TYPE, section: "other" },
];

export function elementTypeFor(showsUnder: ShowsUnder): string {
  return CUSTOM_SHOWS_UNDER.find((option) => option.id === showsUnder)!.elementType;
}

export interface TemplateOption {
  id: CustomTemplate;
  label: string;
  /** The `showsUnder` choices the template allows. */
  showsUnder: readonly ShowsUnder[];
}

export const CUSTOM_TEMPLATE_OPTIONS: readonly TemplateOption[] = [
  { id: "feature", label: "Feature", showsUnder: ["race", "class", "feats", "other"] },
  { id: "boon", label: "Boon, blessing or gift", showsUnder: ["race", "class", "feats", "other"] },
  { id: "curse", label: "Curse or affliction", showsUnder: ["race", "class", "feats", "other"] },
  { id: "feat", label: "Feat", showsUnder: ["feats"] },
  { id: "racialTrait", label: "Species trait", showsUnder: ["race"] },
  { id: "classFeature", label: "Class feature", showsUnder: ["class"] },
  { id: "transformation", label: "Transformation", showsUnder: ["race", "class", "feats", "other"] },
];

export const SHEET_ACTION_OPTIONS: ReadonlyArray<{ id: SheetAction; label: string; text: string }> = [
  { id: "none", label: "None", text: "" },
  { id: "action", label: "Action", text: "Action" },
  { id: "bonusAction", label: "Bonus Action", text: "Bonus Action" },
  { id: "reaction", label: "Reaction", text: "Reaction" },
  { id: "attack", label: "Attack", text: "Attack" },
];

/** The `Build` sections a spell-casting ability menu offers. */
export const CUSTOM_CAST_ABILITIES: readonly CustomAbility[] = CUSTOM_ABILITIES;

/** Feat categories the bundled pickers filter on (B5). */
export const CUSTOM_FEAT_TAGS = ["Origin", "General", "Fighting Style", "Epic Boon"] as const;

/** Equipment gates a modifier may use, by slot. */
export const CUSTOM_EQUIPPED_VALUES: Readonly<Record<string, readonly string[]>> = {
  armor: ["any", "none", "light", "medium", "heavy"],
  shield: ["any", "none"],
  primary: ["any", "none", "versatile"],
  secondary: ["any", "none", "versatile"],
};

/**
 * Element types a grant or choice may target. Physical items are left out:
 * they join a character through the inventory, not through a rule.
 */
export const CUSTOM_GRANT_TYPES: readonly string[] = [
  "Feat", "Feat Feature", "Racial Trait", "Class Feature", "Archetype Feature", "Language", "Proficiency",
  "Vision", "Condition", "Spell", "Ability Score Improvement", "Option", "Companion",
];

// ---- catalogue entries (packs) -------------------------------------------------

export interface CatalogTemplateOption {
  id: CustomCatalogTemplate;
  label: string;
  /** The element type the entry compiles to. */
  elementType: string;
  /** One line for the template picker. */
  summary: string;
  /** What the entry's tags are called, and which ones the pickers already use. */
  tagLabel?: string;
  tagSuggestions?: readonly string[];
  /** Tags used when the author names none. */
  defaultTags?: readonly string[];
  /** The named setters the template reads. */
  fields?: ReadonlyArray<{ key: string; label: string; placeholder?: string }>;
}

export const CUSTOM_CATALOG_OPTIONS: readonly CatalogTemplateOption[] = [
  {
    id: "language",
    label: "Language",
    elementType: "Language",
    summary: "Standard, exotic or secret; script",
    tagLabel: "Language category",
    tagSuggestions: ["Standard", "Exotic", "Monster"],
    defaultTags: ["Standard"],
    fields: [
      { key: "Speakers", label: "Typical speakers", placeholder: "Selkies" },
      { key: "Script", label: "Script", placeholder: "Runes" },
    ],
  },
  {
    id: "proficiency",
    label: "Proficiency",
    elementType: "Proficiency",
    summary: "New skill, tool, vehicle or weapon group",
    tagLabel: "Kind",
    tagSuggestions: ["Tool", "Skill", "Vehicle", "Instrument", "Gaming Set"],
  },
  { id: "vision", label: "Sense", elementType: "Vision", summary: "A vision type such as Tremorsense 30 ft." },
  {
    id: "condition",
    label: "Damage type or condition",
    elementType: "Condition",
    summary: "Resistances, immunities and vulnerabilities to new damage types",
    tagLabel: "Kind",
    tagSuggestions: ["Resistance", "Immunity", "Vulnerability"],
  },
  {
    id: "deity",
    label: "Deity",
    elementType: "Deity",
    summary: "Domains and symbol for the deity picker",
    fields: [
      { key: "setting", label: "Pantheon or setting" },
      { key: "alignment", label: "Alignment", placeholder: "NG" },
      { key: "domains", label: "Domains", placeholder: "Life, Light" },
      { key: "symbol", label: "Symbol" },
    ],
  },
  { id: "option", label: "Optional rule", elementType: "Option", summary: "A switch on Manage › Optional rules that other content can check" },
  {
    id: "alignment",
    label: "Alignment",
    elementType: "Alignment",
    summary: "Extra alignments for the alignment picker",
    fields: [{ key: "Abbreviation", label: "Abbreviation", placeholder: "LW" }],
  },
  { id: "weaponProperty", label: "Weapon property", elementType: "Weapon Property", summary: "New properties, such as firearms reload or misfire" },
  { id: "baseWeapon", label: "Weapon", elementType: "Weapon", summary: "Category, properties, damage, mastery" },
  { id: "baseArmor", label: "Armor or shield", elementType: "Armor", summary: "Group, armor class, stealth, strength" },
];

export function catalogTemplateOption(id: CustomCatalogTemplate): CatalogTemplateOption {
  return CUSTOM_CATALOG_OPTIONS.find((option) => option.id === id)!;
}

/** The element type a catalogue template compiles to. */
export function catalogElementType(template: CustomCatalogTemplate): string {
  return catalogTemplateOption(template).elementType;
}


// ---- weapon filters ------------------------------------------------------------

export interface WeaponFilterTag {
  /** The tag a weapon proficiency (or weapon) carries in its `supports`. */
  id: string;
  label: string;
  group: "Category" | "Property";
}

const PROPERTY_FILTER_LABELS: Readonly<Record<string, string>> = {
  ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED: "Two-handed",
};

/**
 * The tags a choice over weapon proficiencies can filter on. The names mean what the
 * ids mean in the shipped content, so an author picks "Two-handed" and never types an id.
 */
export const WEAPON_FILTER_TAGS: readonly WeaponFilterTag[] = [
  { id: WEAPON_CATEGORY_IDS.simpleMelee, label: "Simple melee", group: "Category" },
  { id: WEAPON_CATEGORY_IDS.simpleRanged, label: "Simple ranged", group: "Category" },
  { id: WEAPON_CATEGORY_IDS.martialMelee, label: "Martial melee", group: "Category" },
  { id: WEAPON_CATEGORY_IDS.martialRanged, label: "Martial ranged", group: "Category" },
  ...WEAPON_PROPERTY_IDS.map((id) => ({
    id,
    label: PROPERTY_FILTER_LABELS[id] ?? titleCase(id.replace("ID_INTERNAL_WEAPON_PROPERTY_", "").toLowerCase()),
    group: "Property" as const,
  })),
];

export const weaponFilterTag = (id: string): WeaponFilterTag | undefined => WEAPON_FILTER_TAGS.find((tag) => tag.id === id);

const weaponTag = (id: string): FilterNode => ({ kind: "tag", value: id });

export interface WeaponFilterPreset {
  id: string;
  label: string;
  node: FilterNode;
}

/**
 * Filters for the words an author uses. Melee and ranged span both categories, and there is no
 * "one-handed" tag in the content: a weapon is one-handed when it lacks the two-handed property.
 */
export const WEAPON_FILTER_PRESETS: readonly WeaponFilterPreset[] = [
  {
    id: "melee",
    label: "Melee weapon",
    node: { kind: "group", op: "any", items: [weaponTag(WEAPON_CATEGORY_IDS.simpleMelee), weaponTag(WEAPON_CATEGORY_IDS.martialMelee)] },
  },
  {
    id: "ranged",
    label: "Ranged weapon",
    node: { kind: "group", op: "any", items: [weaponTag(WEAPON_CATEGORY_IDS.simpleRanged), weaponTag(WEAPON_CATEGORY_IDS.martialRanged)] },
  },
  {
    id: "oneHanded",
    label: "One-handed weapon",
    node: { kind: "group", op: "none", items: [weaponTag("ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED")] },
  },
  { id: "twoHanded", label: "Two-handed weapon", node: weaponTag("ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED") },
];
