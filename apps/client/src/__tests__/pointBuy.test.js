import { describe, expect, it } from 'vitest';
import {
  isBeyondEditableRange,
  pointBuyCost,
  pointBuyRemaining,
} from '../pointBuy.js';

describe('point buy curve', () => {
  it('matches the engine table for every priced score', () => {
    const expected = {
      1: 0, 3: 0, 7: 0, 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
      16: 11, 17: 13, 18: 15, 19: 17, 20: 19, 25: 29, 30: 39,
    };
    for (const [score, cost] of Object.entries(expected)) {
      expect(pointBuyCost(Number(score))).toBe(cost);
    }
  });

  it('prices an imported character with 16s without going negative', () => {
    expect(
      pointBuyRemaining({
        Strength: 8, Dexterity: 13, Constitution: 16,
        Intelligence: 8, Wisdom: 16, Charisma: 8,
      }),
    ).toBe(0);
    expect(
      pointBuyRemaining({
        Strength: 15, Dexterity: 14, Constitution: 13,
        Intelligence: 12, Wisdom: 10, Charisma: 8,
      }),
    ).toBe(0);
  });

  it('flags scores the editor cannot buy directly', () => {
    expect(isBeyondEditableRange(8)).toBe(false);
    expect(isBeyondEditableRange(15)).toBe(false);
    expect(isBeyondEditableRange(16)).toBe(true);
    expect(isBeyondEditableRange(7)).toBe(true);
  });
});
