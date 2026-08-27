// Builds a Foundry VTT dnd5e "character" Actor JSON from the export model. Import path: in
// Foundry with the dnd5e system, create a blank Character actor, right-click it in the Actors
// directory -> Import Data, select this file. Targets dnd5e 5.3.x on Foundry v13/v14. AC and
// the ability/skill/save numbers are written as final values (ac.calc = 'flat') so Foundry
// does not re-derive them and disagree with the engine's homebrew-inclusive maths.
import { buildItems } from './items.js';
import { ABILITIES, SKILLS } from '../rules5e.js';

// Skill base name -> dnd5e skill key.
const SKILL_KEY = {
  acrobatics: 'acr', 'animal handling': 'ani', arcana: 'arc', athletics: 'ath', deception: 'dec',
  history: 'his', insight: 'ins', intimidation: 'itm', investigation: 'inv', medicine: 'med',
  nature: 'nat', perception: 'prc', performance: 'prf', persuasion: 'per', religion: 'rel',
  'sleight of hand': 'slt', stealth: 'ste', survival: 'sur',
};

function firstSenseRange(senses) {
  // "Darkvision 60 ft." -> 60; default 0 when no number present.
  for (const s of senses || []) {
    const m = /(\d+)/.exec(s);
    if (/darkvision/i.test(s) && m) return Number(m[1]);
  }
  return 0;
}

export function buildFoundryActor(model) {
  const abilities = {};
  for (const abbr of ABILITIES) {
    abilities[abbr] = {
      value: model.abilities[abbr]?.score ?? 10,
      proficient: model.saves[abbr]?.proficient ? 1 : 0,
    };
  }

  const skills = {};
  for (const [base, key] of Object.entries(SKILL_KEY)) {
    const info = model.skills[base] || {};
    skills[key] = {
      value: info.multiplier ?? 0,
      ability: SKILLS[base],
      bonuses: { check: '', passive: '' },
    };
  }

  const spellLevels = {};
  // dnd5e uses spell1..spell9 slot maxima (index 0 of the export slots = level 1).
  const perLevel = {};
  for (const caster of model.spellcasters) {
    (caster.slots || []).forEach((count, i) => {
      const lvl = i + 1;
      perLevel[lvl] = Math.max(perLevel[lvl] || 0, count || 0);
    });
  }
  for (let lvl = 1; lvl <= 9; lvl++) {
    spellLevels[`spell${lvl}`] = { value: perLevel[lvl] || 0, override: perLevel[lvl] || null };
  }

  const biographyHtml = [
    model.biography.backstory,
    model.biography.allies ? `<p><strong>Allies &amp; Organizations.</strong> ${model.biography.allies}</p>` : '',
    model.biography.notes ? `<p>${model.biography.notes}</p>` : '',
  ].filter(Boolean).join('\n');

  return {
    name: model.meta.name,
    type: 'character',
    system: {
      abilities,
      attributes: {
        ac: { flat: model.combat.ac, calc: 'flat' },
        hp: { value: model.combat.maxHp, max: model.combat.maxHp, temp: 0, tempmax: 0 },
        init: { ability: 'dex', bonus: '' },
        movement: { walk: model.combat.speed, units: 'ft' },
        senses: { darkvision: firstSenseRange(model.combat.senses), units: 'ft' },
        spellcasting: model.spellcasters[0]?.ability || '',
        prof: model.combat.proficiencyBonus,
      },
      details: {
        alignment: model.identity.alignment,
        race: model.identity.race,
        background: model.identity.background,
        originalClass: model.classes[0]?.name || '',
        xp: { value: model.combat.experience },
        appearance: [model.identity.eyes, model.identity.skin, model.identity.hair].filter(Boolean).join(', '),
        trait: model.personality.traits,
        ideal: model.personality.ideals,
        bond: model.personality.bonds,
        flaw: model.personality.flaws,
        biography: { value: biographyHtml, public: '' },
        gender: model.identity.gender,
        age: model.identity.age,
        height: model.identity.height,
        weight: model.identity.weight,
        eyes: model.identity.eyes,
        hair: model.identity.hair,
        skin: model.identity.skin,
        faith: model.identity.deity,
      },
      traits: {
        size: 'med',
        languages: { value: model.languages.map((l) => l.toLowerCase()), custom: model.languages.join(';') },
      },
      skills,
      spells: spellLevels,
      currency: model.currency,
    },
    items: buildItems(model),
    effects: [],
    flags: { 'fcb-character-builder': { ruleset: model.meta.ruleset, exportedFrom: 'DM Forge Character Builder' } },
  };
}
