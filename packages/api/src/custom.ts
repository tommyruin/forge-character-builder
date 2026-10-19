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
  | { by: "id"; type: string; id: string }
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
  | { kind: "id"; value: string };

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
  sheet?: CustomSheet;
  blocks: CustomBlock[];
  /** B4: prerequisites that gate the element. */
  requirements?: RequirementNode;
  /** B5: tags the element answers to in pickers (`Origin`, `Epic Boon`, ...). */
  tags?: string[];
  ruleset?: CustomRuleset;
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
  draft: CustomDraft;
  /** The element id (`draft.id`). */
  elementId: string;
  /** The element type the draft compiles to. */
  type: string;
  section: BuildSectionKey;
  /** The element is registered on the character (granted at the top level). */
  granted: boolean;
  /** The compiled element resolves in the library. False when its id collides with book content. */
  installed: boolean;
}

/** `getCustomContent`: the character's pack. */
export interface CustomContentDto extends WireObject {
  entries: CustomDraftEntryDto[];
  /** Stored entries that could not be read, by position; they are kept in the file untouched. */
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
