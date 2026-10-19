import { describe, expect, it } from 'vitest';
import {
  CASTING_TIME_PRESETS,
  ROLL_OPTIONS,
  makeSpellDraft,
  spellDraftFromMissing,
  spellNameFromId,
  summarizeSpell,
  tidySpell,
} from '../draftModel';

describe('a new spell draft', () => {
  it('starts as a stated no-roll first-level spell with the common casting words', () => {
    const draft = makeSpellDraft('Frost Lance');
    expect(draft).toMatchObject({
      template: 'spell',
      name: 'Frost Lance',
      level: 1,
      castingTime: '1 action',
      mechanics: { roll: 'none' },
    });
    expect(draft.id).toMatch(/^ID_CUSTOM_/);
  });

  it('can start from the id a pack grants that nothing defines, so creating it resolves the grant', () => {
    const draft = spellDraftFromMissing({ missingId: 'ID_HB_MC_SPELL_FROST_LANCE', missingType: 'Spell' });
    expect(draft.id).toBe('ID_HB_MC_SPELL_FROST_LANCE');
    expect(draft.name).toBe('Frost Lance');
  });

  it('starts from the name when the grant names the spell rather than its id', () => {
    const draft = spellDraftFromMissing({ missingId: 'Spell "Frost Lance"', missingType: 'Spell' });
    expect(draft.name).toBe('Frost Lance');
    expect(draft.id).toMatch(/^ID_CUSTOM_/);
  });
});

describe('a name read from an id', () => {
  it('drops the pack prefix and the type word and capitalises what is left', () => {
    expect(spellNameFromId('ID_HB_MC_SPELL_FROST_LANCE')).toBe('Frost Lance');
    expect(spellNameFromId('ID_WOTC_PHB_SPELL_MAGIC_MISSILE')).toBe('Magic Missile');
    expect(spellNameFromId('ID_ODD')).toBe('Odd');
  });
});

describe('tidying a draft for the engine', () => {
  it('drops empty fields so a draft only opened equals what the engine stores', () => {
    const draft = {
      ...makeSpellDraft('Frost Lance'),
      higherLevels: '  ',
      cameFrom: '',
      classes: [],
      components: { verbal: true, somatic: false, material: false, materialText: '' },
      mechanics: { roll: 'attackRanged', damage: [], healing: '', scaling: undefined },
    };
    const tidy = tidySpell(draft);
    expect(tidy).not.toHaveProperty('higherLevels');
    expect(tidy).not.toHaveProperty('cameFrom');
    expect(tidy).not.toHaveProperty('classes');
    expect(tidy.components).toEqual({ verbal: true });
    expect(tidy.mechanics).toEqual({ roll: 'attackRanged' });
  });

  it('drops mechanics a roll does not use, so switching the roll never leaves stale fields', () => {
    const draft = {
      ...makeSpellDraft('Ember'),
      level: 0,
      mechanics: {
        roll: 'attackRanged',
        saveAbility: 'dexterity',
        halfOnSave: true,
        damage: [{ dice: '1d8', type: 'fire' }],
        scaling: { kind: 'cantrip', tiers: [{ level: 5, dice: '2d8' }] },
      },
    };
    expect(tidySpell(draft).mechanics).toEqual({
      roll: 'attackRanged',
      damage: [{ dice: '1d8', type: 'fire' }],
      scaling: { kind: 'cantrip', tiers: [{ level: 5, dice: '2d8' }] },
    });
  });

  it('keeps a flag only when it is on', () => {
    const tidy = tidySpell({ ...makeSpellDraft('Ward'), concentration: false, ritual: true, mechanics: { roll: 'none', addsModifier: false } });
    expect(tidy).not.toHaveProperty('concentration');
    expect(tidy.ritual).toBe(true);
    expect(tidy.mechanics).toEqual({ roll: 'none' });
  });
});

describe('the plain-words summary', () => {
  it('reads the spell the way a spell block does', () => {
    const draft = {
      ...makeSpellDraft('Frost Lance'),
      level: 2,
      school: 'Evocation',
      range: '120 feet',
      concentration: true,
      components: { verbal: true, somatic: true, material: true, materialText: 'a sliver of ice' },
      classes: ['Wizard', 'Sorcerer'],
      mechanics: {
        roll: 'attackRanged',
        damage: [{ dice: '2d8', type: 'cold' }, { dice: '1d4', type: 'piercing' }],
        scaling: { kind: 'slot', dice: '1d6' },
      },
    };
    expect(summarizeSpell(draft)).toEqual([
      '2nd-level evocation, 1 action, 120 feet, concentration',
      'Components: V, S, M (a sliver of ice)',
      'Ranged spell attack: 2d8 cold + 1d4 piercing',
      '+1d6 for each slot level above 2nd',
      'On the Wizard and Sorcerer spell lists',
    ]);
  });

  it('reads a cantrip with a saving throw and its tiers', () => {
    const draft = {
      ...makeSpellDraft('Ember'),
      level: 0,
      components: { verbal: true },
      mechanics: {
        roll: 'save',
        saveAbility: 'dexterity',
        halfOnSave: true,
        damage: [{ dice: '1d8', type: 'fire' }],
        scaling: { kind: 'cantrip', tiers: [{ level: 5, dice: '2d8' }, { level: 11, dice: '3d8' }] },
      },
    };
    expect(summarizeSpell(draft)).toEqual([
      'Evocation cantrip, 1 action, 60 feet',
      'Components: V',
      'Dexterity saving throw: 1d8 fire, half on a success',
      '2d8 at level 5, 3d8 at level 11',
    ]);
  });

  it('reads healing and a modifier', () => {
    const draft = { ...makeSpellDraft('Mend'), components: {}, mechanics: { roll: 'none', healing: '2d8', addsModifier: true } };
    expect(summarizeSpell(draft)).toContain('Heals 2d8 plus the spellcasting modifier');
  });
});

describe('the menus', () => {
  it('offer every roll the engine reads, in an author\'s words', () => {
    expect(ROLL_OPTIONS.map((option) => option.id)).toEqual(['none', 'attackRanged', 'attackMelee', 'save']);
    expect(ROLL_OPTIONS.map((option) => option.label)).toEqual([
      'No attack or save',
      'Ranged spell attack',
      'Melee spell attack',
      'Saving throw',
    ]);
    expect(CASTING_TIME_PRESETS).toContain('1 bonus action');
  });
});
