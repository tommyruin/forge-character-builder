import { describe, expect, it } from "vitest";
import { sheetAttackRange } from "./attack-range.js";

describe("sheetAttackRange", () => {
  it.each([
    ["60 feet", "60 ft"],
    ["5 foot", "5 ft"],
    ["10 ft", "10 ft"],
    ["10 ft.", "10 ft"],
    ["20/60 feet", "20/60 ft"],
    ["150/600 ft", "150/600 ft"],
    ["Self (10-foot Emanation)", "Self (10 ft)"],
    ["Self (15-foot cone)", "Self (15 ft)"],
    ["Self (30-foot radius)", "Self (30 ft)"],
    ["Self (60-foot line)", "Self (60 ft)"],
    ["Self (60 foot cone)", "Self (60 ft)"],
    ["Self (10-foot-radius sphere)", "Self (10 ft)"],
    ["self (15-foot Cube)", "Self (15 ft)"],
    ["150/600; Arrow", "150/600"],
    ["80/320; Arrow", "80/320"],
    ["150/600 feet; Arrow", "150/600 ft"],
    ["25/100 ft.; Sling Bullet", "25/100 ft"],
    [" 30/120 ;  Needle ", "30/120"],
  ])("shortens %j to %j", (range, short) => {
    expect(sheetAttackRange(range)).toBe(short);
  });

  it.each([
    "Touch", "Self", "Sight", "Unlimited", "Special", "1 mile", "500 miles", "20/60",
    "Self (5-mile radius)", "Self (60-foot long, 10 feet wide line)", "60 feet (see below)", "", "Varies",
    "Touch; Arrow", "1 mile; Arrow",
  ])("leaves %j as written", (range) => {
    expect(sheetAttackRange(range)).toBe(range);
  });
});
