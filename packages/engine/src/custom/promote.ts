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
  isCustomCatalogDraft,
  isCustomItemDraft,
  isCustomOverrideDraft,
  isCustomSpellDraft,
  type CustomPackDraft,
  type PromotedCustomElementDto,
} from "@forge-cb/api";
import { randomUuid } from "../platform.js";
import { catalogElementType, elementTypeFor } from "./catalogue.js";
import { compileCustomElement } from "./compile.js";

/** The element type a draft compiles to, as a pack lists it. `Append` stands for an addition to another file's element. */
export function packElementType(draft: CustomPackDraft): string {
  if (isCustomSpellDraft(draft)) return "Spell";
  if (isCustomItemDraft(draft)) return draft.template === "gear" ? "Item" : "Magic Item";
  if (isCustomCatalogDraft(draft)) return catalogElementType(draft.template);
  if (isCustomAppendDraft(draft)) return "Append";
  if (isCustomOverrideDraft(draft)) return draft.targetType;
  return elementTypeFor(draft.showsUnder);
}

function packElementSupports(draft: CustomPackDraft): string[] {
  if (isCustomSpellDraft(draft)) return draft.classes ?? [];
  if (isCustomItemDraft(draft) || isCustomOverrideDraft(draft)) return [];
  return draft.tags ?? [];
}

function packElementSheetText(draft: CustomPackDraft): string {
  if (isCustomSpellDraft(draft) || isCustomItemDraft(draft) || isCustomCatalogDraft(draft)) return "";
  if (isCustomAppendDraft(draft) || isCustomOverrideDraft(draft)) return "";
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
