/**
 * The sheet's framed-box idiom, shared by the template generator
 * (scripts/build-sheet-templates.mjs) and the PDF writer, which draws the
 * Resources box to match the frames printed around it: a chamfered panel ruled
 * in the accent colour with a fine inner line in the lines colour.
 */

/** The frame's strokes and how far its inner line sits inside the outer one, in points. */
export const SHEET_FRAME = {
  radius: 4,
  outerStroke: 0.9,
  innerInset: 2.2,
  innerStroke: 0.35,
} as const;

/**
 * A rectangle with its corners cut at 45 degrees, as an SVG path from its
 * top-left corner with y running downwards.
 */
export function chamferRectPath(width: number, height: number, cut: number): string {
  return `M ${cut} 0 H ${width - cut} L ${width} ${cut} V ${height - cut} L ${width - cut} ${height} H ${cut} L 0 ${height - cut} V ${cut} Z`;
}

/** A frame's outer and inner paths; the inner path starts `SHEET_FRAME.innerInset` inside the outer. */
export function sheetFramePaths(width: number, height: number, radius: number = SHEET_FRAME.radius): { outer: string; inner: string } {
  const cut = Math.min(radius + 2, width / 3, height / 3);
  const inset = SHEET_FRAME.innerInset * 2;
  return {
    outer: chamferRectPath(width, height, cut),
    inner: chamferRectPath(width - inset, height - inset, Math.max(1, cut - 2)),
  };
}
