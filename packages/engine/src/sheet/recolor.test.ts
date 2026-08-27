import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFArray, PDFDocument, PDFName, type PDFRawStream, type PDFString, decodePDFRawStream } from "pdf-lib";
import { recolorContent, recolorSheetTemplate } from "./recolor.js";
import { DEFAULT_SHEET_COLOURS, SHEET_PALETTE, SHEET_TEMPLATE_CONTRACT, SHEET_THEMES } from "./template-contract.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const DETAILS = join(ROOT, "apps", "client", "public", SHEET_TEMPLATE_CONTRACT.directory, "2014", SHEET_TEMPLATE_CONTRACT.files.details);
const rgb = (_part: "accent" | "lines" | "text", name: keyof typeof SHEET_PALETTE) => SHEET_PALETTE[name].rgb.join(" ");

async function pageContent(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes);
  const contents = document.getPages()[0]!.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => document.context.lookup(ref))
    : [contents];
  return streams
    .map((stream) => Array.from(decodePDFRawStream(stream as PDFRawStream).decode(), (byte) => String.fromCharCode(byte)).join(""))
    .join("\n");
}

describe("sheet template recolouring", () => {
  it("rewrites the default colours' operators in one pass and leaves everything else", () => {
    const content = `${rgb("accent", "crimson")} rg ${rgb("lines", "gold")} RG ${rgb("text", "ink")} rg 1 1 1 rg 10.47 0.13 0.11 rg`;
    expect(recolorContent(content, { accent: "ocean", lines: "silver", text: "black" }))
      .toBe(`${rgb("accent", "ocean")} rg ${rgb("lines", "silver")} RG ${rgb("text", "black")} rg 1 1 1 rg 10.47 0.13 0.11 rg`);
    expect(recolorContent(content, { ...DEFAULT_SHEET_COLOURS, lines: "bronze" }))
      .toBe(`${rgb("accent", "crimson")} rg ${rgb("lines", "bronze")} RG ${rgb("text", "ink")} rg 1 1 1 rg 10.47 0.13 0.11 rg`);
    expect(recolorContent(content, DEFAULT_SHEET_COLOURS)).toBe(content);
  });

  it("returns the shipped bytes untouched for the default colours", async () => {
    const template = readFileSync(DETAILS);
    expect(await recolorSheetTemplate(template, DEFAULT_SHEET_COLOURS)).toBe(template);
  });

  it("recolours a shipped template's artwork and field appearances and keeps its fields", async () => {
    const template = readFileSync(DETAILS);
    const before = await pageContent(template);
    expect(before).toContain(`${rgb("accent", "crimson")} rg`);
    expect(before).toContain(`${rgb("lines", "gold")} RG`);
    const theme = SHEET_THEMES.ocean;
    const recoloured = await recolorSheetTemplate(template, theme);
    const after = await pageContent(recoloured);
    // The artwork carries the accent and line colours as fills or strokes;
    // text lives in the label sheet and the fields' default appearances.
    const uses = (content: string, part: "accent" | "lines", name: keyof typeof SHEET_PALETTE) =>
      new RegExp(`(^|\\s)${rgb(part, name).replaceAll(".", "\\.")} (rg|RG)(\\s|$)`).test(content);
    for (const part of ["accent", "lines"] as const) {
      expect(uses(before, part, DEFAULT_SHEET_COLOURS[part])).toBe(true);
      expect(uses(after, part, DEFAULT_SHEET_COLOURS[part])).toBe(false);
      expect(uses(after, part, theme[part])).toBe(true);
    }
    const original = await PDFDocument.load(template);
    const document = await PDFDocument.load(recoloured);
    expect(document.getForm().getFields().length).toBe(original.getForm().getFields().length);
    const appearance = document.getForm().getTextField("details_character_name").acroField.dict.get(PDFName.of("DA"));
    expect((appearance as PDFString).asString()).toContain(`${rgb("text", theme.text)} rg`);
  });
});
