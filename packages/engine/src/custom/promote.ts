/**
 * Promotion: moving a custom draft into a homebrew pack.
 *
 * The pack store belongs to the client (IndexedDB, synced through Drive), so
 * the engine does not write it. It returns the element in the store's own draft
 * shape instead. The id is the draft's stable id, so characters that already
 * carry the entry keep resolving it; `rawXml` holds the compiled element with
 * the pack's source name; and `customDraft` keeps the form data so the element
 * can be opened in the form again. The same shape serves every kind of draft a
 * pack holds, so an element made in the Homebrew editor and one promoted from a
 * character are the same thing.
 */

import {
  isCustomAppendDraft,
  isCustomBuildDraft,
  isCustomCatalogDraft,
  isCustomItemDraft,
  isCustomOverrideDraft,
  isCustomSpellDraft,
  type CustomBuildDraft,
  type CustomPackDraft,
  type PromotedCustomElementDto,
} from "@forge-cb/api";
import { randomUuid } from "../platform.js";
import { catalogElementType, elementTypeFor } from "./catalogue.js";
import { compileCustomElement } from "./compile.js";
import { CUSTOM_ID_PREFIX } from "./schema.js";
import { pickTags } from "./validate-build.js";

/** The element type each character option compiles to (a subspecies is a Sub Race or a Race Variant, by its kind). */
const BUILD_ELEMENT_TYPES: Partial<Record<CustomBuildDraft["template"], string>> = {
  species: "Race",
  class: "Class",
  subclass: "Archetype",
  background: "Background",
  companion: "Companion",
};

/** The element type a draft compiles to, as a pack lists it. `Append` stands for an addition to another file's element. */
export function packElementType(draft: CustomPackDraft): string {
  if (isCustomSpellDraft(draft)) return "Spell";
  if (isCustomItemDraft(draft)) return draft.template === "gear" ? "Item" : "Magic Item";
  if (isCustomCatalogDraft(draft)) return catalogElementType(draft.template);
  if (isCustomAppendDraft(draft)) return "Append";
  if (isCustomOverrideDraft(draft)) return draft.targetType;
  if (isCustomBuildDraft(draft)) return BUILD_ELEMENT_TYPES[draft.template] ?? (draft.template === "subspecies" ? draft.kind : "");
  return elementTypeFor(draft.showsUnder);
}

function packElementSupports(draft: CustomPackDraft): string[] {
  if (isCustomSpellDraft(draft)) return draft.classes ?? [];
  if (isCustomItemDraft(draft) || isCustomOverrideDraft(draft)) return [];
  if (isCustomBuildDraft(draft)) {
    if (draft.template === "subspecies" || draft.template === "subclass") return pickTags(draft.parent.tag) ?? [draft.parent.tag];
    return draft.template === "companion" ? (draft.tags ?? []) : [];
  }
  return draft.tags ?? [];
}

function packElementSheetText(draft: CustomPackDraft): string {
  if (isCustomSpellDraft(draft) || isCustomItemDraft(draft) || isCustomCatalogDraft(draft)) return "";
  if (isCustomAppendDraft(draft) || isCustomOverrideDraft(draft) || isCustomBuildDraft(draft)) return "";
  return draft.sheet?.text ?? "";
}

/**
 * The element a pack stores for a draft, compiled under the pack's source name.
 *
 * `tolerant` is for an editor holding a draft that is not finished (no name yet, an
 * addition that adds nothing): the element is still made, with no XML until the
 * draft compiles, so the form keeps working and nothing is lost between keystrokes.
 */
export function packElementFor(
  draft: CustomPackDraft,
  source: string,
  options: { tolerant?: boolean } = {},
): PromotedCustomElementDto["element"] {
  let xml: string;
  try {
    xml = compileCustomElement(draft, { source });
  } catch (cause) {
    if (options.tolerant !== true) throw cause;
    xml = "";
  }
  return {
    localId: randomUuid(),
    type: packElementType(draft),
    name: draft.name,
    description: draft.description,
    sheetText: packElementSheetText(draft),
    prerequisite: "",
    requirements: "",
    requirementRows: [],
    supports: packElementSupports(draft),
    ruleset: ("ruleset" in draft ? draft.ruleset : undefined) ?? "inherit",
    setters: {},
    stats: [],
    grants: [],
    rawXml: xml,
    id: draft.id,
    idLocked: true,
    customDraft: draft,
  };
}

export function promoteCustomDraft(draft: CustomPackDraft, source: string): PromotedCustomElementDto {
  const element = packElementFor(draft, source);
  return { id: draft.id, xml: element.rawXml as string, element };
}

const CUSTOM_ID_IN_TEXT = new RegExp(`\\b${CUSTOM_ID_PREFIX}[A-Z0-9_]+\\b`, "g");

/**
 * The other builder-made elements a draft refers to: what it grants, offers as
 * a pick, sits under (a subclass's class) or adds to. Promoting the draft alone
 * would leave those references pointing at nothing in the pack, so a caller
 * offers to bring them along. Elements the draft carries inside itself (the
 * features of a class, the feature of a background) are part of it already and
 * are not listed. The draft is read as data, so every kind of block is covered
 * without the walk knowing the kinds.
 */
export function linkedCustomIds(draft: CustomPackDraft): string[] {
  const defined = new Set<string>();
  const referred = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(CUSTOM_ID_IN_TEXT)) referred.add(match[0]);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      // A nested draft names its own element; it is defined here, not referred to.
      if (typeof record.id === "string" && typeof record.template === "string") defined.add(record.id);
      for (const entry of Object.values(record)) visit(entry);
    }
  };
  visit(draft);
  defined.add(draft.id);
  return [...referred].filter((id) => !defined.has(id));
}
