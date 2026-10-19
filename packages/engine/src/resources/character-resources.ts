/**
 * A character's resources: the operations behind the resource RPCs, written
 * against a small host interface so `CharacterService` stays the only owner of
 * character state. Every change is a byte edit to the `resources` child of the
 * builder block; a character whose trackers are all full, whose switches are
 * all off and who keeps no tracker by hand ends up with no such child.
 */

import type { ResourcesDto, TrackerDef } from "@forge-cb/api";
import type { CharacterState } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import { engineError } from "../errors.js";
import { trackerIssues } from "../custom/trackers.js";
import { computeInlineValues, computeStatistics } from "../statistics/calculator.js";
import { featureUsageEntries } from "../sheet/model.js";
import type { RawEdit } from "../selection/selection.js";
import { planResourceEdits, readResourceBlock, storedWithState } from "./block.js";
import type { DeclaredResources, ResourceState } from "./types.js";
import { buildResources, poolKey, restKeys } from "./view.js";

export interface ResourcesHost {
  readonly library: ElementLibrary | undefined;
  snapshot(id: string): { state: CharacterState; document: Dnd5eDocument };
  applyRegionEdits(id: string, edits: RawEdit[]): CharacterState;
}

type Stored = Pick<ResourceState, "spent" | "switchesOn" | "manual">;

const sameName = (left: string, right: string): boolean => left.trim().toLowerCase() === right.trim().toLowerCase();

export class CharacterResources {
  constructor(private readonly host: ResourcesHost) {}

  private requireLibrary(): ElementLibrary {
    if (this.host.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for resources");
    }
    return this.host.library;
  }

  /** The resources of a character in this state. */
  view(state: CharacterState): ResourcesDto {
    const library = this.requireLibrary();
    const values = computeStatistics(state, library);
    const inline = computeInlineValues(state, library);
    return buildResources(state, library, values, featureUsageEntries(state, library, values, inline));
  }

  get(id: string): ResourcesDto {
    return this.view(this.host.snapshot(id).state);
  }

  /**
   * Rewrites the stored resource state. `change` edits a copy; nothing is
   * written (and nothing is re-read) when it changed nothing.
   */
  private write(id: string, change: (stored: Stored, view: ResourcesDto) => void): ResourcesDto {
    this.requireLibrary();
    const { state, document } = this.host.snapshot(id);
    const read = readResourceBlock(document);
    // Rewriting a block that cannot be read would destroy whatever it still says.
    if (read.unreadable) throw engineError("conflict", "the resources block is not valid JSON; it was not changed");
    const current = this.view(state);
    const next: Stored = {
      spent: { ...read.state.spent },
      switchesOn: [...read.state.switchesOn],
      manual: read.state.manual.map((def) => ({ ...def })),
    };
    change(next, current);
    const stored = storedWithState(read.stored, next);
    const edits = planResourceEdits(document, stored);
    if (edits.length === 0) return current;
    return this.view(this.host.applyRegionEdits(id, edits));
  }

  /**
   * Forgets what a removed custom entry left behind: the counts it had spent
   * and the switches only it named. `declared` is what the file declared before
   * the entry was removed, so a shared pool stays while another member uses it.
   */
  forgetOwner(id: string, ownerId: string, declared: DeclaredResources): void {
    const mine = declared.trackers.filter((tracker) => tracker.ownerId === ownerId);
    const others = declared.trackers.filter((tracker) => tracker.ownerId !== ownerId);
    const switchesLeft = new Set(declared.switches.filter((entry) => entry.ownerId !== ownerId).map((entry) => entry.name.trim().toLowerCase()));
    const { document } = this.host.snapshot(id);
    const read = readResourceBlock(document);
    if (read.unreadable) return;
    const next: Stored = {
      spent: { ...read.state.spent },
      switchesOn: read.state.switchesOn.filter(
        (name) => switchesLeft.has(name.trim().toLowerCase()) || !declared.switches.some((entry) => entry.ownerId === ownerId && sameName(entry.name, name)),
      ),
      manual: read.state.manual,
    };
    for (const tracker of mine) {
      delete next.spent[tracker.def.id];
      const pool = tracker.def.pool?.trim();
      if (pool !== undefined && pool !== "" && !others.some((other) => other.def.pool !== undefined && sameName(other.def.pool, pool))) {
        delete next.spent[poolKey(pool)];
      }
    }
    const edits = planResourceEdits(document, storedWithState(read.stored, next));
    if (edits.length > 0) this.host.applyRegionEdits(id, edits);
  }

  setUsed(id: string, request: { trackerId: string; used: number }): ResourcesDto {
    if (typeof request.used !== "number" || !Number.isFinite(request.used)) {
      throw engineError("invalid-argument", "The Used field must be a number.");
    }
    return this.write(id, (stored, view) => {
      const tracker = view.trackers.find((entry) => entry.id === request.trackerId);
      if (tracker === undefined) throw engineError("not-found", `tracker '${request.trackerId}' not found`);
      const used = Math.min(tracker.max, Math.max(0, Math.trunc(request.used)));
      if (used === 0) delete stored.spent[tracker.id];
      else stored.spent[tracker.id] = used;
    });
  }

  setSwitch(id: string, request: { name: string; on: boolean }): ResourcesDto {
    return this.write(id, (stored, view) => {
      const found = view.switches.find((entry) => sameName(entry.name, request.name));
      if (found === undefined) throw engineError("not-found", `switch '${request.name}' not found`);
      const wasOn = stored.switchesOn.some((name) => sameName(name, found.name));
      if (!request.on) {
        stored.switchesOn = stored.switchesOn.filter((name) => !sameName(name, found.name));
        return;
      }
      if (wasOn) return;
      // Turning a switch on spends a use of every tracker linked to it; with one
      // empty, the switch stays off rather than apply an effect nothing paid for.
      const linked = view.trackers.filter((tracker) => tracker.spendOnSwitch !== undefined && sameName(tracker.spendOnSwitch, found.name));
      const empty = linked.find((tracker) => tracker.remaining < 1);
      if (empty !== undefined) throw engineError("conflict", `${found.name} needs a use of ${empty.label}, and none is left`);
      for (const tracker of linked) stored.spent[tracker.id] = Math.min(tracker.max, tracker.used + 1);
      stored.switchesOn.push(found.name);
    });
  }

  rest(id: string, request: { kind: "short" | "long" }): ResourcesDto {
    if (request.kind !== "short" && request.kind !== "long") {
      throw engineError("invalid-argument", "The Kind field must be 'short' or 'long'.");
    }
    return this.write(id, (stored, view) => {
      for (const key of restKeys(view.trackers, request.kind)) delete stored.spent[key];
      // What a tracker that no longer exists had spent is of no use to anyone.
      const known = new Set(view.trackers.map((tracker) => tracker.id));
      for (const key of Object.keys(stored.spent)) if (!known.has(key)) delete stored.spent[key];
    });
  }

  saveManual(id: string, request: { tracker: TrackerDef }): ResourcesDto {
    const issues = trackerIssues([request.tracker], new Map(), { literalOnly: true });
    if (issues.length > 0) {
      const first = issues[0]!;
      throw engineError("invalid-argument", `invalid tracker: ${first.path.replace(/^trackers\[0\]\.?/, "")}: ${first.message}`, { issues });
    }
    // A tracker kept by hand is never part of a pool or a custom entry's switch.
    const { pool: _pool, ...def } = request.tracker;
    return this.write(id, (stored, view) => {
      const clash = view.trackers.find((entry) => entry.id === def.id && !entry.manual);
      if (clash !== undefined) throw engineError("conflict", `'${def.label}' reuses the id of ${clash.label}`);
      const at = stored.manual.findIndex((entry) => entry.id === def.id);
      if (at < 0) stored.manual.push(def);
      else stored.manual[at] = def;
    });
  }

  deleteManual(id: string, request: { trackerId: string }): ResourcesDto {
    return this.write(id, (stored) => {
      const at = stored.manual.findIndex((entry) => entry.id === request.trackerId);
      if (at < 0) throw engineError("not-found", `tracker '${request.trackerId}' not found`);
      stored.manual.splice(at, 1);
      delete stored.spent[request.trackerId];
    });
  }
}
