/**
 * Dragonborn breath weapon / draconic ancestry projection:
 * - the ancestry choice's `inline="true"` stats are text values, never
 *   numeric statistics (no "0" placeholders on the sheet);
 * - the breath weapon sheet text substitutes dice, damage type, shape, and
 *   DC (8 + CON modifier + proficiency);
 * - the dice count scales with character level (racial stat rules gate
 *   against character level, not a class level).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeInlineValues, computeStatistics } from "./calculator.js";
import { substitute } from "../sheet/model.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const DRAGONBORN = "ID_RACE_DRAGONBORN";
const ANCESTRY_BLACK = "ID_RACIAL_TRAIT_DRACONIC_ANCESTRY_BLACK";

const BREATH_SHEET_TEXT =
  "Exhale destructive energy. Your breath weapon does {{breath-weapon:dice count}}d{{breath-weapon:dice size}} {{draconic-ancestry:damage type}} damage in a {{draconic-ancestry:breath}}  DC {{breath-weapon:dc}}";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function blackDragonborn(): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = "dragonborn";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 13,
  });
  const detail = service.getCharacterDetail(id);
  const raceRule = detail.selectionRules.find((rule) => rule.type === "Race")!;
  service.setSelection(id, raceRule.identifier, DRAGONBORN);
  const afterRace = service.getCharacterDetail(id);
  const ancestryRule = afterRace.selectionRules.find(
    (rule) => rule.type === "Racial Trait" && rule.name === "Draconic Ancestry",
  )!;
  service.setSelection(id, ancestryRule.identifier, ANCESTRY_BLACK);
  return { service, id };
}

describe("dragonborn draconic ancestry", () => {
  it("keeps inline ancestry stats out of the numeric statistics", () => {
    const { service, id } = blackDragonborn();
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    expect(values["draconic-ancestry:damage type"]).toBeUndefined();
    expect(values["draconic-ancestry:breath"]).toBeUndefined();
    expect(values["breath-weapon:dc"]).toBe(8 + 2 + 2);
    expect(values["breath-weapon:dice count"]).toBe(2);
    expect(values["breath-weapon:dice size"]).toBe(6);
  });

  it("substitutes the breath weapon sheet text with the chosen ancestry", () => {
    const { service, id } = blackDragonborn();
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    const inline = computeInlineValues(state, library);
    expect(inline["draconic-ancestry"]).toBe("Black");
    expect(substitute(BREATH_SHEET_TEXT, values, inline)).toBe(
      "Exhale destructive energy. Your breath weapon does 2d6 Acid damage in a 5 by 30 ft. line (Dex. save)  DC 12",
    );
  });
});
