/**
 * A features box too full for its 6pt floor prints its first part at 7–8pt
 * and breaks between whole features, so the continuation page opens on a
 * feature rather than mid-sentence. Only a feature too tall to move whole is
 * cut where the box runs out. Synthetic text only.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import type { CharacterSheetModel, SheetRow } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import type { SheetTemplateSet } from "./template-contract.js";

interface Item { str: string; x: number; y: number; size: number }

const line = (text: string): SheetRow => ({ kind: "lines", lines: [text] });
/**
 * `count` features of `words` words or a few more, varied so a box's foot
 * seldom meets a feature's end, each word naming its feature: `<prefix><feature>w<word>`.
 */
const features = (prefix: string, count: number, words: number): SheetRow[] => Array.from({ length: count }, (_, feature) =>
  line(`Feat${prefix}${feature}. ${Array.from({ length: words + (feature * 7) % 13 }, (_, word) => `${prefix}${feature}w${word}`).join(" ")}`));

const rowText = (row: SheetRow): string => row.kind === "lines" ? row.lines.join(" ") : row.tokens.join(" ");

function sheet(rows: readonly SheetRow[], groups?: { class: readonly SheetRow[]; subclass: readonly SheetRow[] }): CharacterSheetModel {
  return {
    characterId: "Breaks", mode: "full", pageCount: 1, formValues: {},
    pages: [{
      page: 1, templateKind: "details",
      sections: [{ title: "features", rows: [...rows], renderRows: [...rows] }],
      ...(groups === undefined ? {} : { featureGroups: { "class-features": [...groups.class], "subclass-features": [...groups.subclass], feats: [] } }),
    }],
  };
}

async function render(model: CharacterSheetModel, set: SheetTemplateSet, layout?: Record<string, boolean>) {
  const bundle = localTemplateBundle(set, undefined, layout);
  const widget = (await PDFDocument.load(bundle.details)).getForm().getTextField("details_features").acroField.getWidgets()[0]!;
  const box = widget.getRectangle();
  const doc = await getDocument({ data: new Uint8Array(await writeCharacterSheetPdfWithTemplateBundle(model, bundle)), verbosity: 0 }).promise;
  const pages: Item[][] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    pages.push((await (await doc.getPage(index)).getTextContent()).items.flatMap((item) => "str" in item && item.str.trim() !== ""
      ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, size: Math.hypot(item.transform[2] as number, item.transform[3] as number) }]
      : []));
  }
  const inBox = pages[0]!.filter((item) => item.x >= box.x - 1 && item.x <= box.x + box.width && item.y >= box.y - 1 && item.y <= box.y + box.height);
  /** The pages each feature's words print on, by feature. */
  const featurePages = (prefix: string): Map<string, Set<number>> => {
    const found = new Map<string, Set<number>>();
    pages.forEach((items, page) => {
      for (const item of items) {
        for (const match of item.str.matchAll(new RegExp(`\\b(${prefix}\\d+)w\\d+\\b`, "g"))) {
          const set = found.get(match[1]!) ?? new Set<number>();
          set.add(page);
          found.set(match[1]!, set);
        }
      }
    });
    return found;
  };
  const words = (pattern: RegExp): string[] => pages.flat().flatMap((item) => item.str.match(pattern) ?? []);
  return { pages, box, inBox, featurePages, words, rest: pages.slice(1).flat().map((item) => item.str).join(" ") };
}

describe.each(["2014", "2024"] as const)("a features box too full for its floor on %s", (set) => {
  it("breaks between whole features, at 7pt or more, filling the box", async () => {
    const rows = features("f", 60, 30);
    const written = await render(sheet(rows), set);
    expect(written.pages.length).toBeGreaterThan(1);
    expect(written.rest).toMatch(/Features.* \(continued\)/);
    // Every feature prints whole on the character page or wholly after it.
    const placed = written.featurePages("f");
    expect(placed.size).toBe(60);
    for (const [feature, pages] of placed) expect(pages.has(0) && pages.size > 1, feature).toBe(false);
    expect(new Set(written.words(/\bf\d+w\d+\b/g)).size).toBe(rows.map(rowText).join(" ").split(" ").length - 60);
    // One size for the page's part, no smaller than 7pt.
    const sizes = written.inBox.filter((item) => /\bf\d+w\d+/.test(item.str)).map((item) => item.size);
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(0.01);
    expect(sizes[0]!).toBeGreaterThanOrEqual(7 - 0.01);
    expect(sizes[0]!).toBeLessThanOrEqual(8 + 0.01);
    // No more than three lines of that size stay empty under the last.
    const lowest = Math.min(...written.inBox.map((item) => item.y));
    expect(lowest - (written.box.y + 1)).toBeLessThanOrEqual(3 * sizes[0]! + 0.5);
  }, 60_000);

  it("still cuts a feature too tall to move whole, at the normal size", async () => {
    const written = await render(sheet([line("Opening. A short feature."), line(`Huge. ${Array.from({ length: 1500 }, (_, index) => `hg${index}`).join(" ")}`)]), set);
    expect(written.pages.length).toBeGreaterThan(1);
    const onFirst = written.inBox.filter((item) => /\bhg\d+/.test(item.str));
    expect(onFirst.length).toBeGreaterThan(0);
    expect(written.rest).toMatch(/\bhg\d+/);
    for (const item of written.inBox) expect(item.size).toBeCloseTo(8, 1);
    const words = written.words(/\bhg\d+\b/g);
    expect(words).toHaveLength(1500);
    expect(new Set(words).size).toBe(1500);
  }, 60_000);

  it("breaks between whole features under group headings, never leaving a heading last", async () => {
    const classRows = features("c", 30, 30);
    const subclassRows = features("s", 30, 30);
    const written = await render(sheet([...classRows, ...subclassRows], { class: classRows, subclass: subclassRows }), set, { split: true });
    expect(written.pages.length).toBeGreaterThan(1);
    for (const prefix of ["c", "s"]) {
      for (const [feature, pages] of written.featurePages(prefix)) expect(pages.has(0) && pages.size > 1, feature).toBe(false);
    }
    // The lowest line of the box is a feature's, not a heading's.
    const lowest = written.inBox.reduce((low, item) => item.y < low.y ? item : low);
    expect(lowest.str).not.toMatch(/^(Class|Subclass|Features)$/);
    // The continuation carries on the group its first feature belongs to.
    const classDone = [...written.featurePages("c").values()].every((pages) => pages.has(0));
    expect(written.rest).toContain(classDone ? "Subclass Features (continued)" : "Class Features (continued)");
  }, 60_000);
});
