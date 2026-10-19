/**
 * Spell aliases: a character's own name and note for a spell.
 *
 * The alias is presentation. The spell keeps its element id, its rules and its
 * numbers; the Magic tab, the sheet and the spell's attack row print the alias.
 * It is stored in the builder's block of the character file
 * (`dnd5e/builder-block.ts`), as JSON keyed by spell element id:
 *
 * ```xml
 * <spell-aliases schema="1"><![CDATA[{"ID_PHB_SPELL_BARKSKIN":{"name":"Moonlit Ward","note":"..."}}]]></spell-aliases>
 * ```
 *
 * The aliases are not part of the `<magic>` region, so a character file that
 * uses none has no trace of them and keeps its original bytes.
 */

import { builderChildText, cdata, planBuilderChildEdits } from "../dnd5e/builder-block.js";
import type { Dnd5eDocument } from "../dnd5e/document.js";
import type { RawEdit } from "../selection/selection.js";

export const SPELL_ALIASES_NODE = "spell-aliases";
export const SPELL_ALIASES_SCHEMA = 1;
export const MAX_ALIAS_NAME = 80;
export const MAX_ALIAS_NOTE = 500;

export interface SpellAlias {
  /** The name printed in place of the spell's own; empty keeps the spell's name. */
  name: string;
  note: string;
}

export interface SpellAliasRead {
  /** Every stored entry, readable or not, so an edit carries what it cannot read through untouched. */
  stored: Record<string, unknown>;
  /** The entries this version can read. */
  aliases: Record<string, SpellAlias>;
  /** The whole block is not a JSON object; it is left alone rather than rewritten. */
  unreadable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One stored entry as an alias, or null when it is not one (or says nothing). */
function readAlias(raw: unknown): SpellAlias | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : "";
  const note = typeof raw.note === "string" ? raw.note : "";
  return name === "" && note === "" ? null : { name, note };
}

export function readSpellAliasBlock(document: Dnd5eDocument): SpellAliasRead {
  const text = builderChildText(document, SPELL_ALIASES_NODE);
  if (text === null || text === "") return { stored: {}, aliases: {}, unreadable: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { stored: {}, aliases: {}, unreadable: true };
  }
  if (!isRecord(parsed)) return { stored: {}, aliases: {}, unreadable: true };
  const aliases: Record<string, SpellAlias> = {};
  for (const [id, raw] of Object.entries(parsed)) {
    const alias = readAlias(raw);
    if (alias !== null) aliases[id] = alias;
  }
  return { stored: parsed, aliases, unreadable: false };
}

/** The aliases a document carries, by spell id. */
export function readSpellAliases(document: Dnd5eDocument): Record<string, SpellAlias> {
  return readSpellAliasBlock(document).aliases;
}

/** Byte edits that make the document carry exactly these stored entries. */
export function planSpellAliasEdits(document: Dnd5eDocument, stored: Readonly<Record<string, unknown>>): RawEdit[] {
  const element = Object.keys(stored).length === 0
    ? null
    : `<${SPELL_ALIASES_NODE} schema="${SPELL_ALIASES_SCHEMA}">${cdata(JSON.stringify(stored))}</${SPELL_ALIASES_NODE}>`;
  return planBuilderChildEdits(document, SPELL_ALIASES_NODE, element);
}

/** What a spell is printed as: its alias with the real name beside it where there is room. */
export function spellDisplayName(realName: string, alias: SpellAlias | undefined): string {
  const name = alias?.name.trim() ?? "";
  return name === "" || name === realName ? realName : `${name} (${realName})`;
}

/** The short form for narrow places (the spell list): the alias alone. */
export function spellShortName(realName: string, alias: SpellAlias | undefined): string {
  const name = alias?.name.trim() ?? "";
  return name === "" ? realName : name;
}
