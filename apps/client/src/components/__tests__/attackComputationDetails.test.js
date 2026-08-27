import { describe, expect, it } from 'vitest';
import {
  attackCountLabel,
  formatAttackContribution,
} from '../tabs/manage/attackComputationFormat';

describe('attack computation details', () => {
  it('formats signed attack contributions', () => {
    expect(formatAttackContribution({ label: 'Charisma', value: 5 })).toBe(
      'Charisma +5',
    );
    expect(
      formatAttackContribution({
        label: 'Cursed focus',
        value: -1,
      }),
    ).toBe('Cursed focus -1');
  });

  it('labels multi-ray and multi-beam spells as per-hit damage', () => {
    expect(attackCountLabel({ name: 'Eldritch Blast' }, 1)).toBe(
      '1 beam · per hit',
    );
    expect(attackCountLabel({ name: 'Scorching Ray' }, 3)).toBe(
      '3 rays · per hit',
    );
    expect(attackCountLabel({ name: 'Eldritch Blast' }, 2)).toBe(
      '2 beams · per hit',
    );
    expect(attackCountLabel({ name: 'Jim’s Magic Missile' }, 3)).toBe(
      '3 missiles · per hit',
    );
    expect(attackCountLabel({ name: 'Steel Wind Strike' }, 5)).toBe(
      '5 attacks · per hit',
    );
  });
});
