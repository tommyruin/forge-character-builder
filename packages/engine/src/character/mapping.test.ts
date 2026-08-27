import { beforeAll, describe, expect, it } from "vitest";
import { parseDnd5e } from "../dnd5e/document.js";
import { mapToState } from "./mapping.js";
import { SAMPLE_CASTER, SAMPLE_CHARACTER } from "../testing/dnd5e-samples.js";
import type { ElementLibrary } from "../content/library.js";
import { ID, buildCharacter, buildRogue5, sharedLibrary, select } from "../testing/character-factory.js";

/**
 * Mapping runs against two authored documents (the format cases) and two
 * characters built through the engine API (the state cases), so the mapper is
 * exercised on both file-shaped and engine-shaped input.
 */
const DOCUMENTS: Record<string, string> = {
  "tst.dnd5e": SAMPLE_CHARACTER,
  "Meepo.dnd5e": SAMPLE_CASTER,
};

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();

  const rogue = buildRogue5(library, "Rogue5");
  rogue.service.updateDetails("Rogue5", { playerName: "Tom", experience: 6500 });
  DOCUMENTS["Billy.dnd5e"] = rogue.service.exportCharacterXml("Rogue5");

  const barbarian = buildCharacter(library, {
    id: "Barbarian1",
    raceId: "ID_RACE_DRAGONBORN",
    subRaceId: "",
    classId: ID.CLASS_BARBARIAN,
  });
  select(barbarian.service, "Barbarian1", "Background", "ID_BACKGROUND_ACOLYTE");
  DOCUMENTS["test.dnd5e"] = barbarian.service.exportCharacterXml("Barbarian1");
}, 120_000);

const FIXTURES = ["tst.dnd5e", "Meepo.dnd5e", "Billy.dnd5e", "test.dnd5e"];

const mapFixture = (name: string) => mapToState(parseDnd5e(DOCUMENTS[name]!), name);

describe("character mapping", () => {
  it("maps information and generation option", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.id).toBe("tst.dnd5e");
    expect(s.group).toBe("");
    expect(s.generationOption).toBe(1);
  });

  it("treats a missing generation option as Custom", () => {
    const xml = SAMPLE_CHARACTER.replace(/[ \t]*<generationOption>\d+<\/generationOption>\r?\n/, "");
    expect(xml).not.toContain("<generationOption>");
    expect(mapToState(parseDnd5e(xml), "tst").generationOption).toBe(2);
  });

  it("maps display properties including portrait", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.name).toBe("tst");
    expect(s.race).toBe("Rock Gnome");
    expect(s.klass).toBe("");
    expect(s.archetype).toBe("");
    expect(s.background).toBe("");
    expect(s.level).toBe(1);
    expect(s.portrait.companion).toBe("");
    expect(s.portrait.local).toBe("C:\\Portraits\\default-portrait.png");
    expect(s.portrait.base64).toBe("");
  });

  it("maps build/input fields", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.playerName).toBe("Player One");
    expect(s.gender).toBe("Male");
    expect(s.experience).toBe(0);
    expect(s.attacksDescription).toBe("");
    expect(s.backstory).toBe("");
    expect(s.backgroundTraits).toEqual({ trinket: "", traits: "", ideals: "", bonds: "", flaws: "" });
    expect(s.backgroundFeature).toEqual({ name: "", description: "" });
    expect(s.organization).toEqual({ name: "", symbol: "", allies: "" });
    expect(s.additionalFeatures).toBe("");
    expect(s.notes).toEqual({ left: "", right: "" });
    expect(s.quest).toBe("");
    expect(s.coins).toEqual({ copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 });
    expect(s.equipmentNote).toBe("");
    expect(s.treasureNote).toBe("");
  });

  it("maps appearance", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.appearance.portrait).toBe("C:\\Portraits\\default-portrait.png");
    expect(s.appearance.age).toBe("");
    expect(s.appearance.height).toBe('2\'11"');
    expect(s.appearance.weight).toBe("35 lb.");
    expect(s.appearance.eyes).toBe("");
    expect(s.appearance.skin).toBe("");
    expect(s.appearance.hair).toBe("");
  });

  it("maps abilities and available points", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.availablePoints).toBe(15);
    expect(s.abilities).toEqual({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });
  });

  it("maps the elements tree with wrapper attributes", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.levelCount).toBe(1);
    expect(s.registeredCount).toBe(3);
    expect(s.elements).toHaveLength(1);
    const level = s.elements[0]!;
    expect(level).toMatchObject({ type: "Level", name: "1", id: "ID_LEVEL_1" });
    expect(level.children).toHaveLength(10);
    const race = level.children[0]!;
    expect(race).toMatchObject({
      type: "Race",
      name: "Race",
      id: "",
      requiredLevel: 1,
      checksum: "1597ef76",
      registered: "ID_RACE_GNOME",
    });
    expect(race.children).toHaveLength(6);
    const gnomeSubrace = race.children[5]!;
    expect(gnomeSubrace).toMatchObject({ type: "Racial Trait", id: "ID_RACIAL_TRAIT_GNOME_SUBRACE" });
    const subRace = gnomeSubrace.children[0]!;
    expect(subRace).toMatchObject({
      type: "Sub Race",
      requiredLevel: 1,
      checksum: "d8fc9aec",
      registered: "ID_SUB_RACE_ROCK_GNOME",
    });
    expect(subRace.children).toHaveLength(2);
    const klass = level.children[1]!;
    expect(klass).toMatchObject({ type: "Class", registered: "" });
    expect(level.children[2]).toMatchObject({ type: "Background", registered: "" });
    expect(level.children[9]).toMatchObject({
      type: "Grants",
      name: "Constitution Modifier",
      id: "ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER",
    });
  });

  it("maps a built level-5 rogue's key values", () => {
    const s = mapFixture("Billy.dnd5e");
    expect(s.name).toBe("Rogue5");
    expect(s.race).toBe("Hill Dwarf");
    expect(s.klass).toBe("Rogue");
    expect(s.level).toBe(5);
    expect(s.levelCount).toBe(5);
    expect(s.registeredCount).toBe(11);
    expect(s.experience).toBe(6500);
    expect(s.playerName).toBe("Tom");
  });

  it("maps a built character's selections and the sum", () => {
    const s = mapFixture("test.dnd5e");
    expect(s.level).toBe(1);
    expect(s.registeredCount).toBe(6);
    expect(s.sum.elementCount).toBe(88);
    expect(s.sum.elements).toHaveLength(88);
    expect(s.sum.elements[0]).toEqual({ type: "Level", id: "ID_LEVEL_1" });
    // Option wrappers precede the level wrappers in the elements tree.
    const level = s.elements.find((node) => node.type === "Level")!;
    const klass = level.children.find((c) => c.type === "Class")!;
    expect(klass.registered).toBe("ID_WOTC_PHB_CLASS_BARBARIAN");
    const race = level.children.find((c) => c.type === "Race")!;
    expect(race.registered).toBe("ID_RACE_DRAGONBORN");
    const bg = level.children.find((c) => c.type === "Background")!;
    expect(bg.registered).toBe("ID_BACKGROUND_ACOLYTE");
  });

  it("maps options from sum Option elements", () => {
    const s = mapFixture("Billy.dnd5e");
    expect(s.options.has("ID_INTERNAL_OPTION_ALLOW_FEATS")).toBe(true);
    expect(s.options.has("ID_INTERNAL_OPTION_ALLOW_MULTICLASSING")).toBe(true);
  });

  it("maps defenses conditional", () => {
    expect(mapFixture("tst.dnd5e").conditional).toEqual([]);
  });

  it("maps companion attributes, saves, skills and portrait location", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.companion.name).toBe("");
    expect(s.companion.attributes).toEqual({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });
    expect(s.companion.saves).toHaveLength(6);
    expect(s.companion.saves[0]).toEqual({ ability: "strength", value: 0 });
    expect(s.companion.skills).toHaveLength(18);
    expect(s.companion.skills[0]).toEqual({ name: "Acrobatics", value: 0 });
    expect(s.companion.portraitLocation).toBe("local");
  });

  it("maps equipment storages and items with identifiers", () => {
    const s = mapFixture("tst.dnd5e");
    expect(s.storages).toEqual(["#1", "#2"]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      identifier: "ddd7c3bd-bc3b-4218-bb6b-0feac5576609",
      itemId: "ID_WOTC_PHB_ITEM_ABACUS",
      name: "Abacus",
      amount: 1,
      equipped: false,
      detailsName: "",
      notes: "",
    });
  });

  it("maps equipped items with locations and amounts", () => {
    const s = mapFixture("Meepo.dnd5e");
    const shortsword = s.items.find((i) => i.identifier === "499e1747-79a0-45bb-a19a-ccf0c542fe29")!;
    expect(shortsword.equipped).toBe(true);
    expect(shortsword.location).toBe("Primary Hand");
    const potion = s.items.find((i) => i.name === "Potion of Healing")!;
    expect(potion.amount).toBe(5);
    expect(potion.equipped).toBe(false);
  });

  it("maps restricted sources", () => {
    const s = mapFixture("Meepo.dnd5e");
    expect(s.restrictedSources).toContain("ID_WOTC_SOURCE_AL_TYRANNY_OF_DRAGONS");
    expect(mapFixture("tst.dnd5e").restrictedSources).toEqual([]);
  });

  it("maps spellcasting blocks without losing data", () => {
    const s = mapFixture("Meepo.dnd5e");
    expect(s.spellcasting).toHaveLength(1);
    const paladin = s.spellcasting[0]!;
    expect(paladin).toMatchObject({
      name: "Paladin",
      ability: "Charisma",
      attack: "6",
      dc: "14",
      source: "ID_WOTC_PHB_CLASS_FEATURE_PALADIN_SPELLCASTING",
    });
    expect(paladin.slots.s1).toBe("4");
    expect(paladin.slots.s9).toBe("0");
    expect(paladin.cantrips).toEqual([]);
    expect(paladin.spells).toHaveLength(26);
    expect(paladin.spells[0]).toMatchObject({ name: "Bless", level: "1", id: "ID_PHB_SPELL_BLESS", prepared: true, known: false });
    expect(paladin.spells[4]).toMatchObject({
      name: "Protection from Evil and Good",
      prepared: true,
      alwaysPrepared: true,
      known: true,
    });
  });

  it("maps attacks with identifiers", () => {
    const s = mapFixture("Meepo.dnd5e");
    expect(s.attacks).toHaveLength(3);
    expect(s.attacks[0]).toMatchObject({
      identifier: "499e1747-79a0-45bb-a19a-ccf0c542fe29",
      name: "Shortsword",
      range: "5 ft",
      attack: "+6 vs AC",
      damage: "1d6+3 piercing",
      displayed: true,
      ability: "Strength",
    });
  });

  it("maps every document without throwing and keeps sum counts consistent", () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    for (const file of FIXTURES) {
      const s = mapFixture(file);
      expect(s.sum.elements.length, file).toBe(s.sum.elementCount);
      expect(s.sum.elements.length, file).toBeGreaterThan(0);
      expect(s.levelCount, file).toBeGreaterThan(0);
    }
  }, 120_000);
});
