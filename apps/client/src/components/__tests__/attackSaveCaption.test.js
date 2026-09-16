import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AttackComputationDetails from '../tabs/manage/AttackComputationDetails';
import AttackEditorModal from '../tabs/manage/AttackEditorModal';
import { isSaveDcBonus } from '../tabs/manage/attackComputationFormat';

// A saving-throw spell's bonus reads "DC 13 INT", so the captions that say
// "Attack" for an attack roll say "Save DC" for it instead.
const saveComputation = {
  attackBonusContributions: [
    { label: 'Base', value: 8 },
    { label: 'Charisma', value: 3 },
    { label: 'Proficiency', value: 2 },
  ],
  appliedModifiers: [],
  sourceNotes: [],
  attackCount: 1,
  isPerHit: false,
};

const attackComputation = {
  ...saveComputation,
  attackBonusContributions: saveComputation.attackBonusContributions.slice(1),
  isPerHit: true,
};

const spellRow = (bonus, computation) => ({
  id: 'row-1',
  identifier: '',
  kind: 'spell',
  name: 'Mind Sliver',
  range: '60 feet',
  bonus,
  damage: '1d6 Psychic',
  description: 'The target must succeed on an Intelligence saving throw.',
  generated: {
    name: 'Mind Sliver',
    range: '60 feet',
    bonus,
    damage: '1d6 Psychic',
    description: 'The target must succeed on an Intelligence saving throw.',
  },
  overriddenFields: [],
  ability: null,
  defaultAbility: null,
  abilityMode: null,
  calculation: null,
  computation,
  source: {
    casterIdentifier: 'caster-1',
    spellId: 'ID_WOTC_PHB24_SPELL_MIND_SLIVER',
    warning: '',
    beamCount: 1,
  },
  unarmed: null,
  mastery: null,
});

const renderEditor = (attack) =>
  renderToStaticMarkup(
    createElement(AttackEditorModal, {
      open: true,
      attack,
      options: { abilities: [], casters: [], spells: [], weapons: [] },
      detail: null,
      busy: false,
      onClose: () => {},
      onSave: () => {},
    }),
  );

describe('save DC captions', () => {
  it('explains how to add spells with conditional or complex damage', () => {
    const html = renderEditor(spellRow('DC 13 INT', saveComputation));
    expect(html).toContain('For spells with conditional, delayed or multiple damage effects');
    expect(html).toContain('add a Manual attack');
  });
  it('recognises a save DC bonus from the row or the spell option', () => {
    expect(isSaveDcBonus({ bonus: 'DC 13 INT' })).toBe(true);
    expect(isSaveDcBonus({ bonus: '+5 CHA vs AC' })).toBe(false);
    expect(
      isSaveDcBonus({ bonus: '+2 custom', generated: { bonus: 'DC 13 INT' } }),
    ).toBe(true);
    expect(isSaveDcBonus(null)).toBe(false);
  });

  it('captions a save spell’s details "Save DC"', () => {
    const html = renderToStaticMarkup(
      createElement(AttackComputationDetails, {
        attack: { spellName: 'Mind Sliver', bonus: 'DC 13 INT' },
        computation: saveComputation,
      }),
    );
    expect(html).toContain('Save DC:');
    expect(html).not.toContain('Attack:');
  });

  it('keeps the "Attack" caption for an attack roll', () => {
    const html = renderToStaticMarkup(
      createElement(AttackComputationDetails, {
        attack: { spellName: 'Fire Bolt', bonus: '+5 CHA vs AC' },
        computation: attackComputation,
      }),
    );
    expect(html).toContain('Attack:');
    expect(html).not.toContain('Save DC');
  });

  it('labels a save spell row’s bonus field "Save DC" in the editor', () => {
    const html = renderEditor(spellRow('DC 13 INT', saveComputation));
    expect(html).toContain('Save DC');
    expect(html).not.toContain('Attack bonus');
  });

  it('keeps "Attack bonus" for an attack-roll spell row', () => {
    const html = renderEditor(spellRow('+5 CHA vs AC', attackComputation));
    expect(html).toContain('Attack bonus');
    expect(html).not.toContain('Save DC');
  });
});
