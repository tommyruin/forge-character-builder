/**
 * How a tracker travels inside the element a draft compiles to.
 *
 * A library keeps elements, not drafts. A character that has a pack's element
 * has no draft for it, so the tracker definitions ride in the element as
 * `<set name="tracker">` lines. An Aurora-style reader ignores setters it does
 * not know, and the builder reads them back into the same definitions a draft
 * declares, so the Resources page lists the same trackers wherever the element
 * came from.
 *
 *   <set name="tracker" id="moonbeam" max="2" unit="uses" recharge="shortRest">Moonbeam</set>
 *
 * The text is the label. `max` is written only for a fixed count; a count that
 * follows the character is the statistic `uses:<id>` the compiler already
 * writes, so it is read from there and cannot drift from the sheet line.
 */

import type { GrantBlock, TrackerDef, TrackerRecharge, TrackerUnit } from "@forge-cb/api";
import type { Setter } from "../content/parser.js";
import { parseUsageText } from "../resources/usage.js";
import { TRACKER_RECHARGES, TRACKER_UNITS } from "./schema.js";
import { trackerStatKey } from "./trackers.js";
import { attributes, escapeText } from "./xml-text.js";

export const TRACKER_SETTER = "tracker";

/** The stable id of the free-cast tracker a spell grant declares. */
export const spellTrackerId = (draftId: string, blockId: string): string => `spell:${draftId}:${blockId}`;

/** A tracker a draft declares for the free casts of a spell its grant names. */
export interface SpellGrantTracker {
  def: TrackerDef;
  /** The spell's element id, when the grant names one. */
  spellId?: string;
}

export function spellGrantTracker(draft: { id: string }, block: GrantBlock): SpellGrantTracker | null {
  const spell = block.spell;
  if (block.target.type !== "Spell" || spell?.usage === undefined) return null;
  const parsed = parseUsageText(spell.usage);
  if (parsed === null) return null;
  const label = block.target.by === "id" ? (block.target.label ?? "") : block.target.name;
  const def: TrackerDef = {
    id: spellTrackerId(draft.id, block.id),
    label: label === "" ? "Spell" : label,
    max: { kind: "number", value: parsed.count },
    unit: parsed.unit,
    recharge: parsed.recharge,
  };
  return { def, ...(block.target.by === "id" ? { spellId: block.target.id } : {}) };
}

/** One `<set name="tracker">` line. */
export function trackerSetterXml(def: TrackerDef, spellId?: string): string {
  return `<set${attributes([
    ["name", TRACKER_SETTER],
    ["id", def.id],
    ["max", def.max.kind === "number" ? def.max.value : undefined],
    ["unit", def.unit],
    ["recharge", def.recharge],
    ["regain", def.regain],
    ["pool", def.pool],
    ["switch", def.spendOnSwitch],
    ["spell", spellId],
  ])}>${escapeText(def.label)}</set>`;
}

/** Every tracker setter a draft's compiled element carries: its own trackers, then its spell grants' free casts. */
export function trackerSetters(draft: { id: string; trackers?: readonly TrackerDef[]; blocks?: readonly { kind: string }[] }): string[] {
  const own = (draft.trackers ?? []).map((def) => trackerSetterXml(def));
  const casts = (draft.blocks ?? [])
    .filter((block): block is GrantBlock => block.kind === "grant")
    .flatMap((block) => {
      const declared = spellGrantTracker(draft, block);
      return declared === null ? [] : [trackerSetterXml(declared.def, declared.spellId)];
    });
  return [...own, ...casts];
}

/** A tracker read back from an element, with the spell it frees a cast of when it is a spell's. */
export interface ElementTracker {
  def: TrackerDef;
  spellId?: string;
}

/** The tracker a `tracker` setter states, or null when it is not readable. */
export function trackerFromSetter(setter: Pick<Setter, "name" | "value" | "attrs">): ElementTracker | null {
  if (setter.name !== TRACKER_SETTER) return null;
  const attrs = setter.attrs ?? {};
  const id = attrs.id?.trim() ?? "";
  const label = setter.value.trim();
  if (id === "" || label === "") return null;
  const unit = (TRACKER_UNITS as readonly string[]).includes(attrs.unit ?? "") ? (attrs.unit as TrackerUnit) : "uses";
  const recharge = (TRACKER_RECHARGES as readonly string[]).includes(attrs.recharge ?? "") ? (attrs.recharge as TrackerRecharge) : "longRest";
  const count = attrs.max === undefined ? Number.NaN : Number(attrs.max);
  const def: TrackerDef = {
    id,
    label,
    max: Number.isFinite(count) ? { kind: "number", value: count } : { kind: "stat", key: trackerStatKey({ id }) },
    unit,
    recharge,
    ...(attrs.regain === undefined || attrs.regain === "" ? {} : { regain: attrs.regain }),
    ...(attrs.pool === undefined || attrs.pool === "" ? {} : { pool: attrs.pool }),
    ...(attrs.switch === undefined || attrs.switch === "" ? {} : { spendOnSwitch: attrs.switch }),
  };
  return { def, ...(attrs.spell === undefined || attrs.spell === "" ? {} : { spellId: attrs.spell }) };
}

/** Every tracker an element declares in its setters. */
export function elementTrackers(element: { setters: readonly Pick<Setter, "name" | "value" | "attrs">[] }): ElementTracker[] {
  return element.setters.flatMap((setter) => {
    const read = trackerFromSetter(setter);
    return read === null ? [] : [read];
  });
}
