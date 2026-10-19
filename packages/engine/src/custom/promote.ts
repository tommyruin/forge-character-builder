/**
 * Promotion: moving a character's custom draft into a homebrew collection.
 *
 * The collection store belongs to the client (IndexedDB, synced through
 * Drive), so the engine does not write it. It returns the element in the
 * store's own draft shape instead. The id is the draft's stable id, so
 * characters that already carry the entry keep resolving it; `rawXml` holds
 * the compiled element with the collection's source name, which the
 * collection's file emits verbatim; and `customDraft` keeps the form data so
 * the element can be opened in the form again.
 */

import type { CustomDraft, PromotedCustomElementDto } from "@forge-cb/api";
import { randomUuid } from "../platform.js";
import { elementTypeFor } from "./catalogue.js";
import { compileCustomElement } from "./compile.js";

export function promoteCustomDraft(draft: CustomDraft, source: string): PromotedCustomElementDto {
  const xml = compileCustomElement(draft, { source });
  return {
    id: draft.id,
    xml,
    element: {
      localId: randomUuid(),
      type: elementTypeFor(draft.showsUnder),
      name: draft.name,
      description: draft.description,
      sheetText: draft.sheet?.text ?? "",
      prerequisite: "",
      requirements: "",
      requirementRows: [],
      supports: draft.tags ?? [],
      ruleset: draft.ruleset ?? "inherit",
      setters: {},
      stats: [],
      grants: [],
      rawXml: xml,
      id: draft.id,
      idLocked: true,
      customDraft: draft,
    },
  };
}
