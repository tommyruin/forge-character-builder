// Shared 5e math for the VTT exporters, recomputed from the statistics-key
// vocabulary so both Foundry and Roll20 emit final, sheet-worker-independent values.
//
// Formula rules:
//   skill/save FinalBonus = ProficiencyBonus + KeyAbility.Modifier + MiscBonus
//   where ProficiencyBonus and MiscBonus are the summed statistics values
//   `${base}:proficiency` and `${base}:misc` (skills) / `${abl}:save:proficiency` and
//   `${abl}:save:misc` (saves). IsProficient = ProficiencyBonus > 0;
//   IsExpertise = ProficiencyBonus >= 2 * characterProficiencyBonus.

// Skill base name (engine statistic key, = display name lower-cased) -> key ability abbrev.
export const SKILLS = {
  acrobatics: 'dex',
  'animal handling': 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  'sleight of hand': 'dex',
  stealth: 'dex',
  survival: 'wis',
};

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// The engine's save statistic keys use the FULL lower-case ability name (e.g.
// "wisdom:save:proficiency"), not the 3-letter abbreviation.
export const ABILITY_FULL = {
  str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};

// Map an AbilityDto (abbreviation "STR".."CHA") to a { str, dex, ... } lookup of modifiers/scores.
export function abilityMap(abilities) {
  const out = {};
  for (const a of abilities || []) {
    const key = (a.abbreviation || a.name || '').slice(0, 3).toLowerCase();
    if (ABILITIES.includes(key)) out[key] = { score: a.finalScore, mod: a.modifier };
  }
  // Fill any missing ability with a neutral default so downstream indexing never throws.
  for (const key of ABILITIES) if (!out[key]) out[key] = { score: 10, mod: 0 };
  return out;
}

function statValue(stats, key) {
  const v = stats?.[key];
  return typeof v === 'number' ? v : 0;
}

// One skill's derived numbers. proficiencyBonus is the character's PB (detail.proficiency).
export function skillInfo(stats, abilities, skillBase, proficiencyBonus) {
  const ability = SKILLS[skillBase];
  const abilityMod = abilities[ability]?.mod ?? 0;
  const prof = statValue(stats, `${skillBase}:proficiency`);
  const misc = statValue(stats, `${skillBase}:misc`);
  const proficient = prof > 0;
  const expertise = proficient && prof >= proficiencyBonus * 2;
  // Half proficiency (Jack of All Trades etc.): a positive contribution below full PB.
  const half = proficient && prof < proficiencyBonus;
  const multiplier = expertise ? 2 : half ? 0.5 : proficient ? 1 : 0;
  return { ability, bonus: prof + abilityMod + misc, proficient, expertise, half, multiplier };
}

export function allSkills(stats, abilities, proficiencyBonus) {
  const out = {};
  for (const base of Object.keys(SKILLS)) out[base] = skillInfo(stats, abilities, base, proficiencyBonus);
  return out;
}

// One saving throw's derived numbers (abbrev "str".."cha").
export function saveInfo(stats, abilities, abbrevLower) {
  const abilityMod = abilities[abbrevLower]?.mod ?? 0;
  const full = ABILITY_FULL[abbrevLower] ?? abbrevLower;
  const prof = statValue(stats, `${full}:save:proficiency`);
  const misc = statValue(stats, `${full}:save:misc`);
  return { bonus: prof + abilityMod + misc, proficient: prof > 0 };
}

export function allSaves(stats, abilities) {
  const out = {};
  for (const abbr of ABILITIES) out[abbr] = saveInfo(stats, abilities, abbr);
  return out;
}

// Passive Perception = 10 + Perception skill bonus (+ any explicit passive statistic bonus).
export function passivePerception(stats, abilities, proficiencyBonus) {
  const per = skillInfo(stats, abilities, 'perception', proficiencyBonus);
  return 10 + per.bonus + statValue(stats, 'perception:passive');
}
