/**
 * The ids and shapes a new base weapon or armor is written with: the category
 * tags the pickers read, the proficiency element an attack checks, and what each
 * armor group sets (the dexterity cap, the equip slot, the group-wide proficiency).
 */

import type { ArmorGroup, WeaponCategory } from "./schema.js";

export const WEAPON_CATEGORY_IDS: Readonly<Record<WeaponCategory, string>> = {
  simpleMelee: "ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_MELEE",
  simpleRanged: "ID_INTERNAL_WEAPON_CATEGORY_SIMPLE_RANGED",
  martialMelee: "ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE",
  martialRanged: "ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_RANGED",
};

export const WEAPON_CATEGORY_LABELS: Readonly<Record<WeaponCategory, string>> = {
  simpleMelee: "Simple Melee",
  simpleRanged: "Simple Ranged",
  martialMelee: "Martial Melee",
  martialRanged: "Martial Ranged",
};

/**
 * The category-wide proficiency element a character holds when a class grants
 * "Simple Weapons" or "Martial Weapons". An attack adds the proficiency bonus
 * when the weapon's `proficiency` setter names an element the character has.
 */
export const WEAPON_CATEGORY_PROFICIENCY: Readonly<Record<WeaponCategory, string>> = {
  simpleMelee: "ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_MELEE_WEAPONS",
  simpleRanged: "ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_RANGED_WEAPONS",
  martialMelee: "ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_MELEE_WEAPONS",
  martialRanged: "ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_RANGED_WEAPONS",
};

export const VERSATILE_PROPERTY = "ID_INTERNAL_WEAPON_PROPERTY_VERSATILE";

/** The three physical damage types have a support id the weapon pickers read. */
export const DAMAGE_TYPE_SUPPORT_IDS: Readonly<Record<string, string>> = {
  slashing: "ID_INTERNAL_DAMAGE_TYPE_SLASHING",
  piercing: "ID_INTERNAL_DAMAGE_TYPE_PIERCING",
  bludgeoning: "ID_INTERNAL_DAMAGE_TYPE_BLUDGEONING",
};

export const MASTERY_PROPERTY_IDS = [
  "ID_WOTC_PHB24_WEAPON_PROPERTY_CLEAVE",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_GRAZE",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_NICK",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_PUSH",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_SAP",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_SLOW",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_TOPPLE",
  "ID_WOTC_PHB24_WEAPON_PROPERTY_VEX",
] as const;

export interface ArmorGroupDetails {
  id: string;
  label: string;
  /** The `armor` setter: it decides the dexterity cap and the worn state. */
  armor: string;
  slot: string;
  type?: string;
  proficiency: string;
  /** The armor class line the item card shows. */
  display: (ac: number) => string;
}

export const ARMOR_GROUP_DETAILS: Readonly<Record<ArmorGroup, ArmorGroupDetails>> = {
  light: {
    id: "ID_INTERNAL_ARMOR_GROUP_LIGHT",
    label: "Light armor",
    armor: "Light",
    slot: "body",
    proficiency: "ID_PROFICIENCY_ARMOR_PROFICIENCY_LIGHT_ARMOR",
    display: (ac) => `${ac} + Dex modifier`,
  },
  medium: {
    id: "ID_INTERNAL_ARMOR_GROUP_MEDIUM",
    label: "Medium armor",
    armor: "Medium",
    slot: "body",
    proficiency: "ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR",
    display: (ac) => `${ac} + Dex modifier (max 2)`,
  },
  heavy: {
    id: "ID_INTERNAL_ARMOR_GROUP_HEAVY",
    label: "Heavy armor",
    armor: "Heavy",
    slot: "body",
    proficiency: "ID_PROFICIENCY_ARMOR_PROFICIENCY_HEAVY_ARMOR",
    display: (ac) => `${ac}`,
  },
  shield: {
    id: "ID_INTERNAL_ARMOR_GROUP_SHIELD",
    label: "Shield",
    armor: "Shield",
    slot: "onehand,secondary",
    type: "Shield",
    proficiency: "ID_PROFICIENCY_ARMOR_PROFICIENCY_SHIELDS",
    display: (ac) => `+${ac}`,
  },
};
