import { describe, expect, it } from 'vitest';
import { baseOptionLabel, resolveMagicBaseAction } from '../magicBaseAction';

describe('resolveMagicBaseAction', () => {
  it('adds directly when the item takes no base', () => {
    expect(resolveMagicBaseAction({ slot: null, options: [] })).toEqual({
      requiresSelection: false,
      options: [],
      slot: null,
      baseElementId: null,
      baseName: null,
    });
  });

  it('adds directly on the single fixed base', () => {
    const javelin = { id: 'ID_JAVELIN', name: 'Javelin' };
    expect(
      resolveMagicBaseAction({ slot: 'weapon', options: [javelin] }),
    ).toEqual({
      requiresSelection: false,
      options: [javelin],
      slot: 'weapon',
      baseElementId: 'ID_JAVELIN',
      baseName: 'Javelin',
    });
  });

  it('asks for a choice when more than one base is legal', () => {
    const options = [
      { id: 'ID_LONGSWORD', name: 'Longsword' },
      { id: 'ID_RAPIER', name: 'Rapier' },
    ];
    expect(resolveMagicBaseAction({ slot: 'weapon', options })).toEqual({
      requiresSelection: true,
      options,
      slot: 'weapon',
      baseElementId: null,
      baseName: null,
    });
  });
});

describe('baseOptionLabel', () => {
  const shields = [
    { id: 'ID_SHIELD_2014', name: 'Shield', source: 'Player’s Handbook' },
    { id: 'ID_SHIELD_2024', name: 'Shield', source: 'Player’s Handbook (2024)' },
    { id: 'ID_RAPIER', name: 'Rapier', source: 'Player’s Handbook' },
  ];

  it('tells same-named bases apart by source', () => {
    expect(baseOptionLabel(shields[0], shields)).toBe('Shield (Player’s Handbook)');
    expect(baseOptionLabel(shields[1], shields)).toBe('Shield (Player’s Handbook (2024))');
  });

  it('leaves a name only one base carries alone', () => {
    expect(baseOptionLabel(shields[2], shields)).toBe('Rapier');
  });
});
