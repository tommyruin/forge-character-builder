/**
 * The Resources box the writer draws under the features, the Hybrid column's
 * alignment with the skills, and the exhaustion track. Synthetic text only.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OPEN_MARK, SPENT_MARK } from "../resources/sheet.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import type { CharacterSheetModel, SheetRow } from "./model.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import {
  SHEET_LAYOUT_DEFAULTS,
  SHEET_TEMPLATE_CONTRACT,
  SHEET_TEMPLATE_SETS,
  sheetLayoutVariants,
  type SheetLabel,
  type SheetTemplateSet,
} from "./template-contract.js";

const SHEETS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "client", "public", "sheets");

interface Item { str: string; x: number; y: number; size: number }

const line = (text: string): SheetRow => ({ kind: "lines", lines: [text] });
const prose = (word: string, count: number): string => Array.from({ length: count }, (_, index) => `${word}${index}`).join(" ");
const resourcesText = (trackers: number): string =>
  `Resources. ${Array.from({ length: trackers }, (_, index) => `Tracker${index} ${OPEN_MARK} ${SPENT_MARK} (LR)`).join("; ")}`;

function sheet(features: readonly string[], resources?: string, species?: string): CharacterSheetModel {
  const rows = [...features.map(line), ...(resources === undefined ? [] : [line(resources)])];
  return {
    characterId: "Resources", mode: "full", pageCount: 1, formValues: {},
    pages: [{
      page: 1, templateKind: "details",
      sections: [
        ...(species === undefined ? [] : [{ title: "racial-traits", rows: [line(species)] }]),
        { title: "features", rows, renderRows: rows },
      ],
      featureGroups: { "class-features": rows, "subclass-features": [], feats: [] },
    }],
  };
}

async function render(model: CharacterSheetModel, set: SheetTemplateSet, layout?: Record<string, boolean>): Promise<Item[][]> {
  const bytes = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set, undefined, layout));
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages: Item[][] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    pages.push((await (await doc.getPage(index)).getTextContent()).items.flatMap((item) => "str" in item && item.str.trim() !== ""
      ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, size: Math.hypot(item.transform[2] as number, item.transform[3] as number) }]
      : []));
  }
  return pages;
}

/** The features frame's foot as the template prints it. */
const frameFoot = (set: SheetTemplateSet): number => set === "2014" ? 150 : SHEET_TEMPLATE_CONTRACT.traitsColumn.bottom;
const pageText = (items: readonly Item[]): string => items.map((item) => item.str).join(" ");

afterEach(() => vi.restoreAllMocks());

describe("the Resources box", () => {
  it.each(SHEET_TEMPLATE_SETS)("prints the paragraph once, under the features, on %s", async (set) => {
    const pages = await render(sheet(["Opening. A short feature."], resourcesText(2)), set);
    expect(pages).toHaveLength(1);
    const leads = pages[0]!.filter((item) => item.str.startsWith("Resources."));
    expect(leads).toHaveLength(1);
    const opening = pages[0]!.find((item) => item.str.startsWith("Opening"))!;
    expect(leads[0]!.y).toBeLessThan(opening.y);
    expect(leads[0]!.y).toBeGreaterThan(frameFoot(set));
    expect(leads[0]!.y).toBeLessThan(frameFoot(set) + 40);
  }, 60_000);

  it.each(SHEET_TEMPLATE_SETS)("lifts it from split and combined layouts alike on %s", async (set) => {
    for (const split of [true, false]) {
      const pages = await render(sheet(["Opening. A short feature."], resourcesText(1)), set, { split });
      expect(pages[0]!.filter((item) => item.str.startsWith("Resources.")), `split ${split}`).toHaveLength(1);
    }
  }, 60_000);

  it.each(SHEET_TEMPLATE_SETS)("shortens the features so their text stops above the box on %s", async (set) => {
    const long = ["Longfeature. " + prose("ft", 3000)];
    const [bare, boxed] = await Promise.all([render(sheet(long), set), render(sheet(long, resourcesText(2)), set)]);
    const lowest = (items: readonly Item[]): number => Math.min(...items.filter((item) => /\bft\d+/.test(item.str)).map((item) => item.y));
    const lead = boxed[0]!.find((item) => item.str.startsWith("Resources."))!;
    expect(lowest(boxed[0]!)).toBeGreaterThan(lead.y + SHEET_TEMPLATE_CONTRACT.resourcesBox.gap);
    expect(lowest(boxed[0]!)).toBeGreaterThan(lowest(bare[0]!));
  }, 60_000);

  it.each(SHEET_TEMPLATE_SETS)("continues text the box cannot hold under its own heading on %s", async (set) => {
    const trackers = 60;
    const pages = await render(sheet(["Opening. A short feature."], resourcesText(trackers)), set);
    expect(pages.length).toBeGreaterThan(1);
    const rest = pages.slice(1).map(pageText).join(" ");
    expect(rest).toContain("Resources (continued)");
    const all = pages.map(pageText).join(" ");
    for (let index = 0; index < trackers; index += 1) expect(all).toContain(`Tracker${index}`);
  }, 60_000);

  it.each(SHEET_TEMPLATE_SETS)("leaves the artwork as drawn when there is no paragraph on %s", async (set) => {
    const draw = vi.spyOn(PDFPage.prototype, "drawPage");
    await render(sheet(["Opening. A short feature."]), set);
    expect(draw).toHaveBeenCalledTimes(1);
    draw.mockClear();
    await render(sheet(["Opening. A short feature."], resourcesText(1)), set);
    expect(draw.mock.calls.length).toBeGreaterThan(1);
  }, 60_000);
});

describe("the Hybrid column's alignment", () => {
  const column = SHEET_TEMPLATE_CONTRACT.traitsColumn;
  const align = column.speciesAlign["2024-hybrid"];

  it("prints the Features top level with the Skills top when the species foot is on the line", () => {
    expect(align.y - column.gap["2024-hybrid"]).toBe(512);
  });

  it("snaps a Species Traits foot landing near the Saving Throws foot onto it", async () => {
    const bottoms: number[] = [];
    for (let words = 200; words <= 340; words += 6) {
      const pages = await render(sheet(["Opening. A short feature."], undefined, `Trait. ${prose("sp", words)}`), "2024-hybrid");
      const title = pages[0]!.find((item) => item.str === "FEATURES")!;
      // The plate's title sits 11pt under the frame's top.
      bottoms.push(Math.round((title.y + 11 + column.gap["2024-hybrid"]) * 100) / 100);
    }
    expect(bottoms).toContain(align.y);
    for (const bottom of bottoms) {
      if (bottom !== align.y) expect(Math.abs(bottom - align.y), `foot at ${bottom}`).toBeGreaterThan(align.within);
    }
  }, 120_000);
});

describe("the exhaustion track", () => {
  const variants = SHEET_TEMPLATE_SETS.flatMap((set) => [
    { set, file: SHEET_TEMPLATE_CONTRACT.files.details, layout: SHEET_LAYOUT_DEFAULTS[set] },
    ...sheetLayoutVariants(set).map((variant) => ({ set, ...variant })),
  ]);
  const cases = variants.map(({ set, file }) => [set, file] as const);

  async function track(set: SheetTemplateSet, file: string) {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, set, file)))).getForm();
    const rect = (name: string) => form.getField(name).acroField.getWidgets()[0]!.getRectangle();
    const labels = (JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as Record<string, { labels: SheetLabel[] }>)[file]!.labels;
    const marks = [1, 2, 3, 4, 5, 6].map((index) => rect(`details_exhaustion_${index}`));
    const numerals = ["1", "2", "3", "4", "5"].map((text, index) => {
      const mark = marks[index]!;
      return labels.find((label) => label.text === text && label.x === mark.x && label.y > mark.y)!;
    });
    return { form, rect, marks, numerals, caption: labels.find((label) => label.text === "EXHAUSTION")! };
  }

  it.each(cases)("centres a numeral over each of the first five marks on %s/%s", async (set, file) => {
    const { marks, numerals } = await track(set, file);
    numerals.forEach((numeral, index) => {
      const mark = marks[index]!;
      expect(numeral, `mark ${index + 1}`).toBeDefined();
      expect(numeral.align).toBe("center");
      expect(numeral.width).toBe(mark.width);
      expect(numeral.y).toBeGreaterThanOrEqual(mark.y + mark.height);
    });
  });

  it.each(cases)("keeps the label clear of the numerals on %s/%s", async (set, file) => {
    const { marks, numerals, caption } = await track(set, file);
    const inline = caption.y < marks[0]!.y + marks[0]!.height;
    if (inline) expect(caption.x + 40).toBeLessThanOrEqual(marks[0]!.x + 8);
    else for (const numeral of numerals) expect(caption.y).toBeGreaterThanOrEqual(numeral.y + numeral.size * 0.72);
  });

  it.each(cases.filter(([set]) => set !== "2014"))("starts the conditions above the numerals on %s/%s", async (set, file) => {
    const { rect, numerals } = await track(set, file);
    for (const numeral of numerals) expect(rect("details_conditions").y).toBeGreaterThanOrEqual(numeral.y + numeral.size * 0.72);
  });
});
