/**
 * Trackers (B7) and scale values (B9) on a draft: what the compiler writes for
 * them, read back with the real parser, and the validation that names the field
 * a mistake is in.
 */

import { describe, expect, it } from "vitest";
import { parseElementsFile } from "../content/parser.js";
import { compileCustomElement } from "./compile.js";
import { createCustomDraft, createCustomItemDraft, type CustomDraft, type ScaleValue, type TrackerDef } from "./schema.js";
import { customDraftIssues, customEntryIssues } from "./validate.js";
import { scaleKey, trackerStatKey, trackerUsageText } from "./trackers.js";

const tracker = (extra: Partial<TrackerDef> = {}): TrackerDef => ({
  id: "t1",
  label: "Moonbeam",
  max: { kind: "number", value: 2 },
  unit: "uses",
  recharge: "shortRest",
  ...extra,
});

const scale = (extra: Partial<ScaleValue> = {}): ScaleValue => ({
  id: "s1",
  name: "Moonlight die",
  kind: "dice",
  steps: [{ level: 1, value: "1d6" }, { level: 6, value: "1d8" }],
  ...extra,
});

function draft(extra: Partial<CustomDraft> = {}): CustomDraft {
  return { ...createCustomDraft("boon", "Moonwell Gift"), id: "ID_CUSTOM_TRACKERS01", description: "A silver light.", ...extra };
}

function parse(source: CustomDraft) {
  const xml = compileCustomElement(source);
  const [element] = parseElementsFile(`<elements>${xml}</elements>`, "test.xml");
  return { xml, element: element! };
}

const stats = (source: CustomDraft) => parse(source).element.rules.filter((rule) => rule.kind === "stat");

describe("tracker usage text", () => {
  it("words the sheet usage line from the tracker", () => {
    expect(trackerUsageText(tracker())).toBe("2/Short Rest");
    expect(trackerUsageText(tracker({ recharge: "longRest", max: { kind: "number", value: 1 } }))).toBe("1/Long Rest");
    expect(trackerUsageText(tracker({ unit: "charges", max: { kind: "number", value: 7 }, recharge: "dawn" }))).toBe("7 charges/Dawn");
    expect(trackerUsageText(tracker({ unit: "minutes", max: { kind: "number", value: 30 }, recharge: "day" }))).toBe("30 minutes/Day");
    expect(trackerUsageText(tracker({ recharge: "never" }))).toBe("2 (no recharge)");
    expect(trackerUsageText(tracker({ unit: "charges", max: { kind: "number", value: 7 }, recharge: "diceRoll", regain: "1d6+1 at dawn" })))
      .toBe("7 charges (regains 1d6+1 at dawn)");
  });

  it("uses a token for a maximum that follows the character", () => {
    expect(trackerUsageText(tracker({ id: "ab", max: { kind: "reference", ref: "proficiency" }, recharge: "longRest" })))
      .toBe("{{uses:ab}}/Long Rest");
  });
});

describe("trackers compile to the sheet usage line and the maximum", () => {
  it("prints a literal maximum straight into the usage line, with no rule", () => {
    const { element } = parse(draft({ trackers: [tracker()] }));
    expect(element.sheets[0]!.usage).toBe("2/Short Rest");
    expect(element.rules).toEqual([]);
  });

  it("lets the author's own usage text win over the generated line", () => {
    const { element } = parse(draft({ trackers: [tracker()], sheet: { usage: "Twice a rest" } }));
    expect(element.sheets[0]!.usage).toBe("Twice a rest");
  });

  it("joins several trackers on one feature", () => {
    const { element } = parse(draft({ trackers: [tracker(), tracker({ id: "t2", label: "Gaze", max: { kind: "number", value: 1 }, recharge: "longRest" })] }));
    expect(element.sheets[0]!.usage).toBe("2/Short Rest; 1/Long Rest");
  });

  it("writes a statistic for a maximum that follows the character, floored by its minimum", () => {
    const source = draft({
      trackers: [tracker({ id: "ab", max: { kind: "reference", ref: "wisdom:modifier", min: 1 }, recharge: "longRest" })],
    });
    expect(stats(source).map((rule) => rule.kind === "stat" ? [rule.name, rule.value, rule.bonus] : [])).toEqual([
      ["uses:ab", "wisdom:modifier", "base"],
      ["uses:ab", "1", "base"],
    ]);
    expect(parse(source).element.sheets[0]!.usage).toBe("{{uses:ab}}/Long Rest");
    expect(trackerStatKey(source.trackers![0]!)).toBe("uses:ab");
  });

  it("follows a class level, a statistic and a scale value", () => {
    const source = draft({
      scales: [scale({ id: "s2", name: "Gaze count", kind: "number", steps: [{ level: 1, value: 1 }, { level: 5, value: 3 }] })],
      trackers: [
        tracker({ id: "a", max: { kind: "classLevel", className: "Druid" } }),
        tracker({ id: "b", max: { kind: "stat", key: "spellcasting:dc" } }),
        tracker({ id: "c", max: { kind: "scale", scale: "s2" } }),
      ],
    });
    const values = stats(source).filter((rule) => rule.kind === "stat" && rule.name.startsWith("uses:")).map((rule) => rule.kind === "stat" ? [rule.name, rule.value] : []);
    expect(values).toEqual([["uses:a", "level:druid"], ["uses:b", "spellcasting:dc"], ["uses:c", "scale:gaze count"]]);
  });

  it("states an item's charges in its text, which the item's own text may precede", () => {
    const item = {
      ...createCustomItemDraft("worn", "Wand of Embers"),
      id: "ID_CUSTOM_WAND0001",
      slot: "misc" as const,
      description: "A short wand.",
      trackers: [tracker({ label: "Charges", unit: "charges", max: { kind: "number", value: 7 }, recharge: "diceRoll", regain: "1d6+1 at dawn" })],
    };
    const [element] = parseElementsFile(`<elements>${compileCustomElement(item)}</elements>`, "test.xml");
    expect(element!.descriptionXml).toContain("Uses: 7 charges (regains 1d6+1 at dawn)");
  });
});

describe("scale values compile to level-gated statistics", () => {
  it("writes a count as steps that add the difference, so the total is the table's value", () => {
    const source = draft({ scales: [scale({ kind: "number", steps: [{ level: 1, value: 2 }, { level: 5, value: 3 }, { level: 11, value: 5 }] })] });
    expect(stats(source).map((rule) => rule.kind === "stat" ? [rule.name, rule.value, rule.level, rule.inline] : [])).toEqual([
      ["scale:moonlight die", "2", 1, undefined],
      ["scale:moonlight die", "1", 5, undefined],
      ["scale:moonlight die", "2", 11, undefined],
    ]);
    expect(scaleKey(source.scales![0]!)).toBe("scale:moonlight die");
  });

  it("writes a die as inline text from each level", () => {
    const source = draft({ scales: [scale()] });
    expect(stats(source).map((rule) => rule.kind === "stat" ? [rule.name, rule.value, rule.level, rule.inline] : [])).toEqual([
      ["scale:moonlight die", "1d6", 1, true],
      ["scale:moonlight die", "1d8", 6, true],
    ]);
  });

  it("is usable as the value of a modifier", () => {
    const source = draft({
      scales: [scale({ id: "s2", name: "Ward", kind: "number", steps: [{ level: 1, value: 1 }, { level: 9, value: 2 }] })],
      blocks: [{ kind: "modifier", id: "m1", target: "ac:misc", mode: "add", value: { kind: "scale", scale: "s2" } }],
    });
    const rule = stats(source).find((candidate) => candidate.kind === "stat" && candidate.name === "ac:misc");
    expect(rule).toMatchObject({ value: "scale:ward" });
  });
});

describe("validation names the field", () => {
  const issue = (source: unknown) => customDraftIssues(source).map((entry) => `${entry.path}: ${entry.message}`);

  it("accepts a well-formed tracker and scale", () => {
    expect(customDraftIssues(draft({ trackers: [tracker()], scales: [scale()] }))).toEqual([]);
  });

  it("refuses a tracker with no label, a bad maximum, unit or recharge", () => {
    expect(issue(draft({ trackers: [tracker({ label: "" })] }))).toEqual([expect.stringContaining("trackers[0].label")]);
    expect(issue(draft({ trackers: [tracker({ max: { kind: "number", value: 0 } })] }))).toEqual([expect.stringContaining("trackers[0].max")]);
    expect(issue(draft({ trackers: [{ ...tracker(), unit: "gallons" } as never] }))).toEqual([expect.stringContaining("trackers[0].unit")]);
    expect(issue(draft({ trackers: [{ ...tracker(), recharge: "tuesday" } as never] }))).toEqual([expect.stringContaining("trackers[0].recharge")]);
  });

  it("refuses two trackers with one id, and regain text on a tracker that does not roll", () => {
    expect(issue(draft({ trackers: [tracker(), tracker()] }))).toEqual([expect.stringContaining("trackers[1].id")]);
    expect(issue(draft({ trackers: [tracker({ regain: "1d6" })] }))).toEqual([expect.stringContaining("trackers[0].regain")]);
  });

  it("refuses a maximum that names a scale the draft does not have, or a die where a count is needed", () => {
    expect(issue(draft({ trackers: [tracker({ max: { kind: "scale", scale: "nope" } })] }))).toEqual([expect.stringContaining("trackers[0].max.scale")]);
    expect(issue(draft({ scales: [scale()], trackers: [tracker({ max: { kind: "scale", scale: "s1" } })] }))).toEqual([
      expect.stringContaining("trackers[0].max.scale"),
    ]);
  });

  it("refuses scale tables that are not ascending counts or dice", () => {
    expect(issue(draft({ scales: [scale({ steps: [] })] }))).toEqual([expect.stringContaining("scales[0].steps")]);
    expect(issue(draft({ scales: [scale({ steps: [{ level: 5, value: "1d6" }, { level: 5, value: "1d8" }] })] }))).toEqual([
      expect.stringContaining("scales[0].steps[1].level"),
    ]);
    expect(issue(draft({ scales: [scale({ steps: [{ level: 1, value: "big" }] })] }))).toEqual([expect.stringContaining("scales[0].steps[0].value")]);
    expect(issue(draft({ scales: [scale({ kind: "number", steps: [{ level: 1, value: "2" }] })] }))).toEqual([expect.stringContaining("scales[0].steps[0].value")]);
  });

  it("refuses two scales of one name, and a modifier using a scale that is not there or is a die", () => {
    expect(issue(draft({ scales: [scale(), scale({ id: "s2" })] }))).toEqual([expect.stringContaining("scales[1].name")]);
    const modifier = (id: string) => [{ kind: "modifier", id: "m1", target: "ac:misc", mode: "add", value: { kind: "scale", scale: id } }] as CustomDraft["blocks"];
    expect(issue(draft({ blocks: modifier("nope") }))).toEqual([expect.stringContaining("blocks[0].value")]);
    expect(issue(draft({ scales: [scale()], blocks: modifier("s1") }))).toEqual([expect.stringContaining("blocks[0].value")]);
  });

  it("allows an item only literal charges", () => {
    const item = (max: TrackerDef["max"]) => ({
      ...createCustomItemDraft("worn", "Wand"), id: "ID_CUSTOM_WAND0002", slot: "misc" as const, trackers: [tracker({ max })],
    });
    expect(customEntryIssues(item({ kind: "number", value: 7 }))).toEqual([]);
    expect(customEntryIssues(item({ kind: "reference", ref: "proficiency" })).map((entry) => entry.path)).toEqual(["trackers[0].max"]);
  });
});
