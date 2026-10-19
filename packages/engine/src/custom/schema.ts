/**
 * Custom-element drafts (the contract lives in `@forge-cb/api`): the engine's
 * constants and id generation around it.
 *
 * Ids are stable: a draft's `id` is the element id it compiles to, generated
 * once and never derived from the name, so renaming, promoting to a homebrew
 * collection and re-importing never re-id the element.
 */

import { CUSTOM_DRAFT_SCHEMA_VERSION, type CustomDraft, type CustomTemplate, type ShowsUnder } from "@forge-cb/api";
import { randomUuid } from "../platform.js";

export {
  CUSTOM_DRAFT_SCHEMA_VERSION,
  CUSTOM_TEMPLATES,
  SHOWS_UNDER,
  SHEET_ACTIONS,
  MODIFIER_MODES,
  CUSTOM_ABILITIES,
  CUSTOM_RULESETS,
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
