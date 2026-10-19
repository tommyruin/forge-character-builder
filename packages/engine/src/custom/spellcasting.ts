/**
 * B10, spellcasting setup: the standard slot tables, the validation of a
 * caster's settings and the rules a caster compiles to.
 *
 * The shapes follow the bundled classes: a spellcasting feature holds a
 * `<spellcasting name ability prepare allowReplace><list/></spellcasting>`
 * block and, in its rules, one statistic per slot level
 * (`<caster>:spellcasting:slots:N`, a value added at each class level so the
 * running total is the table), the prepare formula
 * (`<caster>:spellcasting:prepare`), the multiclass slot marker the statistics
 * read, and the cantrip and spell selects.
 */

import type { CustomSpellcasting, FilterNode, MulticlassSlotShare, SlotProgression } from "@forge-cb/api";
import { CASTING_STYLES, CUSTOM_ABILITIES, MULTICLASS_SLOT_SHARES, SLOT_PROGRESSIONS } from "@forge-cb/api";
import { compileFilter, filterIssues } from "./conditions.js";
import { attributes, escapeText } from "./xml-text.js";

export interface SpellcastingIssue {
  path: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isWholeNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const WORDS = /^[A-Za-z0-9][A-Za-z0-9 '-]*$/;

/** Slots of each level (1-9) by class level: row 0 is class level 1. */
type SlotRows = readonly (readonly number[])[];

/** The full caster's table (wizard, cleric, druid, bard, sorcerer). */
const FULL_ROWS: SlotRows = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** The half caster's table (paladin, ranger): slots start at class level 2. */
const HALF_ROWS: SlotRows = [
  [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1],
  [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
];

/** The third caster's table (eldritch knight, arcane trickster): slots start at class level 3. */
const THIRD_ROWS: SlotRows = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2],
  [4, 3, 3], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];

/** Pact magic: from this class level, this many slots, all of this level. */
export const PACT_STEPS: ReadonlyArray<{ level: number; slots: number; slotLevel: number }> = [
  { level: 1, slots: 1, slotLevel: 1 },
  { level: 2, slots: 2, slotLevel: 1 },
  { level: 3, slots: 2, slotLevel: 2 },
  { level: 5, slots: 2, slotLevel: 3 },
  { level: 7, slots: 2, slotLevel: 4 },
  { level: 9, slots: 2, slotLevel: 5 },
  { level: 11, slots: 3, slotLevel: 5 },
  { level: 17, slots: 4, slotLevel: 5 },
];

const STANDARD_ROWS: Readonly<Record<"full" | "half" | "third", SlotRows>> = { full: FULL_ROWS, half: HALF_ROWS, third: THIRD_ROWS };

/** A table of 20 rows by 9 slot levels of totals for the progression, or null for a pact caster. */
export function slotTotals(spellcasting: Pick<CustomSpellcasting, "slots">): number[][] | null {
  const { progression, table } = spellcasting.slots;
  if (progression === "pact") return null;
  if (progression === "custom") {
    return Array.from({ length: 20 }, (_, level) => Array.from({ length: 9 }, (_, slot) => table?.[level]?.[slot] ?? 0));
  }
  return STANDARD_ROWS[progression].map((row) => Array.from({ length: 9 }, (_, slot) => row[slot] ?? 0));
}

/** What a multiclass character counts from a class of this progression, unless the author says otherwise. */
export function defaultMulticlassShare(progression: SlotProgression): MulticlassSlotShare {
  switch (progression) {
    case "full":
      return "full";
    case "half":
      return "half";
    case "third":
      return "third";
    case "pact":
      return "solo";
    case "custom":
      return "none";
  }
}

const SHARE_MARKER: Readonly<Record<Exclude<MulticlassSlotShare, "none">, string>> = {
  full: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL",
  half: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF",
  third: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD",
  solo: "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO",
};

/** The class level a caster first has anything to cast or learn at. */
export function firstCastingLevel(spellcasting: CustomSpellcasting): number {
  const levels: number[] = [];
  const totals = slotTotals(spellcasting);
  if (totals === null) levels.push(1);
  else {
    const at = totals.findIndex((row) => row.some((count) => count > 0));
    if (at >= 0) levels.push(at + 1);
  }
  for (const step of spellcasting.cantrips ?? []) if (step.known > 0) levels.push(step.level);
  for (const step of spellcasting.spells ?? []) if (step.known > 0) levels.push(step.level);
  return levels.length === 0 ? 1 : Math.min(...levels);
}

// ---- validation ---------------------------------------------------------------

function stepIssues(steps: unknown, path: string, label: string): SpellcastingIssue[] {
  if (steps === undefined) return [];
  if (!Array.isArray(steps) || steps.length > 20) return [{ path, message: `${label} is a list of at most 20 steps` }];
  const issues: SpellcastingIssue[] = [];
  const seen = new Set<number>();
  let previous = 0;
  const sorted = steps.every((step) => isRecord(step) && isWholeNumber(step.level)) ? [...steps].sort((left, right) => left.level - right.level) : steps;
  sorted.forEach((step: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(step) || !(isWholeNumber(step.level) && step.level >= 1 && step.level <= 20)) {
      issues.push({ path: `${at}.level`, message: "a step's level is a whole number from 1 to 20" });
      return;
    }
    if (seen.has(step.level)) issues.push({ path: `${at}.level`, message: `${label} has two steps at level ${step.level}` });
    seen.add(step.level);
    if (!(isWholeNumber(step.known) && step.known >= 0 && step.known <= 99)) {
      issues.push({ path: `${at}.known`, message: "how many are known is a whole number from 0 to 99" });
    } else {
      if (step.known < previous) issues.push({ path: `${at}.known`, message: `${label} cannot go down as the level goes up` });
      previous = step.known;
    }
  });
  return issues;
}

/** Every problem in a caster's settings, with paths relative to the settings. */
export function spellcastingIssues(value: unknown, path: string): SpellcastingIssue[] {
  if (!isRecord(value)) return [{ path, message: "spellcasting settings must be an object" }];
  const at = (field: string): string => `${path}.${field}`;
  const issues: SpellcastingIssue[] = [];
  if (!CUSTOM_ABILITIES.includes(value.ability as never)) issues.push({ path: at("ability"), message: "pick the spellcasting ability" });
  if (!CASTING_STYLES.includes(value.style as never)) issues.push({ path: at("style"), message: "pick prepared, known or spellbook" });
  if (value.casterName !== undefined && !(typeof value.casterName === "string" && WORDS.test(value.casterName) && value.casterName.length <= 40)) {
    issues.push({ path: at("casterName"), message: "the caster name is plain words (letters, digits, spaces)" });
  }
  if (value.listTag !== undefined && !(typeof value.listTag === "string" && /^[^,&|()!\s<>"][^,&|()!<>"]*$/.test(value.listTag))) {
    issues.push({ path: at("listTag"), message: "the list tag cannot be empty or contain , & | ( ) or !" });
  }
  if (value.listFilter !== undefined) {
    for (const issue of filterIssues(value.listFilter)) {
      issues.push({ path: issue.path === "" ? at("listFilter") : `${at("listFilter")}.${issue.path}`, message: issue.message });
    }
  }
  for (const flag of ["allowReplace", "ritual"] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") issues.push({ path: at(flag), message: `${flag} is on or off` });
  }
  const slots = value.slots;
  if (!isRecord(slots) || !SLOT_PROGRESSIONS.includes(slots.progression as never)) {
    issues.push({ path: at("slots.progression"), message: "pick Full, Half, Third, Pact or a custom table" });
  } else if (slots.progression === "custom") {
    const table = slots.table;
    if (
      !Array.isArray(table) ||
      table.length !== 20 ||
      table.some((row) => !Array.isArray(row) || row.length !== 9 || row.some((count) => !(isWholeNumber(count) && count >= 0 && count <= 9)))
    ) {
      issues.push({ path: at("slots.table"), message: "a custom table gives slots of levels 1 to 9 for each class level from 1 to 20 (0 to 9 each)" });
    }
  } else if (slots.table !== undefined) {
    issues.push({ path: at("slots.table"), message: "only a custom progression has its own table" });
  }
  if (value.multiclassSlots !== undefined && !MULTICLASS_SLOT_SHARES.includes(value.multiclassSlots as never)) {
    issues.push({ path: at("multiclassSlots"), message: "pick how this class counts toward shared slots" });
  }
  if (value.prepare !== undefined) {
    const prepare = value.prepare;
    if (!isRecord(prepare) || (prepare.ability !== undefined && typeof prepare.ability !== "boolean") ||
      (prepare.level !== undefined && !["full", "half", "halfUp"].includes(prepare.level as string))) {
      issues.push({ path: at("prepare"), message: "the prepared count uses the ability modifier and/or the class level (whole, half or half rounded up)" });
    }
    if (value.style === "known") issues.push({ path: at("prepare"), message: "a known caster does not prepare spells" });
  } else if (value.style === "prepared" || value.style === "spellbook") {
    issues.push({ path: at("prepare"), message: "say how many spells are prepared" });
  }
  issues.push(...stepIssues(value.cantrips, at("cantrips"), "cantrips known"));
  if (value.spells !== undefined && value.style === "prepared") {
    issues.push({ path: at("spells"), message: "a caster that prepares from the whole list has no spells known" });
  }
  issues.push(...stepIssues(value.spells, at("spells"), "spells known"));
  return issues;
}

// ---- compilation ----------------------------------------------------------------

const ABILITY_TITLE: Record<string, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  charisma: "Charisma",
};

const stat = (name: string, value: string | number, level?: number): string =>
  `<stat${attributes([["name", name], ["value", value], ["level", level]])} />`;

/** The casters' own name: the author's, else the owning class or subclass. */
export function casterNameOf(spellcasting: CustomSpellcasting, ownerName: string): string {
  return spellcasting.casterName?.trim() || ownerName.trim();
}

export interface CompiledSpellcasting {
  /** The `<spellcasting>` block, as XML. */
  block: string;
  /** The rules of the spellcasting feature. */
  rules: string[];
  /** Sheet text for the feature. */
  sheetText: string;
  /** Setters (for the extra spellcasting ability the engine reads on a feature). */
  castAbility: string;
}

/**
 * Totals at class levels written as the increase at each step, so the running
 * sum of the level-gated statistics is the table.
 */
function deltaRules(name: string, totalsByLevel: readonly number[]): string[] {
  const rules: string[] = [];
  let previous = 0;
  totalsByLevel.forEach((total, index) => {
    if (total === previous) return;
    rules.push(stat(name, total - previous, index + 1));
    previous = total;
  });
  return rules;
}

function selectRules(caster: string, style: CustomSpellcasting["style"], cantrips: CustomSpellcasting["cantrips"], spells: CustomSpellcasting["spells"]): string[] {
  const rules: string[] = [];
  const steps = (list: CustomSpellcasting["cantrips"]): Array<{ level: number; count: number }> => {
    const out: Array<{ level: number; count: number }> = [];
    let previous = 0;
    for (const step of [...(list ?? [])].sort((left, right) => left.level - right.level)) {
      if (step.known > previous) out.push({ level: step.level, count: step.known - previous });
      previous = Math.max(previous, step.known);
    }
    return out;
  };
  for (const step of steps(cantrips)) {
    rules.push(
      `<select${attributes([
        ["type", "Spell"],
        ["name", `Cantrip (${caster})`],
        ["supports", "$(spellcasting:list), 0"],
        ["level", step.level],
        ["number", step.count > 1 ? step.count : undefined],
        ["spellcasting", caster],
      ])} />`,
    );
  }
  if (style !== "prepared") {
    const name = style === "spellbook" ? `Spellbook (${caster})` : `Spellcasting (${caster})`;
    for (const step of steps(spells)) {
      rules.push(
        `<select${attributes([
          ["type", "Spell"],
          ["name", name],
          ["supports", "$(spellcasting:list), $(spellcasting:slots)"],
          ["level", step.level],
          ["number", step.count > 1 ? step.count : undefined],
          ["spellcasting", caster],
        ])} />`,
      );
    }
  }
  return rules;
}

/**
 * The spellcasting block and rules of a caster. `className` is the class whose
 * level the prepared formula reads (a subclass' caster reads its class).
 */
export function compileSpellcasting(spellcasting: CustomSpellcasting, ownerName: string, className: string): CompiledSpellcasting {
  const caster = casterNameOf(spellcasting, ownerName);
  const key = caster.toLowerCase();
  const tag = spellcasting.listTag?.trim() || className.trim();
  const filter: FilterNode = spellcasting.listFilter === undefined
    ? { kind: "tag", value: tag }
    : { kind: "group", op: "all", items: [{ kind: "tag", value: tag }, spellcasting.listFilter] };
  const listExpression = compileFilter(filter);
  const fullList = spellcasting.style === "prepared";
  const prepares = spellcasting.style !== "known";

  const block = `<spellcasting${attributes([
    ["name", caster],
    ["ability", ABILITY_TITLE[spellcasting.ability]],
    ["prepare", prepares ? "true" : "false"],
    ["allowReplace", spellcasting.allowReplace === true ? "true" : undefined],
  ])}><list${fullList ? ' known="true"' : ""}>${escapeText(listExpression)}</list></spellcasting>`;

  const rules: string[] = [];
  const share = spellcasting.multiclassSlots ?? defaultMulticlassShare(spellcasting.slots.progression);
  if (share !== "none") {
    rules.push(`<grant type="Grants" id="${SHARE_MARKER[share]}" requirements="ID_INTERNAL_GRANT_MULTICLASS" />`);
  }
  if (spellcasting.ritual === true) rules.push('<grant type="Grants" id="ID_INTERNAL_RITUAL_CASTING" />');

  const totals = slotTotals(spellcasting);
  if (totals === null) {
    // Pact magic: a count and a slot level, both stepped, with the lower slot
    // level retired when the next begins. The slot statistics read the count.
    const countKey = `${key}:spellcasting:slots:count`;
    rules.push(...deltaRules(countKey, expandSteps(PACT_STEPS.map((step) => [step.level, step.slots]))));
    rules.push(...deltaRules(`${key}:spellcasting:slot`, expandSteps(PACT_STEPS.map((step) => [step.level, step.slotLevel]))));
    PACT_STEPS.forEach((step, index) => {
      const next = PACT_STEPS.slice(index + 1).find((later) => later.slotLevel !== step.slotLevel);
      if (index > 0 && PACT_STEPS[index - 1]!.slotLevel === step.slotLevel) return;
      rules.push(stat(`${key}:spellcasting:slots:${step.slotLevel}`, countKey, step.level));
      if (next !== undefined) rules.push(stat(`${key}:spellcasting:slots:${step.slotLevel}`, `-${countKey}`, next.level));
    });
  } else {
    for (let slotLevel = 1; slotLevel <= 9; slotLevel++) {
      const column = totals.map((row) => row[slotLevel - 1]!);
      rules.push(...deltaRules(`${key}:spellcasting:slots:${slotLevel}`, column));
    }
  }

  if (prepares) {
    const prepare = spellcasting.prepare ?? {};
    if (prepare.ability !== false) rules.push(stat(`${key}:spellcasting:prepare`, `${spellcasting.ability}:modifier`));
    const classKey = className.trim().toLowerCase();
    const levelValue = prepare.level === "half" ? `level:${classKey}:half` : prepare.level === "halfUp" ? `level:${classKey}:half:up` : `level:${classKey}`;
    if (prepare.level !== undefined) rules.push(stat(`${key}:spellcasting:prepare`, levelValue));
  }

  rules.push(...selectRules(caster, spellcasting.style, spellcasting.cantrips, spellcasting.spells));

  const abilityName = ABILITY_TITLE[spellcasting.ability]!;
  const preparedText = prepares ? ` You can prepare {{${key}:spellcasting:prepare}} spells.` : "";
  return {
    block,
    rules,
    sheetText: `${abilityName} is your spellcasting ability for ${caster} spells.${preparedText}`,
    castAbility: abilityName,
  };
}

/** Steps given as [level, value] pairs, spread over levels 1-20 as a total per level. */
function expandSteps(steps: ReadonlyArray<readonly [number, number]>): number[] {
  return Array.from({ length: 20 }, (_, index) => {
    let value = 0;
    for (const [level, total] of steps) if (level <= index + 1) value = total;
    return value;
  });
}
