/**
 * The multiclass caster-level contribution rates, pinned per grant id for
 * class levels 1..20. THIRD_UP takes its first caster level at class level 2,
 * then every third level: 2, 5, 8, 11, 14, 17, 20.
 */

import { describe, expect, it } from "vitest";
import { MULTICLASS_SLOT_RATES } from "./calculator.js";

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

function rates(grantId: string): number[] {
  const rate = MULTICLASS_SLOT_RATES.get(grantId)!;
  return LEVELS.map((level) => rate(level));
}

describe("multiclass slot progression rates", () => {
  it("pins FULL", () => {
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL")).toEqual(LEVELS);
  });

  it("pins HALF and HALF_UP", () => {
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF"))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10]);
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF_UP"))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10]);
  });

  it("pins THIRD and THIRD_UP", () => {
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD"))
      .toEqual([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]);
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD_UP"))
      .toEqual([0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7]);
  });

  it("pins FOURTH, FOURTH_UP, and FIFTH", () => {
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH"))
      .toEqual([0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5]);
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FOURTH_UP"))
      .toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
    expect(rates("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FIFTH"))
      .toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4]);
  });
});
