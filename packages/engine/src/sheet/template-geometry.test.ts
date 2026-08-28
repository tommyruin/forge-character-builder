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
