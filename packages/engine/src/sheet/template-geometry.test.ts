import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { templateFontSize } from "./pdf.js";
import { SHEET_TEMPLATE_CONTRACT, SHEET_TEMPLATE_SETS, type SheetTemplateLabels } from "./template-contract.js";

const SHEETS = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..", "apps", "client", "public", SHEET_TEMPLATE_CONTRACT.directory);

/** Every full-page template of a set, with its labels and widget rectangles. */
async function pagesOf(set: string) {
  const labels = JSON.parse(readFileSync(join(SHEETS, set, SHEET_TEMPLATE_CONTRACT.labelsFile), "utf8")) as SheetTemplateLabels;
  const files = [
    SHEET_TEMPLATE_CONTRACT.files.details,
    SHEET_TEMPLATE_CONTRACT.files.background,
    SHEET_TEMPLATE_CONTRACT.files.companion,
    SHEET_TEMPLATE_CONTRACT.files.equipment,
  ];
  return Promise.all(files.map(async (file) => {
    const document = await PDFDocument.load(readFileSync(join(SHEETS, set, file)));
    const widgets = document.getForm().getFields().flatMap((field) => {
      const rect = field.acroField.getWidgets()[0]?.getRectangle();
      return rect === undefined ? [] : [{ name: field.getName(), rect }];
    });
    return { file, widgets, text: labels[file] };
  }));
}

describe("sheet template geometry", () => {
  // A panel title printed inside a panel's top edge lands on body content that
  // was laid out for a title at the foot. Both sets label at the foot; this
  // keeps them there.
  it.each([...SHEET_TEMPLATE_SETS])("keeps every panel title off the fields on the %s pages", async (set) => {
    const collisions: string[] = [];
    for (const { file, widgets, text } of await pagesOf(set)) {
      for (const label of text?.labels ?? []) {
        if (label.font !== "titles") continue;
        // The masthead's die mark is drawn over its own badge by design.
        const width = label.text.length * label.size * 0.75;
        const left = label.align === "center" ? label.x + ((label.width ?? 0) - width) / 2 : label.x;
        for (const widget of widgets) {
          if (widget.name === SHEET_TEMPLATE_CONTRACT.masthead.field) continue;
          const overlaps = left < widget.rect.x + widget.rect.width && left + width > widget.rect.x &&
            label.y < widget.rect.y + widget.rect.height && label.y + label.size > widget.rect.y;
          if (overlaps) collisions.push(`${file}: "${label.text}" over ${widget.name}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  // The edition label is how a printed page says which rules it was laid out
  // for; a page without one reads as the other edition's sheet.
  it.each([...SHEET_TEMPLATE_SETS])("labels every %s page with its edition", async (set) => {
    const missing: string[] = [];
    for (const { file, text } of await pagesOf(set)) {
      if (!(text?.labels ?? []).some((label) => label.text === `${set} RULES`)) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  it("sizes every field from its own default appearance", async () => {
    for (const set of SHEET_TEMPLATE_SETS) {
      for (const { file, widgets } of await pagesOf(set)) {
        const document = await PDFDocument.load(readFileSync(join(SHEETS, set, file)));
        for (const field of document.getForm().getFields()) {
          if (widgets.find((widget) => widget.name === field.getName()) === undefined) continue;
          const size = templateFontSize(field.acroField.getDefaultAppearance());
          if (size === undefined) continue;
          expect(size, `${set}/${file} ${field.getName()}`).toBeGreaterThan(0);
        }
      }
    }
  });

  // A 2024 weapon's notes cell carries the whole property list, and since the
  // "Mastery: <Name>" suffix was added it never fits one line. That cell — and
  // only that cell — wraps into the band under its row, so it has to stay
  // taller than the rest of the row, sit where its first line reads as level
  // with the row, and clear both the row above and the panel's own free-text
  // note. A single-line cell here clips the second line in half.
  //
  // The numbers are the panel's whole budget, spent deliberately. 86pt wide is
  // what prints the longest 2024 property list ("Reach, Special, Special Lance,
  // Heavy, Mastery: Topple") at the full 6pt in every body face — a 66pt column
  // drove it down to 4.75pt. 21pt tall is the row pitch, and the shortest cell
  // that holds three wrapped lines at the writer's 4.5pt floor, so a
  // hand-written note wraps rather than clipping.
  //
  // The cell's top is 0.9pt proud of the row's, because the writer places the
  // two kinds of line differently: a single-line value is centred on its box by
  // cap height, a wrapped cell's first baseline is a fixed `top - 2 - size`
  // inset. Sharing the top left the note visibly low. 604.9 is the top that
  // optically centres the 6pt first line on the values' own 594..604 band
  // across every body face while staying under the captions; pdf.test.ts
  // measures what it actually buys.
  it("gives the 2024 attack notes a wrapping cell that clears its neighbours", async () => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, "2024", SHEET_TEMPLATE_CONTRACT.files.details)))).getForm();
    const rectOf = (name: string) => form.getTextField(name).acroField.getWidgets()[0]!.getRectangle();
    const freeText = rectOf("details_attack_description");
    expect(form.getTextField("details_attack_description").isMultiline()).toBe(true);
    for (let row = 1; row <= 4; row += 1) {
      const name = `details_attack${row}_description`;
      const notes = rectOf(name);
      const weapon = rectOf(`details_attack${row}_weapon`);
      expect(form.getTextField(name).isMultiline(), name).toBe(true);
      // Room for two 6pt lines of the longest property list, in the NOTES
      // column, raised just far enough over its row that the wrapped first
      // line reads as level with the single-line values beside it.
      expect({ x: notes.x, width: notes.width, height: notes.height }, name).toEqual({ x: 496, width: 86, height: 21 });
      expect(notes.y + notes.height, name).toBeCloseTo(weapon.y + weapon.height + 0.9, 5);
      // Proud of the row, but never by enough to read as a line of its own.
      expect(notes.y + notes.height - (weapon.y + weapon.height), name).toBeGreaterThan(0);
      expect(notes.y + notes.height - (weapon.y + weapon.height), name).toBeLessThan(1.5);
      if (row > 1) expect(notes.y + notes.height, name).toBeLessThanOrEqual(rectOf(`details_attack${row - 1}_description`).y);
      expect(freeText.y + freeText.height, name).toBeLessThanOrEqual(notes.y);
      // Inside the panel: clear of the column captions, whose ink sits on and
      // above their y 605 baseline, and never past the inner right edge of the
      // frame at x 582.
      expect(notes.y + notes.height, name).toBeLessThan(605);
      expect(notes.x + notes.width, name).toBeLessThanOrEqual(582);
      expect(notes.y, name).toBeGreaterThanOrEqual(504);
    }
    // The rows took their extra height from the free-text note, which is the
    // user's own prose and has to stay worth typing into: two 6pt lines' worth
    // of box, inside the panel, under the last row.
    expect(freeText.height).toBeGreaterThanOrEqual(13);
    expect(freeText.y).toBeGreaterThanOrEqual(504);
    expect(freeText.x + freeText.width).toBeLessThanOrEqual(582);
  });

  // The 2014 page prints the same text on a wide line of its own, which fits;
  // it must not pick up the 2024 page's wrapping cell.
  it("leaves the 2014 attack notes on their own single line", async () => {
    const form = (await PDFDocument.load(readFileSync(join(SHEETS, "2014", SHEET_TEMPLATE_CONTRACT.files.details)))).getForm();
    for (let row = 1; row <= 4; row += 1) {
      const field = form.getTextField(`details_attack${row}_description`);
      expect(field.isMultiline(), `row ${row}`).toBe(false);
      expect(field.acroField.getWidgets()[0]!.getRectangle().width, `row ${row}`).toBeGreaterThan(300);
    }
  });

  it("gives the big numbers a size that suits their box", async () => {
    const [details] = await pagesOf("2024");
    const document = await PDFDocument.load(readFileSync(join(SHEETS, "2024", details!.file)));
    const sizeOf = (name: string) => templateFontSize(document.getForm().getTextField(name).acroField.getDefaultAppearance());
    for (const name of ["details_proficiency_bonus", "details_initiative", "details_passive_perception_total", "details_hd"]) {
      expect(sizeOf(name), name).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("templateFontSize", () => {
  it("reads the size a template asked for", () => {
    expect(templateFontSize("0.17 0.13 0.11 rg /Helv 12 Tf")).toBe(12);
    expect(templateFontSize("/Helv 7.16 Tf")).toBe(7.16);
    expect(templateFontSize("/Helv 8 Tf /Helv 15 Tf")).toBe(15);
  });

  it("treats an absent or auto size as none of its business", () => {
    expect(templateFontSize(undefined)).toBeUndefined();
    expect(templateFontSize("0 g")).toBeUndefined();
    // A zero size means "fit the widget", which is the viewer's job.
    expect(templateFontSize("/Helv 0 Tf")).toBeUndefined();
  });
});
