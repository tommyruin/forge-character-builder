/**
 * The unarmed strike profile.
 *
 * An unarmed strike is not an inventory item, so it has no weapon element to
 * read a damage die, a range, or a proficiency from. Everything that varies
 * comes from content statistic keys instead, and the rules this module
 * implements are the ones the corpus already encodes:
 *
 *  - the damage die REPLACES the base. Monk Martial Arts writes
 *    `martial arts:dice` in both rulesets (4/6/8/10 in 2014, 6/8/10/12 in
 *    2024, already collapsed to the level's value by the statistics bonus
 *    bucket), Tasha's Unarmed Fighting writes `unarmed fighting:size`, and
 *    `unarmed strike:dice` is the canonical key for custom content. Every one
 *    of those features reads "you can roll X in place of the normal damage",
 *    so the largest die wins. With none of them present the base is a flat 1.
 *  - the attack and damage riders SUM. The corpus spells the same concept two
 *    ways (`unarmed strike:*` on the Eldritch Claw Tattoo, `unarmed:*` on the
 *    Insignia of Claws), so both are read.
 *  - Dexterity replaces Strength only when a martial-arts key is present. The
 *    statistics bucket has already reduced the feature's own STR/DEX pair to
 *    the higher modifier; its presence is what tells us the substitution is
 *    allowed, and the tie goes to Strength exactly as the weapon finesse rule
 *    does.
 *
 * The `melee:attack` / `melee:damage` category keys are deliberately NOT read
 * here. Their `equipped=` gate is evaluated once per character rather than per
 * attack row, so a sword-and-board Duelling fighter would otherwise collect a
 * spurious +2 on their fist.
 */

/** Content keys that replace the unarmed damage die, with their display label. */
const DIE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["martial arts:dice", "Martial Arts"],
  ["unarmed fighting:size", "Unarmed Fighting"],
  ["unarmed strike:dice", "Unarmed Strike"],
];

/** Content keys that sum into the attack bonus. */
export const ATTACK_RIDER_KEYS: readonly string[] = ["unarmed strike:attack", "unarmed:attack"];

/** Content keys that sum into the damage bonus. */
export const DAMAGE_RIDER_KEYS: readonly string[] = ["unarmed strike:damage", "unarmed:damage"];

/** Keys whose presence means Dexterity may replace Strength. */
const DEXTERITY_KEYS: readonly string[] = [
  "martial arts:attack",
  "martial arts:damage",
  "martial arts:ability modifier",
];

/** The save DC key of the 2024 Grapple and Shove options. */
const SAVE_DC_KEY = "martial arts:dc";

/** Every key whose contributing feature the attack row wants to name. */
export const UNARMED_SOURCE_KEYS: ReadonlySet<string> = new Set([
  ...DIE_KEYS.map(([key]) => key),
  ...ATTACK_RIDER_KEYS,
  ...DAMAGE_RIDER_KEYS,
]);

/** Die sizes an unarmed damage die may take. */
const DIE_SIZES: readonly number[] = [4, 6, 8, 10, 12];

/** One content rule that fed an unarmed key, with the feature that wrote it. */
export interface StatContributor {
  key: string;
  value: number;
  /** The rule's `alt` text, else the owning element's name. */
  label: string;
  elementId: string;
}

/** A feature contributing a flat bonus, collapsed across the two key spellings. */
export interface UnarmedRiderSource {
  name: string;
  elementId: string;
  attack: number;
  damage: number;
}

export interface UnarmedProfile {
  /** The damage dice string: "1" when nothing applies, otherwise "1dN". */
  dice: string;
  /** The content feature that supplied the die, for the computation breakdown. */
  dieSource: string | null;
  damageType: string;
  /** "Strength" unless a martial-arts key allows the higher Dexterity. */
  defaultAbility: string;
  attackRiders: number;
  damageRiders: number;
  /** The features behind the flat bonuses, for the row's applied-modifier list. */
  riderSources: UnarmedRiderSource[];
  /** Situational facts worth surfacing on the row (never added to the totals). */
  notes: string[];
}

const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

const sumOf = (statistics: Record<string, number>, keys: readonly string[]): number =>
  keys.reduce((total, key) => total + (statistics[key] ?? 0), 0);

/**
 * The largest usable die across the die keys, with the feature that supplied it.
 *
 * The key's own label is only a fallback. `unarmed strike:dice` is the generic
 * key that any feature may write, so naming it would report "Unarmed Strike"
 * back at the reader; when a contributor matching the winning value is known,
 * that feature's name is used instead.
 */
function largestDie(
  statistics: Record<string, number>,
  contributors: readonly StatContributor[],
): { size: number; source: string } | null {
  let best: { size: number; source: string } | null = null;
  for (const [key, label] of DIE_KEYS) {
    const size = statistics[key];
    if (size === undefined || !DIE_SIZES.includes(size)) continue;
    if (best !== null && size <= best.size) continue;
    const named = contributors.filter((entry) => entry.key === key && entry.value === size);
    best = { size, source: named[0]?.label ?? label };
  }
  return best;
}

/** The features behind the flat riders, merged per element and ordered by size. */
function riderSourcesOf(contributors: readonly StatContributor[]): UnarmedRiderSource[] {
  const merged = new Map<string, UnarmedRiderSource>();
  for (const entry of contributors) {
    const isAttack = ATTACK_RIDER_KEYS.includes(entry.key);
    const isDamage = DAMAGE_RIDER_KEYS.includes(entry.key);
    if (!isAttack && !isDamage) continue;
    const existing = merged.get(entry.elementId) ??
      { name: entry.label, elementId: entry.elementId, attack: 0, damage: 0 };
    if (isAttack) existing.attack += entry.value;
    if (isDamage) existing.damage += entry.value;
    merged.set(entry.elementId, existing);
  }
  return [...merged.values()].sort(
    (a, b) => b.damage - a.damage || b.attack - a.attack || a.name.localeCompare(b.name),
  );
}

/**
 * The unarmed strike profile for the character's current statistics.
 *
 * `statistics` is the `computeStatistics` output; only the ability scores are
 * needed beyond it, which keeps this resolvable without a content library.
 */
export function resolveUnarmedProfile(
  statistics: Record<string, number>,
  abilities: { strength: number; dexterity: number },
  contributors: readonly StatContributor[] = [],
): UnarmedProfile {
  const die = largestDie(statistics, contributors);
  const allowsDexterity = DEXTERITY_KEYS.some((key) => statistics[key] !== undefined);
  const strength = statistics["strength:modifier"] ?? abilityModifier(abilities.strength);
  const dexterity = statistics["dexterity:modifier"] ?? abilityModifier(abilities.dexterity);
  const saveDc = statistics[SAVE_DC_KEY];
  return {
    dice: die === null ? "1" : `1d${die.size}`,
    dieSource: die?.source ?? null,
    damageType: "bludgeoning",
    defaultAbility: allowsDexterity && dexterity > strength ? "Dexterity" : "Strength",
    attackRiders: sumOf(statistics, ATTACK_RIDER_KEYS),
    damageRiders: sumOf(statistics, DAMAGE_RIDER_KEYS),
    riderSources: riderSourcesOf(contributors),
    notes: saveDc === undefined ? [] : [`Grapple or Shove save DC ${saveDc}`],
  };
}
