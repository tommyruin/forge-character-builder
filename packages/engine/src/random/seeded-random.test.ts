/**
 * SeededRandom: the subtractive generator behind seeded appearance suggestions.
 *
 * The pinned streams below are the contract: a seed must keep producing the
 * same sequence across releases, or shared suggestion seeds stop agreeing.
 */

import { describe, expect, it } from "vitest";
import { SeededRandom } from "./seeded-random.js";

/** First ten next() draws per seed. */
const PINNED_NEXT: Record<number, number[]> = {
  0: [1559595546, 1755192844, 1649316166, 1198642031, 442452829, 1200195957, 1945678308, 949569752, 2099272109, 587775847],
  1: [534011718, 237820880, 1002897798, 1657007234, 1412011072, 929393559, 760389092, 2026928803, 217468053, 1379662799],
  "-1": [534011718, 237820880, 1002897798, 1657007234, 1412011072, 929393559, 760389092, 2026928803, 217468053, 1379662799],
  2147483647: [1559595546, 1755192844, 1649316172, 1198642031, 442452829, 1200195955, 1945678308, 949569752, 2099272109, 587775835],
  "-2147483648": [1559595546, 1755192844, 1649316172, 1198642031, 442452829, 1200195955, 1945678308, 949569752, 2099272109, 587775835],
};

/** First ten nextInt(max) draws for the derived-value pins. */
const PINNED_NEXT_INT: Record<number, Record<number, number[]>> = {
  0: {
    31: [22, 25, 23, 17, 6, 17, 28, 13, 30, 8],
    10: [7, 8, 7, 5, 2, 5, 9, 4, 9, 2],
    6: [4, 4, 4, 3, 1, 3, 5, 2, 5, 1],
  },
  1: {
    31: [7, 3, 14, 23, 20, 13, 10, 29, 3, 19],
    10: [2, 1, 4, 7, 6, 4, 3, 9, 1, 6],
    6: [1, 0, 2, 4, 3, 2, 2, 5, 0, 3],
  },
  2147483647: {
    31: [22, 25, 23, 17, 6, 17, 28, 13, 30, 8],
    10: [7, 8, 7, 5, 2, 5, 9, 4, 9, 2],
  },
};

describe("SeededRandom", () => {
  it("reproduces the pinned next() stream for every seed", () => {
    for (const [seed, expected] of Object.entries(PINNED_NEXT)) {
      const rng = new SeededRandom(Number(seed));
      const actual = expected.map(() => rng.next());
      expect(actual, `seed ${seed}`).toEqual(expected);
    }
  });

  it("reproduces the pinned nextInt(max) derived values", () => {
    for (const [seed, byMax] of Object.entries(PINNED_NEXT_INT)) {
      for (const [max, expected] of Object.entries(byMax)) {
        const rng = new SeededRandom(Number(seed));
        const actual = expected.map(() => rng.nextInt(Number(max)));
        expect(actual, `seed ${seed} nextInt(${max})`).toEqual(expected);
      }
    }
  });

  it("nextInt(1) always returns 0", () => {
    for (const seed of [0, 1, -1, 2147483647, -2147483648]) {
      const rng = new SeededRandom(seed);
      for (let i = 0; i < 20; i++) expect(rng.nextInt(1)).toBe(0);
    }
  });

  it("treats negative seeds by absolute value (seed -1 equals seed 1)", () => {
    const a = new SeededRandom(-1);
    const b = new SeededRandom(1);
    for (let i = 0; i < 25; i++) expect(a.next()).toBe(b.next());
  });

  it("maps Int32.MinValue to Int32.MaxValue (seed -2147483648 equals seed 2147483647)", () => {
    const a = new SeededRandom(-2147483648);
    const b = new SeededRandom(2147483647);
    for (let i = 0; i < 25; i++) expect(a.next()).toBe(b.next());
  });

  it("seed 0 and seed Int32.MaxValue share the first two draws, then diverge", () => {
    const a = new SeededRandom(0);
    const b = new SeededRandom(2147483647);
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(b.next());
  });

  it("every draw stays within [0, Int32.MaxValue)", () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2147483647);
    }
  });

  it("nextInt(max) stays within [0, max) and is uniform over a long run", () => {
    const rng = new SeededRandom(7);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const value = rng.nextInt(6);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    for (const count of counts) expect(count).toBeGreaterThan(800);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6000);
  });
});
