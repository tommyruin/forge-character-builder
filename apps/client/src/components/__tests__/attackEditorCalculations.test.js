import { describe, expect, it } from 'vitest';
import {
  calculateAttackComputation,
  calculateUnarmedPreview,
  buildAttackWriteRequest,
  calculateAttackPreview,
  calculateWeaponPreview,
  getDamageAbilityContext,
} from '../tabs/manage/attackEditorCalculations';

const detail = {
  proficiency: 2,
  abilities: [
    { name: 'Strength', abbreviation: 'STR', modifier: 3 },
    { name: 'Wisdom', abbreviation: 'WIS', modifier: 4 },
    { name: 'Charisma', abbreviation: 'CHA', modifier: 5 },
  ],
};

const options = {
  casters: [
    {
      identifier: 'cleric',
      name: 'Cleric',
      ability: 'Wisdom',
      attackModifier: 6,
    },
  ],
};

describe('calculated attack editor', () => {
  it('builds calculation details from the current unsaved form values', () => {
    expect(
      calculateAttackComputation(
        {
          calculationSource: 'ability',
          abilityName: 'Strength',
          useProficiency: true,
          attackMiscBonus: 1,
        },
        options,
        detail,
      ).attackBonusContributions,
    ).toEqual([
      { label: 'Strength', value: 3 },
      { label: 'Proficiency', value: 2 },
      { label: 'Miscellaneous', value: 1 },
    ]);

    expect(
      calculateAttackComputation(
        {
          calculationSource: 'ability',
          abilityName: 'Charisma',
          useProficiency: false,
          attackMiscBonus: '',
        },
        options,
        detail,
      ).attackBonusContributions,
    ).toEqual([{ label: 'Charisma', value: 5 }]);
  });

  it('shows the final ability-based attack and damage values', () => {
    expect(
      calculateAttackPreview(
        {
          calculationSource: 'ability',
          abilityName: 'Strength',
          useProficiency: true,
          attackMiscBonus: 1,
          damageDice: '1d8',
          addAbilityToDamage: true,
          damageMiscBonus: -1,
          damageType: 'slashing',
        },
        options,
        detail,
      ),
    ).toEqual({
      bonus: '+6 vs AC',
      damage: '1d8+2 slashing',
    });
  });

  it('uses the complete caster modifier in the preview', () => {
    expect(
      calculateAttackPreview(
        {
          calculationSource: 'caster',
          casterIdentifier: 'cleric',
          attackMiscBonus: -1,
          damageDice: '2d6',
          addAbilityToDamage: false,
          damageMiscBonus: 0,
          damageType: 'radiant',
        },
        options,
        detail,
      ),
    ).toEqual({
      bonus: '+5 vs AC',
      damage: '2d6 radiant',
    });
  });

  it('adds the selected ability modifier to damage only when enabled', () => {
    const draft = {
      calculationSource: 'caster',
      casterIdentifier: 'cleric',
      attackMiscBonus: 0,
      damageDice: '1d8',
      damageMiscBonus: 0,
      damageType: 'radiant',
    };

    expect(
      calculateAttackPreview(
        { ...draft, addAbilityToDamage: false },
        options,
        detail,
      ).damage,
    ).toBe('1d8 radiant');
    expect(
      calculateAttackPreview(
        { ...draft, addAbilityToDamage: true },
        options,
        detail,
      ).damage,
    ).toBe('1d8+4 radiant');
  });

  it('identifies a zero modifier so the form can explain no visible change', () => {
    expect(
      getDamageAbilityContext(
        {
          calculationSource: 'caster',
          casterIdentifier: 'cleric',
        },
        options,
        {
          ...detail,
          abilities: detail.abilities.map((ability) =>
            ability.name === 'Wisdom'
              ? { ...ability, modifier: 0 }
              : ability,
          ),
        },
      ),
    ).toEqual({
      name: 'Wisdom',
      abbreviation: 'WIS',
      modifier: 0,
      signedModifier: '+0',
    });
  });

  it('treats blank optional modifiers as zero when saving', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'calculated',
        attackMiscBonus: '',
        damageMiscBonus: '',
        bonus: '',
        damage: '',
        overrideFields: [],
      }),
    ).toMatchObject({
      attackMiscBonus: 0,
      damageMiscBonus: 0,
    });
  });

  it('normalizes hidden calculation modifiers for manual attacks', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'manual',
        name: 'Thrown Teacup',
        attackMiscBonus: '',
        damageMiscBonus: '',
      }),
    ).toMatchObject({
      attackMiscBonus: 0,
      damageMiscBonus: 0,
    });
  });

  it('does not turn blank calculated result fields into overrides', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'calculated',
        bonus: '',
        damage: '',
        overrideFields: [],
      }),
    ).toMatchObject({
      bonus: null,
      damage: null,
    });
  });

  it('submits only calculated result overrides the user enabled', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'calculated',
        bonus: '+9 vs AC',
        damage: '1d8+7 force',
        overrideFields: ['bonus'],
      }),
    ).toMatchObject({
      bonus: '+9 vs AC',
      damage: null,
    });
  });

  it('keeps a newly generated spell linked except for fields the user edits', () => {
    const draft = {
      mode: 'spell',
      name: 'Eldritch Blast',
      range: '120 feet',
      bonus: '+6 CHA vs AC',
      damage: '1d10 force',
      description: 'Make a ranged spell attack.',
      overrideFields: ['description'],
    };

    expect(buildAttackWriteRequest(draft)).toMatchObject({
      name: null,
      range: null,
      bonus: null,
      damage: null,
      description: 'Make a ranged spell attack.',
    });
  });

  it('keeps generated weapon values linked when changing its ability', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'weapon',
        name: 'Shortsword',
        range: '5 ft',
        bonus: '+2 vs AC',
        damage: '1d6+2 piercing',
        description: 'Finesse, Light',
        abilityMode: 'explicit',
        abilityName: 'Charisma',
        overrideFields: [],
        resetFields: [],
      }),
    ).toMatchObject({
      name: null,
      range: null,
      bonus: null,
      damage: null,
      description: null,
      abilityMode: 'explicit',
      abilityName: 'Charisma',
    });
  });

  it('previews a weapon ability change before the attack is saved', () => {
    expect(
      calculateWeaponPreview(
        {
          ability: 'Strength',
          generated: {
            bonus: '+6 vs AC',
            damage: '1d4+3 bludgeoning',
          },
        },
        {
          abilityMode: 'explicit',
          abilityName: 'Charisma',
        },
        detail,
      ),
    ).toEqual({
      bonus: '+8 vs AC',
      damage: '1d4+5 bludgeoning',
    });
  });

  it('previews restoring the normal weapon ability before saving', () => {
    expect(
      calculateWeaponPreview(
        {
          ability: 'Charisma',
          defaultAbility: 'Strength',
          generated: {
            bonus: '+8 vs AC',
            damage: '1d4+5 bludgeoning',
          },
        },
        {
          abilityMode: 'default',
          abilityName: 'Charisma',
        },
        detail,
      ),
    ).toEqual({
      bonus: '+6 vs AC',
      damage: '1d4+3 bludgeoning',
    });
  });

  it('submits only generated weapon fields whose override is enabled', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'weapon',
        name: 'Pact Shortsword',
        range: '5 ft',
        bonus: '+9 vs AC',
        damage: '1d6+2 piercing',
        description: 'Finesse, Light',
        overrideFields: ['name', 'bonus'],
        resetFields: [],
      }),
    ).toMatchObject({
      name: 'Pact Shortsword',
      range: null,
      bonus: '+9 vs AC',
      damage: null,
      description: null,
    });
  });
});

describe('unarmed strike attack editor', () => {
  it('sends the die override on its own and clears it when blank', () => {
    expect(
      buildAttackWriteRequest({
        mode: 'unarmed',
        unarmedDice: '1d4',
        name: 'Unarmed Strike',
        range: '5 ft',
        description: '',
        overrideFields: [],
      }).damageDice,
    ).toBe('1d4');

    expect(
      buildAttackWriteRequest({
        mode: 'unarmed',
        unarmedDice: '',
        overrideFields: [],
      }).damageDice,
    ).toBe('');
  });

  it('clears display fields that are not overridden', () => {
    const request = buildAttackWriteRequest({
      mode: 'unarmed',
      unarmedDice: '',
      name: 'Talons',
      range: '5 ft',
      description: 'Sharp.',
      overrideFields: ['name'],
    });
    expect(request.name).toBe('Talons');
    expect(request.range).toBeNull();
    expect(request.description).toBeNull();
  });

  it('never sends a bonus or damage override, which the engine derives', () => {
    const request = buildAttackWriteRequest({
      mode: 'unarmed',
      unarmedDice: '1d6',
      bonus: '+9 vs AC',
      damage: '2d12 fire',
      overrideFields: ['bonus', 'damage'],
    });
    expect(request.bonus).toBeUndefined();
    expect(request.damage).toBeUndefined();
  });
});

describe('unarmed strike damage preview', () => {
  const unarmedOptions = {
    unarmed: {
      name: 'Unarmed Strike',
      range: '5 ft',
      bonus: '+7 vs AC',
      damage: '1d6+4 bludgeoning',
      description: '',
    },
  };
  const unarmedAttack = {
    kind: 'unarmed',
    ability: 'Dexterity',
    defaultAbility: 'Dexterity',
    bonus: '+7 vs AC',
    damage: '1d6+4 bludgeoning',
    generated: { bonus: '+7 vs AC', damage: '1d6+4 bludgeoning' },
    unarmed: { dice: '' },
  };
  const monkDetail = {
    proficiency: 3,
    abilities: [
      { name: 'Strength', abbreviation: 'STR', modifier: 0 },
      { name: 'Dexterity', abbreviation: 'DEX', modifier: 4 },
    ],
  };

  it('shows the automatic die before anything is chosen', () => {
    expect(
      calculateUnarmedPreview(
        null,
        { mode: 'unarmed', unarmedDice: '', ...unarmedOptions.unarmed },
        monkDetail,
        unarmedOptions,
      ).damage,
    ).toBe('1d6+4 bludgeoning');
  });

  it('swaps in a chosen die without touching the modifier or type', () => {
    expect(
      calculateUnarmedPreview(
        unarmedAttack,
        { mode: 'unarmed', abilityMode: 'default', unarmedDice: '1d4' },
        monkDetail,
        unarmedOptions,
      ).damage,
    ).toBe('1d4+4 bludgeoning');
  });

  it('swaps in a custom homebrew die', () => {
    expect(
      calculateUnarmedPreview(
        unarmedAttack,
        {
          mode: 'unarmed',
          abilityMode: 'default',
          unarmedDice: '1d100',
          unarmedDiceCustom: true,
        },
        monkDetail,
        unarmedOptions,
      ).damage,
    ).toBe('1d100+4 bludgeoning');
  });

  it('returns to the automatic die when the choice is cleared', () => {
    // Going Custom -> a listed die -> Automatic must each update the output.
    const saved = {
      ...unarmedAttack,
      damage: '1d100+4 bludgeoning',
      generated: { bonus: '+7 vs AC', damage: '1d100+4 bludgeoning' },
      unarmed: { dice: '1d100' },
    };
    const draft = { mode: 'unarmed', abilityMode: 'default' };
    expect(
      calculateUnarmedPreview(
        saved,
        { ...draft, unarmedDice: '1d8' },
        monkDetail,
        unarmedOptions,
      ).damage,
    ).toBe('1d8+4 bludgeoning');
    expect(
      calculateUnarmedPreview(
        saved,
        { ...draft, unarmedDice: '' },
        monkDetail,
        unarmedOptions,
      ).damage,
    ).toBe('1d6+4 bludgeoning');
  });

  it('handles the flat base of a character with no unarmed features', () => {
    const plainOptions = { unarmed: { damage: '1+2 bludgeoning' } };
    expect(
      calculateUnarmedPreview(
        null,
        { mode: 'unarmed', unarmedDice: '', damage: '1+2 bludgeoning' },
        detail,
        plainOptions,
      ).damage,
    ).toBe('1+2 bludgeoning');
    expect(
      calculateUnarmedPreview(
        null,
        { mode: 'unarmed', unarmedDice: '1d4', damage: '1+2 bludgeoning' },
        detail,
        plainOptions,
      ).damage,
    ).toBe('1d4+2 bludgeoning');
  });
});
