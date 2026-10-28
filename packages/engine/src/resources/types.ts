/**
 * What the engine holds about a character's resources.
 *
 * Four things are stored in the character file (`block.ts`): how much of each
 * tracker is spent, which switches are on, the trackers the player added by
 * hand, and the trackers the player chose not to track. A fifth is derived from the file's custom pack every time the
 * character loads (`declared.ts`): the limited uses and switches that custom
 * features and items declare. Keeping the derived part out of the file means a
 * draft is the only place a tracker is defined, so editing the draft is all it
 * takes to change it.
 */

import type { TrackerDef } from "@forge-cb/api";

/** A tracker a custom entry declares, with the entry that owns it. */
export interface DeclaredTracker {
  /** The feature, item or granting feature that owns the tracker. */
  ownerId: string;
  ownerName: string;
  /** `spell` is a free cast of one spell granted by a feature. */
  kind: "feature" | "item" | "spell";
  def: TrackerDef;
  /** `spell` only: the spell's element id, when the grant names one. */
  spellId?: string;
  /** `spell` only: the switch the granting block is gated on, when it has one. */
  switch?: string;
}

/** A switch a custom entry's modifiers name. */
export interface DeclaredSwitch {
  name: string;
  ownerId: string;
  ownerName: string;
}

export interface DeclaredResources {
  trackers: DeclaredTracker[];
  switches: DeclaredSwitch[];
  /** Custom features whose limited uses are declared above, so their usage line is not read a second time. */
  trackedOwners: string[];
}

export interface ResourceState {
  /** How many of each tracker are spent, by tracker key (see `view.ts`). Zero is never stored. */
  spent: Record<string, number>;
  /** The names of the switches that are on. */
  switchesOn: string[];
  /** Trackers added by hand on the Resources page. */
  manual: TrackerDef[];
  /** The tracker keys the player turned off: still listed, but not printed or refilled. */
  untracked: string[];
  declared: DeclaredResources;
}

export const emptyDeclaredResources = (): DeclaredResources => ({ trackers: [], switches: [], trackedOwners: [] });

export const emptyResourceState = (): ResourceState => ({
  spent: {},
  switchesOn: [],
  manual: [],
  untracked: [],
  declared: emptyDeclaredResources(),
});
