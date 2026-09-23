/**
 * Darkvision range arithmetic. ID_VISION_LESSER_DARKVISION is a marker: it
 * names the sense for a grant that brings its own range rules, and its own
 * base range is 0 (it registers only when the character has no other
 * darkvision). The engine once baked a 60-foot base onto the marker, which
 * doubled every grant that adds its own 60 feet — Goggles of Night gave 120.
 * These cases pin the source-authored arithmetic: the marker's base, the
 * grant's own base/bonus rules, native darkvision, and conditional ranges.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { computeStatistics } from "./calculator.js";
import { buildCharacter, seededRng } from "../testing/character-factory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

const LESSER = "ID_VISION_LESSER_DARKVISION";
const NATIVE = "ID_VISION_DARKVISION";
const MARK = "ID_TEST_TRAIT_NIGHT_MARK";

function darkvision(service: CharacterService, id: string, library: ElementLibrary): number {
  return computeStatistics(service.getCharacter(id), library)["darkvision:range"] ?? 0;
}

describe("darkvision arithmetic (synthetic content)", () => {
  // The level container must resolve for its subtree to count.
  const vision = (withMarkerBase: boolean): string => `
  <element name="Level 1" type="Level" source="Internal" id="ID_LEVEL_1" />
  <element name="Darkvision" type="Vision" source="Darkvision Test" id="${LESSER}">
    <requirements>!(ID_VISION_SUPERIORDARKVISION || ${NATIVE})</requirements>
    <rules>${withMarkerBase ? '<stat name="darkvision:range" value="0" bonus="base" />' : ""}</rules>
  </element>
  <element name="Darkvision" type="Vision" source="Darkvision Test" id="${NATIVE}">
    <rules><stat name="darkvision:range" value="60" bonus="base" /></rules>
  </element>
  <element name="Night Mark" type="Racial Trait" source="Darkvision Test" id="${MARK}" />`;

  /** One race per rule shape; each grants the marker plus its own rules. */
  const RACES: Record<string, string> = {
    MARKER_ONLY: `<grant type="Vision" id="${LESSER}" />`,
    PLUS_TEN: `<grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="10" />`,
    ADDS_SIXTY: `<grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="60" />`,
    SPLIT: `<grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="30" bonus="base" /><stat name="darkvision:range" value="30" bonus="umbral" />`,
    BASE_SIXTY: `<grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="60" bonus="base" />`,
    NATIVE_ADDS_SIXTY: `<grant type="Vision" id="${NATIVE}" /><grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="60" />`,
    NATIVE_SPLIT: `<grant type="Vision" id="${NATIVE}" /><grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="30" bonus="base" /><stat name="darkvision:range" value="30" bonus="umbral" />`,
    CONDITIONAL_UNMET: `<grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="60" requirements="${MARK}" />`,
    CONDITIONAL_MET: `<grant type="Racial Trait" id="${MARK}" /><grant type="Vision" id="${LESSER}" /><stat name="darkvision:range" value="60" requirements="${MARK}" />`,
  };

  function library(withMarkerBase = true): ElementLibrary {
    const races = Object.entries(RACES)
      .map(([key, rules]) => `<element name="${key}" type="Race" source="Darkvision Test" id="ID_TEST_RACE_${key}"><rules>${rules}</rules></element>`)
      .join("\n");
    const lib = createEmptyLibrary();
    replaceLibraryFiles(lib, new Map([["test/darkvision.xml", `<?xml version="1.0" encoding="utf-8"?>\n<elements>${vision(withMarkerBase)}\n${races}\n</elements>`]]));
    return lib;
  }

  function rangeFor(key: string, lib: ElementLibrary): number {
    const service = new CharacterService(undefined, lib, { rng: seededRng(3) });
    const id = service.createCharacter(key).id;
    const race = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
    service.setSelection(id, race.identifier, `ID_TEST_RACE_${key}`);
    return darkvision(service, id, lib);
  }

  it.each([
    ["MARKER_ONLY", 0],
    ["PLUS_TEN", 10],
    ["ADDS_SIXTY", 60],
    ["SPLIT", 60],
    ["BASE_SIXTY", 60],
    ["NATIVE_ADDS_SIXTY", 120],
    ["NATIVE_SPLIT", 90],
    ["CONDITIONAL_UNMET", 0],
    ["CONDITIONAL_MET", 60],
  ])("%s gives %i feet", (key, expected) => {
    expect(rangeFor(key, library())).toBe(expected);
  });

  it("invents no base when the marker authors no range at all", () => {
    const bare = library(false);
    expect(rangeFor("MARKER_ONLY", bare)).toBe(0);
    expect(rangeFor("ADDS_SIXTY", bare)).toBe(60);
  });
});

describe("darkvision from corpus grants", () => {
  const GOGGLES_OF_NIGHT = "ID_WOTC_DMG_MAGIC_ITEM_GOGGLES_OF_NIGHT";
  const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await buildCorpusLibrary();
  }, 120_000);

  function wearGoggles(service: CharacterService, id: string): string {
    const dto = service.addItem(id, { itemId: GOGGLES_OF_NIGHT, amount: 1, baseElementId: null });
    const goggles = dto.items.find((item) => item.itemId === GOGGLES_OF_NIGHT)!.identifier;
    service.equipItem(id, goggles, "worn");
    return goggles;
  }

  function classless(raceId?: string, subRaceId?: string): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(5) });
    const id = service.createCharacter("vision").id;
    service.setRulesetMode(id, "2014");
    const pick = (type: string, elementId: string): void => {
      const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === type)!;
      service.setSelection(id, rule.identifier, elementId);
    };
    if (raceId !== undefined) pick("Race", raceId);
    if (subRaceId !== undefined) pick("Sub Race", subRaceId);
    return { service, id };
  }

  it("Goggles of Night grant 60 feet to a character without darkvision", () => {
    const { service, id } = classless();
    expect(darkvision(service, id, library)).toBe(0);
    wearGoggles(service, id);
    expect(darkvision(service, id, library)).toBe(60);
  });

  it("Goggles of Night extend native darkvision by 60 feet and give it back on removal", () => {
    const { service, id } = classless("ID_SRD_RACE_DWARF", "ID_SUB_RACE_HILL_DWARF");
    expect(darkvision(service, id, library)).toBe(60);
    const goggles = wearGoggles(service, id);
    expect(darkvision(service, id, library)).toBe(120);
    service.equipItem(id, goggles, "none");
    expect(darkvision(service, id, library)).toBe(60);
    service.equipItem(id, goggles, "worn");
    service.removeItem(id, goggles);
    expect(darkvision(service, id, library)).toBe(60);
  });

  it("Goggles of Night extend superior darkvision by 60 feet", () => {
    const { service, id } = classless("ID_RACE_ELF", "ID_SUB_RACE_DARK_ELF");
    expect(darkvision(service, id, library)).toBe(120);
    wearGoggles(service, id);
    expect(darkvision(service, id, library)).toBe(180);
  });

  function gloomStalker(raceId: string, subRaceId: string): { service: CharacterService; id: string } {
    const { service, id } = buildCharacter(library, { id: `gloom-${raceId}`, raceId, subRaceId, classId: "ID_WOTC_PHB_CLASS_RANGER", levels: 3 });
    const archetype = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Archetype")!;
    service.setSelection(id, archetype.identifier, "ID_WOTC_XGTE_ARCHETYPE_RANGER_GLOOM_STALKER");
    return { service, id };
  }

  it("2014 Gloom Stalker's Umbral Sight: 60 feet for a grung, +30 over a dwarf's 60", () => {
    const grung = gloomStalker("ID_WOTC_OGA_RACE_GRUNG", "");
    expect(darkvision(grung.service, grung.id, library)).toBe(60);
    const dwarf = gloomStalker("ID_SRD_RACE_DWARF", "ID_SUB_RACE_HILL_DWARF");
    expect(darkvision(dwarf.service, dwarf.id, library)).toBe(90);
  });

  it("the imported grung Gloom Stalker fixture keeps 60 feet", async () => {
    const xml = await readFile(join(FIXTURE_ROOT, "ranger-rogue-8.dnd5e"), "utf8");
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    service.importCharacterXml("fixture", xml);
    expect(darkvision(service, "fixture", library)).toBe(60);
  });

  it.each([
    ["ID_WOTC_PHB24_CLASS_RANGER", "ID_WOTC_PHB24_ARCHETYPE_RANGER_GLOOM_STALKER"],
    ["ID_WOTC_PHB24_CLASS_MONK", "ID_WOTC_PHB24_ARCHETYPE_MONK_WARRIOR_OF_SHADOW"],
  ])("2024 %s subclass %s gives 60 feet, 120 with goggles", (classId, archetypeId) => {
    const service = new CharacterService(undefined, library, { rng: seededRng(9) });
    const id = service.createCharacter("vision-2024").id;
    service.setRulesetMode(id, "2024");
    service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
    const pick = (type: string, elementId: string): void => {
      const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === type)!;
      service.setSelection(id, rule.identifier, elementId);
    };
    pick("Class", classId);
    while (service.getCharacter(id).level < 3) service.levelUp(id);
    expect(darkvision(service, id, library)).toBe(0);
    pick("Archetype", archetypeId);
    expect(darkvision(service, id, library)).toBe(60);
    wearGoggles(service, id);
    expect(darkvision(service, id, library)).toBe(120);
  });
});
