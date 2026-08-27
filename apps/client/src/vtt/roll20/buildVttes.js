// Builds a Roll20 VTT Enhancement Suite (VTTES) character JSON (schema_version 3) for the
// "D&D 5E by Roll20" 2014 legacy sheet. Import path: install VTTES (Firefox add-on or
// Tampermonkey userscript — it was removed from the Chrome Web Store in 2019), open a game
// using the 2014 legacy sheet, and use VTTES' "overwrite with file" on the character.
//
// Best-effort and unofficial: attribute names are sheet-specific and unversioned, so we write
// ability scores (which the sheet derives mods/saves/skills from) plus proficiency flags and
// final combat values, and prefer overrides where the sheet would otherwise fight homebrew
// numbers. The 2024 Roll20 sheet has NO import path — this targets the 2014 sheet only.
import { attr, repeatingRow, ROLL20_SKILL, ROLL20_ABILITY } from './attribs.js';
import { roll20RowId } from '../ids.js';
import { ABILITIES } from '../rules5e.js';
import { stripHtml } from '../collect.js';

export function buildVttes(model) {
  const attribs = [];

  // Ability scores (drive the sheet's derived mods/saves/skills) + explicit mods.
  for (const abbr of ABILITIES) {
    const base = ROLL20_ABILITY[abbr];
    const a = model.abilities[abbr] || { score: 10, mod: 0 };
    attribs.push(attr(base, a.score));
    attribs.push(attr(`${base}_base`, a.score));
    attribs.push(attr(`${base}_mod`, a.mod));
    // Saving-throw proficiency flag (the 2014 sheet adds @{pb} when set to the pb expression).
    attribs.push(attr(`${base}_save_prof`, model.saves[abbr]?.proficient ? '(@{pb})' : '0'));
    attribs.push(attr(`${base}_save_bonus`, model.saves[abbr]?.bonus ?? 0));
  }

  // Skill proficiency flags + final bonuses.
  for (const [skillBase, roll20Base] of Object.entries(ROLL20_SKILL)) {
    const s = model.skills[skillBase] || {};
    const flag = s.expertise ? '(@{pb}*2)' : s.proficient ? '(@{pb})' : (s.half ? '(@{pb}/2)' : '0');
    attribs.push(attr(`${roll20Base}_prof`, flag));
    attribs.push(attr(`${roll20Base}_bonus`, s.bonus ?? 0));
  }

  // Core combat + identity.
  attribs.push(attr('pb', model.combat.proficiencyBonus));
  attribs.push(attr('hp', model.combat.maxHp, model.combat.maxHp));
  attribs.push(attr('ac', model.combat.ac));
  attribs.push(attr('speed', `${model.combat.speed} ft.`));
  attribs.push(attr('initiative_bonus', model.combat.initiative));
  attribs.push(attr('passive_wisdom', model.combat.passivePerception));
  attribs.push(attr('level', model.combat.level));
  attribs.push(attr('experience', model.combat.experience));
  attribs.push(attr('race', model.identity.race));
  attribs.push(attr('background', model.identity.background));
  attribs.push(attr('alignment', model.identity.alignment));
  attribs.push(attr('deity', model.identity.deity));
  attribs.push(attr('class', model.classes[0]?.name || ''));
  attribs.push(attr('subclass', model.classes[0]?.subclass || ''));
  attribs.push(attr('class_display', model.classes.map((c) => `${c.name} ${c.level}`).join(' / ')));

  // Personality.
  attribs.push(attr('personality_traits', model.personality.traits));
  attribs.push(attr('ideals', model.personality.ideals));
  attribs.push(attr('bonds', model.personality.bonds));
  attribs.push(attr('flaws', model.personality.flaws));

  // Currency.
  attribs.push(attr('cp', model.currency.cp));
  attribs.push(attr('sp', model.currency.sp));
  attribs.push(attr('ep', model.currency.ep));
  attribs.push(attr('gp', model.currency.gp));
  attribs.push(attr('pp', model.currency.pp));

  // Spell slots + spellcasting stats (from the first caster, plus max slot per level).
  const perLevel = {};
  for (const caster of model.spellcasters) {
    (caster.slots || []).forEach((count, i) => { perLevel[i + 1] = Math.max(perLevel[i + 1] || 0, count || 0); });
  }
  for (let lvl = 1; lvl <= 9; lvl++) attribs.push(attr(`lvl${lvl}_slots_total`, perLevel[lvl] || 0));
  const primary = model.spellcasters[0];
  if (primary) {
    attribs.push(attr('spellcasting_ability', `@{${ROLL20_ABILITY[primary.ability] || 'wisdom'}_mod}`));
    attribs.push(attr('spell_attack_bonus', primary.attackModifier));
    attribs.push(attr('spell_save_dc', primary.saveDc));
  }

  // Repeating: inventory.
  for (const item of model.items) {
    repeatingRow(attribs, 'inventory', roll20RowId(`inv:${item.id}`), {
      itemname: item.name,
      itemcount: item.quantity,
      itemweight: String(item.weight).replace(/[^\d.]/g, '') || '',
      itemcontent: item.source,
      equipped: item.equipped ? '1' : '0',
    });
  }

  // Repeating: attacks.
  for (const atk of model.attacks) {
    repeatingRow(attribs, 'attack', roll20RowId(`atk:${atk.name}`), {
      atkname: atk.name,
      atkbonus: atk.bonus,
      atkrange: atk.range,
      dmgbase: atk.damage,
      atkflag: '1',
    });
  }

  // Repeating: spells by level (repeating_spell-<lvl>). Cantrips use spell-cantrip.
  for (const caster of model.spellcasters) {
    for (const spell of caster.spells) {
      const section = spell.level === 0 ? 'spell-cantrip' : `spell-${spell.level}`;
      repeatingRow(attribs, section, roll20RowId(`spell:${caster.id}:${spell.id}`), {
        spellname: spell.name,
        spelllevel: spell.level,
        spellschool: spell.school,
        spellprepared: spell.prepared ? '1' : '0',
        spellritual: spell.ritual ? '1' : '0',
        spellconcentration: spell.concentration ? '{{concentration=1}}' : '0',
      });
    }
  }

  // Repeating: proficiencies + languages.
  for (const prof of model.proficiencies) {
    repeatingRow(attribs, 'proficiencies', roll20RowId(`prof:${prof}`), { name: prof, prof_type: 'OTHER' });
  }
  for (const lang of model.languages) {
    repeatingRow(attribs, 'proficiencies', roll20RowId(`lang:${lang}`), { name: lang, prof_type: 'LANGUAGE' });
  }

  // Repeating: traits/features.
  for (const feature of model.features) {
    repeatingRow(attribs, 'traits', roll20RowId(`trait:${feature.id}`), {
      name: feature.name,
      source: feature.type,
      source_type: feature.source,
      description: stripHtml(feature.description),
    });
  }

  const bio = [
    model.biography.backstory,
    model.identity.gender && `Gender: ${model.identity.gender}`,
    model.identity.age && `Age: ${model.identity.age}`,
    (model.identity.height || model.identity.weight) && `${model.identity.height} ${model.identity.weight}`.trim(),
  ].filter(Boolean).join('<br>');

  return {
    schema_version: 3,
    type: 'character',
    character: {
      oldId: '',
      name: model.meta.name,
      avatar: '',
      bio,
      gmnotes: '',
      defaulttoken: '',
      tags: '',
      controlledby: '',
      inplayerjournals: '',
      attribs,
      abilities: [],
    },
  };
}
