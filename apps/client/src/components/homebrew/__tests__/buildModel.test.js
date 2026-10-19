import { describe, expect, it } from 'vitest';
import { createCustomClassDraft, createCustomSpeciesDraft } from '@forge-cb/engine/custom';
import {
  addChoiceAt,
  addFeatureAt,
  addScaleColumn,
  makeSkillChoice,
  milestonesAt,
  removeFeature,
  scaleValueAt,
  setFeatureLevel,
  setScaleAt,
  skillIdsOf,
  splitSkillChoice,
  summarizeBuild,
  tableLevels,
} from '../buildModel.js';

const die = (steps) => ({ id: 's', name: 'Moon die', kind: 'dice', steps });
const count = (steps) => ({ id: 'c', name: 'Strikes', kind: 'number', steps });

describe('a value column', () => {
  it('reads the last step at or before a level, and nothing before the first', () => {
    const scale = die([{ level: 3, value: 'd6' }, { level: 7, value: 'd8' }]);
    expect([1, 3, 6, 7, 20].map((level) => scaleValueAt(scale, level))).toEqual([null, 'd6', 'd6', 'd8', 'd8']);
  });

  it('writes a step only where the value changes', () => {
    let scale = die([{ level: 1, value: 'd6' }]);
    scale = setScaleAt(scale, 5, 'd8');
    expect(scale.steps).toEqual([{ level: 1, value: 'd6' }, { level: 5, value: 'd8' }]);
    // The value the level already has needs no step of its own.
    expect(setScaleAt(scale, 9, 'd8').steps).toEqual(scale.steps);
    expect(setScaleAt(scale, 5, 'd10').steps).toEqual([{ level: 1, value: 'd6' }, { level: 5, value: 'd10' }]);
  });

  it('clears a step by emptying its cell but always keeps the first step', () => {
    const scale = die([{ level: 1, value: 'd6' }, { level: 5, value: 'd8' }]);
    expect(setScaleAt(scale, 5, '').steps).toEqual([{ level: 1, value: 'd6' }]);
    expect(setScaleAt(die([{ level: 1, value: 'd6' }]), 1, '').steps).toEqual([{ level: 1, value: 'd6' }]);
  });

  it('keeps counts as numbers and ignores text that is not one', () => {
    const scale = count([{ level: 1, value: 1 }]);
    expect(setScaleAt(scale, 4, '3').steps).toEqual([{ level: 1, value: 1 }, { level: 4, value: 3 }]);
    expect(setScaleAt(scale, 4, 'many')).toBe(scale);
  });

  it('adds a column with a name no other column has', () => {
    const once = addScaleColumn({ scales: [] });
    const twice = addScaleColumn(once);
    expect(twice.scales.map((scale) => scale.name)).toEqual(['Value 1', 'Value 2']);
  });
});

describe('the level table', () => {
  const klass = {
    ...createCustomClassDraft('Moonwalker'),
    subclass: { level: 3 },
    asiLevels: [4, 8],
    spellcasting: { ability: 'wisdom', style: 'known', slots: { progression: 'half' } },
    scales: [die([{ level: 1, value: 'd6' }, { level: 6, value: 'd8' }])],
  };

  it('lists the levels anything happens at, the class\' own milestones included', () => {
    expect(tableLevels(klass)).toEqual([1, 2, 3, 4, 6, 8]);
    expect(milestonesAt(klass, 3)).toEqual(['Moonwalker Subclass']);
    expect(milestonesAt(klass, 2)).toEqual(['Spellcasting']);
    expect(milestonesAt(klass, 8)).toEqual(['Ability Score Improvement']);
    expect(milestonesAt(createCustomSpeciesDraft('Selkie'), 3)).toEqual([]);
  });

  it('adds a feature as the kind its owner needs, moves it and removes it', () => {
    const made = addFeatureAt(createCustomClassDraft('C'), 5);
    expect(made.draft.features[0]).toMatchObject({ level: 5, draft: { template: 'classFeature', showsUnder: 'class' } });
    const species = addFeatureAt(createCustomSpeciesDraft('S'), 5);
    expect(species.draft.features[0].draft).toMatchObject({ template: 'racialTrait', showsUnder: 'race' });
    const moved = setFeatureLevel(made.draft, made.id, 7);
    expect(moved.features[0].level).toBe(7);
    expect(removeFeature(moved, made.id).features).toEqual([]);
  });

  it('adds a choice at a level', () => {
    const made = addChoiceAt(createCustomClassDraft('C'), 4);
    expect(made.draft.choices[0]).toMatchObject({ kind: 'choice', level: 4 });
  });
});

describe('a skill choice', () => {
  it('names its picks by the class and offers the ids it was given, and keeps its name when edited', () => {
    const made = makeSkillChoice('Moonwalker', 2, ['ID_PROFICIENCY_SKILL_ARCANA']);
    expect(made).toMatchObject({ kind: 'choice', type: 'Proficiency', name: 'Skill Proficiency (Moonwalker)', count: 2 });
    expect(skillIdsOf(made)).toEqual(['ID_PROFICIENCY_SKILL_ARCANA']);
    const edited = makeSkillChoice('Moon Walker', 3, ['ID_PROFICIENCY_SKILL_NATURE'], made);
    expect(edited).toMatchObject({ id: made.id, name: 'Skill Proficiency (Moonwalker)', count: 3 });
  });

  it('is set apart from the rest of a list of starting blocks', () => {
    const skill = makeSkillChoice('C', 2, ['ID_X']);
    const other = { kind: 'grant', id: 'g', target: { by: 'id', type: 'Proficiency', id: 'ID_Y' } };
    expect(splitSkillChoice([other, skill])).toEqual({ skill, rest: [other] });
    expect(splitSkillChoice([other]).skill).toBeUndefined();
  });
});

describe('the summary', () => {
  it('says what a class holds in plain words', () => {
    const lines = summarizeBuild({ ...createCustomClassDraft('Moonwalker'), hitDie: 10, subclass: { level: 3, label: 'Moon Path' } });
    expect(lines).toEqual(['Hit die d10', 'Moon Path at level 3', 'Ability score improvement at 4, 8, 12, 16, 19', '0 features in the level table']);
  });
});
