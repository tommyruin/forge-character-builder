/**
 * Choice identity safety.
 *
 * A pick a player made under a choice is remembered by the choice's identity:
 * a checksum over the owning element's id and the select's name, type, level,
 * slot number and (for spell choices) supports (`selectionRuleChecksum`).
 * Edit any of those after a character has picked and the pick no longer
 * belongs to any choice; the engine drops it on the next load. This module
 * says, for an old and a new draft, which choices would change identity and
 * which pick slots that would orphan, so the editor can warn first.
 */

import type { ChoiceIdentityChangeDto, CustomDraft } from "@forge-cb/api";
import { parseElementsFile, type SelectRule } from "../content/parser.js";
import { selectionRuleChecksum } from "../selection/selection.js";
import { compileCustomElement } from "./compile.js";
import type { ChoiceBlock } from "./schema.js";

export interface ChoiceIdentity {
  blockId: string;
  name: string;
  type: string;
  level: number;
  count: number;
  /** Compiled supports; only part of the identity of a spell choice. */
  supports: string;
  /** The checksum of each slot, slot 1 first. */
  checksums: string[];
}

/** The select rules a draft compiles to, in block order, keyed by choice block id. */
function choiceIdentities(draft: CustomDraft): Map<string, ChoiceIdentity> {
  const [element] = parseElementsFile(`<elements>${compileCustomElement(draft)}</elements>`, "identity.xml");
  const selects = (element?.rules ?? []).filter((rule): rule is SelectRule => rule.kind === "select");
  const out = new Map<string, ChoiceIdentity>();
  const choices = draft.blocks.filter((block): block is ChoiceBlock => block.kind === "choice");
  choices.forEach((block, index) => {
    const select = selects[index];
    if (select === undefined) return;
    const count = select.number ?? 1;
    out.set(block.id, {
      blockId: block.id,
      name: select.name ?? select.type,
      type: select.type,
      level: select.level ?? 1,
      count,
      supports: select.supports ?? "",
      checksums: Array.from({ length: count }, (_, slot) => selectionRuleChecksum(draft.id, select, slot + 1)),
    });
  });
  return out;
}

/** The identity of every choice block of a draft, by block id. */
export function draftChoiceIdentities(draft: CustomDraft): ReadonlyMap<string, ChoiceIdentity> {
  return choiceIdentities(draft);
}

export interface ChoiceIdentityChange {
  blockId: string;
  name: string;
  type: string;
  change: ChoiceIdentityChangeDto["change"];
  fields: ChoiceIdentityChangeDto["fields"];
  orphanedSlots: number[];
  /** The old checksum of each orphaned slot, for finding the picks under it. */
  orphanedChecksums: string[];
}

/**
 * The choices whose identity differs between two versions of one draft.
 * Adding a choice, or only raising a choice's count, orphans nothing and is
 * reported only when the count changed.
 */
export function diffChoiceIdentity(before: CustomDraft, after: CustomDraft): ChoiceIdentityChange[] {
  const old = choiceIdentities(before);
  const next = choiceIdentities(after);
  const changes: ChoiceIdentityChange[] = [];
  for (const [blockId, was] of old) {
    const now = next.get(blockId);
    if (now === undefined) {
      changes.push({
        blockId,
        name: was.name,
        type: was.type,
        change: "removed",
        fields: [],
        orphanedSlots: was.checksums.map((_, slot) => slot + 1),
        orphanedChecksums: [...was.checksums],
      });
      continue;
    }
    const fields: ChoiceIdentityChange["fields"] = [];
    if (was.name !== now.name) fields.push("name");
    if (was.type !== now.type) fields.push("type");
    if (was.level !== now.level) fields.push("level");
    if (was.count !== now.count) fields.push("count");
    if (was.type === "Spell" && now.type === "Spell" && was.supports !== now.supports) fields.push("supports");
    if (fields.length === 0) continue;
    const kept = new Set(now.checksums);
    const orphanedSlots: number[] = [];
    const orphanedChecksums: string[] = [];
    was.checksums.forEach((checksum, slot) => {
      if (kept.has(checksum)) return;
      orphanedSlots.push(slot + 1);
      orphanedChecksums.push(checksum);
    });
    changes.push({ blockId, name: was.name, type: was.type, change: "changed", fields, orphanedSlots, orphanedChecksums });
  }
  return changes;
}
