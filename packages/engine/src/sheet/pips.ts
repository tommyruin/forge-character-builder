/**
 * The resource pips of the printed sheet.
 *
 * The sheet model writes a resource tracker's uses as "○" (left) and "●"
 * (spent), which previews and text exports read as they are. No sheet face has
 * either glyph, so the PDF writer draws each one as a small copy of the sheet's
 * own checkbox marker instead: the empty death-save box for a use left, the
 * ticked one for a use spent. Only the Resources paragraph is drawn this way;
 * the same marks anywhere else print as text (see `winAnsiText`).
 *
 * During line layout a pip is an inline box of fixed width, so wrapping,
 * continuation pages and every body face treat it like any other piece of a
 * word. This module holds the pure part: which words carry pips, how a word
 * splits into text and pips, and how wide a pip is at a given size.
 */

import { OPEN_MARK, RESOURCES_LEAD, SPENT_MARK } from "../resources/sheet.js";
import type { SheetMarker } from "./template-contract.js";

/**
 * Which of the page's own tracks the pips copy: the death saves, drawn in the
 * set's marker (rounded squares on a 2014 page, circles on a 2024 one), or
 * the exhaustion track, rounded squares on every set. Both are a white marker
 * ruled in the accent colour, ticked with the same dot. An internal switch,
 * not a sheet setting.
 */
export type PipLook = "death-save" | "exhaustion";
/**
 * The exhaustion squares, for now: at text size a cap-height circle in the
 * print theme's black reads as a capital O, where a rounded square reads only
 * as a box to tick, and it is the same box on every set.
 */
export const DEFAULT_PIP_LOOK: PipLook = "exhaustion";

/** The marker the pips draw for `look` on a set whose checkboxes use `setMarker`. */
export function pipMarker(look: PipLook, setMarker: SheetMarker): SheetMarker {
  return look === "exhaustion" ? "square" : setMarker;
}

/**
 * The template checkbox a pip copies, in points: a 6pt marker ruled with a
 * 0.6pt stroke, a rounded square's corners at 1.2pt (see
 * scripts/build-sheet-templates.mjs `check`; the 2024 exhaustion boxes are
 * 7pt with the same stroke and corners).
 */
export const MARKER_BOX = 6;
export const MARKER_STROKE = 0.6;
export const MARKER_CORNER = 1.2;
/** A ticked checkbox's dot: its radius as a share of the marker's size. */
export const CHECK_DOT_RATIO = 0.28;

/**
 * Room either side of a pip, as a share of its size, so its stroke never
 * touches a neighbouring glyph ("○;"). The word space sets pips apart from
 * one another, as it does words.
 */
export const PIP_SIDE_BEARING = 0.08;

/** A word's pieces: runs of text, and a pip for each mark. */
export type PipSegment = { kind: "text"; text: string } | { kind: "pip"; spent: boolean };

/** Whether a features line is the Resources paragraph, the only one drawn with pips. */
export function isPipParagraph(line: string): boolean {
  return line === RESOURCES_LEAD || line.startsWith(`${RESOURCES_LEAD} `);
}

/** Whether `word` holds a tracker mark. */
export function hasPips(word: string): boolean {
  return word.includes(OPEN_MARK) || word.includes(SPENT_MARK);
}

/** Splits a word into text runs and pips, in order ("○;" is a pip, then ";"). */
export function pipSegments(word: string): PipSegment[] {
  const segments: PipSegment[] = [];
  let text = "";
  for (const character of word) {
    if (character !== OPEN_MARK && character !== SPENT_MARK) {
      text += character;
      continue;
    }
    if (text !== "") segments.push({ kind: "text", text });
    text = "";
    segments.push({ kind: "pip", spent: character === SPENT_MARK });
  }
  if (text !== "") segments.push({ kind: "text", text });
  return segments;
}

/** A pip's measurements at one size, in points. */
export interface PipBox {
  /** The marker's height and width: the body face's cap height at this size. */
  size: number;
  /** The width the pip takes in the line, the marker centred in it. */
  advance: number;
  stroke: number;
  /** A rounded square's corner radius. */
  corner: number;
  /** The radius of a spent use's dot. */
  dotRadius: number;
}

/**
 * The pip for text set at `fontSize` in a face whose cap height is
 * `capHeight` of the size: as tall as a capital, the marker's stroke and
 * corners scaled with it.
 */
export function pipBox(fontSize: number, capHeight: number): PipBox {
  const size = fontSize * capHeight;
  const scale = size / MARKER_BOX;
  return {
    size,
    advance: size * (1 + 2 * PIP_SIDE_BEARING),
    stroke: MARKER_STROKE * scale,
    corner: MARKER_CORNER * scale,
    dotRadius: size * CHECK_DOT_RATIO,
  };
}

/**
 * How wide a word with pips is: its text runs as `measure` gives them (each
 * run drawn on its own, so measured on its own), plus a pip's advance for each
 * mark.
 */
export function pipWordWidth(word: string, fontSize: number, capHeight: number, measure: (text: string) => number): number {
  const advance = pipBox(fontSize, capHeight).advance;
  let width = 0;
  for (const segment of pipSegments(word)) width += segment.kind === "pip" ? advance : measure(segment.text);
  return width;
}
