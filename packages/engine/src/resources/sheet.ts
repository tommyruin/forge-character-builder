/**
 * How the sheet prints a character's resources: one "Resources" paragraph in
 * the features text, which every template has and which continues on a
 * continuation page when a box is full. A resource with a few uses gets a box
 * for each, to tick off at the table; a large one gets a blank to write the
 * count in ("____ / 7"). The sheet prints the trackers full, as a fresh
 * sheet would be, not the state the app was left in.
 */

import type { TrackerDto } from "@forge-cb/api";

/** The most boxes drawn for one resource; beyond this a number is easier to keep. */
export const MAX_BOXES = 6;

const SHORT_RECHARGE: Readonly<Record<TrackerDto["recharge"], string>> = {
  shortRest: "SR",
  longRest: "LR",
  dawn: "dawn",
  day: "day",
  never: "",
  diceRoll: "",
};

function resourceText(tracker: TrackerDto): string {
  const unit = tracker.unit === "uses" ? "" : ` ${tracker.unit}`;
  const marks = tracker.max <= MAX_BOXES ? ` ${Array.from({ length: tracker.max }, () => "[ ]").join(" ")}${unit === "" ? "" : ` ${tracker.unit}`}` : ` ____ / ${tracker.max}${unit}`;
  const note = tracker.recharge === "diceRoll" ? (tracker.regain ?? "").trim() : SHORT_RECHARGE[tracker.recharge];
  return `${tracker.label}${marks}${note === "" ? "" : ` (${note})`}`;
}

/** The "Resources" paragraph, or null when the character has none. */
export function resourceSheetText(trackers: readonly TrackerDto[]): string | null {
  if (trackers.length === 0) return null;
  return `Resources. ${trackers.map(resourceText).join("; ")}`;
}
