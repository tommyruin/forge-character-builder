import { beforeAll, describe, expect, it } from "vitest";
import { buildAppearanceSuggestions } from "./appearance.js";
import type { ElementLibrary } from "../content/library.js";
import { buildCharacter, sharedLibrary, ID } from "../testing/character-factory.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120000);

describe("appearance suggestions", () => {
  it("rolls height/weight for a race whose weight modifier is a flat integer", () => {
    // The PHB gnome's weight setter is `modifier="1"` — a fixed ×1 multiplier,
    // not a dice expression. It must roll as the constant it names.
    const { state } = buildCharacter(library, {
      id: "GnomeLooks",
      raceId: "ID_RACE_GNOME",
      subRaceId: "ID_SUB_RACE_ROCK_GNOME",
      classId: ID.CLASS_WIZARD,
    });

    const suggestion = buildAppearanceSuggestions(state, library, 42);

    expect(suggestion.heightWeightFromRace).toBe(true);
    const heightMatch = /^(\d+)'(\d+)"$/.exec(suggestion.height ?? "");
    const weightMatch = /^(\d+) lb\.$/.exec(suggestion.weight ?? "");
    expect(heightMatch).not.toBeNull();
    expect(weightMatch).not.toBeNull();
    // Gnome: height base 2'11" (35 in.), weight base 35 lb., weight factor ×1,
    // so the pound count always equals the rolled height in inches.
    const inches = Number(heightMatch![1]) * 12 + Number(heightMatch![2]);
    expect(Number(weightMatch![1])).toBe(inches);
  });

  it("still rolls dice modifiers for races that use them", () => {
    const { state } = buildCharacter(library, {
      id: "DwarfLooks",
      classId: ID.CLASS_FIGHTER,
    });

    const suggestion = buildAppearanceSuggestions(state, library, 7);

    expect(suggestion.heightWeightFromRace).toBe(true);
    expect(suggestion.height).toMatch(/^\d+'\d+"$/);
    expect(suggestion.weight).toMatch(/^\d+ lb\.$/);
  });
});
