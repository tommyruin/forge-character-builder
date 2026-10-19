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

import type { ChoiceIdentityChangeDto, CustomBuildDraft, CustomCatalogDraft, CustomDraft } from "@forge-cb/api";
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

/** The drafts that can hold a choice: features, and catalogue entries (a proficiency or a deity can grant rules too). */
export type ChoiceDraft = CustomDraft | CustomCatalogDraft;

/** The select rules a draft compiles to, in block order, keyed by choice block id. */
function choiceIdentities(draft: ChoiceDraft): Map<string, ChoiceIdentity> {
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
export function draftChoiceIdentities(draft: ChoiceDraft): ReadonlyMap<string, ChoiceIdentity> {
  return choiceIdentities(draft);
}

export interface ChoiceIdentityChange {
  /** The element whose rules hold the choice, when it is not the draft's own element (a class' features). */
  ownerId?: string;
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
export function diffChoiceIdentity(before: ChoiceDraft, after: ChoiceDraft): ChoiceIdentityChange[] {
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

// ---- character options: choices spread over several elements -----------------------------

interface CompiledChoice extends ChoiceIdentity {
  ownerId: string;
  /** Owner, type and name with the position among choices sharing them: what ties an old choice to its new one. */
  key: string;
}

/**
 * Every choice a class, species, background or subclass compiles to, on whichever
 * element holds it. A choice has no block id here (the table, the features and the
 * generated spellcasting all hold them), so it is told apart by the element that
 * owns it, its type and name, and its position among those that share them.
 */
function buildChoices(draft: CustomBuildDraft): CompiledChoice[] {
  const elements = parseElementsFile(`<elements>${compileCustomElement(draft)}</elements>`, "identity.xml");
  const out: CompiledChoice[] = [];
  for (const element of elements) {
    const seen = new Map<string, number>();
    for (const rule of element.rules) {
      if (rule.kind !== "select") continue;
      const name = rule.name ?? rule.type;
      const base = `${element.identity.id}|${rule.type}|${name}`;
      const at = seen.get(base) ?? 0;
      seen.set(base, at + 1);
      const count = rule.number ?? 1;
      out.push({
        blockId: `${base}|${at}`,
        key: `${base}|${at}`,
        ownerId: element.identity.id,
        name,
        type: rule.type,
        level: rule.level ?? 1,
        count,
        supports: rule.supports ?? "",
        checksums: Array.from({ length: count }, (_, slot) => selectionRuleChecksum(element.identity.id, rule, slot + 1)),
      });
    }
  }
  return out;
}

/**
 * The choices of a class, species, background or subclass whose picks an edit
 * would orphan. A pick survives when any choice of the edited draft still has
 * its checksum, so moving a choice between levels' positions costs nothing; one
 * that no choice matches any more is reported, with the fields that differ from
 * the choice it most resembles (same owner, type and name), or as removed.
 */
export function diffBuildChoiceIdentity(before: CustomBuildDraft, after: CustomBuildDraft): ChoiceIdentityChange[] {
  const old = buildChoices(before);
  const next = buildChoices(after);
  const kept = new Set(next.flatMap((choice) => choice.checksums));
  const byKey = new Map(next.map((choice) => [choice.key, choice]));
  const changes: ChoiceIdentityChange[] = [];
  for (const was of old) {
    const orphanedSlots: number[] = [];
    const orphanedChecksums: string[] = [];
    was.checksums.forEach((checksum, slot) => {
      if (kept.has(checksum)) return;
      orphanedSlots.push(slot + 1);
      orphanedChecksums.push(checksum);
    });
    if (orphanedSlots.length === 0) continue;
    const now = byKey.get(was.key);
    const fields: ChoiceIdentityChange["fields"] = [];
    if (now !== undefined) {
      if (was.level !== now.level) fields.push("level");
      if (was.count !== now.count) fields.push("count");
      if (was.type === "Spell" && was.supports !== now.supports) fields.push("supports");
    }
    changes.push({
      ownerId: was.ownerId,
      blockId: was.blockId,
      name: was.name,
      type: was.type,
      change: now === undefined ? "removed" : "changed",
      fields,
      orphanedSlots,
      orphanedChecksums,
    });
  }
  return changes;
}
