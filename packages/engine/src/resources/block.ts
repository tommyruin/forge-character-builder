/**
 * Resource state as it is stored: a child of the builder's block in the
 * character file (`dnd5e/builder-block.ts`).
 *
 * ```xml
 * <resources schema="1"><![CDATA[{"spent":{"moonbeam":1},"switches":["Moonlit Form"],"manual":[…],"untracked":["usage:…"]}]]></resources>
 * ```
 *
 * Every part is left out when empty and the child with it, so a character
 * whose trackers are all full, whose switches are all off, who keeps no
 * tracker by hand and tracks everything has no trace of it and keeps its
 * original bytes. Keys this reader does not know are carried through every
 * rewrite untouched, and `schema` is written but never checked, so a later
 * part (such as `untracked`) is ignored, not lost, by an earlier reader.
 */

import type { TrackerDef } from "@forge-cb/api";
import { builderChildText, cdata, planBuilderChildEdits } from "../dnd5e/builder-block.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import type { RawEdit } from "../selection/selection.js";
import { trackerIssues } from "../custom/trackers.js";
import { emptyDeclaredResources, type ResourceState } from "./types.js";

export const RESOURCES_NODE = "resources";
export const RESOURCES_SCHEMA = 1;

export interface ResourceBlockRead {
  /** Every stored key, readable or not, so an edit carries what it cannot read through untouched. */
  stored: Record<string, unknown>;
  state: ResourceState;
  /** The block is not a JSON object; it is left alone rather than rewritten. */
  unreadable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readManual(raw: unknown): TrackerDef[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackerDef[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    // A tracker kept by hand holds a fixed number: there is no draft to give it a statistic.
    if (trackerIssues([entry], new Map(), { literalOnly: true }).length > 0) continue;
    const def = entry as TrackerDef;
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}

/** The tracker keys turned off: non-empty strings, each once. */
function readUntracked(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((key): key is string => typeof key === "string" && key !== ""))];
}

export function readResourceBlock(document: Dnd5eDocument): ResourceBlockRead {
  const empty: ResourceBlockRead = {
    stored: {},
    state: { spent: {}, switchesOn: [], manual: [], untracked: [], declared: emptyDeclaredResources() },
    unreadable: false,
  };
  const text = builderChildText(document, RESOURCES_NODE);
  if (text === null || text === "") return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, unreadable: true };
  }
  if (!isRecord(parsed)) return { ...empty, unreadable: true };
  const spent: Record<string, number> = {};
  if (isRecord(parsed.spent)) {
    for (const [key, value] of Object.entries(parsed.spent)) {
      if (typeof value === "number" && Number.isInteger(value) && value > 0) spent[key] = value;
    }
  }
  const switchesOn = Array.isArray(parsed.switches)
    ? parsed.switches.filter((name): name is string => typeof name === "string" && name !== "")
    : [];
  return {
    stored: parsed,
    state: { spent, switchesOn, manual: readManual(parsed.manual), untracked: readUntracked(parsed.untracked), declared: emptyDeclaredResources() },
    unreadable: false,
  };
}

/** The stored object that carries `state`: unknown keys kept, every empty part left out. */
export function storedWithState(
  stored: Readonly<Record<string, unknown>>,
  state: Pick<ResourceState, "spent" | "switchesOn" | "manual" | "untracked">,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored };
  const spent = Object.fromEntries(Object.entries(state.spent).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.keys(spent).length > 0) next.spent = spent;
  else delete next.spent;
  if (state.switchesOn.length > 0) next.switches = state.switchesOn;
  else delete next.switches;
  if (state.manual.length > 0) next.manual = state.manual;
  else delete next.manual;
  if (state.untracked.length > 0) next.untracked = state.untracked;
  else delete next.untracked;
  return next;
}

/** Byte edits that make the document carry exactly these stored keys. */
export function planResourceEdits(document: Dnd5eDocument, stored: Readonly<Record<string, unknown>>): RawEdit[] {
  const element = Object.keys(stored).length === 0
    ? null
    : `<${RESOURCES_NODE} schema="${RESOURCES_SCHEMA}">${cdata(JSON.stringify(stored))}</${RESOURCES_NODE}>`;
  return planBuilderChildEdits(document, RESOURCES_NODE, element);
}

