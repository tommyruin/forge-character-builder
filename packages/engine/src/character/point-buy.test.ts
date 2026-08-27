import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDnd5e } from "../dnd5e/document.js";
import { mapToState } from "./mapping.js";
import { POINT_BUY_BUDGET, pointBuyCost, pointBuyRemaining } from "./point-buy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const characterFixture = (name: string): string =>
  readFileSync(join(ROOT, "fixtures", "coverage", "characters", name), "utf8");

describe("point buy", () => {
  it("prices every base score on the continuous curve", () => {
    const expected: Record<number, number> = {
      1: 0, 3: 0, 7: 0, 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
      16: 11, 17: 13, 18: 15, 19: 17, 20: 19, 25: 29, 30: 39,
    };
    for (const [score, cost] of Object.entries(expected)) {
      expect(pointBuyCost(Number(score))).toBe(cost);
    }
  });

  it("spends the whole budget on the standard 15/14/13/12/10/8 array", () => {
    expect(POINT_BUY_BUDGET).toBe(27);
    expect(pointBuyRemaining({ strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 })).toBe(0);
    expect(pointBuyRemaining({ strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 })).toBe(15);
    expect(pointBuyRemaining({ strength: 18, dexterity: 18, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 })).toBe(-3);
  });

  it("recomputes the remaining points of imported point-buy characters", () => {
    const remaining = (xml: string): number => mapToState(parseDnd5e(xml), "fixture").availablePoints;
    // Base scores above 15 are priced on the curve rather than rejected.
    expect(remaining(characterFixture("cleric-7.dnd5e"))).toBe(0);
    expect(remaining(characterFixture("warlock-7.dnd5e"))).toBe(0);
    expect(remaining(characterFixture("bard-fighter-5.dnd5e"))).toBe(0);
    expect(remaining(characterFixture("wizard-1.dnd5e"))).toBe(3);
    // The file's own figure is advisory: the scores decide.
    const misstated = characterFixture("cleric-7.dnd5e").replace('available-points="0"', 'available-points="15"');
    expect(misstated).toContain('available-points="15"');
    expect(remaining(misstated)).toBe(0);
  });
});
