/**
 * How the sheet prints a character's resources: a tracker closes the text of
 * the first printed feature that spends it ("[Uses: ○ ○]", `inlineUsesText`).
 * Asked for, one "Resources" paragraph closes the features text with every
 * tracker, those a feature already closes included (`resourceSheetText`); every template has
 * that box, and it continues on a continuation page when the box is full.
 *
 * A printed sheet always starts fresh, whatever the Resources page has spent:
 * paper cannot un-spend a use, so the player marks uses off at the table. A
 * resource with a few uses gets an open circle for each; a large one gets a
 * blank for the count beside its maximum ("____ / 8"). A tracker the player
 * does not track is left off.
 */

import type { TrackerDto } from "@forge-cb/api";

/** The most circles drawn for one resource; beyond this a number is easier to keep. */
export const MAX_BOXES = 6;

/**
 * A use to mark off. The PDF draws it as a pip in the style of the sheet's own
 * empty checkboxes (see `sheet/pips.ts`).
 */
export const OPEN_MARK = "○";

/** The blank a large resource's count is written in. */
const COUNT_BLANK = "____";

/** How the paragraph opens; the PDF writer draws pips in the paragraph that starts with it (and in a feature's inline uses). */
export const RESOURCES_LEAD = "Resources.";

const SHORT_RECHARGE: Readonly<Record<TrackerDto["recharge"], string>> = {
  shortRest: "SR",
  longRest: "LR",
  dawn: "dawn",
  day: "day",
  never: "",
  diceRoll: "",
};

/** A tracker's marks, fresh: a circle per use up to MAX_BOXES, else a blank for the count of the most ("____ / 8"). */
function trackerMarks(tracker: TrackerDto): string {
  if (tracker.max > MAX_BOXES) return `${COUNT_BLANK} / ${tracker.max}`;
  return Array.from({ length: tracker.max }, () => OPEN_MARK).join(" ");
}

function rechargeNote(tracker: TrackerDto): string {
  return tracker.recharge === "diceRoll" ? (tracker.regain ?? "").trim() : SHORT_RECHARGE[tracker.recharge];
}

/** The unit after the marks: none for uses, nor for a label that already names it ("Sorcery Points ____ / 8"). */
function unitSuffix(tracker: TrackerDto, label: string): string {
  if (tracker.unit === "uses" || label.toLowerCase().endsWith(tracker.unit)) return "";
  return ` ${tracker.unit}`;
}

function resourceText(tracker: TrackerDto): string {
  const unit = unitSuffix(tracker, tracker.label);
  const note = rechargeNote(tracker);
  return `${tracker.label} ${trackerMarks(tracker)}${unit}${note === "" ? "" : ` (${note})`}`;
}

/** How a feature's own tracker opens when it is the feature's only one: by what it counts. */
const UNIT_LEAD: Readonly<Record<TrackerDto["unit"], string>> = {
  uses: "Uses",
  charges: "Charges",
  minutes: "Minutes",
  points: "Points",
};

/** How the PDF writer finds a feature's uses: a bracketed group closing its line, its label ending in a colon. */
export const INLINE_USES_OPEN = "[";
export const INLINE_USES_CLOSE = "]";

/** How a feature's inline uses print. */
export interface InlineUsesOptions {
  /** Add the recharge ("(LR)"), for a feature whose own line states no usage. */
  recharge?: boolean;
}

/**
 * The uses of the trackers that close one feature's text on the sheet: "[Uses: ○ ○ ○]" for its one tracker, each by its label when
 * it has several or a named pool ("[Sorcery Points: ____ / 8]"). The marks
 * follow the Resources paragraph's rules (see `resourceSheetText`); null when
 * none of them is tracked.
 */
export function inlineUsesText(trackers: readonly TrackerDto[], options: InlineUsesOptions = {}): string | null {
  const printed = trackers.filter((tracker) => tracker.tracked !== false);
  if (printed.length === 0) return null;
  return printed.map((tracker) => {
    const byUnit = printed.length === 1 && tracker.pool === undefined;
    const lead = byUnit ? UNIT_LEAD[tracker.unit] : tracker.label;
    const unit = byUnit ? "" : unitSuffix(tracker, lead);
    const note = options.recharge === true ? rechargeNote(tracker) : "";
    return `${INLINE_USES_OPEN}${lead}: ${trackerMarks(tracker)}${unit}${note === "" ? "" : ` (${note})`}${INLINE_USES_CLOSE}`;
  }).join(" ");
}

/** The "Resources" paragraph, or null when the character tracks none. */
export function resourceSheetText(trackers: readonly TrackerDto[]): string | null {
  const printed = trackers.filter((tracker) => tracker.tracked !== false);
  if (printed.length === 0) return null;
  return `${RESOURCES_LEAD} ${printed.map(resourceText).join("; ")}`;
}
