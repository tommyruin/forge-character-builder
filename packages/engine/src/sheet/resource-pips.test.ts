/**
 * The Resources paragraph's pips: how its words split into text and pips, how
 * wide a pip is, how a line with pips wraps and continues, and what the PDF
 * writer draws for them. Synthetic trackers only.
 */

import { describe, expect, it, vi } from "vitest";
import type { TrackerDto } from "@forge-cb/api";
import { PDFPage } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { type CharacterService } from "../character/service.js";
import { OPEN_MARK, SPENT_MARK, resourceSheetText } from "../resources/sheet.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";
import { buildCharacterSheetModel, type CharacterSheetModel, type SheetPage } from "./model.js";
import { featureFlowLines, featureParagraphs, writeCharacterSheetPdfWithTemplateBundle, type TextMeasure } from "./pdf.js";
import {
  CHECK_DOT_RATIO,
  DEFAULT_PIP_LOOK,
  MARKER_STROKE,
  PIP_SIDE_BEARING,
  hasPips,
  isPipParagraph,
  pipBox,
  pipMarker,
  pipSegments,
  pipWordWidth,
  type PipLook,
} from "./pips.js";

const dto = (extra: Partial<TrackerDto>): TrackerDto => ({
  id: "t", label: "Pip Test", sources: [], isCustom: true, manual: true, max: 4, used: 2, remaining: 2, unit: "uses",
  recharge: "longRest", rechargeLabel: "per long rest", tracked: true, ...extra,
});

/** Every character one point wide at 1pt, so widths are easy to reason about. */
const unitMeasure: TextMeasure = (text, fontSize) => [...text].length * fontSize;

describe("pip tokens", () => {
  it("finds the Resources paragraph and nothing else", () => {
    expect(isPipParagraph("Resources. Pip Test ○ ● (LR)")).toBe(true);
    expect(isPipParagraph("Resources.")).toBe(true);
    expect(isPipParagraph("Resourceful. A feature ○")).toBe(false);
    expect(isPipParagraph("Gift. Resources. ○")).toBe(false);
    expect(hasPips(OPEN_MARK)).toBe(true);
    expect(hasPips(`${SPENT_MARK};`)).toBe(true);
    expect(hasPips("(LR);")).toBe(false);
  });

  it("splits a word into text runs and pips, in order", () => {
    expect(pipSegments(OPEN_MARK)).toEqual([{ kind: "pip", spent: false }]);
    expect(pipSegments(`${SPENT_MARK};`)).toEqual([{ kind: "pip", spent: true }, { kind: "text", text: ";" }]);
    expect(pipSegments(`(${OPEN_MARK}${SPENT_MARK})`)).toEqual([
      { kind: "text", text: "(" }, { kind: "pip", spent: false }, { kind: "pip", spent: true }, { kind: "text", text: ")" },
    ]);
    expect(pipSegments("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("marks only the Resources paragraph's regular words that hold a mark", () => {
    const [resources, other] = featureParagraphs([
      { kind: "lines", lines: [resourceSheetText([dto({}), dto({ label: "Gift", max: 1, used: 0, recharge: "never" })])!] },
      { kind: "lines", lines: [`Bullets. A feature that prints ${OPEN_MARK} and ${SPENT_MARK} as text.`] },
    ]);
    const words = resources!.words;
    expect(words.filter((word) => word.pips === true).map((word) => word.text)).toEqual([OPEN_MARK, OPEN_MARK, SPENT_MARK, SPENT_MARK, OPEN_MARK]);
    expect(words.find((word) => word.text === "Resources.")).toMatchObject({ style: "bold-italic" });
    expect(words.find((word) => word.text === "Resources.")?.pips).toBeUndefined();
    expect(other!.words.some((word) => word.pips === true)).toBe(false);
  });
});

describe("pip size", () => {
  it("is as tall as a capital, its stroke, corners and dot scaled with it", () => {
    const box = pipBox(8, 0.75);
    expect(box.size).toBeCloseTo(6);
    expect(box.stroke).toBeCloseTo(MARKER_STROKE);
    expect(box.corner).toBeCloseTo(1.2);
    expect(box.dotRadius).toBeCloseTo(6 * CHECK_DOT_RATIO);
    expect(box.advance).toBeCloseTo(6 * (1 + 2 * PIP_SIDE_BEARING));
    expect(pipBox(4, 0.75).advance).toBeCloseTo(box.advance / 2);
  });

  it("widens a word by a fixed advance per pip, its text measured as drawn", () => {
    const advance = pipBox(10, 0.7).advance;
    const measure = (text: string) => unitMeasure(text, 10);
    expect(pipWordWidth(OPEN_MARK, 10, 0.7, measure)).toBeCloseTo(advance);
    expect(pipWordWidth(`${SPENT_MARK};`, 10, 0.7, measure)).toBeCloseTo(advance + 10);
    expect(pipWordWidth(`(${OPEN_MARK}${OPEN_MARK})`, 10, 0.7, measure)).toBeCloseTo(2 * advance + 20);
  });

  it("copies the death saves in the set's marker, or rounded squares on every set", () => {
    expect(pipMarker("death-save", "circle")).toBe("circle");
    expect(pipMarker("death-save", "square")).toBe("square");
    expect(pipMarker("square", "circle")).toBe("square");
    expect(DEFAULT_PIP_LOOK).toBe("death-save");
  });
});

describe("a Resources line with pips", () => {
  const capHeight = 0.7;
  const fontSize = 10;
  const advance = pipBox(fontSize, capHeight).advance;
  const lineWidth = (words: readonly { text: string; pips?: true }[]) => words.reduce((sum, word, index) =>
    sum + (index === 0 ? 0 : fontSize) + (word.pips === true
      ? pipWordWidth(word.text, fontSize, capHeight, (text) => unitMeasure(text, fontSize))
      : unitMeasure(word.text, fontSize)), 0);

  it("wraps at the pips' own width and keeps every word in order", () => {
    const text = resourceSheetText([dto({ max: 6, used: 2 }), dto({ label: "Gift", max: 3, used: 3, recharge: "shortRest" })])!;
    const paragraphs = featureParagraphs([{ kind: "lines", lines: [text] }]);
    // Room for "Pip Test" plus three pips and their spaces, and no more.
    const width = unitMeasure("Pip Test", fontSize) + 3 * (fontSize + advance) + 1;
    const lines = featureFlowLines(paragraphs, width, fontSize, unitMeasure, capHeight);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(lineWidth(line.words)).toBeLessThanOrEqual(width);
    expect(lines.flatMap((line) => line.words)).toEqual(paragraphs[0]!.words);
    expect(lines.flatMap((line) => line.words).map((word) => word.text).join(" ")).toBe(text);
    // Measured as text ("○" one point a character) the same words would pack differently.
    const asText = featureFlowLines(paragraphs.map((paragraph) => ({
      ...paragraph, words: paragraph.words.map(({ pips: _pips, ...word }) => word),
    })), width, fontSize, unitMeasure, capHeight);
    expect(asText.map((line) => line.words.length)).not.toEqual(lines.map((line) => line.words.length));
  });

  it("continues from the first word not drawn, its pips still pips", () => {
    const text = resourceSheetText([dto({ max: 6, used: 4 })])!;
    const paragraphs = featureParagraphs([{ kind: "lines", lines: [text] }]);
    const lines = featureFlowLines(paragraphs, unitMeasure("Resources. Pip Test", fontSize) + fontSize + advance + 1, fontSize, unitMeasure, capHeight);
    expect(lines.length).toBeGreaterThan(1);
    // A box that holds only the first line hands on the rest of its paragraph
    // (drawFeatureFlow's `rest`), which a continuation page wraps afresh.
    const rest = paragraphs[0]!.words.slice(lines[1]!.start);
    expect(rest.filter((word) => word.pips === true).map((word) => word.text)).toEqual(
      lines.slice(1).flatMap((line) => line.words).filter((word) => word.pips === true).map((word) => word.text),
    );
    const rewrapped = featureFlowLines([{ ...paragraphs[0]!, words: rest }], 1000, fontSize, unitMeasure, capHeight);
    expect(rewrapped).toHaveLength(1);
    expect(rewrapped[0]!.words.map((word) => word.text).join(" ")).toBe(`${OPEN_MARK} ${SPENT_MARK} ${SPENT_MARK} ${SPENT_MARK} ${SPENT_MARK} (LR)`);
  });
});

describe("the PDF's pips", () => {
  const WHITE = { type: "RGB", red: 1, green: 1, blue: 1 };
  const page = (lines: string[]): SheetPage => ({
    page: 1, templateKind: "details",
    sections: [{ title: "features", rows: lines.map((text) => ({ kind: "lines" as const, lines: [text] })) }],
  });
  async function draw(sheetPage: SheetPage, set: "2014" | "2024", pipLook?: PipLook) {
    const circles = vi.spyOn(PDFPage.prototype, "drawCircle");
    const paths = vi.spyOn(PDFPage.prototype, "drawSvgPath");
    try {
      const model: CharacterSheetModel = { characterId: "Pips", mode: "full", pageCount: 1, pages: [sheetPage], formValues: {} };
      const bytes = await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle(set), pipLook === undefined ? {} : { pipLook });
      const ringCircles = circles.mock.calls.filter(([options]) => options?.borderWidth !== undefined && options.borderWidth > 0 && options.color !== undefined
        && JSON.stringify(options.color) === JSON.stringify(WHITE));
      const ringSquares = paths.mock.calls.filter(([, options]) => JSON.stringify(options?.color) === JSON.stringify(WHITE));
      const dots = circles.mock.calls.filter(([options]) => options?.borderWidth === undefined && options?.borderColor === undefined);
      const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
      const text: string[] = [];
      for (let index = 1; index <= doc.numPages; index++) {
        text.push(...(await (await doc.getPage(index)).getTextContent()).items.flatMap((item) => "str" in item ? [item.str] : []));
      }
      return { ringCircles: ringCircles.length, ringSquares: ringSquares.length, dots: dots.length, text: text.join(" ") };
    } finally {
      circles.mockRestore();
      paths.mockRestore();
    }
  }
  const fourUsesTwoSpent = resourceSheetText([dto({})])!;

  it("draws a 4-use tracker with 2 spent as four death-save circles on a 2024 page, two of them dotted", async () => {
    expect(fourUsesTwoSpent).toBe(`Resources. Pip Test ${OPEN_MARK} ${OPEN_MARK} ${SPENT_MARK} ${SPENT_MARK} (LR)`);
    const drawn = await draw(page([fourUsesTwoSpent]), "2024");
    expect(drawn).toMatchObject({ ringCircles: 4, ringSquares: 0, dots: 2 });
    expect(drawn.text).toContain("Pip Test");
    expect(drawn.text).toContain("(LR)");
    expect(drawn.text).not.toMatch(/Pip Test\s+o\b/);
    expect(drawn.text).not.toContain("•");
  }, 60_000);

  it("copies the 2014 death saves' circles too, and draws squares on any set when asked", async () => {
    expect(await draw(page([fourUsesTwoSpent]), "2024", "death-save")).toMatchObject({ ringCircles: 4, ringSquares: 0, dots: 2 });
    expect(await draw(page([fourUsesTwoSpent]), "2014")).toMatchObject({ ringCircles: 4, ringSquares: 0, dots: 2 });
    expect(await draw(page([fourUsesTwoSpent]), "2024", "square")).toMatchObject({ ringCircles: 0, ringSquares: 4, dots: 2 });
    expect(await draw(page([fourUsesTwoSpent]), "2014", "square")).toMatchObject({ ringCircles: 0, ringSquares: 4, dots: 2 });
  }, 60_000);

  it("prints an empty tracker as rings alone, a large one as text, and leaves other marks as text", async () => {
    const empty = resourceSheetText([dto({}), dto({ label: "Wand", max: 7, used: 3 })], { empty: true })!;
    const drawn = await draw(page([`Bullets. A feature that prints ${OPEN_MARK} as text.`, empty]), "2024");
    expect(drawn).toMatchObject({ ringCircles: 4, dots: 0 });
    expect(drawn.text).toContain("____ / 7");
    expect(drawn.text).toMatch(/prints\s+o\s+as/);
  }, 60_000);

  it("draws the pips of a Resources line that continues on another page", async () => {
    const filler = Array.from({ length: 1400 }, (_, index) => `word${index}`).join(" ");
    const drawn = await draw(page([`Long. ${filler}`, fourUsesTwoSpent]), "2024");
    expect(drawn.text).toContain("FEATURES & TRAITS (CONTINUED)");
    expect(drawn).toMatchObject({ ringCircles: 4, dots: 2 });
  }, 60_000);

  it("draws a real character's tracker kept by hand", async () => {
    const library = await sharedLibrary();
    const { service, id } = buildFighter3(library, "PipFighter") as { service: CharacterService; id: string };
    service.saveManualTracker(id, { tracker: { id: "pip-test", label: "Pip Test", max: { kind: "number", value: 4 }, unit: "uses", recharge: "longRest" } });
    service.setTrackerUsed(id, { trackerId: "pip-test", used: 2 });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const details = model.pages.find((entry) => entry.templateKind === "details")!;
    expect(JSON.stringify(details)).toContain(`Pip Test ${OPEN_MARK} ${OPEN_MARK} ${SPENT_MARK} ${SPENT_MARK} (LR)`);
    const drawn = await draw(details, "2024");
    // Every tracker on the line is drawn as pips; none prints as "o" or a bullet.
    expect(drawn.ringCircles).toBeGreaterThanOrEqual(4);
    expect(drawn.dots).toBeGreaterThanOrEqual(2);
    expect(drawn.text).toContain("Pip Test");
    expect(drawn.text).not.toMatch(/Pip Test\s+o\b/);
    expect(drawn.text).not.toContain("•");
  }, 120_000);
});
