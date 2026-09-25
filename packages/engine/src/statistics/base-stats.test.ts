/**
 * bonus="base" stat rules. A base rule names a key's base value, and base
 * rules compete like any other named bonus bucket: the highest wins, and
 * every other contribution adds on top. The content is written that way —
 * "1 or your Wisdom modifier" floors, "60 feet, or +30 if you already have
 * it" features beside a race's darkvision, boots that set a walking speed of
 * 30 "unless yours is higher". The engine once let the last base rule applied
 * replace the key, erasing the others and every contribution before it.
 *
 * A key's first base rule still replaces the engine seed it stands in for
 * (attunement slots start at 3; a base of 4 makes 4, not 7). A walking or
 * other movement speed is its innate calculation or a content base that beats
 * it, plus its misc pool.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { computeStatistics, type StatisticsValues } from "./calculator.js";
import { buildCharacter, seededRng } from "../testing/character-factory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

const stat = (name: string, value: string, bonus?: string): string =>
  `<stat name="${name}" value="${value}"${bonus === undefined ? "" : ` bonus="${bonus}"`} />`;
const base = (name: string, value: string): string => stat(name, value, "base");

describe("base rules (synthetic content)", () => {
  /** Each race carries one rule shape; `TRAIT_*` elements are granted to it. */
  const TRAITS: Record<string, string> = {
    TRAIT_BASE_30: base("test:value", "30"),
    TRAIT_BASE_60: base("test:value", "60"),
  };
  const RACES: Record<string, string> = {
    HIGH_THEN_LOW: base("test:value", "60") + base("test:value", "30"),
    LOW_THEN_HIGH: base("test:value", "30") + base("test:value", "60"),
    RACE_60_TRAIT_30: base("test:value", "60") + `<grant type="Racial Trait" id="ID_TEST_TRAIT_BASE_30" />`,
    RACE_30_TRAIT_60: base("test:value", "30") + `<grant type="Racial Trait" id="ID_TEST_TRAIT_BASE_60" />`,
    ADD_THEN_BASE: stat("test:value", "5") + base("test:value", "30"),
    BUCKET_THEN_BASE: stat("test:value", "10", "named") + base("test:value", "30"),
    FLOOR_AFTER_REFERENCE: base("test:value", "strength:modifier") + base("test:value", "1"),
    FLOOR_BEFORE_REFERENCE: base("test:value", "1") + base("test:value", "strength:modifier"),
    SEEDED: base("attunement:max", "4"),
    WALK_30: base("innate speed", "30"),
    TRAIT_SPEED_35: base("innate speed", "30") + base("speed", "35"),
    SLOW_WITH_SPEED_30: base("innate speed", "25") + base("speed", "30"),
    FAST_WITH_SPEED_30_MISC: base("innate speed", "30") + base("speed", "30") + stat("speed:misc", "10"),
    FLY_AS_WALK: base("innate speed", "30") + base("speed:fly", "speed"),
    FLY_INNATE_60: base("innate speed", "30") + base("innate speed:fly", "60") + base("speed:fly", "speed"),
  };

  let library: ElementLibrary;
  beforeAll(() => {
    const elements = [
      `<element name="Level 1" type="Level" source="Internal" id="ID_LEVEL_1" />`,
      ...Object.entries(TRAITS).map(
        ([key, rules]) => `<element name="${key}" type="Racial Trait" source="Base Test" id="ID_TEST_${key}"><rules>${rules}</rules></element>`,
      ),
      ...Object.entries(RACES).map(
        ([key, rules]) => `<element name="${key}" type="Race" source="Base Test" id="ID_TEST_RACE_${key}"><rules>${rules}</rules></element>`,
      ),
    ];
    library = createEmptyLibrary();
    replaceLibraryFiles(library, new Map([["test/base.xml", `<?xml version="1.0" encoding="utf-8"?>\n<elements>${elements.join("\n")}</elements>`]]));
  });

  function statsFor(key: string, strength = 10): StatisticsValues {
    const service = new CharacterService(undefined, library, { rng: seededRng(3) });
    const id = service.createCharacter(key).id;
    service.setAbilities(id, { strength, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
    const race = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
    service.setSelection(id, race.identifier, `ID_TEST_RACE_${key}`);
    return computeStatistics(service.getCharacter(id), library);
  }

  it.each(["HIGH_THEN_LOW", "LOW_THEN_HIGH", "RACE_60_TRAIT_30", "RACE_30_TRAIT_60"])(
    "%s: the highest base wins in any order, on one element or two",
    (key) => {
      expect(statsFor(key)["test:value"]).toBe(60);
    },
  );

  it("keeps additive and named-bucket contributions made before a base", () => {
    expect(statsFor("ADD_THEN_BASE")["test:value"]).toBe(35);
    expect(statsFor("BUCKET_THEN_BASE")["test:value"]).toBe(40);
  });

  it.each(["FLOOR_AFTER_REFERENCE", "FLOOR_BEFORE_REFERENCE"])("%s: a floor pair is max(1, modifier)", (key) => {
    expect(statsFor(key, 10)["test:value"]).toBe(1);
    expect(statsFor(key, 16)["test:value"]).toBe(3);
  });

  it("replaces a key's engine seed rather than adding to it", () => {
    expect(statsFor("SEEDED")["attunement:max"]).toBe(4);
  });

  it.each([
    ["WALK_30", 30],
    ["TRAIT_SPEED_35", 35],
    ["SLOW_WITH_SPEED_30", 30],
    ["FAST_WITH_SPEED_30_MISC", 40],
  ])("%s: walking speed is the higher of innate and base, plus misc (%i)", (key, expected) => {
    expect(statsFor(key).speed).toBe(expected);
  });

  it("a fly speed set to the walking speed competes with an innate fly speed", () => {
    expect(statsFor("FLY_AS_WALK")["speed:fly"]).toBe(30);
    expect(statsFor("FLY_INNATE_60")["speed:fly"]).toBe(60);
  });
});

describe("base rules (corpus content)", () => {
  const BOOTS = "ID_WOTC_DMG_MAGIC_ITEM_BOOTS_OF_STRIDING_AND_SPRINGING";
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await buildCorpusLibrary();
  }, 120_000);

  const statsOf = (service: CharacterService, id: string): StatisticsValues => computeStatistics(service.getCharacter(id), library);

  function pick(service: CharacterService, id: string, type: string, elementId: string): void {
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === type)!;
    service.setSelection(id, rule.identifier, elementId);
  }

  function classAt(classId: string, level: number, mode: "2014" | "2024", wisdom = 10): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(4) });
    const id = service.createCharacter("base").id;
    service.setRulesetMode(id, mode);
    service.setAbilities(id, { strength: 10, dexterity: 10, constitution: 12, intelligence: 14, wisdom, charisma: 14 });
    pick(service, id, "Class", classId);
    while (service.getCharacter(id).level < level) service.levelUp(id);
    return { service, id };
  }

  it("a 2024 wood elf walks 35 feet", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(4) });
    const id = service.createCharacter("wood elf").id;
    service.setRulesetMode(id, "2024");
    pick(service, id, "Race", "ID_WOTC_PHB24_RACE_ELF");
    const state = service.getCharacter(id);
    const lineage = pendingSelectionRules(state).find((rule) => rule.name === "Elven Lineage")!;
    const wood = selectionOptions(state, library, lineage).find((option) => option.id.endsWith("_WOOD_ELF"))!;
    service.setSelection(id, lineage.identifier, wood.id);
    expect(statsOf(service, id).speed).toBe(35);
  });

  it("Boots of Striding and Springing set a hill dwarf's speed to 30 while worn", () => {
    const { service, id } = buildCharacter(library, { id: "boots", classId: "ID_WOTC_PHB_CLASS_FIGHTER" });
    expect(statsOf(service, id).speed).toBe(25);
    const dto = service.addItem(id, { itemId: BOOTS, amount: 1, baseElementId: null });
    const boots = dto.items.find((item) => item.itemId === BOOTS)!.identifier;
    service.equipItem(id, boots, "worn");
    service.attuneItem(id, boots, true);
    expect(statsOf(service, id).speed).toBe(30);
    service.attuneItem(id, boots, false);
    service.equipItem(id, boots, "none");
    expect(statsOf(service, id).speed).toBe(25);
  });

  it("a 2024 cleric's Sear Undead count is max(1, Wisdom modifier)", () => {
    const wise = classAt("ID_WOTC_PHB24_CLASS_CLERIC", 5, "2024", 16);
    expect(statsOf(wise.service, wise.id)["sear undead:count"]).toBe(3);
    const plain = classAt("ID_WOTC_PHB24_CLASS_CLERIC", 5, "2024", 8);
    expect(statsOf(plain.service, plain.id)["sear undead:count"]).toBe(1);
  });

  it("a 2014 bard's Bardic Inspiration die grows d6, d8, d10", () => {
    const { service, id } = classAt("ID_WOTC_PHB_CLASS_BARD", 1, "2014");
    expect(statsOf(service, id)["bardic-inspiration:dice"]).toBe(6);
    while (service.getCharacter(id).level < 5) service.levelUp(id);
    expect(statsOf(service, id)["bardic-inspiration:dice"]).toBe(8);
    while (service.getCharacter(id).level < 10) service.levelUp(id);
    expect(statsOf(service, id)["bardic-inspiration:dice"]).toBe(10);
  });

  it("a 2014 bard inspires at least once, else Charisma modifier times", () => {
    const { service, id } = classAt("ID_WOTC_PHB_CLASS_BARD", 1, "2014");
    expect(statsOf(service, id)["bardic-inspiration:count"]).toBe(2);
    service.setAbilities(id, { strength: 10, dexterity: 10, constitution: 12, intelligence: 14, wisdom: 10, charisma: 11 });
    expect(statsOf(service, id)["bardic-inspiration:count"]).toBe(1);
    service.setAbilities(id, { strength: 10, dexterity: 10, constitution: 12, intelligence: 14, wisdom: 10, charisma: 8 });
    expect(statsOf(service, id)["bardic-inspiration:count"]).toBe(1);
  });

  it("the UA 2019 artificer knows 3, 4, then 5 infusions", () => {
    const { service, id } = classAt("ID_WOTC_UA20190228_CLASS_ARTIFICER", 2, "2014");
    expect(statsOf(service, id)["infusions:count"]).toBe(3);
    while (service.getCharacter(id).level < 4) service.levelUp(id);
    expect(statsOf(service, id)["infusions:count"]).toBe(4);
    while (service.getCharacter(id).level < 7) service.levelUp(id);
    expect(statsOf(service, id)["infusions:count"]).toBe(5);
  });
});
