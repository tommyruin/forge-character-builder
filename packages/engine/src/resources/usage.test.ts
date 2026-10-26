/**
 * The usage lines the engine reads as trackers, and the ones it leaves alone.
 */

import { describe, expect, it } from "vitest";
import type { TrackerDto } from "@forge-cb/api";
import { trackerUsageText } from "../custom/trackers.js";
import { resourceSheetText } from "./sheet.js";
import { parseUsageText } from "./usage.js";

describe("parseUsageText", () => {
  it("reads a count and a rest", () => {
    expect(parseUsageText("1/Long Rest")).toEqual({ count: 1, recharge: "longRest", unit: "uses" });
    expect(parseUsageText("3/Short Rest")).toEqual({ count: 3, recharge: "shortRest", unit: "uses" });
    expect(parseUsageText("2 uses / long rest")).toEqual({ count: 2, recharge: "longRest", unit: "uses" });
    expect(parseUsageText("15 HP/Long Rest")).toEqual({ count: 15, recharge: "longRest", unit: "points" });
    expect(parseUsageText("7 charges/Dawn")).toEqual({ count: 7, recharge: "dawn", unit: "charges" });
    expect(parseUsageText("30 minutes/Day")).toEqual({ count: 30, recharge: "day", unit: "minutes" });
  });

  it("reads back what the form writes", () => {
    expect(parseUsageText("2 (no recharge)")).toEqual({ count: 2, recharge: "never", unit: "uses" });
    expect(parseUsageText("2 (recharges on a dice roll)")).toEqual({ count: 2, recharge: "diceRoll", unit: "uses" });
  });

  it("reads back the line a tracker writes", () => {
    const line = trackerUsageText({ id: "t", label: "T", max: { kind: "number", value: 4 }, unit: "points", recharge: "shortRest" });
    expect(parseUsageText(line)).toEqual({ count: 4, recharge: "shortRest", unit: "points" });
  });

  it("leaves a line it does not understand untracked", () => {
    for (const text of ["Channel Divinity", "1/Turn", "1/Round", "Ki", "Unlimited", "Recharges after a Short or Long Rest", "{{unfilled}}/Long Rest", "0/Long Rest", "", "Action"]) {
      expect(parseUsageText(text)).toBeNull();
    }
    expect(parseUsageText(undefined)).toBeNull();
  });
});

describe("resourceSheetText", () => {
  const dto = (extra: Partial<TrackerDto>): TrackerDto => ({
    id: "t", label: "Gift", sources: [], isCustom: true, manual: false, max: 2, used: 1, remaining: 1, unit: "uses",
    recharge: "longRest", rechargeLabel: "per long rest", ...extra,
  });

  it("is absent when there is nothing to print", () => {
    expect(resourceSheetText([])).toBeNull();
  });

  it("prints boxes for a few uses and a blank for many, whatever is spent", () => {
    expect(resourceSheetText([dto({}), dto({ label: "Wand", max: 7, unit: "charges", recharge: "dawn" }), dto({ label: "Pool", max: 20, unit: "points", recharge: "shortRest" })]))
      .toBe("Resources. Gift ○ ○ (LR); Wand ____ / 7 charges (dawn); Pool ____ / 20 points (SR)");
  });
});
