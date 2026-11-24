/**
 * Finds sheet text whose last line break may fall mid-paragraph.
 *
 * The sheet writer starts a new, indented paragraph at every line break in a
 * feature's `<sheet><description>`, and the content marks an accidental break
 * exactly as it marks a deliberate one. This heuristic flags the likely
 * accidents for review: a plain break before a short closing sentence that
 * opens by pointing back at what came before. Each flagged element is then
 * listed in sheet/text-joins.ts as one to join or one to keep.
 *
 * Used by text-joins.test.ts and scripts/audit-sheet-breaks.mjs.
 */

import type { ElementLibrary } from "../content/library.js";

/** The same split the sheet writer uses to find a feature's paragraphs. */
const PARAGRAPH_BREAK = /(?:\t{2,}|[\r\n]+)/;

/** Openers that refer back to, or carry on from, the paragraph before. */
const CONTINUATION_OPENERS: readonly string[] = [
  "If you have no uses",
  "Once you use",
  "This ",
  "It ",
  "These ",
  "When you do",
  "Alternatively",
  "Otherwise",
  "Additionally",
  "In addition",
  "Also",
];

/** A closing sentence longer than this reads as a rule of its own. */
const MAX_CLOSING_LENGTH = 160;

/** A paragraph that opens a list item or a labelled heading is a deliberate break. */
const STRUCTURED_OPENING = /^(?:[•\-–—*]|\d|(?:[A-Z][\w'’-]*\s){0,4}[A-Z][\w'’-]*[.:]\s)/;

export interface SheetBreakCandidate {
  id: string;
  name: string;
  type: string;
  /** The `level` of the tiered description flagged, when it has one. */
  level?: number;
}

/** The paragraphs the sheet writer would print for `text`. */
export function sheetParagraphs(text: string): string[] {
  return text.split(PARAGRAPH_BREAK).map((part) => part.trim()).filter(Boolean);
}

/** Whether `text` ends in a break that looks like it falls mid-paragraph. */
export function hasSuspectBreak(text: string): boolean {
  const paragraphs = sheetParagraphs(text);
  if (paragraphs.length < 2) return false;
  const closing = paragraphs[paragraphs.length - 1]!;
  if (closing.length >= MAX_CLOSING_LENGTH) return false;
  if (!CONTINUATION_OPENERS.some((opener) => closing.startsWith(opener))) return false;
  if (STRUCTURED_OPENING.test(closing)) return false;
  // One sentence: no sentence end followed by another sentence's capital.
  return closing.split(/(?<=[.!?])["”')]?\s+(?=[A-Z])/).length === 1;
}

/** Every element whose sheet text (any tier) has a suspect break, by id. */
export function findSheetBreakCandidates(library: ElementLibrary): SheetBreakCandidate[] {
  const out: SheetBreakCandidate[] = [];
  for (const element of library.byId.values()) {
    for (const sheet of element.sheets) {
      const flagged = sheet.descriptions.find((description) => hasSuspectBreak(description.text));
      if (flagged === undefined) continue;
      out.push({
        id: element.identity.id,
        name: element.identity.name,
        type: element.identity.type,
        ...(flagged.level === undefined ? {} : { level: flagged.level }),
      });
      break;
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
