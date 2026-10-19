/**
 * The character pack as it is stored: inside the character's own `.dnd5e`
 * document, in one builder-owned block.
 *
 * ```xml
 * <forge-builder version="1">
 *   <custom-pack schema="1"><![CDATA[ [ {draft}, {draft} ] ]]></custom-pack>
 * </forge-builder>
 * ```
 *
 * `forge-builder` is the single element name the builder reserves at the root
 * of a character file; later builder-only data (resource trackers, switches)
 * becomes further children of it rather than new root elements. The pack is
 * the drafts as JSON, not compiled XML: the drafts are the source of truth and
 * the element XML is derived from them every time a character loads, so a
 * compiler improvement reaches old files and a file can never disagree with
 * its own drafts.
 *
 * A file without the block is never touched: adding the first draft inserts
 * the block before the root's closing tag, and removing the last one removes
 * it again, leaving the original bytes.
 */

import type { Dnd5eDocument } from "../dnd5e/document.js";
import {
  BUILDER_BLOCK,
  BUILDER_BLOCK_VERSION,
  builderChildText,
  cdata,
  planBuilderChildEdits,
} from "../dnd5e/builder-block.js";
import type { RawEdit } from "../selection/selection.js";
import { CUSTOM_DRAFT_SCHEMA_VERSION, type CustomEntryDraft } from "./schema.js";
import { readCustomEntry } from "./validate.js";

export { BUILDER_BLOCK, BUILDER_BLOCK_VERSION };
export const CUSTOM_PACK_NODE = "custom-pack";

export interface CustomPackRead {
  /**
   * Every stored entry as JSON, readable or not. Edits rebuild the block from
   * these, so an entry this version cannot read (a newer schema) is carried
   * through untouched instead of being dropped.
   */
  entries: unknown[];
  drafts: CustomEntryDraft[];
  /** Entries the file holds that could not be read, so the caller can say so instead of dropping them silently. */
  problems: Array<{ index: number; message: string }>;
}

/** The drafts a document carries; an absent block reads as none. */
export function readCustomPack(document: Dnd5eDocument): CustomPackRead {
  const text = builderChildText(document, CUSTOM_PACK_NODE);
  if (text === null || text === "") return { entries: [], drafts: [], problems: [] };
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch (cause) {
    return {
      entries: [],
      drafts: [],
      problems: [{ index: -1, message: `the custom content block is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})` }],
    };
  }
  if (!Array.isArray(list)) {
    return { entries: [], drafts: [], problems: [{ index: -1, message: "the custom content block is not a list" }] };
  }
  const drafts: CustomEntryDraft[] = [];
  const problems: CustomPackRead["problems"] = [];
  const seen = new Set<string>();
  list.forEach((raw: unknown, index: number) => {
    try {
      const draft = readCustomEntry(raw);
      if (seen.has(draft.id)) {
        problems.push({ index, message: `'${draft.name}' repeats the id of an earlier entry` });
        return;
      }
      seen.add(draft.id);
      drafts.push(draft);
    } catch (cause) {
      problems.push({ index, message: (cause as { message?: string }).message ?? "unreadable entry" });
    }
  });
  return { entries: list, drafts, problems };
}

const entryId = (entry: unknown): string | undefined =>
  typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
    ? (entry as { id: string }).id
    : undefined;

/** The stored entries with this draft in place of the one sharing its id, or appended. */
export function entriesWithDraft(read: CustomPackRead, draft: CustomEntryDraft): unknown[] {
  const at = read.entries.findIndex((entry) => entryId(entry) === draft.id);
  if (at < 0) return [...read.entries, draft];
  return read.entries.map((entry, index) => (index === at ? draft : entry));
}

/** The stored entries without the one holding this id. */
export function entriesWithoutDraft(read: CustomPackRead, draftId: string): unknown[] {
  return read.entries.filter((entry) => entryId(entry) !== draftId);
}

function packElement(entries: readonly unknown[]): string {
  return `<${CUSTOM_PACK_NODE} schema="${CUSTOM_DRAFT_SCHEMA_VERSION}">${cdata(JSON.stringify(entries))}</${CUSTOM_PACK_NODE}>`;
}

/** Byte edits that make the document carry exactly these stored entries. */
export function planCustomPackEdits(document: Dnd5eDocument, drafts: readonly unknown[]): RawEdit[] {
  return planBuilderChildEdits(document, CUSTOM_PACK_NODE, drafts.length === 0 ? null : packElement(drafts));
}
