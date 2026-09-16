/**
 * Features that change a spell attack's damage or range.
 *
 * The corpus describes most of these only in prose (Potent Spellcasting,
 * Spell Sniper, Eldritch Spear) and the few that carry a statistic use a
 * feature-specific key ("agonizing blast:damage"), so the engine keeps a
 * table keyed by element id. A rider is either applied — its effect lands in
 * the row's damage or range, with a pill and a note naming it — or, when the
 * text leaves the player a decision (a chosen cantrip, a matching damage type,
 * a once-per-turn limit), surfaced as a note alone.
 */

export interface SpellRiderSpell {
  spellId: string;
  /** Spell level; 0 for a cantrip. */
  level: number;
  school: string;
  /** The caster block's name, which the corpus sets to the class ("Cleric"). */
  casterName: string;
  range: string;
  damage: string;
  beamCount: number;
}

export interface SpellRiderInput extends SpellRiderSpell {
  /** Ids of every element registered on the character. */
  registered: ReadonlySet<string>;
  statistics: Readonly<Record<string, number>>;
  /** The display name of a registered element, when the library knows it. */
  nameOf: (id: string) => string | undefined;
}

export interface SpellRiderModifier {
  id: string;
  name: string;
  field: string;
  effect: string;
}

export interface SpellRiderResult {
  damage: string;
  range: string;
  appliedModifiers: SpellRiderModifier[];
  sourceNotes: string[];
}

type AbilityName = "charisma" | "intelligence" | "wisdom";

interface SpellRider {
  /** Every printing that grants the feature. */
  ids: readonly string[];
  /** Pill name when the library has no element for the id. */
  label: string;
  applies: (spell: SpellRiderSpell) => boolean;
  /** Damage bonus: a statistic the corpus emits, or an ability modifier. */
  damage?: { stat: string } | { ability: AbilityName };
  range?: { set: string } | { add: number } | { multiply: number };
  /** A "note" rider never changes the row; its text explains the condition. */
  note?: string;
}

export const ELDRITCH_BLAST_2014 = "ID_PHB_SPELL_ELDRITCH_BLAST";

const AGONIZING_BLAST_2014 = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_AGONIZING_BLAST";
// The corpus keeps this id's mixed case on purpose: changing it would orphan
// existing characters, so it is matched exactly as written.
const ELDRITCH_SPEAR_2014 = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_Eldritch_Spear";
const AGONIZING_BLAST_2024 = "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_AGONIZING_BLAST";
const ELDRITCH_SPEAR_2024 = [
  "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_ELDRITCH_SPEAR",
  "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_ELDRITCH_SPEAR_REPEATABLE",
];

const POTENT_SPELLCASTING_CLERIC = [
  "ID_WOTC_PHB_ARCHETYPE_FEATURE_KNOWLEDGE_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_PHB_ARCHETYPE_FEATURE_LIGHT_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_SCAG_ARCHETYPE_FEATURE_ARCANA_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_XGTE_ARCHETYPE_FEATURE_GRAVE_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_TCOE_ARCHETYPE_FEATURE_PEACE_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_PSA_ARCHETYPE_FEATURE_AMBITION_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_UA20200206_ARCHETYPE_FEATURE_LOVE_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_UA20200206_ARCHETYPE_FEATURE_UNITY_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_UA20220718_ARCHETYPE_CLERIC_FEATURE_FATE_DOMAIN_POTENT_SPELLCASTING",
  "ID_WOTC_PHB24_CLASS_FEATURE_CLERIC_BLESSED_STRIKES_POTENT_SPELLCASTING",
];

const POTENT_SPELLCASTING_DRUID = ["ID_WOTC_PHB24_CLASS_FEATURE_DRUID_ELEMENTAL_FURY_POTENT_SPELLCASTING"];
const IMPROVED_ELEMENTAL_FURY = ["ID_WOTC_PHB24_CLASS_FEATURE_DRUID_IMPROVED_ELEMENTAL_FURY"];
const EMPOWERED_EVOCATION = [
  "ID_WOTC_PHB_ARCHETYPE_FEATURE_WIZARD_EVOCATION_EMPOWERED_EVOCATION",
  "ID_WOTC_PHB24_ARCHETYPE_WIZARD_EVOKER_EMPOWERED_EVOCATION",
];
const SPELL_SNIPER_2014 = ["ID_PHB_FEAT_SPELLSNIPER"];
const SPELL_SNIPER_2024 = ["ID_WOTC_PHB24_FEAT_SPELLSNIPER"];

/**
 * Riders that only touch spells with an attack roll: both printings of Spell
 * Sniper extend "a spell that requires an attack roll", never a save.
 */
export const ATTACK_ROLL_RIDER_IDS: ReadonlySet<string> = new Set([...SPELL_SNIPER_2014, ...SPELL_SNIPER_2024]);

const ELEMENTAL_AFFINITY = [
  "ID_WOTC_PHB_ARCHETYPE_FEATURE_ELEMENTAL_AFFINITY",
  "ID_WOTC_PHB24_ARCHETYPE_FEATURE_SORCERER_DRACONIC_SORCERY_ELEMENTAL_AFFINITY",
];
const RADIANT_SOUL = [
  "ID_WOTC_XGTE_ARCHETYPE_FEATURE_CELESTIAL_RADIANT_SOUL",
  "ID_WOTC_PHB24_ARCHETYPE_FEATURE_WARLOCK_CELESTIAL_PATRON_RADIANT_SOUL",
  "ID_WOTC_UA20151102_ARCHETYPE_FEATURE_UNDYING_LIGHT_RADIANT_SOUL",
];
const ARCANE_FIREARM = [
  "ID_WOTC_TCOE_ARCHETYPE_FEATURE_ARTILLERIST_ARCANE_FIREARM",
  "ID_WOTC_ERLW_ARCHETYPE_FEATURE_ARTILLERIST_ARCANE_FIREARM",
];
const ALCHEMICAL_SAVANT = [
  "ID_WOTC_TCOE_ARCHETYPE_FEATURE_ALCHEMIST_ALCHEMICAL_SAVANT",
  "ID_WOTC_ERLW_ARCHETYPE_FEATURE_ALCHEMIST_ALCHEMICAL_SAVANT",
];
const HEXBLADES_CURSE = ["ID_WOTC_XGTE_ARCHETYPE_FEATURE_HEXBLADE_HEXBLADES_CURSE"];
const DISTANT_SPELL = [
  "ID_WOTC_PHB_CLASS_FEATURE_SORCERER_METAMAGIC_DISTANT_SPELL",
  "ID_WOTC_PHB24_CLASS_FEATURE_SORCERER_METAMAGIC_DISTANT_SPELL",
];

/** The range in feet, or null for "Touch", "Self", "Sight" and the like. */
export function rangeFeet(range: string): number | null {
  const match = /^(\d+) f(?:ee|oo)t\b/i.exec(range.trim());
  return match === null ? null : Number.parseInt(match[1]!, 10);
}

const isCantrip = (spell: SpellRiderSpell): boolean => spell.level === 0;
const ofClass = (spell: SpellRiderSpell, name: string): boolean => spell.casterName.toLowerCase() === name;
const hasDamage = (spell: SpellRiderSpell): boolean => spell.damage !== "";
const damageType = (spell: SpellRiderSpell, ...types: string[]): boolean =>
  types.some((type) => spell.damage.toLowerCase().includes(type));
const rangedAtLeast = (spell: SpellRiderSpell, feet: number): boolean => {
  const range = rangeFeet(spell.range);
  return range !== null && range >= feet;
};

/** Table order is application order; a later rider sees the earlier one's result. */
const SPELL_RIDERS: readonly SpellRider[] = [
  {
    ids: [AGONIZING_BLAST_2014],
    label: "Agonizing Blast",
    applies: (spell) => spell.spellId === ELDRITCH_BLAST_2014 && hasDamage(spell),
    damage: { stat: "agonizing blast:damage" },
  },
  {
    ids: [ELDRITCH_SPEAR_2014],
    label: "Eldritch Spear",
    applies: (spell) => spell.spellId === ELDRITCH_BLAST_2014,
    range: { set: "300 feet" },
  },
  {
    ids: POTENT_SPELLCASTING_CLERIC,
    label: "Potent Spellcasting",
    applies: (spell) => isCantrip(spell) && ofClass(spell, "cleric") && hasDamage(spell),
    damage: { ability: "wisdom" },
  },
  {
    ids: POTENT_SPELLCASTING_DRUID,
    label: "Potent Spellcasting",
    applies: (spell) => isCantrip(spell) && ofClass(spell, "druid") && hasDamage(spell),
    damage: { ability: "wisdom" },
  },
  {
    ids: IMPROVED_ELEMENTAL_FURY,
    label: "Improved Elemental Fury",
    applies: (spell) => isCantrip(spell) && ofClass(spell, "druid") && rangedAtLeast(spell, 10),
    range: { add: 300 },
  },
  {
    ids: EMPOWERED_EVOCATION,
    label: "Empowered Evocation",
    applies: (spell) =>
      ofClass(spell, "wizard") && spell.school.toLowerCase() === "evocation" && hasDamage(spell) && spell.beamCount === 1,
    damage: { ability: "intelligence" },
  },
  {
    ids: EMPOWERED_EVOCATION,
    label: "Empowered Evocation",
    applies: (spell) =>
      ofClass(spell, "wizard") && spell.school.toLowerCase() === "evocation" && hasDamage(spell) && spell.beamCount > 1,
    note: "Empowered Evocation adds your Intelligence modifier to one damage roll of the spell, not to every hit.",
  },
  {
    ids: SPELL_SNIPER_2014,
    label: "Spell Sniper",
    applies: (spell) => rangeFeet(spell.range) !== null,
    range: { multiply: 2 },
  },
  {
    ids: SPELL_SNIPER_2024,
    label: "Spell Sniper",
    applies: (spell) => rangedAtLeast(spell, 10),
    range: { add: 60 },
  },
  {
    ids: [AGONIZING_BLAST_2024],
    label: "Agonizing Blast",
    applies: (spell) => isCantrip(spell) && ofClass(spell, "warlock") && hasDamage(spell),
    note: "Agonizing Blast (2024) applies to one chosen Warlock cantrip; add your Charisma modifier to its damage if this is the one.",
  },
  {
    ids: ELDRITCH_SPEAR_2024,
    label: "Eldritch Spear",
    applies: (spell) => isCantrip(spell) && ofClass(spell, "warlock") && rangedAtLeast(spell, 10),
    note: "Eldritch Spear (2024) applies to one chosen Warlock cantrip; its range grows by 30 feet per Warlock level if this is the one.",
  },
  {
    ids: ELEMENTAL_AFFINITY,
    label: "Elemental Affinity",
    applies: (spell) => ofClass(spell, "sorcerer") && hasDamage(spell),
    note: "Elemental Affinity adds your Charisma modifier to one damage roll when the spell deals your draconic ancestry's damage type.",
  },
  {
    ids: RADIANT_SOUL,
    label: "Radiant Soul",
    applies: (spell) => ofClass(spell, "warlock") && damageType(spell, "radiant", "fire"),
    note: "Radiant Soul adds your Charisma modifier to one radiant or fire damage roll of the spell.",
  },
  {
    ids: ARCANE_FIREARM,
    label: "Arcane Firearm",
    applies: (spell) => ofClass(spell, "artificer") && hasDamage(spell),
    note: "Arcane Firearm adds 1d8 to one damage roll when the firearm is your spellcasting focus.",
  },
  {
    ids: ALCHEMICAL_SAVANT,
    label: "Alchemical Savant",
    applies: (spell) => ofClass(spell, "artificer") && damageType(spell, "acid", "fire", "necrotic", "poison"),
    note: "Alchemical Savant adds your Intelligence modifier (minimum +1) to one acid, fire, necrotic, or poison damage roll when cast with alchemist's supplies.",
  },
  {
    ids: HEXBLADES_CURSE,
    label: "Hexblade's Curse",
    applies: (spell) => ofClass(spell, "warlock") && hasDamage(spell),
    note: "Hexblade's Curse adds your proficiency bonus to damage against the cursed target.",
  },
  {
    ids: DISTANT_SPELL,
    label: "Distant Spell",
    applies: (spell) => ofClass(spell, "sorcerer") && rangeFeet(spell.range) !== null,
    note: "Distant Spell doubles the range for 1 sorcery point.",
  },
];

const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

/** Inserts a signed bonus between the dice and the damage type, omitting zero. */
export function damageWithBonus(damage: string, bonus: number): string {
  if (damage === "" || bonus === 0) return damage;
  const space = damage.indexOf(" ");
  const dice = space === -1 ? damage : damage.slice(0, space);
  const rest = space === -1 ? "" : damage.slice(space);
  return `${dice}${signed(bonus)}${rest}`;
}

function adjustedRange(range: string, rule: NonNullable<SpellRider["range"]>): string {
  if ("set" in rule) return rule.set;
  const feet = rangeFeet(range);
  if (feet === null) return range;
  return `${"add" in rule ? feet + rule.add : feet * rule.multiply} feet`;
}

/**
 * Applies every registered rider to the spell, in table order. Each applied
 * rider is both a pill (the feature's name, effect as its tooltip) and a note
 * (what it did), because a touch reader never sees the tooltip.
 */
export function applySpellRiders(input: SpellRiderInput): SpellRiderResult {
  const result: SpellRiderResult = {
    damage: input.damage,
    range: input.range,
    appliedModifiers: [],
    sourceNotes: [],
  };
  for (const rider of SPELL_RIDERS) {
    const id = rider.ids.find((candidate) => input.registered.has(candidate));
    if (id === undefined) continue;
    const spell: SpellRiderSpell = { ...input, damage: result.damage, range: result.range };
    if (!rider.applies(spell)) continue;
    const name = input.nameOf(id) ?? rider.label;
    if (rider.note !== undefined) {
      result.sourceNotes.push(rider.note);
      continue;
    }
    const parts: string[] = [];
    if (rider.damage !== undefined) {
      const bonus = "stat" in rider.damage
        ? input.statistics[rider.damage.stat] ?? 0
        : input.statistics[`${rider.damage.ability}:modifier`] ?? 0;
      if (bonus !== 0) {
        result.damage = damageWithBonus(result.damage, bonus);
        parts.push(`${signed(bonus)} damage`);
      }
    }
    if (rider.range !== undefined) {
      const next = adjustedRange(result.range, rider.range);
      if (next !== result.range) {
        result.range = next;
        parts.push(`range ${next}`);
      }
    }
    if (parts.length === 0) continue;
    result.appliedModifiers.push({
      id,
      name,
      field: rider.damage !== undefined && rider.range !== undefined
        ? "damage and range"
        : rider.damage !== undefined ? "damage" : "range",
      effect: parts.join(", "),
    });
    result.sourceNotes.push(`${name} adds ${parts.join(" and ")}.`);
  }
  return result;
}
