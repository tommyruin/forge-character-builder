/**
 * Card prose laid out in the body face it is drawn in. The model lays cards
 * out without loading a font (face-metrics.ts carries the advances), and the
 * writer measures positioned runs the same way, so a Spectral card wraps where
 * Spectral needs it to and its words join into one drawn string per line.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { descriptionCardRuns, type DescriptionCard } from "./card-layout.js";
import { writeCharacterSheetPdfWithTemplateBundle } from "./pdf.js";
import { DEFAULT_SHEET_FONTS, SHEET_FONT_FACES } from "./template-contract.js";
import { measuredTextWidth } from "./text.js";
import { localTemplateBundle } from "../testing/sheet-bundle.js";

const FONTS = fileURLToPath(new URL("../../../../apps/client/public/sheets/fonts/", import.meta.url));
const SAMPLE = "Each creature in a 20-foot-radius sphere must make a Dexterity saving throw — “Fireball” costs 5 gp.";

afterEach(() => {
  vi.restoreAllMocks();
});

const card: DescriptionCard = {
  kind: "spell",
  title: "Fireball",
  subtitle: "3rd-level evocation",
  metadata: [["CASTING TIME", "1 action"], ["RANGE", "150 feet"], ["DURATION", "Instantaneous"], ["COMPONENTS", "V, S, M"]],
  body: `<p>${"A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame. ".repeat(4)}</p>`
    + "<p><strong><em>At Higher Levels.</em></strong> When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6.</p>",
  footer: "Spellcasting (Wizard)",
};

describe("body face metrics", () => {
  it.each(["spectral", "alegreyaSans"] as const)("measure %s on the advances the writer draws", async (face) => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const files = SHEET_FONT_FACES[face].files;
    for (const [style, file] of [["regular", files.regular], ["bold", files.bold], ["italic", files.italic], ["bold-italic", files.boldItalic]] as const) {
      const font = await document.embedFont(readFileSync(join(FONTS, file)), { subset: true });
      const drawn = [...SAMPLE].reduce((total, character) => total + font.widthOfTextAtSize(character, 10), 0);
      expect(measuredTextWidth(SAMPLE, 10, style, face)).toBeCloseTo(drawn, 1);
    }
  });

  it("lays a card out in the chosen face", () => {
    const words = (face?: string) => descriptionCardRuns([card], face === undefined ? {} : { face })
      .filter((run) => run.role === "body");
    const helvetica = words();
    const alegreya = words("alegreyaSans");
    // The narrower face fits more on a line, so the same prose takes fewer lines.
    expect(new Set(alegreya.map((run) => run.y)).size).toBeLessThan(new Set(helvetica.map((run) => run.y)).size);
    for (const run of alegreya) {
      expect(run.width).toBeCloseTo(measuredTextWidth(run.text, run.fontSize!, run.style, "alegreyaSans"), 6);
    }
  });

  it("draws each body line of a Spectral card as one string", async () => {
    const runs = descriptionCardRuns([card], { face: "spectral" });
    const model = {
      characterId: "Spectral card", mode: "full" as const, pageCount: 1,
      pages: [{ page: 1, templateKind: "spell-cards" as const, sections: [{ title: "Fireball", rows: [], positionedRuns: runs }] }],
    };
    const texts = vi.spyOn(PDFPage.prototype, "drawText");
    await writeCharacterSheetPdfWithTemplateBundle(model, localTemplateBundle("2024", { ...DEFAULT_SHEET_FONTS, body: "spectral" }));
    const body = runs.filter((run) => run.role === "body");
    // Lines of plain prose; a bold or italic word is drawn in its own face.
    const plainLines = [...new Set(body.map((run) => run.y))]
      .filter((y) => body.every((run) => run.y !== y || (run.style ?? "regular") === "regular"));
    expect(plainLines.length).toBeGreaterThan(5);
    for (const y of plainLines) {
      const drawn = texts.mock.calls.filter(([, options]) => options?.y === y && options.size === body[0]!.fontSize);
      expect(drawn, `line at ${y}`).toHaveLength(1);
    }
  });
});
