/**
 * The limited uses and switches a character's custom entries declare, read from
 * the drafts in its file. Nothing here is stored: the drafts are the single
 * place a tracker is defined, so this is recomputed whenever the file is read.
 */

import type { CustomEntryDraft, GrantBlock } from "@forge-cb/api";
import { isCustomItemDraft, isCustomSpellDraft } from "../custom/schema.js";
import { spellGrantTracker, spellTrackerId } from "../custom/tracker-setters.js";
import type { DeclaredResources, DeclaredSwitch, DeclaredTracker } from "./types.js";

export { spellTrackerId };

function spellGrantDeclared(draft: { id: string; name: string }, block: GrantBlock): DeclaredTracker | null {
  const found = spellGrantTracker(draft, block);
  if (found === null) return null;
  return {
    ownerId: draft.id,
    ownerName: draft.name,
    kind: "spell",
    def: found.def,
    ...(found.spellId === undefined ? {} : { spellId: found.spellId }),
  };
}

export function declareResources(drafts: readonly CustomEntryDraft[]): DeclaredResources {
  const trackers: DeclaredTracker[] = [];
  const switches: DeclaredSwitch[] = [];
  const trackedOwners = new Set<string>();
  for (const draft of drafts) {
    if (isCustomSpellDraft(draft)) continue;
    const kind = isCustomItemDraft(draft) ? "item" : "feature";
    for (const def of draft.trackers ?? []) {
      trackers.push({ ownerId: draft.id, ownerName: draft.name, kind, def });
      trackedOwners.add(draft.id);
    }
    const seen = new Set<string>();
    const declareSwitch = (name: string | undefined): void => {
      const trimmed = name?.trim();
      if (trimmed === undefined || trimmed === "" || seen.has(trimmed.toLowerCase())) return;
      seen.add(trimmed.toLowerCase());
      switches.push({ name: trimmed, ownerId: draft.id, ownerName: draft.name });
    };
    for (const block of draft.blocks) {
      if (block.kind === "grant") {
        const declared = spellGrantDeclared(draft, block);
        if (declared !== null) {
          trackers.push(declared);
          trackedOwners.add(draft.id);
        }
        declareSwitch(block.switch);
      } else if (block.kind === "modifier") {
        declareSwitch(block.gates?.switch);
      }
    }
  }
  return { trackers, switches, trackedOwners: [...trackedOwners] };
}
