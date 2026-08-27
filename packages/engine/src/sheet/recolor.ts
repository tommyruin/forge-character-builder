/**
 * Recolours a generated sheet template. The templates are drawn in the
 * contract's default colours; every frame, ribbon, shield, inner line and
 * caption sets one of three exact colours with `rg`/`RG` operators, so
 * rewriting those operators in the page content streams (and in the fields'
 * default appearances, which colour the filled values) turns the whole set to
 * another scheme without a second copy of the artwork.
 */

import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, PDFString, decodePDFRawStream } from "pdf-lib";
import {
  DEFAULT_SHEET_COLOURS,
  SHEET_COLOUR_PARTS,
  SHEET_PALETTE,
  type SheetColourName,
  type SheetColours,
} from "./template-contract.js";

/** The operand text pdf-lib writes for a colour. */
function operand(rgb: readonly [number, number, number]): string {
  return rgb.map((value) => `${value}`).join(" ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paletteRgb(name: SheetColourName): readonly [number, number, number] {
  return SHEET_PALETTE[name].rgb;
}

/** Default-operand → chosen-operand for every part that differs from the default. */
function substitutions(colours: SheetColours): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of SHEET_COLOUR_PARTS) {
    if (colours[part] === DEFAULT_SHEET_COLOURS[part]) continue;
    map.set(operand(paletteRgb(DEFAULT_SHEET_COLOURS[part])), operand(paletteRgb(colours[part])));
  }
  return map;
}

/** Rewrites the default colours' `rg`/`RG` operators in `content`. */
export function recolorContent(content: string, colours: SheetColours): string {
  const map = substitutions(colours);
  if (map.size === 0) return content;
  const pattern = new RegExp(`(^|\\s)(${[...map.keys()].map(escapeRegExp).join("|")}) (rg|RG)(?=\\s|$)`, "g");
  return content.replace(pattern, (_match, lead: string, from: string, op: string) => `${lead}${map.get(from)} ${op}`);
}

function decodeLatin1(bytes: Uint8Array): string {
  // String.fromCharCode spreads a bounded argument list; page streams can exceed it.
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return text;
}

function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * Returns `template` drawn in `colours`. The default colours return the bytes
 * untouched, so the shipped templates never round-trip through pdf-lib.
 */
export async function recolorSheetTemplate(template: Uint8Array, colours: SheetColours): Promise<Uint8Array> {
  if (substitutions(colours).size === 0) return template;
  const document = await PDFDocument.load(template, { updateMetadata: false });
  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    if (contents === undefined) continue;
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref))
      : [contents];
    const chunks: Uint8Array[] = [];
    for (const stream of streams) {
      if (!(stream instanceof PDFStream)) continue;
      const decoded = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
      chunks.push(encodeLatin1(recolorContent(decodeLatin1(decoded), colours)));
    }
    const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length + 1, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length + 1;
      merged[offset - 1] = 0x0a;
    }
    page.node.set(PDFName.of("Contents"), document.context.register(document.context.flateStream(merged)));
  }
  // The filled values take their colour from each field's default appearance.
  const da = PDFName.of("DA");
  for (const field of document.getForm().getFields()) {
    const current = field.acroField.dict.get(da);
    if (!(current instanceof PDFString)) continue;
    const rewritten = recolorContent(current.asString(), colours);
    if (rewritten !== current.asString()) field.acroField.dict.set(da, PDFString.of(rewritten));
  }
  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
