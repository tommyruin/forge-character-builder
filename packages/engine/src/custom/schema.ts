/**
 * Custom-element drafts (the contract lives in `@forge-cb/api`): the engine's
 * constants and id generation around it.
 *
 * Ids are stable: a draft's `id` is the element id it compiles to, generated
 * once and never derived from the name, so renaming, promoting to a homebrew
 * collection and re-importing never re-id the element.
 */

import {
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_SPELL_TEMPLATE,
  type CustomDraft,
  type CustomItemDraft,
  type CustomItemTemplate,
  type CustomSpellDraft,
  type CustomTemplate,
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
  SPELL_SCHOOLS,
  SPELL_ROLLS,
  ITEM_RARITIES,
  WORN_SLOTS,
  DAMAGE_TYPES,
  WEAPON_PROPERTY_IDS,
  isCustomItemDraft,
  isCustomSpellDraft,
} from "@forge-cb/api";
export type {
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
