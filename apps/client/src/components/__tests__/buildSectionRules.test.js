import { describe, expect, it } from 'vitest';
import {
  buildSectionRules,
  isImprovementOptionRule,
} from '../buildSectionRules';

const ABILITIES = { key: 'abilities', types: ['Ability Score Improvement'] };
const RACE = {
  key: 'race',
  types: ['Race', 'Race Variant', 'Sub Race', 'Racial Trait'],
};
const CLASS = {
  key: 'class',
  types: ['Class', 'Class Feature', 'Archetype', 'Multiclass'],
};
const FEATS = { key: 'feats', types: ['Feat', 'Feat Feature'] };

const rule = (overrides = {}) => ({
  name: 'Choice',
  type: 'Choice Type',
  allocatesAbilityScores: false,
  ...overrides,
});

const routedTo = (section, rules) =>
  buildSectionRules(section, rules).map((entry) => entry.name);

describe('build section routing', () => {
  it('routes a flagged Feat Feature ability choice to Ability Scores only', () => {
    const feyTouched = rule({
      name: 'Ability Score Increase (Fey-Touched)',
      type: 'Feat Feature',
      allocatesAbilityScores: true,
    });
    expect(routedTo(ABILITIES, [feyTouched])).toEqual([
      'Ability Score Increase (Fey-Touched)',
    ]);
    expect(routedTo(FEATS, [feyTouched])).toEqual([]);
  });

  it('routes a flagged racial trait ability choice away from Race', () => {
    const halfElf = rule({
      name: 'Ability Score Increase (Half-Elf)',
      type: 'Racial Trait',
      allocatesAbilityScores: true,
    });
    expect(routedTo(ABILITIES, [halfElf])).toEqual([
      'Ability Score Increase (Half-Elf)',
    ]);
    expect(routedTo(RACE, [halfElf])).toEqual([]);
  });

  it('keeps an unflagged ancestry picker in Race', () => {
    const subrace = rule({ name: 'Dwarven Subrace', type: 'Sub Race' });
    expect(routedTo(RACE, [subrace])).toEqual(['Dwarven Subrace']);
    expect(routedTo(ABILITIES, [subrace])).toEqual([]);
  });

  it('keeps a non-ability Feat Feature sub-choice in Feats', () => {
    const spellcasting = rule({
      name: 'Spellcasting Ability (Magic Initiate)',
      type: 'Feat Feature',
    });
    expect(routedTo(FEATS, [spellcasting])).toEqual([
      'Spellcasting Ability (Magic Initiate)',
    ]);
    expect(routedTo(ABILITIES, [spellcasting])).toEqual([]);
  });

  it('keeps the ASI-or-feat improvement option in Feats', () => {
    const improvement = rule({
      name: 'Improvement Option (Wizard 4)',
      type: 'Class Feature',
    });
    expect(isImprovementOptionRule(improvement)).toBe(true);
    expect(routedTo(FEATS, [improvement])).toEqual([
      'Improvement Option (Wizard 4)',
    ]);
    expect(routedTo(CLASS, [improvement])).toEqual([]);
  });

  it('keeps an ordinary Ability Score Improvement rule in Ability Scores', () => {
    const wizard4 = rule({
      name: 'Ability Score Increase (WIZARD 4)',
      type: 'Ability Score Improvement',
    });
    expect(routedTo(ABILITIES, [wizard4])).toEqual([
      'Ability Score Increase (WIZARD 4)',
    ]);
    expect(routedTo(CLASS, [wizard4])).toEqual([]);
  });

  it('keeps the 2024 level-4 feat chooser in Feats', () => {
    const chooser = rule({
      name: 'Ability Score Improvement (Fighter 4)',
      type: 'Feat',
    });
    expect(routedTo(FEATS, [chooser])).toEqual([
      'Ability Score Improvement (Fighter 4)',
    ]);
    expect(routedTo(ABILITIES, [chooser])).toEqual([]);
  });
});
