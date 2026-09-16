import type { ParsedElement } from "../content/parser.js";
import type { CharacterState } from "../character/state.js";
import { declaredUsage, promisesFreeCastPerLongRest } from "./feature-casters.js";

export interface GrantedSpellUsage {
  usage: string;
  note?: string;
}

/** Reviewed exceptions whose allowance cannot be safely inferred from a
 * feature-wide usage alone. This does not change imported content or IDs. */
export function grantedSpellUsage(
  element: ParsedElement, spellId: string, state: CharacterState,
): GrantedSpellUsage | undefined {
  const id = element.identity.id;
  const lunar = id === "ID_WOTC_DSDQ_ARCHETYPE_FEATURE_LUNAR_MAGIC_LUNAR_EMBODIMENT";
  const lunarPlaytest = id === "ID_WOTC_UA20220308_ARCHETYPE_FEATURE_LUNAR_MAGIC_LUNAR_EMBODIMENT";
  if (lunar || lunarPlaytest) {
    const phases = ["FULL_MOON", "NEW_MOON", "CRESCENT_MOON"];
    const phase = phases.findIndex((suffix) => state.sum.elements.some((entry) => entry.id === `${id}_${suffix}`));
    // These two tables declare their spells row by row: Full, New, Crescent.
    const spells = element.rules.filter((rule) => rule.kind === "grant" && rule.type === "Spell");
    const index = spells.findIndex((rule) => rule.kind === "grant" && rule.id === spellId);
    if (phase < 0 || index < 0 || index % 3 !== phase || (lunar && index >= 3)) return undefined;
    return {
      usage: "1/Long Rest",
      note: lunar
        ? "Lunar Embodiment: one free cast of your selected phase's level-1 spell. Changing phase does not restore this use."
        : "Lunar Embodiment (playtest): once per spell per Long Rest for the selected phase.",
    };
  }
  if (id === "ID_WOTC_TCOE_ARCHETYPE_FEATURE_THE_FATHOMLESS_GRASPING_TENTACLES") {
    return { usage: "1/Long Rest" };
  }
  const usage = declaredUsage(element);
  if (usage === null || !promisesFreeCastPerLongRest(element)) return undefined;
  if (id === "ID_WOTC_PHB24_ARCHETYPE_FEATURE_BARD_GLAMOUR_MANTLE_OF_MAJESTY") {
    return {
      usage: "1 use/Long Rest",
      note: "Mantle of Majesty: one activation allows repeated Bonus Action Commands for up to 1 minute while concentrating. A level 3+ spell slot can restore the feature's use.",
    };
  }
  if (id === "ID_WOTC_UA20191003_ARCHETYPE_FEATURE_ONOMANCY_FATEFUL_NAMING") {
    return { usage: usage.replace("/", " shared/"), note: "Fateful Naming: Bane and Bless share this allowance. Speak one target's true name when casting." };
  }
  return { usage };
}
