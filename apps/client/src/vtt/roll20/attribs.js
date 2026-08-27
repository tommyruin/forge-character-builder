// Helpers for building a Roll20 "D&D 5E by Roll20" (2014 legacy sheet) attribs array. Every
// entry must carry all four of name/current/max/id or VTTES import rejects the file. Row ids
// for repeating sections embed in the attribute NAME (repeating_<section>_<rowId>_<field>).
import { roll20AttrId } from '../ids.js';

// Skill base name -> Roll20 2014-sheet attribute base (underscored, lower case).
export const ROLL20_SKILL = {
  acrobatics: 'acrobatics', 'animal handling': 'animal_handling', arcana: 'arcana',
  athletics: 'athletics', deception: 'deception', history: 'history', insight: 'insight',
  intimidation: 'intimidation', investigation: 'investigation', medicine: 'medicine',
  nature: 'nature', perception: 'perception', performance: 'performance', persuasion: 'persuasion',
  religion: 'religion', 'sleight of hand': 'sleight_of_hand', stealth: 'stealth', survival: 'survival',
};

export const ROLL20_ABILITY = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

// A plain attrib. `max` defaults to '' (Roll20 stores most values in `current`); hp uses max.
export function attr(name, current, max = '') {
  return { name, current: current === null || current === undefined ? '' : String(current), max: String(max ?? ''), id: roll20AttrId(name) };
}

// A repeating-section row: pushes one attrib per field with the shared row id in the name.
export function repeatingRow(list, section, rowId, fields) {
  for (const [field, value] of Object.entries(fields)) {
    const name = `repeating_${section}_${rowId}_${field}`;
    list.push({ name, current: value === null || value === undefined ? '' : String(value), max: '', id: roll20AttrId(name) });
  }
}
