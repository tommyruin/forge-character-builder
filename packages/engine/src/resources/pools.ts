/**
 * Point pools the book states without a usage line.
 *
 * A feature such as Font of Magic prints "You have {{sorcery points:amount}}
 * Sorcery Points" and sets that statistic in its rules, but its sheet block
 * carries no "N/Long Rest" line, so the usage reader never sees it. These
 * pools are named here by element id, with the statistic that holds their size
 * and the rest that refills them, so they are tracked like any other book
 * feature: under `usage:<element id>`, beside the feature that grants them.
 */

import type { TrackerRecharge, TrackerUnit } from "@forge-cb/api";

export interface PointPool {
  /** The statistic the element's rules set to the pool's size. */
  stat: string;
  /** The tracker's name in the Resources list. */
  label: string;
  unit: TrackerUnit;
  recharge: TrackerRecharge;
}

export const POOL_TRACKERS: ReadonlyMap<string, PointPool> = new Map<string, PointPool>([
  // Regained in full on a long rest (2014 and 2024 alike).
  ["ID_WOTC_PHB24_CLASS_FEATURE_SORCERER_FONT_OF_MAGIC", { stat: "sorcery points:amount", label: "Sorcery Points", unit: "points", recharge: "longRest" }],
  ["ID_WOTC_PHB_CLASS_FEATURE_SORCERER_FONT_OF_MAGIC", { stat: "sorcery-points", label: "Sorcery Points", unit: "points", recharge: "longRest" }],
  // Regained in full on a short or long rest; a long rest refills short-rest trackers too.
  ["ID_WOTC_PHB24_CLASS_FEATURE_MONK_MONKS_FOCUS", { stat: "monks focus:points", label: "Focus Points", unit: "points", recharge: "shortRest" }],
  ["ID_WOTC_PHB_CLASS_FEATURE_MONK_KI", { stat: "ki:points", label: "Ki Points", unit: "points", recharge: "shortRest" }],
]);
