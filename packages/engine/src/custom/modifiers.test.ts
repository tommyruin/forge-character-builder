/**
 * Every modifier mode and gate, compiled and run through the statistics
 * calculator on a factory character: what a form says is what the totals do.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { computeStatistics, type StatisticsValues } from "../statistics/calculator.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { customDraftIssues } from "./validate.js";
import { createCustomDraft, type ModifierBlock, type CustomDraft } from "./schema.js";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

let counter = 0;

/** The statistics of a fresh fighter before and after taking a feature made of these modifiers. */
function withFeatures(...features: Array<Array<Partial<ModifierBlock> & Pick<ModifierBlock, "target" | "mode" | "value">>>): {
  before: StatisticsValues;
  after: StatisticsValues;
} {
  const { service, id } = buildFighter3(library, `ModifierFighter${counter++}`);
  const before = computeStatistics(service.getCharacter(id), library);
  features.forEach((blocks, featureIndex) => {
    const draft: CustomDraft = createCustomDraft("feature", `Feature ${featureIndex}`);
    draft.blocks = blocks.map((block, index) => ({ kind: "modifier", id: `b${featureIndex}${index}`, ...block }));
    service.saveCustomDraft(id, { draft });
  });
  return { before, after: computeStatistics(service.getCharacter(id), library) };
}

const number = (value: number) => ({ kind: "number", value }) as const;

describe("modes", () => {
  it("add: an ability score, a save, a skill and initiative each rise by the value", () => {
    const { before, after } = withFeatures([
      { target: "wisdom", mode: "add", value: number(2) },
      { target: "dexterity:save:misc", mode: "add", value: number(1) },
      { target: "stealth:misc", mode: "add", value: number(3) },
      { target: "initiative", mode: "add", value: number(4) },
    ]);
    expect(after["wisdom:score"]).toBe(before["wisdom:score"]! + 2);
    expect(after["dexterity:save:misc"]).toBe(1);
    expect(after["stealth:misc"]).toBe(3);
    expect(after.initiative).toBe(before.initiative! + 4);
  });

  it("setBase: a flying speed is set, and a higher base wins instead of stacking", () => {
    const { after } = withFeatures(
      [{ target: "speed:fly", mode: "setBase", value: number(40) }],
      [{ target: "speed:fly", mode: "setBase", value: number(30) }],
    );
    expect(after["speed:fly"]).toBe(40);
  });

  it("setBase on an ability sets the score, unless it is already higher", () => {
    const { before, after } = withFeatures([{ target: "strength", mode: "setBase", value: number(19) }]);
    expect(after["strength:score"]).toBe(Math.max(19, before["strength:score"]!));
  });

  it("bestOf: sources in one bucket do not stack, the largest counts", () => {
    const { before, after } = withFeatures(
      [{ target: "ac:misc", mode: "bestOf", bucket: "ward", value: number(1) }],
      [{ target: "ac:misc", mode: "bestOf", bucket: "ward", value: number(2) }],
    );
    expect(after.ac).toBe(before.ac! + 2);
    const stacked = withFeatures(
      [{ target: "ac:misc", mode: "add", value: number(1) }],
      [{ target: "ac:misc", mode: "add", value: number(2) }],
    );
    expect(stacked.after.ac).toBe(stacked.before.ac! + 3);
  });

  it("raiseMax: lifts the ability maximum, so a score can pass 20", () => {
    const { after } = withFeatures([
      { target: "strength", mode: "setBase", value: number(22) },
      { target: "strength:max", mode: "raiseMax", value: number(2) },
    ]);
    expect(after["strength:max"]).toBe(22);
  });
});

describe("values", () => {
  it("a reference follows the character: Strength modifier, capped", () => {
    const { before, after } = withFeatures([
      { target: "initiative", mode: "add", value: { kind: "reference", ref: "strength:modifier" }, cap: number(1) },
    ]);
    expect(before["strength:modifier"]).toBeGreaterThan(1);
    expect(after.initiative).toBe(before.initiative! + 1);
  });

  it("a reference with a floor reads 'ability modifier, at least 1' and never goes below it", () => {
    const { before, after } = withFeatures([
      { target: "initiative", mode: "add", value: { kind: "reference", ref: "charisma:modifier", min: 1 } },
      { target: "melee:attack", mode: "add", value: { kind: "reference", ref: "strength:modifier", min: 1 } },
    ]);
    expect(before["charisma:modifier"]).toBeLessThan(1);
    expect(after.initiative).toBe(before.initiative! + 1);
    // A modifier above the floor counts as it is.
    expect(before["strength:modifier"]).toBeGreaterThan(1);
    expect(after["melee:attack"]).toBe((before["melee:attack"] ?? 0) + before["strength:modifier"]!);
  });

  it("refuses a floor that is not a whole number", () => {
    const draft = createCustomDraft("feature", "Floor");
    draft.blocks = [{ kind: "modifier", id: "b0", target: "initiative", mode: "add", value: { kind: "reference", ref: "charisma:modifier", min: 1.5 } }];
    expect(customDraftIssues(draft).map((issue) => issue.path)).toEqual(["blocks[0].value.min"]);
  });

  it("a negated reference subtracts and a class level reference counts that class", () => {
    const { before, after } = withFeatures([
      { target: "hp", mode: "add", value: { kind: "reference", ref: "level", negate: true } },
      { target: "hp", mode: "add", value: { kind: "classLevel", className: "Fighter" } },
      { target: "melee:attack", mode: "add", value: { kind: "reference", ref: "proficiency" } },
    ]);
    // -level + fighter level cancels for a single-class fighter.
    expect(after.hp).toBe(before.hp);
    expect(after["melee:attack"]).toBe(before.proficiency);
  });
});

describe("gates", () => {
  it("a level gate holds the modifier back until the character reaches it", () => {
    const early = withFeatures([{ target: "initiative", mode: "add", value: number(2), gates: { level: 3 } }]);
    expect(early.after.initiative).toBe(early.before.initiative! + 2);
    const late = withFeatures([{ target: "initiative", mode: "add", value: number(2), gates: { level: 5 } }]);
    expect(late.after.initiative).toBe(late.before.initiative);
  });

  it("requirements gate it on the character", () => {
    const met = withFeatures([
      { target: "initiative", mode: "add", value: number(2), gates: { requirements: { kind: "ability", ability: "strength", min: 10 } } },
    ]);
    expect(met.after.initiative).toBe(met.before.initiative! + 2);
    const unmet = withFeatures([
      { target: "initiative", mode: "add", value: number(2), gates: { requirements: { kind: "ability", ability: "strength", min: 30 } } },
    ]);
    expect(unmet.after.initiative).toBe(unmet.before.initiative);
  });

  it("an equipment gate follows what the character wears", () => {
    // The factory fighter wears no armor: only the "no armor" gate holds.
    const bare = withFeatures([{ target: "ac:misc", mode: "add", value: number(1), gates: { equipped: [{ slot: "armor", value: "none" }] } }]);
    expect(bare.after.ac).toBe(bare.before.ac! + 1);
    const armored = withFeatures([{ target: "ac:misc", mode: "add", value: number(1), gates: { equipped: [{ slot: "armor", value: "any" }] } }]);
    expect(armored.after.ac).toBe(armored.before.ac);
  });

  it("a switch keeps the modifier out of the totals until something turns it on", () => {
    const { before, after } = withFeatures([{ target: "ac:misc", mode: "add", value: number(2), gates: { switch: "Moonlit form" } }]);
    expect(after.ac).toBe(before.ac);
  });
});

describe("targets", () => {
  it("covers the rest of the catalogue: hit points, attunement, attacks, spellcasting, passive scores", () => {
    const { before, after } = withFeatures([
      { target: "hp", mode: "add", value: number(5) },
      { target: "attunement:max", mode: "setBase", value: number(5) },
      { target: "extra attack:count", mode: "bestOf", value: number(3) },
      { target: "melee:damage", mode: "add", value: number(1) },
      { target: "ranged:attack", mode: "add", value: number(1) },
      { target: "spellcasting:dc", mode: "add", value: number(1) },
      { target: "spellcasting:attack", mode: "add", value: number(2) },
      { target: "speed:misc", mode: "add", value: number(10) },
      { target: "perception:passive", mode: "add", value: number(5) },
    ]);
    expect(after.hp).toBe(before.hp! + 5);
    expect(after["attunement:max"]).toBe(5);
    expect(after["extra attack:count"]).toBe(3);
    expect(after["melee:damage"]).toBe(1);
    expect(after["ranged:attack"]).toBe(1);
    expect(after["spellcasting:dc"]).toBe(before["spellcasting:dc"]! + 1);
    expect(after["spellcasting:attack"]).toBe(before["spellcasting:attack"]! + 2);
    expect(after.speed).toBe(before.speed! + 10);
    expect(after["perception:passive"]).toBe(before["perception:passive"]! + 5);
  });

  it("an armor class calculation competes with the unarmored one", () => {
    const { before, after } = withFeatures([
      { target: "ac:calculation", mode: "setBase", value: number(14), addAbilities: ["dexterity", "wisdom"], gates: { equipped: [{ slot: "armor", value: "none" }] } },
    ]);
    const dexterity = before["dexterity:modifier"]!;
    const wisdom = before["wisdom:modifier"]!;
    expect(after["ac:calculation"]).toBe(Math.max(before["ac:calculation"]!, 14 + dexterity + wisdom));
    expect(after.ac).toBeGreaterThan(before.ac!);
    expect(after.ac).toBe(after["ac:calculation"]! + (before.ac! - before["ac:calculation"]!));
  });
});
