/**
 * How the sheet prints a character's resources: one "Resources" paragraph in
 * the features text, which every template has and which continues on a
 * continuation page when a box is full. A resource with a few uses gets a
 * circle for each; a large one gets a count ("4 / 7").
 *
 * By default the paragraph shows each tracker as the Resources page left it:
 * an open circle per use left, then a filled one per use spent (the page's own
 * order, spent uses at the end), and what is left of a large one. Printed
 * empty, it is a fresh sheet to fill in at the table: an open circle per use,
 * and a blank for the count of a large one ("____ / 7"). A tracker the player
 * does not track is left off either way.
 */

import type { TrackerDto } from "@forge-cb/api";

/** The most circles drawn for one resource; beyond this a number is easier to keep. */
export const MAX_BOXES = 6;

/**
 * A use left (and every use, on an empty sheet). The PDF draws it as a pip in
 * the style of the sheet's own empty checkboxes (see `sheet/pips.ts`).
 */
export const OPEN_MARK = "○";
/** A use spent. The PDF draws it as a ticked checkbox pip: the empty one with a dot inside. */
export const SPENT_MARK = "●";

/** How the paragraph opens; the PDF writer draws pips only in the paragraph that starts with it. */
export const RESOURCES_LEAD = "Resources.";

/** How the paragraph prints: as the Resources page left it, or empty to fill in at the table. */
export interface ResourceSheetOptions {
  empty?: boolean;
}

const SHORT_RECHARGE: Readonly<Record<TrackerDto["recharge"], string>> = {
  shortRest: "SR",
  longRest: "LR",
  dawn: "dawn",
  day: "day",
  never: "",
  diceRoll: "",
};

function resourceText(tracker: TrackerDto, empty: boolean): string {
  const unit = tracker.unit === "uses" ? "" : ` ${tracker.unit}`;
  const used = empty ? 0 : Math.min(tracker.max, Math.max(0, tracker.used));
  const circles = [...Array.from({ length: tracker.max - used }, () => OPEN_MARK), ...Array.from({ length: used }, () => SPENT_MARK)];
  const marks = tracker.max <= MAX_BOXES
    ? ` ${circles.join(" ")}${unit}`
    : ` ${empty ? "____" : tracker.max - used} / ${tracker.max}${unit}`;
  const note = tracker.recharge === "diceRoll" ? (tracker.regain ?? "").trim() : SHORT_RECHARGE[tracker.recharge];
  return `${tracker.label}${marks}${note === "" ? "" : ` (${note})`}`;
}

/** The "Resources" paragraph, or null when the character tracks none. */
export function resourceSheetText(trackers: readonly TrackerDto[], options: ResourceSheetOptions = {}): string | null {
  const printed = trackers.filter((tracker) => tracker.tracked !== false);
  if (printed.length === 0) return null;
  return `${RESOURCES_LEAD} ${printed.map((tracker) => resourceText(tracker, options.empty === true)).join("; ")}`;
}
