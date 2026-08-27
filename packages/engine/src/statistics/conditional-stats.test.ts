/**
 * Conditional stat rules ("while raging") describe circumstances, not
 * permanent statistics: the Barbarian's Rage damage and resistances must not
 * contribute to the unconditional statistics dictionary.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "./calculator.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const BARBARIAN = "ID_WOTC_PHB_CLASS_BARBARIAN";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

describe("conditional stat rules", () => {
  it("keeps Rage bonuses out of the unconditional statistics", () => {
    const service = new CharacterService(undefined, library);
    const id = "barbarian";
    service.createCharacter(id);
    service.setAbilities(id, {
      strength: 16, dexterity: 14, constitution: 14, intelligence: 8, wisdom: 12, charisma: 10,
    });
    const detail = service.getCharacterDetail(id);
    const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
    service.setSelection(id, classRule.identifier, BARBARIAN);

    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    // The rage counters themselves are ordinary statistics and still compute.
    expect(values["barbarian rage:count"]).toBeGreaterThan(0);
    expect(values["barbarian rage:damage"]).toBe(2);
    // The condition-gated projections stay out of the totals.
    expect(values["melee:damage, strength"]).toBeUndefined();
    expect(values["resistance:bludgeoning"]).toBeUndefined();
    expect(values["advantage:Strength Check"]).toBeUndefined();
  });
});
