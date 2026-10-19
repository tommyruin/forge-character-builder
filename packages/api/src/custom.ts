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

export const CUSTOM_TEMPLATES = ["feature", "feat", "racialTrait", "classFeature", "curse", "boon"] as const;
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

/** B1 values: a number, or a reference the engine resolves against the final statistics. */
export type CustomValue =
  | { kind: "number"; value: number }
  | { kind: "reference"; ref: string; negate?: boolean }
  | { kind: "classLevel"; className: string; negate?: boolean };

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
  /** Sheet text about limited uses or charges ("7 charges; regains 1d6+1 at dawn"). Not tracked. */
  uses?: string;
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
