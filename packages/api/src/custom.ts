/**
 * The custom-content contract: the draft a form edits and a character file
 * stores, and the DTOs of the RPCs that manage it.
 *
 * A draft is one custom rule (a boon, a feat, a trait ...) as plain, versioned
 * JSON. It is never read by the rules engine: the engine compiles it to an
 * ordinary library element, so statistics, selections, the sheet and the
 * exports need no special case. A draft therefore speaks in the author's
 * terms (menu choices, trees of conditions) and never carries stat keys or
 * expressions the author typed.
 */

import type { WireObject } from "./methods.js";

/** The draft shape version. A draft without one predates versioning and reads as 1. */
export const CUSTOM_DRAFT_SCHEMA_VERSION = 1 as const;

export const CUSTOM_TEMPLATES = ["feature", "feat", "racialTrait", "classFeature", "curse", "boon", "transformation"] as const;
export type CustomTemplate = (typeof CUSTOM_TEMPLATES)[number];

export const SHOWS_UNDER = ["race", "class", "feats", "other"] as const;
export type ShowsUnder = (typeof SHOWS_UNDER)[number];

export const SHEET_ACTIONS = ["none", "action", "bonusAction", "reaction", "attack"] as const;
export type SheetAction = (typeof SHEET_ACTIONS)[number];

export const MODIFIER_MODES = ["add", "setBase", "bestOf", "raiseMax"] as const;
export type ModifierMode = (typeof MODIFIER_MODES)[number];

export const CUSTOM_ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
export type CustomAbility = (typeof CUSTOM_ABILITIES)[number];

export const CUSTOM_RULESETS = ["shared", "2014", "2024"] as const;
export type CustomRuleset = (typeof CUSTOM_RULESETS)[number];

/** B4: a tree of conditions, compiled to the engine's requirement expression. */
export type RequirementNode =
  | { kind: "group"; op: "all" | "any" | "none"; items: RequirementNode[] }
  /** Has (or, with `negate`, lacks) an element or optional rule. `label` is display text only. */
  | { kind: "element"; id: string; negate?: boolean; label?: string }
  /** Has an element of the given type (Class, Feat, ...). */
  | { kind: "elementType"; type: string }
  | { kind: "ability"; ability: CustomAbility; min: number }
  | { kind: "level"; min: number }
  | { kind: "classLevel"; className: string; min: number }
  /** Any statistic at or above `min`; `key` comes from the target catalogue. */
  | { kind: "stat"; key: string; min: number; label?: string };

/**
 * B1 values: a number, or a reference the engine resolves against the final statistics.
 * A reference's `min` is a floor ("Intelligence modifier, at least 1"), applied before `negate`.
 */
export type CustomValue =
  | { kind: "number"; value: number }
  | { kind: "reference"; ref: string; negate?: boolean; min?: number }
  | { kind: "classLevel"; className: string; negate?: boolean }
  /** A scale value of the same draft (B9), by its id: the value the table gives at the owning level. */
  | { kind: "scale"; scale: string; negate?: boolean };

export interface EquippedGate {
  slot: "armor" | "shield" | "primary" | "secondary";
  /** `any`, `none`, an armor weight, `versatile` or a weapon name, by slot. */
  value: string;
  negate?: boolean;
}

export interface ModifierGates {
  /** Applies from this level (the owning class level inside a class, else the character level). */
  level?: number;
  equipped?: EquippedGate[];
  requirements?: RequirementNode;
  /** A named switch: while it is off the modifier stays out of the totals. */
  switch?: string;
}

export interface ModifierBlock {
  kind: "modifier";
  id: string;
  /** A catalogue target id (`CUSTOM_MODIFIER_TARGETS`). */
  target: string;
  mode: ModifierMode;
  /** `bestOf` only: sources naming the same bucket do not stack; the largest counts. */
  bucket?: string;
  value: CustomValue;
  /** An upper bound on the resolved value ("Wisdom modifier, at most 3"). */
  cap?: CustomValue;
  /** `ac:calculation` only: ability modifiers added to the value. */
  addAbilities?: CustomAbility[];
  gates?: ModifierGates;
  /** The name the sheet shows for this contribution. */
  label?: string;
}

export type GrantTarget =
  /** `label` is display text for summaries; the engine reads only the id. */
  | { by: "id"; type: string; id: string; label?: string }
  | { by: "name"; type: string; name: string };

export interface SpellGrantOptions {
  /** The ability the spell is cast with (a feature that grants spells uses one ability). */
  castAbility?: CustomAbility;
  /** Always prepared on `caster`. */
  prepared?: boolean;
  /** A spellcasting feature's name (`Wizard`): the grant joins that caster. */
  caster?: string;
  /** Free-cast text ("1/Long Rest"); shown with the feature's spells. */
  usage?: string;
}

export interface GrantBlock {
  kind: "grant";
  id: string;
  target: GrantTarget;
  level?: number;
  requirements?: RequirementNode;
  spell?: SpellGrantOptions;
  /** A named switch: the grant registers only while it is on. */
  switch?: string;
}

/** B5/B3: a filter over what a choice may offer. */
export type FilterNode =
  | { kind: "group"; op: "all" | "any" | "none"; items: FilterNode[] }
  | { kind: "tag"; value: string }
  | { kind: "level"; value: number }
  | { kind: "school"; value: string }
  /** `label` is display text; the engine reads only the id. */
  | { kind: "id"; value: string; label?: string };

export interface ChoiceBlock {
  kind: "choice";
  id: string;
  /** The element type the player picks (`Language`, `Feat`, `Spell`, ...); `List` for inline items. */
  type: string;
  /** Groups the picks; part of the pick identity. */
  name: string;
  count: number;
  level?: number;
  requirements?: RequirementNode;
  supports?: FilterNode;
  /** An inline text list; the choice's type is then `List`. */
  items?: string[];
  optional?: boolean;
  /** Spell choices: the ability the picked spells are cast with. */
  castAbility?: CustomAbility;
  /** Spell choices: join this spellcasting feature's list. */
  caster?: string;
}

export type CustomBlock = ModifierBlock | GrantBlock | ChoiceBlock;

// ---- trackers and scale values (B7, B9) --------------------------------------

export const TRACKER_UNITS = ["uses", "charges", "minutes", "points"] as const;
export type TrackerUnit = (typeof TRACKER_UNITS)[number];

/**
 * When a tracker is full again. A rest, dawn or a new day refills it by itself;
 * `never` leaves it to the player, and `diceRoll` regains what the dice say
 * (`TrackerDef.regain`), which the player adds back by hand.
 */
export const TRACKER_RECHARGES = ["shortRest", "longRest", "dawn", "day", "never", "diceRoll"] as const;
export type TrackerRecharge = (typeof TRACKER_RECHARGES)[number];

/** How many a tracker holds: a number, or a value that follows the character. */
export type TrackerMax =
  | { kind: "number"; value: number }
  /** A reference from the value menu (proficiency bonus, an ability modifier, level ...); `min` floors it. */
  | { kind: "reference"; ref: string; min?: number }
  | { kind: "classLevel"; className: string }
  /** A scale value of the same draft, by its id. */
  | { kind: "scale"; scale: string }
  /** Any statistic the engine computes (its key comes from the engine, never from typing). */
  | { kind: "stat"; key: string };

/** A limited-use resource: a feature's uses, an item's charges, a pool of points. */
export interface TrackerDef {
  /** Stable for the life of the tracker; the spent count is stored under it. */
  id: string;
  label: string;
  max: TrackerMax;
  unit: TrackerUnit;
  recharge: TrackerRecharge;
  /** `diceRoll` only: what rolling regains ("1d6+1"). */
  regain?: string;
  /** Trackers naming the same pool spend from one count. */
  pool?: string;
  /** Turning this switch on spends one use. */
  spendOnSwitch?: string;
}

export const SCALE_KINDS = ["number", "dice"] as const;
export type ScaleKind = (typeof SCALE_KINDS)[number];

/** A named per-level table: 1d6 at level 1, 2d6 at level 5; or 2 uses at level 1, 3 at level 6. */
export interface ScaleValue {
  id: string;
  /** What the sheet text calls it (`{{scale:name}}`); unique inside the draft. */
  name: string;
  kind: ScaleKind;
  /** From this level on the value applies; the first step is the base. A number step holds a number, a dice step dice text. */
  steps: Array<{ level: number; value: number | string }>;
}

/** B6: how the feature prints on the character sheet. */
export interface CustomSheet {
  /** False hides the feature from the sheet. Default true. */
  show?: boolean;
  /** Printed in place of the element name. */
  title?: string;
  action?: SheetAction;
  usage?: string;
  /** Sheet text; defaults to the description. May use `{{stat}}` tokens. */
  text?: string;
  /** Text that replaces the base text from this level on. */
  tiers?: Array<{ level: number; text: string }>;
}

export interface CustomDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** The element id the draft compiles to. */
  id: string;
  template: CustomTemplate;
  name: string;
  showsUnder: ShowsUnder;
  /** Plain text; blank lines separate paragraphs. */
  description: string;
  /** Free text on where the entry came from (a campaign, a DM); shown beside it in lists. */
  cameFrom?: string;
  sheet?: CustomSheet;
  blocks: CustomBlock[];
  /** B4: prerequisites that gate the element. */
  requirements?: RequirementNode;
  /** B5: tags the element answers to in pickers (`Origin`, `Epic Boon`, ...). */
  tags?: string[];
  ruleset?: CustomRuleset;
  /** B7: limited uses the character tracks; the sheet usage line is written from them. */
  trackers?: TrackerDef[];
  /** B9: named per-level tables the draft's modifiers, trackers and sheet text use. */
  scales?: ScaleValue[];
}

// ---- items -------------------------------------------------------------------

/**
 * Item templates. `weapon` and `armor` lay a magic item over a real base from the
 * library; `worn` is a magic item that is worn; `gear` is a plain item with no
 * rules. An item draft lives in the same character pack as a feature draft and
 * is told apart by its template.
 */
export const CUSTOM_ITEM_TEMPLATES = ["weapon", "armor", "worn", "gear"] as const;
export type CustomItemTemplate = (typeof CUSTOM_ITEM_TEMPLATES)[number];

export const ITEM_RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** Where a worn item sits; the engine files `ring` items under Rings and the rest under Wondrous Items. */
export const WORN_SLOTS = ["head", "neck", "ring", "shoulders", "arms", "hands", "waist", "legs", "feet", "body", "misc"] as const;
export type WornSlot = (typeof WORN_SLOTS)[number];

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
  "psychic", "radiant", "slashing", "thunder",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** The weapon properties an item may give its base weapon (ids of the engine's own property elements). */
export const WEAPON_PROPERTY_IDS = [
  "ID_INTERNAL_WEAPON_PROPERTY_AMMUNITION",
  "ID_INTERNAL_WEAPON_PROPERTY_FINESSE",
  "ID_INTERNAL_WEAPON_PROPERTY_HEAVY",
  "ID_INTERNAL_WEAPON_PROPERTY_LIGHT",
  "ID_INTERNAL_WEAPON_PROPERTY_LOADING",
  "ID_INTERNAL_WEAPON_PROPERTY_REACH",
  "ID_INTERNAL_WEAPON_PROPERTY_THROWN",
  "ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED",
  "ID_INTERNAL_WEAPON_PROPERTY_VERSATILE",
] as const;

/** Damage dice and a damage type: "1d6 cold". */
export interface ItemDamage {
  dice: string;
  type: DamageType;
}

export interface CustomItemCost {
  amount: number;
  currency: "cp" | "sp" | "gp";
}

/** What a magic weapon changes about its base weapon's attacks. */
export interface CustomItemWeapon {
  /** Dice added after the weapon's own damage ("1d8+3 slashing + 1d6 cold"). */
  extraDamage?: ItemDamage[];
  /** The ability attack and damage rolls with this weapon use by default. */
  attackAbility?: CustomAbility;
  /** Replaces the base weapon's damage die and type. */
  damage?: ItemDamage;
  /** The two-handed damage die of a versatile weapon. */
  versatile?: string;
  /** Replaces the base weapon's range ("20/60"). */
  range?: string;
  /** Replaces the base weapon's properties (ids from `WEAPON_PROPERTY_IDS`). */
  properties?: string[];
}

/**
 * A custom item. It compiles to an ordinary Magic Item laid over `base`
 * (weapon, armor), a Magic Item worn on its own (worn) or an Item (gear), so
 * adding it to a character, equipping, attuning and the sheet are the engine's
 * existing paths.
 */
export interface CustomItemDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** The element id the draft compiles to. */
  id: string;
  template: CustomItemTemplate;
  name: string;
  /** Plain text; blank lines separate paragraphs. */
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  /** `weapon` and `armor`: the library element the item sits on. `shield` marks a shield base. */
  base?: { id: string; name: string; shield?: boolean };
  /** `weapon`: the enhancement bonus to attack and damage; `armor`: the bonus to armor class. */
  bonus?: number;
  weapon?: CustomItemWeapon;
  rarity?: ItemRarity;
  /** The item conveys nothing until the wearer attunes to it. */
  attunement?: boolean;
  /** `worn`: where it is worn. */
  slot?: WornSlot;
  /** Text about limited uses or charges ("7 charges; regains 1d6+1 at dawn"), for an item with no tracker. */
  uses?: string;
  /** B7: charges and limited uses the character tracks; the item's text states them. */
  trackers?: TrackerDef[];
  /** Pounds. */
  weight?: number;
  cost?: CustomItemCost;
  /** `gear`: copies share a record, counted by quantity. */
  stackable?: boolean;
  /** What the item does while it is worn (and attuned, when it asks): modifiers, grants and choices. */
  blocks: CustomBlock[];
}

/** True for a draft of the item kind. */
export function isCustomItemDraft(draft: { template?: unknown }): draft is CustomItemDraft {
  return (CUSTOM_ITEM_TEMPLATES as readonly unknown[]).includes(draft.template);
}

// ---- spells ------------------------------------------------------------------

/** The one spell template; a spell draft is told apart from the others by it. */
export const CUSTOM_SPELL_TEMPLATE = "spell" as const;

export const SPELL_SCHOOLS = [
  "Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation",
] as const;
export type SpellSchool = (typeof SPELL_SCHOOLS)[number];

/** What a spell asks of the caster's target or the caster: the attack roll, the save, or nothing. */
export const SPELL_ROLLS = ["none", "attackRanged", "attackMelee", "save"] as const;
export type SpellRoll = (typeof SPELL_ROLLS)[number];

/** A damage-dice tier of a cantrip: from this character level, the first damage term rolls these dice. */
export interface CantripTier {
  level: number;
  dice: string;
}

/** How a spell grows: with the caster's level (cantrips) or with the slot it is cast in. */
export type SpellScaling =
  | { kind: "cantrip"; tiers: CantripTier[] }
  /** The dice each slot level above the spell's own adds. */
  | { kind: "slot"; dice: string };

/**
 * What the spell rolls, in the author's terms. The engine reads these instead of
 * the spell's text for its attack row, so the numbers never depend on wording.
 */
export interface SpellMechanics {
  roll: SpellRoll;
  /** `save` only: the ability the target saves with. */
  saveAbility?: CustomAbility;
  /** `save` only: a successful save still takes half the damage. */
  halfOnSave?: boolean;
  /** One or more damage terms ("1d10 cold"); the first is the one cantrip tiers raise. */
  damage?: ItemDamage[];
  /** Dice the spell restores ("2d8"); never an attack row. */
  healing?: string;
  /** The spellcasting ability modifier joins the damage (or healing). */
  addsModifier?: boolean;
  scaling?: SpellScaling;
}

/** The components a spell asks for. */
export interface SpellComponents {
  verbal?: boolean;
  somatic?: boolean;
  material?: boolean;
  /** What the material component is ("a pinch of salt"). */
  materialText?: string;
}

/**
 * A custom spell. It compiles to an ordinary Spell element: the setters every
 * book spell carries (level, school, time, range, duration, components), the
 * class lists as `supports` tags, and the structured mechanics as the `spell …`
 * setters the attack rows read.
 */
export interface CustomSpellDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** The element id the draft compiles to. */
  id: string;
  template: typeof CUSTOM_SPELL_TEMPLATE;
  name: string;
  /** Plain text; blank lines separate paragraphs. */
  description: string;
  /** The text for casting in a higher slot ("The damage increases by 1d6 ..."). */
  higherLevels?: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  /** 0 is a cantrip. */
  level: number;
  school: SpellSchool;
  castingTime: string;
  range: string;
  duration: string;
  components: SpellComponents;
  concentration?: boolean;
  ritual?: boolean;
  /** Class lists the spell is on: each name becomes a `supports` tag the class's list matches. */
  classes?: string[];
  mechanics?: SpellMechanics;
}

/** Anything the character pack stores. */
export type CustomEntryDraft = CustomDraft | CustomItemDraft | CustomSpellDraft;

// ---- catalogue entries -------------------------------------------------------

/**
 * Templates for the plain reference elements a pack can add to a pickers' list:
 * a language, a proficiency, a vision type, a damage-type or condition entry, a
 * deity, an optional rule, an alignment, a weapon property, and a new base
 * weapon or armor (a magic item sits on one of those). They compile to the
 * element types of the same name; the character's own pack does not hold them,
 * since a character has nothing to attach them to.
 */
export const CUSTOM_CATALOG_TEMPLATES = [
  "language",
  "proficiency",
  "vision",
  "condition",
  "deity",
  "option",
  "alignment",
  "weaponProperty",
  "baseWeapon",
  "baseArmor",
] as const;
export type CustomCatalogTemplate = (typeof CUSTOM_CATALOG_TEMPLATES)[number];

export const WEAPON_CATEGORIES = ["simpleMelee", "simpleRanged", "martialMelee", "martialRanged"] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

export const ARMOR_GROUPS = ["light", "medium", "heavy", "shield"] as const;
export type ArmorGroup = (typeof ARMOR_GROUPS)[number];

/** A new base weapon: what the Weapon template asks for. */
export interface CatalogWeapon {
  category: WeaponCategory;
  damage: ItemDamage;
  /** Two-handed damage die of a versatile weapon ("1d10"). */
  versatile?: string;
  /** "20/60". */
  range?: string;
  hands: "onehand" | "twohand";
  /** Property element ids: the engine's own, or a property the pack or a book defines. */
  properties?: string[];
  /** A 2024 mastery property element id. */
  mastery?: string;
  weight?: number;
  cost?: CustomItemCost;
}

/** A new base armor or shield: what the Armor template asks for. */
export interface CatalogArmor {
  group: ArmorGroup;
  /** Base armor class; for a shield, the bonus it adds. */
  ac: number;
  /** Minimum Strength; speed drops 10 below it. */
  strength?: number;
  stealthDisadvantage?: boolean;
  weight?: number;
  cost?: CustomItemCost;
}

/**
 * A catalogue entry. `tags` are the `supports` the element answers to in pickers
 * (a language's `Standard`, a condition's `Resistance`); `fields` are the named
 * setters the template reads (a deity's `domains`, an alignment's
 * `Abbreviation`). Rules ride in `blocks` like any other draft.
 */
export interface CustomCatalogDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** The element id the draft compiles to. */
  id: string;
  template: CustomCatalogTemplate;
  name: string;
  /** Plain text; blank lines separate paragraphs. */
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  tags?: string[];
  fields?: Record<string, string>;
  weapon?: CatalogWeapon;
  armor?: CatalogArmor;
  /** What the entry does when a character has it. */
  blocks: CustomBlock[];
}

/** True for a draft of the catalogue kind. */
export function isCustomCatalogDraft(draft: { template?: unknown }): draft is CustomCatalogDraft {
  return (CUSTOM_CATALOG_TEMPLATES as readonly unknown[]).includes(draft.template);
}

// ---- character options: species, class, background, companion -------------------

/**
 * Templates for the options a character is built from: a species and its
 * subspecies, a class and its subclass, a background and a companion. Each
 * compiles to a Race / Sub Race / Class / Archetype / Background / Companion
 * element plus the feature elements it grants, in the shapes the bundled rules
 * use, so leveling, selection, spellcasting and the sheet read them like any
 * book option. A character's own pack does not hold them: a character has
 * nothing to attach a class to.
 */
export const CUSTOM_BUILD_TEMPLATES = ["species", "subspecies", "class", "subclass", "background", "companion"] as const;
export type CustomBuildTemplate = (typeof CUSTOM_BUILD_TEMPLATES)[number];

export const CREATURE_SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"] as const;
export type CreatureSize = (typeof CREATURE_SIZES)[number];

export const HIT_DICE = [6, 8, 10, 12] as const;
export type HitDie = (typeof HIT_DICE)[number];

export const SPEED_MODES = ["fly", "swim", "climb", "burrow"] as const;
export type SpeedMode = (typeof SPEED_MODES)[number];

/** A feature authored inside another element, granted at a level (B11). */
export interface ProgressionFeature {
  /** The level it is granted at: a class level inside a class or subclass, the character level inside a species. */
  level: number;
  /** The feature itself, edited with the same form as any custom feature. Its id is its element id. */
  draft: CustomDraft;
}

/**
 * The progression table (B11): features granted by level, choices offered by
 * level and the value columns (B9) the features read, plus the effects the
 * element has as a whole.
 */
export interface ProgressionFields {
  features: ProgressionFeature[];
  /** Player picks offered at a level (each carries its own `level`). */
  choices: ChoiceBlock[];
  /** Value columns of the level table, such as a die that grows. */
  scales: ScaleValue[];
  /** Effects the element has from the level each block names (B1, B2). */
  blocks: CustomBlock[];
}

export interface IdLabel {
  id: string;
  /** Display text; the engine reads only the id. */
  label?: string;
}

export interface ExtraSpeed {
  mode: SpeedMode;
  feet: number;
}

export interface LanguageSettings {
  grants: IdLabel[];
  /** How many more the player picks. */
  choices: number;
  /** Where the picks come from: the common languages, or any language. */
  from?: "standard" | "any";
}

export interface HeightWeight {
  /** `4'6"` and `90 lb.`: the shortest build. */
  base: string;
  /** Dice added on top (`2d10`), or a plain number. */
  modifier: string;
}

export interface Appearance {
  names?: { male?: string; female?: string; child?: string; family?: string };
  namesFormat?: string;
  height?: HeightWeight;
  weight?: HeightWeight;
}

/** What a species and a subspecies share: senses, languages, ability changes, extra speeds and appearance setters. */
export interface LineageFields extends ProgressionFields {
  /** Vision elements granted (darkvision ...). */
  vision?: IdLabel[];
  languages?: LanguageSettings;
  /** Fixed increases (2014 rules); they switch off under a background that grants the increase (2024). */
  abilityBonuses?: Array<{ ability: CustomAbility; amount: number }>;
  /** The player assigns this many +1 points among `from` (all six when omitted). */
  abilityChoice?: { picks: number; from?: CustomAbility[] };
  speeds?: ExtraSpeed[];
  appearance?: Appearance;
}

/** What makes a species offer a subspecies (Sub Race) or a variant (Race Variant) pick. */
export interface SubspeciesOffer {
  kind: "Sub Race" | "Race Variant";
  /** The tag subspecies answer to; the species' name when omitted. */
  tag?: string;
  /** The pick's name ("Elven Subrace"); defaults to the species name and the kind. */
  label?: string;
  /** A variant is usually optional; a subrace is not. */
  optional?: boolean;
}

export interface CustomSpeciesDraft extends LineageFields {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "species";
  name: string;
  /** Plain text; blank lines separate paragraphs. */
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  size: CreatureSize;
  /** Walking speed in feet. */
  speed: number;
  subspecies?: SubspeciesOffer;
}

export interface CustomSubspeciesDraft extends LineageFields {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "subspecies";
  name: string;
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  kind: "Sub Race" | "Race Variant";
  /** The species it belongs to; `tag` is what the species' pick answers to. */
  parent: { id: string; name: string; tag: string };
  /** Added to the walking speed. */
  speedBonus?: number;
}

export const SLOT_PROGRESSIONS = ["full", "half", "third", "pact", "custom"] as const;
export type SlotProgression = (typeof SLOT_PROGRESSIONS)[number];

export const CASTING_STYLES = ["prepared", "known", "spellbook"] as const;
export type CastingStyle = (typeof CASTING_STYLES)[number];

export const MULTICLASS_SLOT_SHARES = ["full", "half", "third", "solo", "none"] as const;
export type MulticlassSlotShare = (typeof MULTICLASS_SLOT_SHARES)[number];

export interface KnownStep {
  /** From this class level the total is `known`. */
  level: number;
  known: number;
}

/** B10: a class or subclass that casts spells. */
export interface CustomSpellcasting {
  /** The spellcasting feature's name; defaults to the class (or subclass) name. */
  casterName?: string;
  ability: CustomAbility;
  /** `prepared` prepares from the whole list, `known` knows a fixed set, `spellbook` prepares from a book. */
  style: CastingStyle;
  /** A known caster may swap one spell when it gains a level. */
  allowReplace?: boolean;
  /** Ritual casting. */
  ritual?: boolean;
  /** The tag the spell list answers to; the class name when omitted. */
  listTag?: string;
  /** Narrows the list (a school filter for a third-caster). */
  listFilter?: FilterNode;
  slots: {
    progression: SlotProgression;
    /** `custom` only: slots of each level (1-9) at each class level (1-20), as totals. */
    table?: number[][];
  };
  /** What a multiclass character counts from this class toward shared slots; follows the progression when omitted. */
  multiclassSlots?: MulticlassSlotShare;
  /** How many spells are prepared: the ability modifier and/or the class level (or a part of it). */
  prepare?: { ability?: boolean; level?: "full" | "half" | "halfUp" };
  cantrips?: KnownStep[];
  spells?: KnownStep[];
}

export interface CustomMulticlass {
  /** What taking a level in this class asks of the character (ability scores). */
  requirements?: RequirementNode;
  /** The proficiencies the text names, as the class page prints them. */
  summary?: string;
  /** Proficiencies and picks gained when this is not the first class. */
  blocks: CustomBlock[];
}

export interface CustomClassDraft extends ProgressionFields {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "class";
  name: string;
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  hitDie: HitDie;
  /** One line for the class picker. */
  short?: string;
  /** Proficiencies and picks of the first class only (skills, armor, saves): grants (B2) and choices (B3). */
  starting: CustomBlock[];
  /**
   * The level the player picks a subclass at, and what the pick is called
   * ("Arcane Tradition"). The label is also the tag subclasses answer to, so it
   * stays stable once subclasses exist; it reads "<class> Subclass" when omitted.
   */
  subclass?: { level: number; label?: string };
  /** Levels that offer an ability score increase or a feat. */
  asiLevels: number[];
  spellcasting?: CustomSpellcasting;
  multiclass?: CustomMulticlass;
}

/** How a subclass relates to its class' spells. */
export interface SubclassSpells {
  /** The class' spellcasting feature name (`Wizard`), for spells the subclass prepares and adds. */
  caster: string;
  /** Spells always prepared from a class level. */
  alwaysPrepared: Array<{ level: number; spell: IdLabel }>;
  /** Spells added to the class list for every character of the class (an append to the spell). */
  addToList: IdLabel[];
  /** The list tag the added spells take; the parent class name when omitted. */
  listTag?: string;
}

export interface CustomSubclassDraft extends ProgressionFields {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "subclass";
  name: string;
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  /** The class it belongs to; `tag` is what the class' subclass pick answers to. */
  parent: { id: string; name: string; tag: string };
  /** Spells added to the parent's list; or the subclass casts on its own (`spellcasting`). */
  spells?: SubclassSpells;
  spellcasting?: CustomSpellcasting;
}

export const PERSONALITY_LIST_NAMES = ["Personality Trait", "Ideal", "Bond", "Flaw"] as const;
export type PersonalityListName = (typeof PERSONALITY_LIST_NAMES)[number];

export interface BackgroundList {
  /** The sheet fills its personality, ideals, bonds and flaws boxes from lists of exactly these names. */
  name: PersonalityListName;
  /** How many the player picks. */
  count: number;
  items: string[];
}

export interface CustomBackgroundDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "background";
  name: string;
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  /** Proficiencies and languages: grants (B2) and choices (B3). */
  starting: CustomBlock[];
  /** Starting equipment, one line each; backgrounds list it in their text. */
  equipment: string[];
  /** The background feature, authored here because it cannot be added on its own. */
  feature?: CustomDraft;
  lists: BackgroundList[];
  /** 2024: the three abilities the background raises (the player assigns +2/+1 or +1/+1/+1). */
  abilityChoice?: CustomAbility[];
  /** 2024: the origin feat. */
  originFeat?: IdLabel;
  blocks: CustomBlock[];
}

export type CompanionTraitKind = "traits" | "actions" | "reactions";

/** A trait, action or reaction of a companion's stat block. */
export interface CompanionEntry {
  id: string;
  name: string;
  text: string;
}

export const COMPANION_STAT_TARGETS = [
  "companion:ac",
  "companion:attack",
  "companion:damage",
  "companion:proficiency",
  "companion:initiative",
  "companion:hp:max",
] as const;
export type CompanionStatTarget = (typeof COMPANION_STAT_TARGETS)[number];

/** A companion statistic that follows its owner (hit points = 5 x level, armor class = 10 + proficiency ...). */
export interface CompanionStat {
  id: string;
  target: CompanionStatTarget;
  mode: "add" | "set";
  value: CustomValue;
}

export interface CustomCompanionDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  id: string;
  template: "companion";
  name: string;
  description: string;
  cameFrom?: string;
  ruleset?: CustomRuleset;
  /** The tags pickers filter on (`Familiar`). */
  tags?: string[];
  size: CreatureSize;
  creatureType: string;
  alignment: string;
  /** `1/2`, `0`, `3`. */
  challenge: string;
  armorClass: number;
  hitPoints: number;
  /** Printed hit points ("19 (3d8+6)"); the number when omitted. */
  hitPointsText?: string;
  speed: number;
  speeds?: ExtraSpeed[];
  abilities: Record<CustomAbility, number>;
  senses?: string;
  languages?: string;
  skills?: string;
  saves?: string;
  resistances?: string;
  immunities?: string;
  vulnerabilities?: string;
  conditionImmunities?: string;
  traits: CompanionEntry[];
  actions: CompanionEntry[];
  reactions: CompanionEntry[];
  stats: CompanionStat[];
}

export type CustomBuildDraft =
  | CustomSpeciesDraft
  | CustomSubspeciesDraft
  | CustomClassDraft
  | CustomSubclassDraft
  | CustomBackgroundDraft
  | CustomCompanionDraft;

/** True for a draft of the character-option kind. */
export function isCustomBuildDraft(draft: { template?: unknown }): draft is CustomBuildDraft {
  return (CUSTOM_BUILD_TEMPLATES as readonly unknown[]).includes(draft.template);
}

// ---- appends and overrides ---------------------------------------------------

/** The template of a draft that adds rules or tags to an element another file defines. */
export const CUSTOM_APPEND_TEMPLATE = "append" as const;

/**
 * Adds to an element a book (or another pack) defines, without redefining it: its
 * rules and tags join the target's. It compiles to a top-level `<append id>`; put a
 * homebrew spell on a class list by adding the class's name as a tag.
 */
export interface CustomAppendDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** This entry's own id in the pack; the element it adds to is `targetId`. */
  id: string;
  template: typeof CUSTOM_APPEND_TEMPLATE;
  /** What the pack calls this addition ("Frost Lance on the Druid list"). */
  name: string;
  description: string;
  cameFrom?: string;
  targetId: string;
  /** The target's name, for lists and summaries. */
  targetName?: string;
  tags?: string[];
  blocks: CustomBlock[];
}

export function isCustomAppendDraft(draft: { template?: unknown }): draft is CustomAppendDraft {
  return draft.template === CUSTOM_APPEND_TEMPLATE;
}

/** The template of a draft that redefines an element another file defines. */
export const CUSTOM_OVERRIDE_TEMPLATE = "override" as const;

/**
 * Redefines a book element under its own id: a house rule (the author edits the
 * element's XML) or a reflavour (a new name and text over the same rules). The
 * element is carried as a copy of the original's XML, so what it does is exactly
 * what the book's did until the author changes it.
 */
export interface CustomOverrideDraft {
  schemaVersion: typeof CUSTOM_DRAFT_SCHEMA_VERSION;
  /** The id of the element it replaces; the element keeps it. */
  id: string;
  template: typeof CUSTOM_OVERRIDE_TEMPLATE;
  /** The name it takes; the original's when omitted. */
  name: string;
  /** New text (plain, blank lines between paragraphs); the original's when empty. */
  description: string;
  cameFrom?: string;
  /** True for a reflavour: the rules are the original's and the form hides them. */
  reflavour?: boolean;
  /** The element type being replaced. */
  targetType: string;
  /** The `<element>` XML the replacement is made from. */
  baseXml: string;
  ruleset?: CustomRuleset;
}

export function isCustomOverrideDraft(draft: { template?: unknown }): draft is CustomOverrideDraft {
  return draft.template === CUSTOM_OVERRIDE_TEMPLATE;
}

/**
 * Anything a homebrew pack stores. A character's own pack holds the first three
 * kinds (`CustomEntryDraft`): a character has nothing to attach a language, a
 * class or a book override to.
 */
export type CustomPackDraft = CustomEntryDraft | CustomCatalogDraft | CustomAppendDraft | CustomOverrideDraft | CustomBuildDraft;

/** True for a draft of the spell kind. */
export function isCustomSpellDraft(draft: { template?: unknown }): draft is CustomSpellDraft {
  return draft.template === CUSTOM_SPELL_TEMPLATE;
}

// ---- RPC payloads ------------------------------------------------------------

/** The Build tab sections an entry can land in (the client's `BUILD_SECTIONS` keys, plus Other). */
export type BuildSectionKey =
  | "race"
  | "class"
  | "background"
  | "abilities"
  | "languages"
  | "proficiencies"
  | "feats"
  | "other";

/** Where an element comes from: a book, the character's own pack, or a homebrew collection. */
export type ContentOrigin = "book" | "character" | "homebrew";

/**
 * One granted element of a character. `kind` keeps the established values
 * (`spell`, `feat`, `ability`) and adds `feature` for every other feature
 * type, so a client that only knows the old kinds still lists feats correctly.
 */
export interface DmGrantDto extends WireObject {
  kind: "spell" | "feat" | "ability" | "feature";
  id: string;
  name: string;
  source: string;
  /** The element type (`Racial Trait`, `Feat`, `Spell` ...). */
  type: string;
  /** True for content made in the builder: a character's own pack or a homebrew collection. */
  isCustom: boolean;
  origin: ContentOrigin;
  /** The Build section the element belongs in; null for spells, which have their own tab. */
  section: BuildSectionKey | null;
}

/** An entry the builder reports on instead of dropping it silently. */
export interface CustomDiagnosticDto extends WireObject {
  kind: "missing-grant" | "skipped" | "unreadable";
  message: string;
  elementId?: string;
  missingId?: string;
  /** The element type the rule wants (`Spell`), when it says. */
  missingType?: string;
}

/** One custom draft on a character, with what the engine knows about it. */
export interface CustomDraftEntryDto extends WireObject {
  /** A feature draft is granted in Build; an item draft is carried in the inventory; a spell draft is known to a caster. */
  kind: "feature" | "item" | "spell";
  draft: CustomEntryDraft;
  /** The element id (`draft.id`). */
  elementId: string;
  /** The element type the draft compiles to. */
  type: string;
  /** The Build section a feature lands in; `other` for an item or a spell, which Build never lists. */
  section: BuildSectionKey;
  /**
   * A feature is registered on the character (granted at the top level); an
   * item is in the inventory; a spell is known to the character (granted to a
   * caster, or picked from its list).
   */
  granted: boolean;
  /** The compiled element resolves in the library. False when its id collides with book content. */
  installed: boolean;
}

/** `getCustomContent`: the character's pack. */
export interface CustomContentDto extends WireObject {
  entries: CustomDraftEntryDto[];
  /**
   * Stored entries that could not be read, by position; they are kept in the
   * file untouched. Index -1 means the whole block is unreadable, and saving
   * is refused until it is repaired.
   */
  problems: Array<{ index: number; message: string }>;
}

/** `saveCustomDraft` and `deleteCustomDraft` results. */
export interface CustomDraftMutationDto extends WireObject {
  /** The character detail after the change, like every other mutation. */
  character: WireObject;
  content: CustomContentDto;
  /** The saved entry; null after a delete. */
  entry: CustomDraftEntryDto | null;
  diagnostics: CustomDiagnosticDto[];
}

/** A choice whose pick identity a draft change would alter. */
export interface ChoiceIdentityChangeDto extends WireObject {
  /** The choice block's id. */
  blockId: string;
  /** The choice as it is now, for the warning text. */
  name: string;
  type: string;
  change: "removed" | "changed";
  /** Which parts of the identity differ: name, type, level, count or supports. */
  fields: Array<"name" | "type" | "level" | "count" | "supports">;
  /** Pick slots (1-based) that stop matching any choice after the change. */
  orphanedSlots: number[];
  /** Picks currently made under the orphaned slots, across every loaded character. */
  picks: Array<{ characterId: string; slot: number; elementId: string; elementName: string }>;
}

/** `getChoiceIdentityImpact`. */
export interface ChoiceIdentityReportDto extends WireObject {
  changes: ChoiceIdentityChangeDto[];
  /** True when any loaded character has a pick that would be orphaned. */
  hasPicks: boolean;
}

/** `promoteCustomDraft`: what the client stores to move a draft into a homebrew collection. */
export interface PromotedCustomElementDto extends WireObject {
  /** The element id, unchanged by promotion. */
  id: string;
  /** The compiled `<element>`, carrying the target source name. */
  xml: string;
  /**
   * The element in the homebrew editor's draft shape: `rawXml` holds `xml`,
   * `id` is the stable id with `idLocked` set, and `customDraft` keeps the
   * full draft so the element can be edited with the form again.
   */
  element: WireObject;
}

/** The attack row a custom weapon would give the character, as `getAttacks` prints it. */
export interface CustomItemAttackPreviewDto extends WireObject {
  name: string;
  range: string;
  bonus: string;
  damage: string;
  description: string;
}

/** `previewCustomItem`: what an item draft would do for this character, without saving it. */
export interface CustomItemPreviewDto extends WireObject {
  /** The weapon's attack row once wielded and attuned; null for anything that is not a weapon. */
  attack: CustomItemAttackPreviewDto | null;
}

/** The attack or save row a custom spell would give the character, as the attack options print it. */
export interface CustomSpellAttackPreviewDto extends WireObject {
  casterName: string;
  /** "+5 INT vs AC" for an attack roll, "DC 13 DEX" for a save. */
  bonus: string;
  damage: string;
  range: string;
  /** Decisions the player still has to make (casting in a higher slot). */
  warning: string | null;
}

/** `previewCustomSpell`: what a spell draft would do for this character, without saving it. */
export interface CustomSpellPreviewDto extends WireObject {
  /** The spell's attack or save row; null when the spell is no attack. */
  attack: CustomSpellAttackPreviewDto | null;
}

/**
 * A grant, a choice default or a DM-granted spell the character holds that
 * resolves to no element: content the library lacks, so the grant does nothing.
 */
export interface MissingGrantDto extends WireObject {
  /** The element whose rule names the missing one; empty for a spell granted straight to the character. */
  elementId: string;
  elementName: string;
  /** The id (or `Type "Name"`) nothing defines. */
  missingId: string;
  /** The type the rule wants (`Spell`); null when it does not say. */
  missingType: string | null;
  message: string;
}

// ---- resources (trackers, switches) --------------------------------------------

/** Where a tracker comes from, for the label on its card. */
export interface TrackerSourceDto extends WireObject {
  name: string;
  kind: "book" | "custom" | "manual";
  /** The feature or item element, when the tracker belongs to one. */
  elementId?: string;
}

/** One resource of the character, with its current count. */
export interface TrackerDto extends WireObject {
  /** What a spend is stored under: the tracker's id, or `pool:<name>` for a shared pool. */
  id: string;
  label: string;
  /** Every feature or item that spends it (more than one for a shared pool). */
  sources: TrackerSourceDto[];
  /** Made in the builder (a custom entry or a manual tracker). */
  isCustom: boolean;
  /** Added by hand on the Resources page; it can be edited and removed there. */
  manual: boolean;
  max: number;
  used: number;
  remaining: number;
  unit: TrackerUnit;
  recharge: TrackerRecharge;
  /** "per Long Rest", "regains 1d6+1 at dawn" ... */
  rechargeLabel: string;
  regain?: string;
  /** The pool's name, for a shared pool. */
  pool?: string;
  /** The switch whose turning on spends one use of it. */
  spendOnSwitch?: string;
  /** A manual tracker's own definition, for editing. */
  def?: TrackerDef;
  /**
   * Whether the player tracks it. An untracked one is still listed, so it can
   * be tracked again, but is left off the sheet, out of rests and out of what a
   * switch spends; its spent count is kept for when it is tracked again.
   */
  tracked: boolean;
}

/** A named on/off switch and what turning it on does. */
export interface SwitchDto extends WireObject {
  name: string;
  on: boolean;
  /** The features that apply only while it is on. */
  sources: string[];
  /** The label of the tracker one use of which turning it on spends. */
  spends?: string;
}

/** `getResources` and the results of every resource mutation. */
export interface ResourcesDto extends WireObject {
  trackers: TrackerDto[];
  switches: SwitchDto[];
}

// ---- pack health ---------------------------------------------------------------

/**
 * One thing wrong (or worth knowing) about a pack's content file, found without
 * loading it. `overrides` is not a fault: the pack replaces a loaded element on
 * purpose. `missing-base` is a Magic Item whose type line says Weapon or Armor
 * but that names no base weapon or armour, so it cannot be wielded or worn as
 * one.
 */
export interface PackFindingDto extends WireObject {
  kind: "missing-grant" | "duplicate-id" | "unattachable" | "missing-base" | "append-target" | "invalid-requirements" | "overrides";
  message: string;
  /** The pack element the finding is about. */
  elementId?: string;
  elementName?: string;
  /**
   * missing-grant: the id (or `Type "Name"`) nothing defines, and the type the rule wants.
   * missing-base: `missingType` alone, the type of the base the item lacks (`Weapon` or `Armor`).
   */
  missingId?: string;
  missingType?: string;
  /** append-target: the element the append names. */
  targetId?: string;
  /** duplicate-id and overrides: the other file that defines the id. */
  otherFile?: string;
}

/** `checkPackContent`: checks a pack's compiled file against the loaded library without loading it. */
export interface PackCheckRequest extends WireObject {
  /** The path the pack is (or will be) stored under; its own library copies are not counted. */
  path: string;
  xml: string;
  /** Element ids the pack replaces on purpose (a changed book element); reported as `overrides`, not as duplicates. */
  overrides?: string[];
}

/** `getElementSource`: a loaded element as `<element>` XML, ready to be changed or reflavoured in a pack. */
export interface ElementSourceDto extends WireObject {
  id: string;
  name: string;
  type: string;
  source: string;
  /** The element's XML, or null when a copy would lose structure (see `reason`). */
  xml: string | null;
  reason?: string;
}
