/**
 * Structured spell mechanics.
 *
 * A book spell says what it rolls in prose, and the attack-option rows recover
 * it with regular expressions (`parseSpellAttack`, `parseSpellSave`). A spell
 * made in the builder says it outright, in setters, so the numbers never
 * depend on how its text is worded:
 *
 *  - `spell roll`: `ranged attack`, `melee attack`, `saving throw` or `none`.
 *    Its presence marks the spell as structured; `none` makes it a spell with
 *    no attack row, whatever its text mentions.
 *  - `spell save`: the ability a saving-throw spell forces ("Wisdom").
 *  - `spell save success`: `half` when a successful save still takes half.
 *  - `spell damage` (repeatable, `type` attribute): one damage term, "1d10 fire".
 *  - `spell cantrip scaling` (repeatable, `level` attribute): from that
 *    character level the first damage term's dice are the value (2d10 at 5).
 *  - `spell slot scaling`: dice each slot level above the spell's own adds.
 *  - `spell modifier`: `true` when the spellcasting modifier joins the damage.
 *  - `spell healing`: dice the spell restores; carried for the spell's text and
 *    cards, never an attack row.
 *
 * A spell without `spell roll` is read from its prose exactly as before.
 */

import type { ParsedElement } from "../content/parser.js";
import type { SpellAttackParse, SpellSaveParse } from "./reconcile.js";

export const SPELL_ROLL_SETTER = "spell roll";

export const ordinal = (value: number): string => {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
};

export interface StructuredSpellRows {
  attack: SpellAttackParse | null;
  save: SpellSaveParse | null;
}

interface DamageTerm {
  dice: string;
  type: string;
}

const text = (element: Pick<ParsedElement, "setters">, name: string): string | undefined => {
  const value = element.setters.find((setter) => setter.name === name)?.value.trim();
  return value === undefined || value === "" ? undefined : value;
};

/** Whether a spell declares its own roll. */
export function isStructuredSpell(element: Pick<ParsedElement, "setters">): boolean {
  return text(element, SPELL_ROLL_SETTER) !== undefined;
}

function damageTerms(element: Pick<ParsedElement, "setters">, characterLevel: number): DamageTerm[] {
  const terms: DamageTerm[] = element.setters
    .filter((setter) => setter.name === "spell damage" && setter.value.trim() !== "")
    .map((setter) => ({ dice: setter.value.trim(), type: setter.attrs?.type?.trim() ?? "" }));
  if (terms.length === 0) return terms;
  let tierLevel = -1;
  for (const tier of element.setters) {
    if (tier.name !== "spell cantrip scaling" || tier.value.trim() === "") continue;
    const at = Number.parseInt(tier.attrs?.level ?? "", 10);
    if (Number.isFinite(at) && at <= characterLevel && at > tierLevel) {
      tierLevel = at;
      terms[0] = { ...terms[0]!, dice: tier.value.trim() };
    }
  }
  return terms;
}

const damageText = (terms: readonly DamageTerm[]): string =>
  terms.map((term) => (term.type === "" ? term.dice : `${term.dice} ${term.type}`)).join(" + ");

/**
 * The attack or save row a structured spell projects, or null when the spell
 * is not structured (the caller reads its prose). `spellLevel` only words the
 * upcast warning.
 */
export function structuredSpellMechanics(
  element: Pick<ParsedElement, "setters">,
  characterLevel: number,
  spellLevel: number,
): StructuredSpellRows | null {
  const roll = text(element, SPELL_ROLL_SETTER)?.toLowerCase();
  if (roll === undefined) return null;
  const terms = damageTerms(element, characterLevel);
  const damage = damageText(terms);
  const slotDice = text(element, "spell slot scaling");
  const warning = slotDice === undefined || terms.length === 0
    ? null
    : `Higher-level slots add ${slotDice} per slot level above ${ordinal(spellLevel)}.`;
  const addsSpellcastingModifier = text(element, "spell modifier") === "true";

  if (roll === "ranged attack" || roll === "melee attack") {
    return {
      attack: { damage, beamCount: 1, beamUnit: "attacks", addsSpellcastingModifier, warning, notes: [] },
      save: null,
    };
  }
  if (roll === "saving throw") {
    const ability = text(element, "spell save");
    // Like a prose save spell, a save that deals no damage has no row to show.
    if (ability === undefined || terms.length === 0) return { attack: null, save: null };
    return {
      attack: null,
      save: {
        ability,
        damage,
        halfOnSuccess: text(element, "spell save success")?.toLowerCase() === "half",
        addsSpellcastingModifier,
        warning,
        notes: [],
      },
    };
  }
  return { attack: null, save: null };
}
