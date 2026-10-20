/**
 * The character's resources: every limited use its features and items carry,
 * with what is spent, and the switches that gate custom modifiers.
 *
 * A tracker has four possible sources, all read here and merged into one list:
 *
 *  - a custom entry's tracker (a feature's uses, an item's charges) or the free
 *    cast of a spell that entry grants, declared by the draft in the character's
 *    file, or carried by the compiled element of a pack the character uses;
 *  - a tracker the player added by hand;
 *  - a book feature whose sheet usage line states a count and a rest
 *    ("2/Short Rest", "{{proficiency}}/Long Rest" once its token is filled in).
 *    Lines in any other shape ("Channel Divinity", "1/Turn") are not tracked.
 *
 * Trackers naming one pool are a single resource. What is spent is stored under
 * the tracker's key (its id, `pool:<name>`, or `usage:<element id>`).
 */

import type { ResourcesDto, SwitchDto, TrackerDto, TrackerSourceDto, TrackerDef } from "@forge-cb/api";
import type { CharacterState } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import { rechargeLabel, REST_RECHARGES, trackerStatKey } from "../custom/trackers.js";
import { isCustomElementId } from "../custom/schema.js";
import { grantSwitchOpen } from "../custom/switch-gate.js";
import { elementTrackers } from "../custom/tracker-setters.js";
import { spellInfo } from "../magic/spelllist.js";
import { parseUsageText } from "./usage.js";
import type { DeclaredSwitch, DeclaredTracker } from "./types.js";

/** A feature printed on the sheet that states a usage line, with its tokens already filled in. */
export interface FeatureUsage {
  elementId: string;
  title: string;
  usage: string;
}

type Statistics = Readonly<Record<string, number>>;

/** One tracker before pools are merged. */
interface Candidate {
  key: string;
  label: string;
  source: TrackerSourceDto;
  isCustom: boolean;
  manual: boolean;
  max: number;
  unit: TrackerDef["unit"];
  recharge: TrackerDef["recharge"];
  regain?: string;
  pool?: string;
  spendOnSwitch?: string;
  def?: TrackerDef;
}

export const poolKey = (name: string): string => `pool:${name.trim().toLowerCase()}`;

const sameName = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();

/** The count a tracker holds now: a literal, or the statistic the draft made it follow. */
function resolvedMax(def: TrackerDef, values: Statistics): number {
  if (def.max.kind === "number") return def.max.value;
  return Math.max(0, Math.trunc(values[trackerStatKey(def)] ?? 0));
}

function ownerActive(state: CharacterState, declared: Pick<DeclaredTracker, "ownerId" | "kind">): boolean {
  if (declared.kind === "item") {
    return state.items.some((item) => item.itemId === declared.ownerId || item.adorners.includes(declared.ownerId));
  }
  return state.sum.elements.some((entry) => entry.id === declared.ownerId);
}

/**
 * The trackers the elements a character has declare in their own setters: what
 * a pack's feature or item carries once it is compiled, and what any other file
 * could say the same way. An entry whose draft sits in the character's file is
 * declared by that draft, so it is passed over here.
 */
function elementDeclared(state: CharacterState, library: ElementLibrary): DeclaredTracker[] {
  const owned = new Set(state.resources.declared.trackedOwners);
  const out: DeclaredTracker[] = [];
  const seen = new Set<string>();
  const collect = (id: string, kind: DeclaredTracker["kind"]): void => {
    if (seen.has(id) || owned.has(id)) return;
    seen.add(id);
    const element = library.byId.get(id);
    if (element === undefined) return;
    for (const tracker of elementTrackers(element)) {
      out.push({
        ownerId: id,
        ownerName: element.identity.name,
        kind,
        def: tracker.def,
        ...(tracker.spellId === undefined ? {} : { spellId: tracker.spellId }),
      });
    }
  };
  for (const entry of state.sum.elements) collect(entry.id, "feature");
  for (const item of state.items) {
    collect(item.itemId, "item");
    for (const adorner of item.adorners) collect(adorner, "item");
  }
  return out;
}

/** The ids of the active elements that declare trackers in their setters, so their usage line is not read a second time. */
function elementTrackerCarriers(state: CharacterState, library: ElementLibrary): Set<string> {
  return new Set(elementDeclared(state, library).map((declared) => declared.ownerId));
}

/**
 * Whether the spell a tracker frees a cast of is granted right now. A grant gated on a switch
 * registers only while the switch is on, so its free casts are not a resource until then; what was
 * spent stays recorded and comes back with the switch. A pack's element carries the gate on its
 * grant rule, a draft in the character's file on the tracker it declared.
 */
function spellGrantActive(state: CharacterState, library: ElementLibrary, declared: DeclaredTracker): boolean {
  if (declared.spellId === undefined) return true;
  const fromDraft = declared.switch;
  if (fromDraft !== undefined) return grantSwitchOpen(state, declared.ownerId, fromDraft);
  const owner = library.byId.get(declared.ownerId);
  const grant = owner?.rules.find((rule) => rule.kind === "grant" && rule.id === declared.spellId);
  return grant?.kind !== "grant" || grantSwitchOpen(state, declared.ownerId, grant.condition);
}

function declaredCandidates(state: CharacterState, library: ElementLibrary, values: Statistics): Candidate[] {
  const out: Candidate[] = [];
  for (const declared of [...state.resources.declared.trackers, ...elementDeclared(state, library)]) {
    if (!ownerActive(state, declared)) continue;
    if (!spellGrantActive(state, library, declared)) continue;
    const max = resolvedMax(declared.def, values);
    if (max < 1) continue;
    let label = declared.def.label;
    if (declared.spellId !== undefined) {
      const spell = spellInfo(library, declared.spellId);
      const alias = state.spellAliases[declared.spellId]?.name.trim() ?? "";
      if (alias !== "") label = alias;
      else if (spell !== null) label = spell.name;
    }
    out.push({
      key: declared.def.id,
      label,
      source: { name: declared.ownerName, kind: "custom", elementId: declared.ownerId },
      isCustom: true,
      manual: false,
      max,
      unit: declared.def.unit,
      recharge: declared.def.recharge,
      ...(declared.def.regain === undefined ? {} : { regain: declared.def.regain }),
      ...(declared.def.pool === undefined ? {} : { pool: declared.def.pool.trim() }),
      ...(declared.def.spendOnSwitch === undefined ? {} : { spendOnSwitch: declared.def.spendOnSwitch }),
    });
  }
  return out;
}

function manualCandidates(state: CharacterState): Candidate[] {
  return state.resources.manual.map((def) => ({
    key: def.id,
    label: def.label,
    source: { name: def.label, kind: "manual" as const },
    isCustom: true,
    manual: true,
    max: def.max.kind === "number" ? def.max.value : 0,
    unit: def.unit,
    recharge: def.recharge,
    ...(def.regain === undefined ? {} : { regain: def.regain }),
    ...(def.spendOnSwitch === undefined ? {} : { spendOnSwitch: def.spendOnSwitch }),
    def,
  }));
}

function usageCandidates(state: CharacterState, library: ElementLibrary, usages: readonly FeatureUsage[]): Candidate[] {
  const owned = new Set([...state.resources.declared.trackedOwners, ...elementTrackerCarriers(state, library)]);
  const out: Candidate[] = [];
  for (const entry of usages) {
    // A custom entry that declares its own trackers is tracked by them.
    if (owned.has(entry.elementId)) continue;
    const parsed = parseUsageText(entry.usage);
    if (parsed === null) continue;
    const custom = isCustomElementId(entry.elementId);
    out.push({
      key: `usage:${entry.elementId}`,
      label: entry.title,
      source: { name: entry.title, kind: custom ? "custom" : "book", elementId: entry.elementId },
      isCustom: custom,
      manual: false,
      max: parsed.count,
      unit: parsed.unit,
      recharge: parsed.recharge,
    });
  }
  return out;
}

function toDto(candidates: readonly Candidate[], state: CharacterState): TrackerDto {
  const first = candidates[0]!;
  const pooled = first.pool !== undefined;
  const key = pooled ? poolKey(first.pool!) : first.key;
  // Members of a pool agree on what it holds; if they do not, the larger count stands.
  const max = Math.max(...candidates.map((candidate) => candidate.max));
  const used = Math.min(max, Math.max(0, state.resources.spent[key] ?? 0));
  const sources = candidates.map((candidate) => candidate.source).filter(
    (source, index, all) => all.findIndex((other) => other.name === source.name && other.elementId === source.elementId) === index,
  );
  const spendOnSwitch = candidates.find((candidate) => candidate.spendOnSwitch !== undefined)?.spendOnSwitch;
  return {
    id: key,
    label: pooled ? first.pool! : first.label,
    sources,
    isCustom: candidates.some((candidate) => candidate.isCustom),
    manual: first.manual,
    max,
    used,
    remaining: max - used,
    unit: first.unit,
    recharge: first.recharge,
    rechargeLabel: rechargeLabel(first),
    ...(first.regain === undefined ? {} : { regain: first.regain }),
    ...(pooled ? { pool: first.pool! } : {}),
    ...(spendOnSwitch === undefined ? {} : { spendOnSwitch }),
    ...(first.def === undefined ? {} : { def: first.def }),
  };
}

/** Every tracker, merged by pool and ordered: book features, then custom entries, then trackers kept by hand. */
export function buildTrackers(
  state: CharacterState,
  library: ElementLibrary,
  values: Statistics,
  usages: readonly FeatureUsage[],
): TrackerDto[] {
  const candidates = [...usageCandidates(state, library, usages), ...declaredCandidates(state, library, values), ...manualCandidates(state)];
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = candidate.pool === undefined ? candidate.key : poolKey(candidate.pool);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else if (candidate.pool !== undefined) group.push(candidate);
    // A repeated key that is not a pool is the same tracker seen twice; it counts once.
  }
  return [...groups.values()].map((group) => toDto(group, state));
}

/**
 * The switches the compiled rules of the character's active custom elements name.
 * A draft in the character's own file declares its switches itself; an element a
 * pack defines has no draft here, but its rules carry the same `condition`, so the
 * switch is read off them and the player can turn it on.
 */
function ruleSwitches(state: CharacterState, library: ElementLibrary, active: ReadonlySet<string>): DeclaredSwitch[] {
  const out: DeclaredSwitch[] = [];
  for (const id of active) {
    if (!isCustomElementId(id)) continue;
    const element = library.byId.get(id);
    if (element === undefined) continue;
    const seen = new Set<string>();
    for (const rule of element.rules) {
      if (rule.kind !== "stat" && rule.kind !== "grant") continue;
      const name = rule.condition?.trim() ?? "";
      if (name === "" || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, ownerId: id, ownerName: element.identity.name });
    }
  }
  return out;
}

export function buildSwitches(state: CharacterState, library: ElementLibrary, trackers: readonly TrackerDto[]): SwitchDto[] {
  const declared = state.resources.declared;
  const active = new Set<string>();
  const items = state.items;
  for (const entry of state.sum.elements) active.add(entry.id);
  for (const item of items) {
    active.add(item.itemId);
    for (const adorner of item.adorners) active.add(adorner);
  }
  const out: SwitchDto[] = [];
  for (const entry of [...declared.switches, ...ruleSwitches(state, library, active)]) {
    if (!active.has(entry.ownerId)) continue;
    const existing = out.find((candidate) => sameName(candidate.name, entry.name));
    if (existing !== undefined) {
      if (!existing.sources.includes(entry.ownerName)) (existing.sources as string[]).push(entry.ownerName);
      continue;
    }
    const spends = trackers.find((tracker) => tracker.spendOnSwitch !== undefined && sameName(tracker.spendOnSwitch, entry.name));
    out.push({
      name: entry.name,
      on: state.resources.switchesOn.some((name) => sameName(name, entry.name)),
      sources: [entry.ownerName],
      ...(spends === undefined ? {} : { spends: spends.label }),
    });
  }
  return out;
}

export function buildResources(
  state: CharacterState,
  library: ElementLibrary,
  values: Statistics,
  usages: readonly FeatureUsage[],
): ResourcesDto {
  const trackers = buildTrackers(state, library, values, usages);
  return { trackers, switches: buildSwitches(state, library, trackers) };
}

/** The tracker keys a rest of this kind refills. */
export function restKeys(trackers: readonly TrackerDto[], kind: "short" | "long"): string[] {
  const recharges = REST_RECHARGES[kind];
  return trackers.filter((tracker) => recharges.includes(tracker.recharge)).map((tracker) => tracker.id);
}
