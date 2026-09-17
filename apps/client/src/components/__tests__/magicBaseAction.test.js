import { describe, expect, it } from 'vitest';
import { resolveMagicBaseAction } from '../magicBaseAction';

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
