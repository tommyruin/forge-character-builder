/**
 * Every feature the sheet-break heuristic flags has been reviewed: its sheet
 * text either prints as one paragraph or keeps its breaks. A newly flagged
 * element fails here until it is added to one list in text-joins.ts
 * (`node scripts/audit-sheet-breaks.mjs` lists them).
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { sharedLibrary } from "../testing/character-factory.js";
import { findSheetBreakCandidates, hasSuspectBreak, sheetParagraphs } from "../testing/sheet-breaks.js";
import { JOIN_SHEET_TEXT_IDS, KEEP_SHEET_TEXT_IDS } from "./text-joins.js";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

describe("reviewed sheet text breaks", () => {
  it("lists every flagged element as joined or kept", () => {
    const unreviewed = findSheetBreakCandidates(library)
      .map((candidate) => candidate.id)
      .filter((id) => !JOIN_SHEET_TEXT_IDS.has(id) && !KEEP_SHEET_TEXT_IDS.has(id));
    expect(unreviewed).toEqual([]);
  });

  it("never lists an element as both joined and kept", () => {
    expect([...JOIN_SHEET_TEXT_IDS].filter((id) => KEEP_SHEET_TEXT_IDS.has(id))).toEqual([]);
  });

  it("lists only elements the corpus still has", () => {
    const missing = [...JOIN_SHEET_TEXT_IDS, ...KEEP_SHEET_TEXT_IDS].filter((id) => !library.byId.has(id));
    expect(missing).toEqual([]);
  });

  it("joins each listed element's text into one printed paragraph", () => {
    for (const id of JOIN_SHEET_TEXT_IDS) {
      for (const description of library.byId.get(id)?.sheets.flatMap((sheet) => sheet.descriptions) ?? []) {
        const joined = description.text.replace(/\s*[\r\n]+\s*/g, " ");
        expect(sheetParagraphs(joined), id).toHaveLength(1);
      }
    }
  });
});

describe("the sheet-break heuristic", () => {
  it("flags a short closing sentence that points back", () => {
    expect(hasSuspectBreak("You gain a burst of speed. \r\n\t\t\tThis lasts until the end of your turn.")).toBe(true);
    expect(hasSuspectBreak("You gain a burst of speed.\nOnce you use this feature, you must rest first.")).toBe(true);
  });

  it("leaves a single paragraph, a list item, a heading or a fresh rule alone", () => {
    expect(hasSuspectBreak("You gain a burst of speed. This lasts a turn.")).toBe(false);
    expect(hasSuspectBreak("You gain a burst of speed.\n• This lasts a turn.")).toBe(false);
    expect(hasSuspectBreak("You gain a burst of speed.\nThis Burst: lasts a turn.")).toBe(false);
    expect(hasSuspectBreak("You gain a burst of speed.\nYou also gain a swim speed.")).toBe(false);
  });

  it("leaves a closing paragraph of more than one sentence alone", () => {
    expect(hasSuspectBreak("You gain a burst of speed.\nIt lasts a turn. Then you rest.")).toBe(false);
  });
});
