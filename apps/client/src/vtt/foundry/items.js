// Foundry dnd5e embedded Item documents built from the export model. Plain data documents
// (no Activities/compendium links): weapons/spells import data-complete; Foundry synthesizes
// default behaviour where it can. Damage/level strings are parsed tolerantly with a
// description-only fallback so homebrew content never fails the export.
import { foundryId } from '../ids.js';
import { stripHtml } from '../collect.js';

// "1d8+3 slashing" / "2d6 fire" -> { number, denomination, bonus, types:[...] }. Returns null
// when the string doesn't look like dice, so the caller can fall back to a description.
export function parseDamage(damage) {
  if (!damage) return null;
  const types = [];
  for (const t of ['slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning', 'thunder',
    'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic']) {
    if (new RegExp(t, 'i').test(damage)) types.push(t);
  }
  const dice = /(\d+)d(\d+)\s*([+-]\s*\d+)?/i.exec(damage);
  if (dice) {
    const bonus = dice[3] ? dice[3].replace(/\s+/g, '') : '';
    return { number: Number(dice[1]), denomination: Number(dice[2]), bonus, flat: null, types };
  }
  // An unarmed strike with no die deals a flat "1+3"; there is nothing to roll,
  // so the total travels as the damage instead of a dice formula.
  const constant = /^\s*(\d+)\s*([+-]\s*\d+)?/.exec(damage);
  if (!constant) return null;
  const bonus = constant[2] ? constant[2].replace(/\s+/g, '') : '';
  return {
    number: 0,
    denomination: 0,
    bonus,
    flat: Number(constant[1]) + (bonus === '' ? 0 : Number(bonus)),
    types,
  };
}

const SCHOOL_ABBR = {
  abjuration: 'abj', conjuration: 'con', divination: 'div', enchantment: 'enc',
  evocation: 'evo', illusion: 'ill', necromancy: 'nec', transmutation: 'trs',
};

function classItem(cls) {
  return {
    _id: foundryId(`class:${cls.id}`),
    name: cls.name,
    type: 'class',
    system: {
      levels: cls.level,
      hitDice: cls.hitDie || 'd8',
      hitDiceUsed: 0,
      identifier: (cls.name || '').toLowerCase().replace(/\s+/g, '-'),
    },
  };
}

function subclassItem(cls) {
  if (!cls.subclass) return null;
  return {
    _id: foundryId(`subclass:${cls.id}:${cls.subclass}`),
    name: cls.subclass,
    type: 'subclass',
    system: { classIdentifier: (cls.name || '').toLowerCase().replace(/\s+/g, '-') },
  };
}

function spellItem(spell, caster) {
  const atWill = spell.level === 0; // cantrips are level 0
  return {
    _id: foundryId(`spell:${caster.id}:${spell.id}`),
    name: spell.name,
    type: 'spell',
    system: {
      level: spell.level,
      school: SCHOOL_ABBR[(spell.school || '').toLowerCase()] || '',
      // dnd5e 5.x preparation model (with the legacy `preparation` block for older importers).
      method: atWill ? 'atwill' : 'prepared',
      prepared: spell.prepared ? 1 : 0,
      properties: [
        spell.ritual ? 'ritual' : null,
        spell.concentration ? 'concentration' : null,
      ].filter(Boolean),
      sourceClass: (caster.name || '').toLowerCase(),
      preparation: { mode: atWill ? 'atwill' : 'prepared', prepared: spell.prepared },
    },
  };
}

function weaponItem(attack) {
  const dmg = parseDamage(attack.damage);
  // A flat total has no die to roll, so it exports as the number itself and
  // carries no dice base.
  const isFlat = dmg !== null && dmg.denomination === 0;
  const formula = dmg === null
    ? null
    : isFlat
      ? `${dmg.flat}`
      : `${dmg.number}d${dmg.denomination}${dmg.bonus}`;
  const parts = formula === null ? [] : [[formula, dmg.types[0] || '']];
  return {
    _id: foundryId(`weapon:${attack.name}`),
    name: attack.name,
    type: 'weapon',
    system: {
      equipped: true,
      damage: {
        parts,
        base: dmg && !isFlat
          ? { number: dmg.number, denomination: dmg.denomination, types: dmg.types }
          : undefined,
      },
      range: {},
      description: { value: attack.description || `<p>${attack.range || ''} ${attack.bonus || ''} ${attack.damage || ''}</p>`.trim() },
    },
  };
}

function gearItem(item) {
  // Attunable magic items become 'equipment'; everything else 'loot'.
  const type = item.attunable ? 'equipment' : 'loot';
  const weightNumber = Number(String(item.weight).replace(/[^\d.]/g, '')) || 0;
  return {
    _id: foundryId(`gear:${item.id}`),
    name: item.name,
    type,
    system: {
      quantity: item.quantity,
      weight: { value: weightNumber, units: 'lb' },
      equipped: item.equipped,
      attunement: item.attunable ? 'required' : '',
      attuned: item.attuned,
      source: { custom: item.source || '' },
    },
  };
}

function featItem(feature) {
  return {
    _id: foundryId(`feat:${feature.id}`),
    name: feature.name,
    type: 'feat',
    system: {
      type: { value: 'feat' },
      description: { value: feature.description || `<p>${stripHtml(feature.description) || feature.name}</p>` },
      source: { custom: feature.source || '' },
    },
  };
}

function raceItem(model) {
  if (!model.identity.race) return null;
  return {
    _id: foundryId(`race:${model.identity.race}`),
    name: model.identity.race,
    type: 'race',
    system: { movement: { walk: model.combat.speed } },
  };
}

function backgroundItem(model) {
  if (!model.identity.background) return null;
  return {
    _id: foundryId(`background:${model.identity.background}`),
    name: model.identity.background,
    type: 'background',
    system: {},
  };
}

export function buildItems(model) {
  const items = [];
  for (const cls of model.classes) {
    items.push(classItem(cls));
    const sub = subclassItem(cls);
    if (sub) items.push(sub);
  }
  const race = raceItem(model);
  if (race) items.push(race);
  const bg = backgroundItem(model);
  if (bg) items.push(bg);
  for (const feature of model.features) items.push(featItem(feature));
  for (const item of model.items) items.push(gearItem(item));
  for (const attack of model.attacks) items.push(weaponItem(attack));
  for (const caster of model.spellcasters) for (const spell of caster.spells) items.push(spellItem(spell, caster));
  return items;
}
