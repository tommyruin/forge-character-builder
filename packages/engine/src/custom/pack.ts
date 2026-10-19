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

import { child, childElements, textContent, type Dnd5eDocument, type Dnd5eNode } from "../dnd5e/document.js";
import { removeNodeEdit, type RawEdit } from "../selection/selection.js";
import { CUSTOM_DRAFT_SCHEMA_VERSION, type CustomDraft } from "./schema.js";
import { readCustomDraft } from "./validate.js";

export const BUILDER_BLOCK = "forge-builder";
export const CUSTOM_PACK_NODE = "custom-pack";
export const BUILDER_BLOCK_VERSION = 1;

export interface CustomPackRead {
  /**
   * Every stored entry as JSON, readable or not. Edits rebuild the block from
   * these, so an entry this version cannot read (a newer schema) is carried
   * through untouched instead of being dropped.
   */
  entries: unknown[];
  drafts: CustomDraft[];
  /** Entries the file holds that could not be read, so the caller can say so instead of dropping them silently. */
  problems: Array<{ index: number; message: string }>;
}

function packNode(document: Dnd5eDocument): { block: Dnd5eNode; pack: Dnd5eNode | null } | null {
  const block = child(document.root.node, BUILDER_BLOCK);
  if (block === null) return null;
  return { block, pack: child(block, CUSTOM_PACK_NODE) };
}

/** The drafts a document carries; an absent block reads as none. */
export function readCustomPack(document: Dnd5eDocument): CustomPackRead {
  const found = packNode(document);
  if (found === null || found.pack === null) return { entries: [], drafts: [], problems: [] };
  const text = textContent(found.pack);
  if (text === "") return { entries: [], drafts: [], problems: [] };
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
  const drafts: CustomDraft[] = [];
  const problems: CustomPackRead["problems"] = [];
  const seen = new Set<string>();
  list.forEach((raw: unknown, index: number) => {
    try {
      const draft = readCustomDraft(raw);
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
export function entriesWithDraft(read: CustomPackRead, draft: CustomDraft): unknown[] {
  const at = read.entries.findIndex((entry) => entryId(entry) === draft.id);
  if (at < 0) return [...read.entries, draft];
  return read.entries.map((entry, index) => (index === at ? draft : entry));
}

/** The stored entries without the one holding this id. */
export function entriesWithoutDraft(read: CustomPackRead, draftId: string): unknown[] {
  return read.entries.filter((entry) => entryId(entry) !== draftId);
}

/** CDATA cannot contain its own terminator; split it across two sections. */
function cdata(text: string): string {
  return `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function packElement(entries: readonly unknown[]): string {
  return `<${CUSTOM_PACK_NODE} schema="${CUSTOM_DRAFT_SCHEMA_VERSION}">${cdata(JSON.stringify(entries))}</${CUSTOM_PACK_NODE}>`;
}

/** Byte edits that make the document carry exactly these stored entries. */
export function planCustomPackEdits(document: Dnd5eDocument, drafts: readonly unknown[]): RawEdit[] {
  const found = packNode(document);
  const eol = document.raw.includes("\r\n") ? "\r\n" : "\n";
  if (drafts.length === 0) {
    if (found === null) return [];
    const others = childElements(found.block).filter((node) => node !== found.pack);
    if (others.length === 0) return [removeNodeEdit(document.raw, found.block)];
    return found.pack === null ? [] : [removeNodeEdit(document.raw, found.pack)];
  }
  if (found !== null && found.pack !== null) {
    return [{ start: found.pack.start, end: found.pack.end, replacement: packElement(drafts) }];
  }
  if (found !== null) {
    const close = found.block.closeStart;
    if (close === null) {
      return [{
        start: found.block.start,
        end: found.block.end,
        replacement: `<${BUILDER_BLOCK} version="${BUILDER_BLOCK_VERSION}">${eol}\t\t${packElement(drafts)}${eol}\t</${BUILDER_BLOCK}>`,
      }];
    }
    return [{ start: close, end: close, replacement: `\t${packElement(drafts)}${eol}\t` }];
  }
  const root = document.root.node;
  const close = root.closeStart ?? root.end;
  const block = `\t<${BUILDER_BLOCK} version="${BUILDER_BLOCK_VERSION}">${eol}\t\t${packElement(drafts)}${eol}\t</${BUILDER_BLOCK}>${eol}`;
  return [{ start: close, end: close, replacement: block }];
}
