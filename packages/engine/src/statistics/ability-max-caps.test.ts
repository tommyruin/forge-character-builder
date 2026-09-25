/**
 * Ability score maximums above 20. Content raises a cap two ways:
 *
 * - "{ability}:max:extra" as a base rule — "increases by N, to a maximum of
 *   X" (Primal Champion, blessings, epic boons). The highest one lifts the
 *   cap, and each such source adds its own bonus only up to its own X.
 * - "{ability}:max" or a non-base ":max:extra" — "as does your maximum"
 *   (manuals and tomes, Orb of the Veil). These stack.
 *
 * The engine computes the cap itself; the shipped content has no Ability
 * Score Maximum Over 20 grant, and a level-20 barbarian's Primal Champion
 * once did nothing there.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCharacterDetail } from "../selection/detail.js";
import { computeStatistics, type StatisticsValues } from "./calculator.js";
import { seededRng } from "../testing/character-factory.js";
import { SYSTEM_ROOT } from "../testing/corpus.js";

const stat = (name: string, value: string, bonus?: string): string =>
  `<stat name="${name}" value="${value}"${bonus === undefined ? "" : ` bonus="${bonus}"`} />`;
/** "Your Strength increases by N, to a maximum of 20 + extra." */
const capped = (bonus: number, extra: number): string =>
  stat("strength", String(bonus)) + stat("strength:max:extra", String(extra), "base");

const TRAITS: Record<string, string> = {
  CHAMPION: capped(4, 4),
  /** The 2024 Primal Champion as shipped: +4, to a maximum of 25. */
  CHAMPION_2024: capped(4, 5),
  BLESSING: capped(2, 2),
  BOON: capped(1, 10),
  ORB: stat("strength", "2") + stat("strength:max:extra", "2"),
  MANUAL: stat("strength", "2") + stat("strength:max", "2"),
  RACIAL: stat("strength", "2"),
  /** An Ability Score Improvement pick: +1 with no maximum of its own. */
  PLAIN: stat("strength", "1"),
};
const RACES: Record<string, string[]> = {
  CHAMPION: ["CHAMPION"],
  CHAMPION_BLESSING: ["CHAMPION", "BLESSING"],
  CHAMPION_BLESSING_BOON: ["CHAMPION", "BLESSING", "BOON"],
  BLESSING: ["BLESSING"],
  CHAMPION_ORB: ["CHAMPION", "ORB"],
  MANUAL_TWICE: ["MANUAL", "MANUAL_AGAIN"],
  RACIAL: ["RACIAL"],
  RACIAL_CHAMPION: ["RACIAL", "CHAMPION"],
  PLAIN_CHAMPION: ["PLAIN", "CHAMPION_2024"],
  PLAIN_CHAMPION_BOON: ["PLAIN", "CHAMPION_2024", "BOON"],
  PLAIN_CHAMPION_ORB: ["PLAIN", "CHAMPION", "ORB"],
};

describe("ability maximums (synthetic content)", () => {
  let library: ElementLibrary;
  beforeAll(() => {
    const traits = { ...TRAITS, MANUAL_AGAIN: TRAITS.MANUAL! };
    const elements = [
      `<element name="Level 1" type="Level" source="Internal" id="ID_LEVEL_1" />`,
      ...Object.entries(traits).map(
        ([key, rules]) => `<element name="${key}" type="Racial Trait" source="Max Test" id="ID_TEST_TRAIT_${key}"><rules>${rules}</rules></element>`,
      ),
      ...Object.entries(RACES).map(
        ([key, parts]) =>
          `<element name="${key}" type="Race" source="Max Test" id="ID_TEST_RACE_${key}"><rules>${parts
            .map((part) => `<grant type="Racial Trait" id="ID_TEST_TRAIT_${part}" />`)
            .join("")}</rules></element>`,
      ),
    ];
    library = createEmptyLibrary();
    replaceLibraryFiles(library, new Map([["test/max.xml", `<?xml version="1.0" encoding="utf-8"?>\n<elements>${elements.join("\n")}</elements>`]]));
  });

  function statsFor(race: string, strength: number): StatisticsValues {
    const service = new CharacterService(undefined, library, { rng: seededRng(2) });
    const id = service.createCharacter(race).id;
    service.setAbilities(id, { strength, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === "Race")!;
    service.setSelection(id, rule.identifier, `ID_TEST_RACE_${race}`);
    return computeStatistics(service.getCharacter(id), library);
  }

  it.each([
    // race, starting Strength, final Strength, cap
    ["CHAMPION", 20, 24, 24],
    ["CHAMPION", 18, 22, 24],
    ["CHAMPION_BLESSING", 20, 24, 24],
    ["CHAMPION_BLESSING_BOON", 20, 25, 30],
    ["BLESSING", 21, 22, 22],
    ["BLESSING", 22, 22, 22],
    ["CHAMPION_ORB", 20, 26, 26],
    ["MANUAL_TWICE", 20, 24, 24],
    ["RACIAL", 20, 20, 20],
    ["RACIAL_CHAMPION", 18, 24, 24],
    // A plain +1 stops at 20 even once a capped source raises the maximum.
    ["PLAIN_CHAMPION", 20, 24, 25],
    ["PLAIN_CHAMPION", 19, 24, 25],
    ["PLAIN_CHAMPION_BOON", 20, 25, 30],
    // A stacking raise ("as does your maximum") still lifts it.
    ["PLAIN_CHAMPION_ORB", 20, 26, 26],
  ])("%s from Strength %i reaches %i (cap %i)", (race, strength, score, cap) => {
    const values = statsFor(race, strength);
    expect(values["strength:score"]).toBe(score);
    expect(values["strength:max"]).toBe(cap);
  });
});

describe("ability maximums (shipped content)", () => {
  const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
  let library: ElementLibrary;

  beforeAll(async () => {
    const { PUBLIC_BASE_PATHS } = (await import(
      fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
    )) as { PUBLIC_BASE_PATHS: Set<string> };
    const files = new Map<string, string>();
    for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
    for (const name of ["system-proxies.xml", "system-unarmed-riders.xml"]) {
      files.set(`system/${name}`, await readFile(join(SYSTEM_ROOT, name), "utf8"));
    }
    library = createEmptyLibrary();
    replaceLibraryFiles(library, files);
  }, 120_000);

  it("a level-20 2024 barbarian's Primal Champion raises Strength and Constitution to a maximum of 25", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(6) });
    const id = service.createCharacter("champion").id;
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, { strength: 20, dexterity: 14, constitution: 18, intelligence: 8, wisdom: 10, charisma: 8 });
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === "Class")!;
    service.setSelection(id, rule.identifier, "ID_WOTC_PHB24_CLASS_BARBARIAN");
    service.levelUpTo(id, { level: 20 });
    const values = computeStatistics(service.getCharacter(id), library);
    expect(values["strength:max"]).toBe(25);
    expect(values["strength:score"]).toBe(24);
    expect(values["constitution:score"]).toBe(22);
    // Build's Ability Scores section reads the same capped score.
    const strength = buildCharacterDetail(service.getCharacter(id), library).abilities.find((ability) => ability.name === "Strength")!;
    expect(strength.finalScore).toBe(24);
    expect(strength.maximum).toBe(25);
    expect(strength.modifier).toBe(7);
  });
});
