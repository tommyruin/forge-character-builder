import type { Dnd5eNode } from "../dnd5e/document.js";

/**
 * Parsed magic state — the engine's view of the `<magic>` region.
 *
 * The region is parsed fresh from the document node on every projection so
 * imported bytes stay authoritative until a real mutation happens. Attribute
 * values are kept as raw strings (the DTO layer formats them).
 */

export interface MagicSpellEntry {
  name: string;
  level: string;
  id: string;
  /** `prepared="true"` on the spell element. */
  prepared: boolean;
  /** `always-prepared="true"` on the spell element. */
  alwaysPrepared: boolean;
  /** `known="true"` on the spell element. */
  known: boolean;
}

export interface MagicCasterBlock {
  name: string;
  ability: string;
  attack: string;
  dc: string;
  source: string;
  /** Slot counts keyed by level (s1..s9). */
  slots: Record<string, string>;
  cantrips: MagicSpellEntry[];
  spells: MagicSpellEntry[];
}

export interface MagicAdditionalSpell {
  name: string;
  level: string;
  id: string;
  /** The `source` attribute (the granting feature name). */
  source: string;
}

export interface MagicState {
  /** `multiclass="true"` on the magic root. */
  multiclass: boolean;
  /** `level="N"` on the magic root (multiclass caster level). */
  level: string | null;
  /** Caster blocks in document order. */
  casters: MagicCasterBlock[];
  /** `<additional>` spells in document order. */
  additional: MagicAdditionalSpell[];
}

function spellAttrs(node: Dnd5eNode): MagicSpellEntry {
  const attrs = new Map(node.attrs);
  return {
    name: attrs.get("name") ?? "",
    level: attrs.get("level") ?? "",
    id: attrs.get("id") ?? "",
    prepared: attrs.get("prepared") === "true",
    alwaysPrepared: attrs.get("always-prepared") === "true",
    known: attrs.get("known") === "true",
  };
}

function castersOf(node: Dnd5eNode): MagicCasterBlock[] {
  const blocks: MagicCasterBlock[] = [];
  for (const casting of node.children) {
    if (casting.name !== "spellcasting") continue;
    const attrs = new Map(casting.attrs);
    const slots: Record<string, string> = {};
    const cantrips: MagicSpellEntry[] = [];
    const spells: MagicSpellEntry[] = [];
    for (const child of casting.children) {
      if (child.name === "slots") {
        for (const attr of child.attrs) slots[attr[0]] = attr[1];
      } else if (child.name === "cantrips") {
        for (const spell of child.children) {
          if (spell.name === "spell") cantrips.push(spellAttrs(spell));
        }
      } else if (child.name === "spells") {
        for (const spell of child.children) {
          if (spell.name === "spell") spells.push(spellAttrs(spell));
        }
      }
    }
    blocks.push({
      name: attrs.get("name") ?? "",
      ability: attrs.get("ability") ?? "",
      attack: attrs.get("attack") ?? "",
      dc: attrs.get("dc") ?? "",
      source: attrs.get("source") ?? "",
      slots,
      cantrips,
      spells,
    });
  }
  return blocks;
}

function additionalOf(node: Dnd5eNode): MagicAdditionalSpell[] {
  const additional: MagicAdditionalSpell[] = [];
  for (const child of node.children) {
    if (child.name !== "additional") continue;
    for (const spell of child.children) {
      if (spell.name !== "spell") continue;
      const attrs = new Map(spell.attrs);
      additional.push({
        name: attrs.get("name") ?? "",
        level: attrs.get("level") ?? "",
        id: attrs.get("id") ?? "",
        source: attrs.get("source") ?? "",
      });
    }
  }
  return additional;
}

/** Parses the magic region into the engine state. Returns null when absent. */
export function parseMagicState(node: Dnd5eNode | null): MagicState | null {
  if (node === null) return null;
  const attrs = new Map(node.attrs);
  return {
    multiclass: attrs.get("multiclass") === "true",
    level: attrs.get("level") ?? null,
    casters: castersOf(node),
    additional: additionalOf(node),
  };
}
