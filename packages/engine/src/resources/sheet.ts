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
 * does not track is left off either way. With uses next to features (the
 * sheet model's default), a tracker only one printed feature spends closes
 * that feature's text instead (`inlineUsesText`), in the same marks.
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

/** How the paragraph opens; the PDF writer draws pips in the paragraph that starts with it (and in a feature's inline uses). */
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

/** A tracker's marks: a circle per use up to MAX_BOXES, else what is left of the most ("4 / 7"). */
function trackerMarks(tracker: TrackerDto, empty: boolean): string {
  const used = empty ? 0 : Math.min(tracker.max, Math.max(0, tracker.used));
  if (tracker.max > MAX_BOXES) return `${empty ? "____" : tracker.max - used} / ${tracker.max}`;
  return [...Array.from({ length: tracker.max - used }, () => OPEN_MARK), ...Array.from({ length: used }, () => SPENT_MARK)].join(" ");
}

function rechargeNote(tracker: TrackerDto): string {
  return tracker.recharge === "diceRoll" ? (tracker.regain ?? "").trim() : SHORT_RECHARGE[tracker.recharge];
}

function resourceText(tracker: TrackerDto, empty: boolean): string {
  const unit = tracker.unit === "uses" ? "" : ` ${tracker.unit}`;
  const note = rechargeNote(tracker);
  return `${tracker.label} ${trackerMarks(tracker, empty)}${unit}${note === "" ? "" : ` (${note})`}`;
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
export interface InlineUsesOptions extends ResourceSheetOptions {
  /** Add the recharge ("(LR)"), for a feature whose own line states no usage. */
  recharge?: boolean;
}

/**
 * The uses of the trackers one feature spends, to close that feature's text
 * on the sheet: "[Uses: ○ ○ ●]" for its one tracker, each by its label when
 * it has several or a named pool ("[Sorcery Points: 3 / 7 points]"). The marks
 * follow the Resources paragraph's rules (see `resourceSheetText`); null when
 * none of them is tracked.
 */
export function inlineUsesText(trackers: readonly TrackerDto[], options: InlineUsesOptions = {}): string | null {
  const printed = trackers.filter((tracker) => tracker.tracked !== false);
  if (printed.length === 0) return null;
  const empty = options.empty === true;
  return printed.map((tracker) => {
    const byUnit = printed.length === 1 && tracker.pool === undefined;
    const lead = byUnit ? UNIT_LEAD[tracker.unit] : tracker.label;
    const unit = byUnit || tracker.unit === "uses" ? "" : ` ${tracker.unit}`;
    const note = options.recharge === true ? rechargeNote(tracker) : "";
    return `${INLINE_USES_OPEN}${lead}: ${trackerMarks(tracker, empty)}${unit}${note === "" ? "" : ` (${note})`}${INLINE_USES_CLOSE}`;
  }).join(" ");
}

/** The "Resources" paragraph, or null when the character tracks none. */
export function resourceSheetText(trackers: readonly TrackerDto[], options: ResourceSheetOptions = {}): string | null {
  const printed = trackers.filter((tracker) => tracker.tracked !== false);
  if (printed.length === 0) return null;
  return `${RESOURCES_LEAD} ${printed.map((tracker) => resourceText(tracker, options.empty === true)).join("; ")}`;
}
