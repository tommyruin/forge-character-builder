/**
 * Trackers (B7) and scale values (B9) on a draft: the vocabulary a form offers,
 * the validation that names the field a mistake is in, and the pieces the
 * compiler turns into rules and sheet text.
 *
 * A scale value is a per-level table. It compiles to level-gated statistics
 * under the key `scale:<name>`: a count adds the difference between steps so the
 * running total is the table's value, and a die is inline text from each level,
 * so `{{scale:name}}` in sheet text reads the die the character has reached.
 *
 * A tracker's maximum is a literal, or a statistic named `uses:<tracker id>`
 * that follows the character (a base rule, so a minimum is a second base rule
 * and the larger wins, the way the engine's own bard counts do). The statistic
 * is what both the sheet's usage line and the Resources page read, so they can
 * never disagree.
 */

import { valueReference } from "./catalogue.js";
import {
  TRACKER_RECHARGES,
  TRACKER_UNITS,
  type CustomEntryDraft,
  type ScaleValue,
  type TrackerDef,
  type TrackerRecharge,
  type TrackerUnit,
} from "./schema.js";

export interface CustomDraftIssueLike {
  path: string;
  message: string;
}

export const MAX_TRACKERS = 12;
export const MAX_SCALES = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isName = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= max;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SAFE_TEXT = /^[^<>&"]*$/;
const SCALE_NAME = /^[A-Za-z][A-Za-z0-9 ]{0,39}$/;
const STAT_KEY = /^[a-z][a-z0-9 :_-]{0,60}$/;
const CLASS_WORDS = /^[A-Za-z0-9][A-Za-z0-9 ]*$/;
const DICE = /^(?:[1-9][0-9]?)?d[1-9][0-9]{0,2}$/;

export interface RechargeOption {
  id: TrackerRecharge;
  label: string;
  /** The word after the slash in a usage line ("2/Long Rest"); empty when the line words it otherwise. */
  word: string;
}

export const TRACKER_RECHARGE_OPTIONS: readonly RechargeOption[] = [
  { id: "shortRest", label: "Short Rest", word: "Short Rest" },
  { id: "longRest", label: "Long Rest", word: "Long Rest" },
  { id: "dawn", label: "Dawn", word: "Dawn" },
  { id: "day", label: "Day", word: "Day" },
  { id: "never", label: "Never", word: "" },
  { id: "diceRoll", label: "Dice roll", word: "" },
];

export const TRACKER_UNIT_OPTIONS: ReadonlyArray<{ id: TrackerUnit; label: string; singular: string }> = [
  { id: "uses", label: "Uses", singular: "use" },
  { id: "charges", label: "Charges", singular: "charge" },
  { id: "minutes", label: "Minutes", singular: "minute" },
  { id: "points", label: "Points", singular: "point" },
];

/** The recharges a rest refills by itself, by the rest that does it. */
export const REST_RECHARGES: Readonly<Record<"short" | "long", readonly TrackerRecharge[]>> = {
  short: ["shortRest"],
  // A long rest ends the day and runs through dawn, so it refills those too.
  long: ["shortRest", "longRest", "dawn", "day"],
};

/** The words after "per" or "at" that a card shows under a tracker. */
export function rechargeLabel(tracker: Pick<TrackerDef, "recharge" | "regain">): string {
  switch (tracker.recharge) {
    case "shortRest":
      return "per Short Rest";
    case "longRest":
      return "per Long Rest";
    case "dawn":
      return "regained at dawn";
    case "day":
      return "per day";
    case "never":
      return "no recharge";
    case "diceRoll":
      return tracker.regain === undefined || tracker.regain.trim() === "" ? "recharges on a dice roll" : `regains ${tracker.regain.trim()}`;
  }
}

/** A scale's name as a statistic suffix: lowercase words, so `{{scale:moonlight die}}` reads the table. */
export const scaleSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The statistic a scale value is stored under. */
export const scaleKey = (scale: Pick<ScaleValue, "name">): string => `scale:${scaleSlug(scale.name)}`;

/** The statistic that holds a tracker's maximum when it follows the character. */
export const trackerStatKey = (tracker: Pick<TrackerDef, "id">): string => `uses:${tracker.id.toLowerCase()}`;

export const isLiteralMax = (tracker: Pick<TrackerDef, "max">): tracker is Pick<TrackerDef, "max"> & { max: { kind: "number"; value: number } } =>
  tracker.max.kind === "number";

const unitWord = (unit: TrackerUnit, count: number | string): string => {
  const option = TRACKER_UNIT_OPTIONS.find((entry) => entry.id === unit)!;
  return count === 1 ? option.singular : option.id;
};

/**
 * The sheet usage line for a tracker. A maximum that follows the character is
 * a `{{token}}` the sheet substitutes from its statistic; a literal prints as it
 * is. `uses` is the default unit and is not named ("2/Short Rest").
 */
export function trackerUsageText(tracker: TrackerDef): string {
  const count: number | string = tracker.max.kind === "number" ? tracker.max.value : `{{${trackerStatKey(tracker)}}}`;
  const amount = tracker.unit === "uses" ? `${count}` : `${count} ${unitWord(tracker.unit, count)}`;
  switch (tracker.recharge) {
    case "never":
      return `${amount} (no recharge)`;
    case "diceRoll": {
      const regain = tracker.regain?.trim() ?? "";
      return regain === "" ? `${amount} (recharges on a dice roll)` : `${amount} (regains ${regain})`;
    }
    default:
      return `${amount}/${TRACKER_RECHARGE_OPTIONS.find((option) => option.id === tracker.recharge)!.word}`;
  }
}

/** The usage line of a list of trackers: each one's, joined. */
export function trackersUsageText(trackers: readonly TrackerDef[] | undefined): string | undefined {
  if (trackers === undefined || trackers.length === 0) return undefined;
  return trackers.map(trackerUsageText).join("; ");
}

/** The statistic rules (`name`, `value`, `bonus`) that make a tracker's maximum follow the character. */
export function trackerRuleSpecs(tracker: TrackerDef, scales: readonly ScaleValue[]): Array<{ name: string; value: string; bonus: string }> {
  const name = trackerStatKey(tracker);
  const max = tracker.max;
  switch (max.kind) {
    case "number":
      return [];
    case "reference": {
      const rules = [{ name, value: max.ref, bonus: "base" }];
      if (max.min !== undefined) rules.push({ name, value: String(max.min), bonus: "base" });
      return rules;
    }
    case "classLevel":
      return [{ name, value: `level:${max.className.toLowerCase()}`, bonus: "base" }];
    case "scale": {
      const scale = scales.find((entry) => entry.id === max.scale);
      return scale === undefined ? [] : [{ name, value: scaleKey(scale), bonus: "base" }];
    }
    case "stat":
      return [{ name, value: max.key, bonus: "base" }];
  }
}

/** The statistic rules a scale value compiles to, ascending by level. */
export function scaleRuleSpecs(scale: ScaleValue): Array<{ name: string; value: string; level: number; inline: boolean }> {
  const name = scaleKey(scale);
  const steps = [...scale.steps].sort((left, right) => left.level - right.level);
  if (scale.kind === "dice") {
    return steps.map((step) => ({ name, value: String(step.value), level: step.level, inline: true }));
  }
  let previous = 0;
  return steps.map((step) => {
    const delta = Number(step.value) - previous;
    previous = Number(step.value);
    return { name, value: String(delta), level: step.level, inline: false };
  });
}

// ---- validation ---------------------------------------------------------------

/** The statistic menu the "follows a statistic" maximum offers; never typed. */
function maxIssues(max: unknown, path: string, scales: ReadonlyMap<string, ScaleValue>, literalOnly: boolean): CustomDraftIssueLike[] {
  if (!isRecord(max)) return [{ path, message: "give how many it holds" }];
  if (max.kind === "number") {
    return isWholeNumber(max.value) && max.value >= 1 && max.value <= 999
      ? []
      : [{ path: `${path}.value`, message: "how many it holds is a whole number from 1 to 999" }];
  }
  if (literalOnly) return [{ path, message: "this kind of entry holds a fixed number of charges" }];
  if (max.kind === "reference") {
    const issues: CustomDraftIssueLike[] = [];
    if (typeof max.ref !== "string" || valueReference(max.ref) === undefined) {
      issues.push({ path: `${path}.ref`, message: "pick a value from the menu" });
    }
    if (max.min !== undefined && !(isWholeNumber(max.min) && max.min >= 0 && max.min <= 99)) {
      issues.push({ path: `${path}.min`, message: "the minimum is a whole number from 0 to 99" });
    }
    return issues;
  }
  if (max.kind === "classLevel") {
    return typeof max.className === "string" && CLASS_WORDS.test(max.className)
      ? []
      : [{ path: `${path}.className`, message: "name the class whose level is used" }];
  }
  if (max.kind === "scale") {
    const scale = typeof max.scale === "string" ? scales.get(max.scale) : undefined;
    return scale !== undefined && scale.kind === "number"
      ? []
      : [{ path: `${path}.scale`, message: "pick one of this entry's scale values that is a count" }];
  }
  if (max.kind === "stat") {
    return typeof max.key === "string" && STAT_KEY.test(max.key) ? [] : [{ path: `${path}.key`, message: "pick a statistic from the menu" }];
  }
  return [{ path, message: "give how many it holds" }];
}

export function trackerIssues(
  trackers: unknown,
  scales: ReadonlyMap<string, ScaleValue>,
  options: { literalOnly?: boolean } = {},
): CustomDraftIssueLike[] {
  if (trackers === undefined) return [];
  if (!Array.isArray(trackers) || trackers.length > MAX_TRACKERS) {
    return [{ path: "trackers", message: `limited uses are a list of at most ${MAX_TRACKERS}` }];
  }
  const issues: CustomDraftIssueLike[] = [];
  const ids = new Set<string>();
  trackers.forEach((raw: unknown, index: number) => {
    const path = `trackers[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: "a limited use must be an object" });
      return;
    }
    if (typeof raw.id !== "string" || !ID.test(raw.id)) issues.push({ path: `${path}.id`, message: "every limited use needs a stable id" });
    else if (ids.has(raw.id)) issues.push({ path: `${path}.id`, message: "two limited uses share an id" });
    else ids.add(raw.id);
    if (!isName(raw.label, 60) || !SAFE_TEXT.test(raw.label as string)) {
      issues.push({ path: `${path}.label`, message: "name the limited use (at most 60 characters, without < > & or quotes)" });
    }
    issues.push(...maxIssues(raw.max, `${path}.max`, scales, options.literalOnly === true));
    if (!TRACKER_UNITS.includes(raw.unit as never)) issues.push({ path: `${path}.unit`, message: "pick uses, charges, minutes or points" });
    if (!TRACKER_RECHARGES.includes(raw.recharge as never)) {
      issues.push({ path: `${path}.recharge`, message: "pick Short Rest, Long Rest, Dawn, Day, Never or Dice roll" });
    }
    if (raw.regain !== undefined) {
      if (raw.recharge !== "diceRoll") issues.push({ path: `${path}.regain`, message: "only a dice-roll recharge says what the roll regains" });
      else if (!isName(raw.regain, 60) || !SAFE_TEXT.test(raw.regain as string)) {
        issues.push({ path: `${path}.regain`, message: "say what the roll regains (at most 60 characters, without < > & or quotes)" });
      }
    }
    if (raw.pool !== undefined && !(isName(raw.pool, 40) && SAFE_TEXT.test(raw.pool as string))) {
      issues.push({ path: `${path}.pool`, message: "a shared pool needs a short name without < > & or quotes" });
    }
    if (raw.spendOnSwitch !== undefined && !(isName(raw.spendOnSwitch, 40) && SAFE_TEXT.test(raw.spendOnSwitch as string))) {
      issues.push({ path: `${path}.spendOnSwitch`, message: "name the switch that spends a use" });
    }
  });
  return issues;
}

export function scaleIssues(scales: unknown): CustomDraftIssueLike[] {
  if (scales === undefined) return [];
  if (!Array.isArray(scales) || scales.length > MAX_SCALES) {
    return [{ path: "scales", message: `scale values are a list of at most ${MAX_SCALES}` }];
  }
  const issues: CustomDraftIssueLike[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  scales.forEach((raw: unknown, index: number) => {
    const path = `scales[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: "a scale value must be an object" });
      return;
    }
    if (typeof raw.id !== "string" || !ID.test(raw.id)) issues.push({ path: `${path}.id`, message: "every scale value needs a stable id" });
    else if (ids.has(raw.id)) issues.push({ path: `${path}.id`, message: "two scale values share an id" });
    else ids.add(raw.id);
    if (typeof raw.name !== "string" || !SCALE_NAME.test(raw.name) || scaleSlug(raw.name) === "") {
      issues.push({ path: `${path}.name`, message: "name the scale value with letters, digits and spaces (at most 40 characters)" });
    } else if (slugs.has(scaleSlug(raw.name))) {
      issues.push({ path: `${path}.name`, message: "two scale values have the same name" });
    } else {
      slugs.add(scaleSlug(raw.name));
    }
    const kind = raw.kind;
    if (kind !== "number" && kind !== "dice") issues.push({ path: `${path}.kind`, message: "a scale value is a count or a die" });
    const steps = raw.steps;
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > 20) {
      issues.push({ path: `${path}.steps`, message: "list from 1 to 20 levels" });
      return;
    }
    let previous = 0;
    steps.forEach((step: unknown, at: number) => {
      const where = `${path}.steps[${at}]`;
      if (!isRecord(step) || !(isWholeNumber(step.level) && step.level >= 1 && step.level <= 20)) {
        issues.push({ path: `${where}.level`, message: "a level is a whole number from 1 to 20" });
      } else if (step.level <= previous) {
        issues.push({ path: `${where}.level`, message: "levels run upward, each once" });
      } else {
        previous = step.level;
      }
      const value = isRecord(step) ? step.value : undefined;
      if (kind === "number" && !(isWholeNumber(value) && value >= 0 && value <= 999)) {
        issues.push({ path: `${where}.value`, message: "a count is a whole number from 0 to 999" });
      } else if (kind === "dice" && !(typeof value === "string" && DICE.test(value))) {
        issues.push({ path: `${where}.value`, message: "write the die like d6 or 2d8" });
      }
    });
  });
  return issues;
}

/** The scale values of a draft by id (an empty map for a draft that has none or holds nonsense). */
export function scalesById(draft: unknown): ReadonlyMap<string, ScaleValue> {
  const scales = isRecord(draft) && Array.isArray(draft.scales) ? draft.scales : [];
  const map = new Map<string, ScaleValue>();
  for (const scale of scales as unknown[]) {
    if (isRecord(scale) && typeof scale.id === "string") map.set(scale.id, scale as unknown as ScaleValue);
  }
  return map;
}

/** The trackers a stored entry declares (features and items; a spell has none). */
export function entryTrackers(draft: CustomEntryDraft): readonly TrackerDef[] {
  return "trackers" in draft && draft.trackers !== undefined ? draft.trackers : [];
}
