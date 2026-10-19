/**
 * Text shared by the sheet's layout and drawing passes.
 *
 * Line breaking happens in `card-layout.ts` and painting happens in `pdf.ts`.
 * Both must agree on the exact string they work from, or a line measured as
 * fitting gets drawn past its box edge. Normalizing in one place is what keeps
 * the two passes in step.
 */

import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";
import { FACE_METRIC_CHARACTERS, FACE_METRICS } from "./face-metrics.js";

/**
 * The drawable form of a string: control codes and the sheet's private bullet
 * markers resolve to real glyphs, and anything outside WinAnsi degrades to "?".
 */
export function winAnsiText(value: string): string {
  return value
    .replaceAll("\u0007", "•")
    .replaceAll("♊", "•")
    .replaceAll("✝", "†")
    .replaceAll("\u00a0", " ")
    .replace(/[\u0000-\u001f]/g, " ")
    // Any remaining glyph outside WinAnsi (Latin-1 plus the cp1252 typographic
    // block) degrades to "?" instead of aborting the whole sheet build --
    // third-party content is unconstrained input here.
    .replace(/[^\u0020-\u007e\u00a1-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/gu, "?");
}

/** The styles the sheet draws in, each mapping to a Helvetica variant. */
export type TextStyle = "regular" | "bold" | "italic" | "bold-italic";

const styleFonts: Record<TextStyle, Font> = {
  regular: Font.load(FontNames.Helvetica),
  bold: Font.load(FontNames.HelveticaBold),
  italic: Font.load(FontNames.HelveticaOblique),
  "bold-italic": Font.load(FontNames.HelveticaBoldOblique),
};

/** WinAnsi glyph name for a code point, matching winAnsiText's "?" fallback. */
function glyphName(codePoint: number): string {
  try {
    return Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint).name;
  } catch {
    return "question";
  }
}

// Advances scale linearly with font size, so each string is measured once at
// size 1 and reused for every candidate size the shrink-to-fit searches try.
const unitWidths = new Map<string, number>();

const faceTableStyles: Record<TextStyle, "regular" | "bold" | "italic" | "boldItalic"> = {
  regular: "regular", bold: "bold", italic: "italic", "bold-italic": "boldItalic",
};
const faceCharacterIndex = new Map([...FACE_METRIC_CHARACTERS].map((character, index) => [character, index]));
const QUESTION_INDEX = faceCharacterIndex.get("?")!;

function unitWidth(text: string, style: TextStyle, face: string | undefined): number {
  const table = face === undefined ? undefined : FACE_METRICS[face]?.[faceTableStyles[style]];
  const key = `${table === undefined ? "" : face} ${style} ${text}`;
  const cached = unitWidths.get(key);
  if (cached !== undefined) return cached;
  let units = 0;
  if (table !== undefined) {
    for (const character of text) units += table[faceCharacterIndex.get(character) ?? QUESTION_INDEX] ?? 0;
  } else {
    const font = styleFonts[style];
    for (const character of text) units += font.getWidthOfGlyph(glyphName(character.codePointAt(0)!)) || 0;
  }
  unitWidths.set(key, units);
  return units;
}

/**
 * How wide `text` will be once drawn, in points.
 *
 * Deliberately not pdf-lib's `widthOfTextAtSize`: that subtracts the font's
 * kerning pairs, but the text is painted as a plain show-text operator, which a
 * viewer lays out on advance widths alone. The two disagree by as much as 10%
 * on capitals ("AVATAR" at 7pt renders 28.01pt wide, not 25.28pt), and
 * measuring the narrower number is what lets a line wrap a word too late and
 * print past the edge of its box.
 *
 * `face` names the body face the text will be drawn in (a SHEET_FONT_FACES
 * key); a face with generated width tables (face-metrics.ts) is measured in
 * its own advances, any other in Helvetica's.
 */
export function measuredTextWidth(text: string, fontSize: number, style: TextStyle = "regular", face?: string): number {
  return unitWidth(winAnsiText(text), style, face) * fontSize / 1000;
}
