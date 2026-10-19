/**
 * The limited uses and switches a character's custom entries declare, read from
 * the drafts in its file. Nothing here is stored: the drafts are the single
 * place a tracker is defined, so this is recomputed whenever the file is read.
 */

import type { CustomEntryDraft, GrantBlock, TrackerDef } from "@forge-cb/api";
import { isCustomItemDraft, isCustomSpellDraft } from "../custom/schema.js";
import { parseUsageText } from "./usage.js";
import type { DeclaredResources, DeclaredSwitch, DeclaredTracker } from "./types.js";

/** The stable id of the free-cast tracker a spell grant declares. */
export const spellTrackerId = (draftId: string, blockId: string): string => `spell:${draftId}:${blockId}`;

function spellGrantTracker(draft: { id: string; name: string }, block: GrantBlock): DeclaredTracker | null {
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
  return {
    ownerId: draft.id,
    ownerName: draft.name,
    kind: "spell",
    def,
    ...(block.target.by === "id" ? { spellId: block.target.id } : {}),
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
    for (const block of draft.blocks) {
      if (block.kind === "grant") {
        const declared = spellGrantTracker(draft, block);
        if (declared !== null) {
          trackers.push(declared);
          trackedOwners.add(draft.id);
        }
      } else if (block.kind === "modifier") {
        const name = block.gates?.switch?.trim();
        if (name !== undefined && name !== "" && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          switches.push({ name, ownerId: draft.id, ownerName: draft.name });
        }
      }
    }
  }
  return { trackers, switches, trackedOwners: [...trackedOwners] };
}
