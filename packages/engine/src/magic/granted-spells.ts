import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import { featureSpellCasters } from "./feature-casters.js";
import { spellInfo, type SpellInfo } from "./spelllist.js";

/**
 * Additional spells: the `<magic><additional>` entries (the add-spell surface
 * writes "Additional Spell, X" / "Additional <caster> Spell, X") and the
 * ingest-generated "Additional ... Spell" item proxies that register the same
 * grants. They belong to no caster block, so whenever a class caster's list
 * does not already carry one it projects through the "Additional Spells"
 * block instead.
 */

/** Whether an `<additional>` source follows the DM-grant naming convention. */
export function isDmGrantSource(source: string): boolean {
  return /^Additional(?: [A-Za-z]+)* Spell, /.test(source);
}

/**
 * The caster a DM grant names. The add-spell surface files a spell for a
 * caster as "Additional Spell, Cure Wounds (Wizard)": still a DM grant by its
 * prefix, with the caster in a closing parenthesis. The name only counts when
 * it is one of the character's casters, so a spell whose own name ends in a
 * parenthesis is never misread.
 */
export function grantCasterOf(source: string, casterNames: Iterable<string>): string | null {
  const match = / \(([^()]+)\)$/.exec(source);
  if (match === null || !isDmGrantSource(source)) return null;
  for (const name of casterNames) if (name === match[1]) return name;
  return null;
}

/** The `source` a DM grant of this spell is filed under, naming the caster when there is one. */
export function dmGrantSource(spellName: string, caster: string | null): string {
  return caster === null ? `Additional Spell, ${spellName}` : `Additional Spell, ${spellName} (${caster})`;
}

/** Whether an element id names an ingest-generated "Additional ... Spell" item proxy. */
export function isGeneratedSpellProxyId(id: string): boolean {
  return id.includes("_INTERNAL_ITEM_") && id.includes("_SPELL_PROXY_");
}

/**
 * Every additional spell the character carries, deduplicated by spell id:
 * the `<additional>` entries plus the generated proxy items' spells. Non-DM
 * entries are included so a character with no class caster keeps the block
 * that used to gather them.
 */
export function additionalSpellPool(state: CharacterState, library: ElementLibrary): SpellInfo[] {
  const byId = new Map<string, SpellInfo>();
  for (const extra of state.magic?.additional ?? []) {
    const info = spellInfo(library, extra.id);
    if (info !== null) byId.set(info.id, info);
  }
  for (const caster of featureSpellCasters(state, library)) {
    if (!isGeneratedSpellProxyId(caster.elementId)) continue;
    for (const id of [...caster.cantripIds, ...caster.spellIds]) {
      const info = spellInfo(library, id);
      if (info !== null) byId.set(info.id, info);
    }
  }
  return [...byId.values()];
}
