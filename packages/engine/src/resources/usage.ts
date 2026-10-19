/**
 * Reading a usage line ("2/Long Rest", "7 charges/Dawn") back into a count and a
 * recharge. Only lines in a known shape are read; a line the engine does not
 * understand ("Channel Divinity", "1/Turn") is left as text and never tracked.
 */

import type { TrackerRecharge, TrackerUnit } from "@forge-cb/api";

export interface ParsedUsage {
  count: number;
  recharge: TrackerRecharge;
  unit: TrackerUnit;
}

const RECHARGE_WORDS: Readonly<Record<string, TrackerRecharge>> = {
  "short rest": "shortRest",
  "long rest": "longRest",
  dawn: "dawn",
  day: "day",
};

/** The count and recharge a usage line states, or null when it is not in a shape the engine knows. */
export function parseUsageText(text: string | undefined | null): ParsedUsage | null {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (value === "") return null;

  const never = /^(\d+) \(no recharge\)$/i.exec(value);
  if (never) return { count: Number(never[1]), recharge: "never", unit: "uses" };
  const dice = /^(\d+) \(recharges on a dice roll\)$/i.exec(value);
  if (dice) return { count: Number(dice[1]), recharge: "diceRoll", unit: "uses" };

  // "2/Long Rest", "1 use/Short Rest", "15 HP/Long Rest": a count, an optional unit word, a recharge.
  const match = /^(\d+)(?: (uses?|charges?|minutes?|points?|hp|hit points?))?\s*\/\s*(short rest|long rest|dawn|day)$/i.exec(value);
  if (match === null) return null;
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const word = (match[2] ?? "uses").toLowerCase();
  const unit: TrackerUnit = word.startsWith("charge")
    ? "charges"
    : word.startsWith("minute")
      ? "minutes"
      : word.startsWith("point") || word === "hp" || word.startsWith("hit")
        ? "points"
        : "uses";
  return { count, recharge: RECHARGE_WORDS[match[3]!.toLowerCase()]!, unit };
}
