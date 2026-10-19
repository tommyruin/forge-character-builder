/**
 * Custom-element drafts (the contract lives in `@forge-cb/api`): the engine's
 * constants and id generation around it.
 *
 * Ids are stable: a draft's `id` is the element id it compiles to, generated
 * once and never derived from the name, so renaming, promoting to a homebrew
 * collection and re-importing never re-id the element.
 */

import {
  CUSTOM_APPEND_TEMPLATE,
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_OVERRIDE_TEMPLATE,
  CUSTOM_SPELL_TEMPLATE,
  type CustomAppendDraft,
  type CustomCatalogDraft,
  type CustomCatalogTemplate,
  type CustomDraft,
  type CustomOverrideDraft,
  type CustomItemDraft,
  type CustomItemTemplate,
  type CustomSpellDraft,
  type CustomTemplate,
  type CustomBackgroundDraft,
  type CustomClassDraft,
  type CustomCompanionDraft,
  type CustomSpeciesDraft,
  type CustomSubclassDraft,
  type CustomSubspeciesDraft,
  type ProgressionFeature,
  type ShowsUnder,
} from "@forge-cb/api";
import { randomUuid } from "../platform.js";

export {
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_TEMPLATES,
  SHOWS_UNDER,
  SHEET_ACTIONS,
  MODIFIER_MODES,
  CUSTOM_ABILITIES,
  CUSTOM_RULESETS,
  CUSTOM_ITEM_TEMPLATES,
  CUSTOM_SPELL_TEMPLATE,
  CUSTOM_CATALOG_TEMPLATES,
  CUSTOM_APPEND_TEMPLATE,
  CUSTOM_OVERRIDE_TEMPLATE,
  WEAPON_CATEGORIES,
  ARMOR_GROUPS,
  isCustomCatalogDraft,
  isCustomAppendDraft,
  isCustomOverrideDraft,
  SPELL_SCHOOLS,
  SPELL_ROLLS,
  ITEM_RARITIES,
  WORN_SLOTS,
  DAMAGE_TYPES,
  WEAPON_PROPERTY_IDS,
  isCustomItemDraft,
  isCustomSpellDraft,
  TRACKER_UNITS,
  TRACKER_RECHARGES,
  SCALE_KINDS,
  CUSTOM_BUILD_TEMPLATES,
  CREATURE_SIZES,
  HIT_DICE,
  SPEED_MODES,
  SLOT_PROGRESSIONS,
  CASTING_STYLES,
  MULTICLASS_SLOT_SHARES,
  PERSONALITY_LIST_NAMES,
  COMPANION_STAT_TARGETS,
  isCustomBuildDraft,
} from "@forge-cb/api";
export type {
  TrackerUnit,
  TrackerRecharge,
  TrackerMax,
  TrackerDef,
  ScaleKind,
  ScaleValue,
  TrackerSourceDto,
  TrackerDto,
  SwitchDto,
  ResourcesDto,
  CustomTemplate,
  ShowsUnder,
  SheetAction,
  ModifierMode,
  CustomAbility,
  CustomRuleset,
  RequirementNode,
  CustomValue,
  EquippedGate,
  ModifierGates,
  ModifierBlock,
  GrantTarget,
  SpellGrantOptions,
  GrantBlock,
  FilterNode,
  ChoiceBlock,
  CustomBlock,
  CustomSheet,
  CustomDraft,
  CustomItemTemplate,
  ItemRarity,
  WornSlot,
  DamageType,
  ItemDamage,
  CustomItemCost,
  CustomItemWeapon,
  CustomItemDraft,
  CustomSpellDraft,
  SpellSchool,
  SpellRoll,
  SpellScaling,
  CantripTier,
  SpellMechanics,
  SpellComponents,
  CustomEntryDraft,
  CustomPackDraft,
  CustomCatalogTemplate,
  CustomCatalogDraft,
  CatalogWeapon,
  CatalogArmor,
  WeaponCategory,
  ArmorGroup,
  CustomAppendDraft,
  CustomOverrideDraft,
  PackFindingDto,
  PackCheckRequest,
  ElementSourceDto,
  BuildSectionKey,
  ContentOrigin,
  DmGrantDto,
  CustomDiagnosticDto,
  CustomDraftEntryDto,
  CustomContentDto,
  CustomDraftMutationDto,
  ChoiceIdentityChangeDto,
  ChoiceIdentityReportDto,
  PromotedCustomElementDto,
  CustomBuildTemplate,
  CustomBuildDraft,
  CustomSpeciesDraft,
  CustomSubspeciesDraft,
  CustomClassDraft,
  CustomSubclassDraft,
  CustomBackgroundDraft,
  CustomCompanionDraft,
  CreatureSize,
  HitDie,
  SpeedMode,
  ProgressionFeature,
  ProgressionFields,
  LineageFields,
  SubspeciesOffer,
  IdLabel,
  ExtraSpeed,
  LanguageSettings,
  HeightWeight,
  Appearance,
  SlotProgression,
  CastingStyle,
  MulticlassSlotShare,
  KnownStep,
  CustomSpellcasting,
  CustomMulticlass,
  SubclassSpells,
  PersonalityListName,
  BackgroundList,
  CompanionEntry,
  CompanionTraitKind,
  CompanionStat,
  CompanionStatTarget,
} from "@forge-cb/api";

/** Every generated element id starts here; the rest is opaque. */
export const CUSTOM_ID_PREFIX = "ID_CUSTOM_";

/** The source name custom elements carry when their author names none. */
export const CUSTOM_SOURCE_NAME = "Custom";

/** The element type of an "other" feature: lands in Build > Other and on the sheet. */
export const CUSTOM_OTHER_TYPE = "Custom Feature";

/** A fresh stable element id: generated once, never derived from a name. */
export function newCustomElementId(): string {
  return `${CUSTOM_ID_PREFIX}${randomUuid().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

/** A fresh id for a block inside a draft. */
export function newCustomBlockId(): string {
  return randomUuid().replaceAll("-", "").slice(0, 10);
}

export function isCustomElementId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/** A blank draft for a template, ready for the form to fill in. */
export function createCustomDraft(template: CustomTemplate, name = ""): CustomDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template,
    name,
    showsUnder: defaultShowsUnder(template),
    description: "",
    blocks: [],
  };
}

/** A blank item draft for a template, ready for the form to fill in. */
export function createCustomItemDraft(template: CustomItemTemplate, name = ""): CustomItemDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template,
    name,
    description: "",
    blocks: [],
  };
}

/** A blank spell draft: a 1st-level evocation with a casting time, range and duration to edit. */
export function createCustomSpellDraft(name = ""): CustomSpellDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: CUSTOM_SPELL_TEMPLATE,
    name,
    description: "",
    level: 1,
    school: "Evocation",
    castingTime: "1 action",
    range: "60 feet",
    duration: "Instantaneous",
    components: { verbal: true, somatic: true },
    mechanics: { roll: "none" },
  };
}

/** A blank catalogue entry (a language, a weapon ...) for a template. */
export function createCustomCatalogDraft(template: CustomCatalogTemplate, name = ""): CustomCatalogDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template,
    name,
    description: "",
    blocks: [],
    ...(template === "baseWeapon"
      ? { weapon: { category: "simpleMelee" as const, damage: { dice: "1d6", type: "slashing" as const }, hands: "onehand" as const } }
      : {}),
    ...(template === "baseArmor" ? { armor: { group: "light" as const, ac: 11 } } : {}),
  };
}

/** A blank addition to an element another file defines. */
export function createCustomAppendDraft(targetId: string, targetName = "", name = ""): CustomAppendDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: CUSTOM_APPEND_TEMPLATE,
    name,
    description: "",
    targetId,
    ...(targetName === "" ? {} : { targetName }),
    blocks: [],
  };
}

/** A replacement for a loaded element, made from a copy of its XML. */
export function createCustomOverrideDraft(options: {
  targetId: string;
  targetType: string;
  baseXml: string;
  name?: string;
  reflavour?: boolean;
}): CustomOverrideDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: options.targetId,
    template: CUSTOM_OVERRIDE_TEMPLATE,
    name: options.name ?? "",
    description: "",
    targetType: options.targetType,
    baseXml: options.baseXml,
    ...(options.reflavour === true ? { reflavour: true } : {}),
  };
}

/** Where a template's entries land unless the author picks otherwise. */
export function defaultShowsUnder(template: CustomTemplate): ShowsUnder {
  switch (template) {
    case "feat":
      return "feats";
    case "racialTrait":
      return "race";
    case "classFeature":
      return "class";
    default:
      return "other";
  }
}


// ---- character options (packs) -----------------------------------------------

const emptyProgression = () => ({ features: [], choices: [], scales: [], blocks: [] });

/** The kind of element a feature inside a class, species or background compiles to. */
export type ProgressionOwner = "class" | "subclass" | "species" | "background";

/** A blank feature inside a progression table, granted at `level`. */
export function createProgressionFeature(owner: ProgressionOwner, level: number, name = ""): ProgressionFeature {
  const draft = createCustomDraft(owner === "species" ? "racialTrait" : owner === "background" ? "feature" : "classFeature", name);
  return { level, draft: { ...draft, showsUnder: owner === "species" ? "race" : owner === "background" ? "other" : "class" } };
}

export function createCustomSpeciesDraft(name = ""): CustomSpeciesDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "species",
    name,
    description: "",
    size: "Medium",
    speed: 30,
    ...emptyProgression(),
  };
}

export function createCustomSubspeciesDraft(
  parent: { id: string; name: string; tag: string } = { id: "", name: "", tag: "" },
  name = "",
  kind: "Sub Race" | "Race Variant" = "Sub Race",
): CustomSubspeciesDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "subspecies",
    name,
    description: "",
    kind,
    parent,
    ...emptyProgression(),
  };
}

export function createCustomClassDraft(name = ""): CustomClassDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "class",
    name,
    description: "",
    hitDie: 8,
    starting: [],
    asiLevels: [4, 8, 12, 16, 19],
    ...emptyProgression(),
  };
}

export function createCustomSubclassDraft(
  parent: { id: string; name: string; tag: string } = { id: "", name: "", tag: "" },
  name = "",
): CustomSubclassDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "subclass",
    name,
    description: "",
    parent,
    ...emptyProgression(),
  };
}

export function createCustomBackgroundDraft(name = ""): CustomBackgroundDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "background",
    name,
    description: "",
    starting: [],
    equipment: [],
    lists: [],
    blocks: [],
  };
}

export function createCustomCompanionDraft(name = ""): CustomCompanionDraft {
  return {
    schemaVersion: CUSTOM_DRAFT_SCHEMA_VERSION,
    id: newCustomElementId(),
    template: "companion",
    name,
    description: "",
    size: "Small",
    creatureType: "Beast",
    alignment: "unaligned",
    challenge: "0",
    armorClass: 10,
    hitPoints: 1,
    speed: 30,
    abilities: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    traits: [],
    actions: [],
    reactions: [],
    stats: [],
  };
}
