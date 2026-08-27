/**
 * SeededRandom: the subtractive lagged-Fibonacci generator (Knuth's
 * algorithm, lags 55 and 24) that seeded appearance suggestions are drawn
 * from. A seed must reproduce the same stream forever, because suggestions
 * are shared by seed; the pinned streams in the tests define the contract.
 */

const MBIG = 2147483647;
const MSEED = 161803398;

// The generator is specified in int32 arithmetic: mid-state values wrap on
// overflow (seedArray[55] holds a negative seed-derived value for seeds above
// ~161803398). The | 0 masks reproduce that wraparound.

export class SeededRandom {
  private readonly seedArray = new Array<number>(56).fill(0);
  private inext = 0;
  private inextp = 21;

  constructor(seed: number) {
    const subtraction = seed === -2147483648 ? 2147483647 : Math.abs(seed);
    let mj = MSEED - subtraction;
    this.seedArray[55] = mj;
    let mk = 1;
    let ii = 0;
    for (let i = 1; i < 55; i++) {
      ii += 21;
      if (ii >= 55) ii -= 55;
      this.seedArray[ii] = mk;
      mk = (mj - mk) | 0;
      if (mk < 0) mk += MBIG;
      mj = this.seedArray[ii]!;
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let n = i + 30;
        if (n >= 55) n -= 55;
        this.seedArray[i] = (this.seedArray[i]! - this.seedArray[1 + n]!) | 0;
        if (this.seedArray[i]! < 0) this.seedArray[i]! += MBIG;
      }
    }
  }

  /** One subtractive step, with the correction that keeps the value below MBIG. */
  next(): number {
    let locINext = this.inext + 1;
    if (locINext >= 56) locINext = 1;
    let locINextp = this.inextp + 1;
    if (locINextp >= 56) locINextp = 1;
    let retVal = (this.seedArray[locINext]! - this.seedArray[locINextp]!) | 0;
    if (retVal === MBIG) retVal--;
    if (retVal < 0) retVal += MBIG;
    this.seedArray[locINext] = retVal;
    this.inext = locINext;
    this.inextp = locINextp;
    return retVal;
  }

  /** A draw scaled to [0, maxExclusive): trunc(next() / MBIG * maxExclusive). */
  nextInt(maxExclusive: number): number {
    return Math.trunc(this.next() * (1.0 / MBIG) * maxExclusive);
  }
}
