/**
 * The editor draft an attack row reopens with. An unarmed strike stores its
 * damage die separately from its display fields, so reopening has to restore
 * both the die and whether it came from the list or was typed by hand.
 */

import { describe, expect, it } from 'vitest';
import { attackDraft } from '../tabs/manage/AttackEditorModal';

const unarmed = (dice) => ({
  id: 'row',
  kind: 'unarmed',
  name: 'Unarmed Strike',
  range: '5 ft',
  bonus: '+7 vs AC',
  damage: '1d6+4 bludgeoning',
  description: '',
  abilityMode: 'default',
  ability: 'Dexterity',
  defaultAbility: 'Dexterity',
  overriddenFields: [],
  calculation: null,
  source: null,
  unarmed: { dice },
});

describe('unarmed strike editor draft', () => {
  it('opens on Automatic when the die follows the character', () => {
    const draft = attackDraft(unarmed(''));
    expect(draft.mode).toBe('unarmed');
    expect(draft.unarmedDice).toBe('');
    expect(draft.unarmedDiceCustom).toBe(false);
  });

  it('opens on the listed die that was chosen', () => {
    const draft = attackDraft(unarmed('1d4'));
    expect(draft.unarmedDice).toBe('1d4');
    expect(draft.unarmedDiceCustom).toBe(false);
  });

  it('opens on Custom for a die that is not in the list', () => {
    const draft = attackDraft(unarmed('1d100'));
    expect(draft.unarmedDice).toBe('1d100');
    expect(draft.unarmedDiceCustom).toBe(true);
  });

  it('carries the ability override back into the form', () => {
    const draft = attackDraft({
      ...unarmed(''),
      abilityMode: 'explicit',
      ability: 'Constitution',
    });
    expect(draft.abilityMode).toBe('explicit');
    expect(draft.abilityName).toBe('Constitution');
  });

  it('leaves other kinds without an unarmed die', () => {
    const draft = attackDraft({
      id: 'w',
      kind: 'weapon',
      name: 'Longsword',
      abilityMode: 'default',
      ability: 'Strength',
      overriddenFields: [],
      calculation: null,
      source: null,
      unarmed: null,
    });
    expect(draft.mode).toBe('weapon');
    expect(draft.unarmedDice).toBe('');
    expect(draft.unarmedDiceCustom).toBe(false);
  });
});
