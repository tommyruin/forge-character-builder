/**
 * Removing a level that is not the character's most recent one.
 *
 * The document only ever grows at its end — a level appends its content to its
 * class container and its wrapper to the level list — so the only removal the
 * planner can express is "take back the last level". Lowering an earlier class
 * therefore unwinds every level down to the target and replays the ones above
 * it. This module holds the parts that have to survive that round trip: which
 * level a request names, and the choices the player had already made.
 */

import type { CharacterState, LevelHistoryEntry, RegisteredElement } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import { engineError } from "../errors.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "../selection/selection.js";
import { classElementForMulticlass } from "./leveling.js";

/** Restoring one choice can create the rule another one needs, so restore repeats. */
const MAX_RESTORE_PASSES = 20;

export interface DelevelOptions {
  mode: "last" | "class";
  classId?: string;
}

/**
 * The level a delevel request names: the character's last, or the most recent
 * level of one class. A class is named by whichever id the caller holds — the
 * class element's own id or its multiclass variant's — because the progression
 * view reports the variant while the level history of the main class reports
 * the class.
 */
export function resolveDelevelTarget(
  state: CharacterState,
  library: ElementLibrary,
  opts: DelevelOptions,
): LevelHistoryEntry {
  const history = state.levelHistory;
  const last = history[history.length - 1];
  if (last === undefined) throw engineError("conflict", "this character has no levels");
  if (opts.mode === "last" || opts.classId === undefined) return last;
  const wanted = new Set([opts.classId]);
  const element = library.byId.get(opts.classId) ?? classElementForMulticlass(library, opts.classId);
  if (element !== undefined) {
    wanted.add(element.identity.id);
    if (element.multiclass !== undefined) wanted.add(element.multiclass.id);
  }
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index]!;
    if (!entry.isPending && wanted.has(entry.classId)) return entry;
  }
  throw engineError("not-found", `class '${opts.classId}' is not part of this character`);
}

/** One selection wrapper in the tree, filled or not, with the rule it came from. */
export interface WrapperSnapshot {
  path: number[];
  /** The registered element the wrapper hangs off, which the rule belongs to. */
  ownerId: string;
  type: string;
  name: string;
  requiredLevel: number;
  number: number;
  checksum: string;
  /** The element chosen in this wrapper, or "" while it is still pending. */
  registered: string;
}

/** Every selection wrapper in the tree, in document order. */
export function wrapperSnapshots(state: CharacterState): WrapperSnapshot[] {
  const out: WrapperSnapshot[] = [];
  const walk = (nodes: RegisteredElement[], path: number[], ownerId: string): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (node.requiredLevel !== undefined) {
        out.push({
          path: here,
          ownerId,
          type: node.type,
          name: node.name,
          requiredLevel: node.requiredLevel,
          number: node.number ?? 1,
          checksum: node.checksum ?? "",
          registered: node.registered ?? "",
        });
      }
      const owner = node.id !== "" ? node.id : (node.registered ?? "") !== "" ? node.registered! : ownerId;
      walk(node.children, here, owner);
    });
  };
  walk(state.elements, [], "");
  return out;
}

/**
 * The pending wrapper that stands for `snapshot` after the replay. Replay
 * builds the tree again from scratch, so a wrapper is found by the rule it came
 * from rather than by where it sits: its checksum first, then its owner and
 * name, then its name alone, because a rule can move to another level's feature
 * and still ask the same question. Wrappers that tie are interchangeable slots
 * of one rule, so the first free one takes the choice.
 */
function matchPending(
  state: CharacterState,
  snapshot: WrapperSnapshot,
  taken: Set<string>,
): SelectionRule | null {
  const candidates = wrapperSnapshots(state).filter(
    (entry) => entry.registered === "" && !taken.has(entry.path.join(".")),
  );
  const tiers: Array<(entry: WrapperSnapshot) => boolean> = [
    (entry) =>
      entry.checksum !== "" &&
      entry.checksum === snapshot.checksum &&
      entry.number === snapshot.number,
    (entry) =>
      entry.ownerId === snapshot.ownerId &&
      entry.type === snapshot.type &&
      entry.name === snapshot.name &&
      entry.requiredLevel === snapshot.requiredLevel,
    (entry) => entry.type === snapshot.type && entry.name === snapshot.name,
  ];
  for (const tier of tiers) {
    const matches = candidates.filter(tier);
    const first = matches[0];
    if (first === undefined) continue;
    const key = first.path.join(".");
    const rule = pendingSelectionRules(state).find((candidate) => candidate.path.join(".") === key);
    if (rule !== undefined) return rule;
  }
  return null;
}

/**
 * Re-applies the choices captured before the unwind, repeating because filling
 * one wrapper can create the rule the next choice belongs to. Returns the
 * choices that could not be made again — the picks the replayed character is
 * no longer eligible for.
 */
export function restoreSelections(
  snapshots: WrapperSnapshot[],
  library: ElementLibrary,
  getState: () => CharacterState,
  setSelection: (ruleIdentifier: string, selectionId: string) => void,
): WrapperSnapshot[] {
  const outstanding = snapshots.filter((snapshot) => snapshot.registered !== "");
  const taken = new Set<string>();
  for (let pass = 0; pass < MAX_RESTORE_PASSES && outstanding.length > 0; pass++) {
    let progressed = false;
    for (const snapshot of [...outstanding]) {
      const state = getState();
      const rule = matchPending(state, snapshot, taken);
      if (rule === null) continue;
      if (!selectionOptions(state, library, rule).some((option) => option.id === snapshot.registered)) {
        taken.add(rule.path.join("."));
        continue;
      }
      try {
        setSelection(rule.identifier, snapshot.registered);
      } catch {
        // A choice the replayed character can no longer make is reported, not fatal.
        taken.add(rule.path.join("."));
        continue;
      }
      outstanding.splice(outstanding.indexOf(snapshot), 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  return outstanding;
}

/** The pending rules standing for choices the replay could not restore. */
export function repickRules(state: CharacterState, unrestored: WrapperSnapshot[]): SelectionRule[] {
  const taken = new Set<string>();
  const rules: SelectionRule[] = [];
  for (const snapshot of unrestored) {
    const rule = matchPending(state, snapshot, taken);
    if (rule === null) continue;
    taken.add(rule.path.join("."));
    rules.push(rule);
  }
  return rules;
}
