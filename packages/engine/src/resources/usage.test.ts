/**
 * The usage lines the engine reads as trackers, and the ones it leaves alone.
 */

import { describe, expect, it } from "vitest";
import type { TrackerDto } from "@forge-cb/api";
import { trackerUsageText } from "../custom/trackers.js";
import { FACE_METRIC_CHARACTERS } from "../sheet/face-metrics.js";
import { winAnsiText } from "../sheet/text.js";
import { OPEN_MARK, resourceSheetText } from "./sheet.js";
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

  it("reads a pool of dice as one use per die", () => {
    expect(parseUsageText("4d8/Short Rest")).toEqual({ count: 4, recharge: "shortRest", unit: "uses" });
    expect(parseUsageText("1d6 / long rest")).toEqual({ count: 1, recharge: "longRest", unit: "uses" });
    expect(parseUsageText("12d10/Long Rest")).toEqual({ count: 12, recharge: "longRest", unit: "uses" });
    for (const text of ["0d8/Short Rest", "d8/Short Rest", "4d8/Turn", "4d8", "4d{{unfilled}}/Short Rest", "{{unfilled}}d8/Short Rest", "4d8+2/Long Rest"]) {
      expect(parseUsageText(text)).toBeNull();
    }
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
    recharge: "longRest", rechargeLabel: "per long rest", tracked: true, ...extra,
  });
  const trackers = (): TrackerDto[] => [
    dto({}),
    dto({ label: "Wand", max: 7, used: 3, remaining: 4, unit: "charges", recharge: "dawn" }),
    dto({ label: "Pool", max: 20, used: 0, remaining: 20, unit: "points", recharge: "shortRest" }),
  ];

  it("is absent when there is nothing to print", () => {
    expect(resourceSheetText([])).toBeNull();
  });

  it("prints a fresh sheet: an open circle per use and a blank count for many, whatever is spent", () => {
    expect(resourceSheetText(trackers())).toBe("Resources. Gift ○ ○ (LR); Wand ____ / 7 charges (dawn); Pool ____ / 20 points (SR)");
    expect(resourceSheetText([dto({ max: 3, used: 3, remaining: 0 })])).toBe("Resources. Gift ○ ○ ○ (LR)");
    expect(resourceSheetText([dto({ max: 6, used: 0, remaining: 6, unit: "minutes" })])).toBe("Resources. Gift ○ ○ ○ ○ ○ ○ minutes (LR)");
  });

  it("prints a character with spent uses exactly like one with none spent", () => {
    const unspent = trackers().map((tracker) => ({ ...tracker, used: 0, remaining: tracker.max }));
    expect(resourceSheetText(trackers())).toBe(resourceSheetText(unspent));
  });

  it("leaves off a tracker the player does not track, and prints nothing when none is tracked", () => {
    expect(resourceSheetText([dto({ tracked: false }), dto({ label: "Wand" })])).toBe("Resources. Wand ○ ○ (LR)");
    expect(resourceSheetText([dto({ tracked: false })])).toBeNull();
  });

  it("draws the circle in a glyph every sheet face carries", () => {
    // The circle is not in WinAnsi, so a face without pips draws an "o" for each use.
    expect(winAnsiText(`Gift ${OPEN_MARK} ${OPEN_MARK}`)).toBe("Gift o o");
    for (const character of winAnsiText(OPEN_MARK)) expect(FACE_METRIC_CHARACTERS).toContain(character);
  });
});
