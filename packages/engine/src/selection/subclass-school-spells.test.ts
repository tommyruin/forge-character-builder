/**
 * The 2014 Arcane Trickster and Eldritch Knight learn three 1st-level spells
 * at level 3 through two same-named selects: one free Wizard spell and two
 * restricted to the subclass's schools (Enchantment/Illusion, respectively
 * Abjuration/Evocation). Merged by their shared label, all three slots
 * resolved to the free select, and the Magic tab browsed nothing at all —
 * the browse list expression ("Wizard,(Enchantment||Illusion)") filters by
 * school, which spell tags did not carry. Their cantrips (any Wizard cantrip)
 * must browse every school, too.
 *
 * Also here: Giant Power's edition-conditional cantrip pair, where a 2024
 * barbarian's wrapper must resolve to the 2024 select, not the first one.
 *
 * Corpus content; the synthetic identity cases live in
 * authored-select-identity.test.ts.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

const ROGUE = "ID_WOTC_PHB_CLASS_ROGUE";
const FIGHTER = "ID_WOTC_PHB_CLASS_FIGHTER";
const ARCANE_TRICKSTER = "ID_WOTC_PHB_ARCHETYPE_ARCANE_TRICKSTER";
const ELDRITCH_KNIGHT = "ID_WOTC_PHB_ARCHETYPE_FIGHTER_ELDRITCH_KNIGHT";

const MAGIC_MISSILE = "ID_PHB_SPELL_MAGIC_MISSILE";
const SHIELD = "ID_PHB_SPELL_SHIELD";
const CHARM_PERSON = "ID_PHB_SPELL_CHARM_PERSON";
const DISGUISE_SELF = "ID_PHB_SPELL_DISGUISE_SELF";
const SLEEP = "ID_PHB_SPELL_SLEEP";
const FIRE_BOLT = "ID_PHB_SPELL_FIRE_BOLT";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

interface Built {
  service: CharacterService;
  id: string;
}

function subclassAt3(classId: string, archetypeId: string, ruleset?: "2014" | "2024"): Built {
  const service = new CharacterService(undefined, library, { rng: seededRng(11) });
  const id = service.createCharacter("school-spells").id;
  if (ruleset !== undefined) service.setRulesetMode(id, ruleset);
  service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === type)!;
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Class", classId);
  while (service.getCharacter(id).level < 3) service.levelUp(id);
  pick("Archetype", archetypeId);
  return { service, id };
}

function groups(built: Built, name: string, id = built.id) {
  return built.service.getCharacterDetail(id).selectionRules.filter((rule) => rule.name === name && rule.requiredLevel === 3);
}

function pending(state: CharacterState, name: string): SelectionRule[] {
  return pendingSelectionRules(state).filter((rule) => rule.name === name);
}

function browse(built: Built, identifier: string) {
  const dto = built.service.getSpellBrowse(built.id, identifier);
  const status = new Map(dto.spells.map((spell) => [spell.id, spell.status]));
  const learnableSchools = new Set(dto.spells.filter((spell) => spell.status === "learnable").map((spell) => spell.school));
  return { dto, status, learnableSchools };
}

describe("2014 Arcane Trickster level-3 spells", () => {
  it("splits the free spell from the two Enchantment/Illusion spells", () => {
    const built = subclassAt3(ROGUE, ARCANE_TRICKSTER, "2014");
    expect(groups(built, "Spell (Arcane Trickster)").map((group) => group.selectionCount)).toEqual([1, 2]);
    expect(groups(built, "Cantrip (Arcane Trickster)").map((group) => group.selectionCount)).toEqual([2]);

    const state = built.service.getCharacter(built.id);
    const [free, restricted] = pending(state, "Spell (Arcane Trickster)");
    const freeOptions = selectionOptions(state, library, free!).map((option) => option.id);
    const restrictedOptions = selectionOptions(state, library, restricted!).map((option) => option.id);
    expect(freeOptions).toEqual(expect.arrayContaining([MAGIC_MISSILE, SHIELD, CHARM_PERSON]));
    expect(restrictedOptions).toEqual(expect.arrayContaining([CHARM_PERSON, DISGUISE_SELF, SLEEP]));
    expect(restrictedOptions).not.toContain(MAGIC_MISSILE);
    expect(restrictedOptions).not.toContain(SHIELD);
  });

  it("browses spells for both groups, restricting only the school-bound one", () => {
    const built = subclassAt3(ROGUE, ARCANE_TRICKSTER, "2014");
    const [free, restricted] = groups(built, "Spell (Arcane Trickster)");

    const freeBrowse = browse(built, free!.identifier);
    expect(freeBrowse.status.get(MAGIC_MISSILE)).toBe("learnable");
    expect(freeBrowse.status.get(CHARM_PERSON)).toBe("learnable");
    expect(freeBrowse.learnableSchools.size).toBeGreaterThan(2);

    const restrictedBrowse = browse(built, restricted!.identifier);
    expect(restrictedBrowse.dto.selectionCount).toBe(2);
    expect(restrictedBrowse.status.get(CHARM_PERSON)).toBe("learnable");
    expect(restrictedBrowse.status.get(DISGUISE_SELF)).toBe("learnable");
    expect(restrictedBrowse.status.has(MAGIC_MISSILE)).toBe(false);
    expect([...restrictedBrowse.learnableSchools].sort()).toEqual(["Enchantment", "Illusion"]);
  });

  it("browses cantrips of every school", () => {
    const built = subclassAt3(ROGUE, ARCANE_TRICKSTER, "2014");
    const [cantrips] = groups(built, "Cantrip (Arcane Trickster)");
    const cantripBrowse = browse(built, cantrips!.identifier);
    expect(cantripBrowse.status.get(FIRE_BOLT)).toBe("learnable");
    expect(cantripBrowse.learnableSchools).toContain("Evocation");
    expect(cantripBrowse.learnableSchools).toContain("Illusion");
  });

  it("selects, replaces, clears, and survives export/import and a delevel undo", () => {
    const built = subclassAt3(ROGUE, ARCANE_TRICKSTER, "2014");
    const { service, id } = built;
    const [free, restricted] = groups(built, "Spell (Arcane Trickster)");

    expect(() => service.setSelection(id, restricted!.identifier, MAGIC_MISSILE, 1)).toThrow(/not eligible/);
    service.setSelection(id, free!.identifier, MAGIC_MISSILE);
    service.setSelection(id, restricted!.identifier, CHARM_PERSON, 1);
    service.setSelection(id, restricted!.identifier, DISGUISE_SELF, 2);
    service.setSelection(id, restricted!.identifier, SLEEP, 1);
    const picked = [[MAGIC_MISSILE], [SLEEP, DISGUISE_SELF]];
    expect(groups(built, "Spell (Arcane Trickster)").map((group) => group.selectedElementIds)).toEqual(picked);
    expect(browse(built, restricted!.identifier).status.get(SLEEP)).toBe("selected");

    service.importCharacterXml("reimported", service.exportCharacterXml(id));
    expect(groups(built, "Spell (Arcane Trickster)", "reimported").map((group) => group.selectedElementIds)).toEqual(picked);

    service.delevel(id, { mode: "last" });
    expect(groups(built, "Spell (Arcane Trickster)")).toEqual([]);
    service.undoDelevel(id);
    expect(groups(built, "Spell (Arcane Trickster)").map((group) => group.selectedElementIds)).toEqual(picked);

    const [, again] = groups(built, "Spell (Arcane Trickster)");
    service.clearSelection(id, again!.identifier, 2);
    expect(groups(built, "Spell (Arcane Trickster)").map((group) => group.selectedElementIds)).toEqual([[MAGIC_MISSILE], [SLEEP, null]]);
  });
});

describe("2014 Eldritch Knight level-3 spells", () => {
  it("splits the free spell from the two Abjuration/Evocation spells", () => {
    const built = subclassAt3(FIGHTER, ELDRITCH_KNIGHT, "2014");
    const [free, restricted] = groups(built, "Spellcasting (Eldritch Knight)");
    expect(groups(built, "Spellcasting (Eldritch Knight)").map((group) => group.selectionCount)).toEqual([1, 2]);

    expect(() => built.service.setSelection(built.id, restricted!.identifier, CHARM_PERSON, 1)).toThrow(/not eligible/);
    built.service.setSelection(built.id, free!.identifier, CHARM_PERSON);
    built.service.setSelection(built.id, restricted!.identifier, SHIELD, 1);

    const restrictedBrowse = browse(built, restricted!.identifier);
    expect(restrictedBrowse.status.get(SHIELD)).toBe("selected");
    expect(restrictedBrowse.status.get(MAGIC_MISSILE)).toBe("learnable");
    expect([...restrictedBrowse.learnableSchools].sort()).toEqual(["Abjuration", "Evocation"]);
    expect(browse(built, free!.identifier).status.get(CHARM_PERSON)).toBe("selected");
  });
});

describe("2024 subclass casters keep their single level-3 group", () => {
  it("2024 Arcane Trickster: three slots, one group, spells to browse", () => {
    const built = subclassAt3("ID_WOTC_PHB24_CLASS_ROGUE", "ID_WOTC_PHB24_ARCHETYPE_ROGUE_ARCANE_TRICKSTER", "2024");
    const spellGroups = groups(built, "Spell (Arcane Trickster)");
    expect(spellGroups.map((group) => group.selectionCount)).toEqual([3]);
    expect(browse(built, spellGroups[0]!.identifier).status.get("ID_WOTC_PHB24_SPELL_CHARM_PERSON")).toBe("learnable");
  });
});

describe("Giant Power's edition-conditional cantrip", () => {
  function giantPowerOptions(classId: string, ruleset?: "2014"): string[] {
    const built = subclassAt3(classId, "ID_WOTC_GOTG_ARCHETYPE_BARBARIAN_PATH_OF_THE_GIANT", ruleset);
    const state = built.service.getCharacter(built.id);
    const rules = pending(state, "Cantrip (Giant Power)");
    expect(rules).toHaveLength(1);
    return selectionOptions(state, library, rules[0]!).map((option) => option.id).sort();
  }

  it("offers a 2014 barbarian the 2014 cantrips", () => {
    expect(giantPowerOptions("ID_WOTC_PHB_CLASS_BARBARIAN", "2014")).toEqual(["ID_PHB_SPELL_DRUIDCRAFT", "ID_PHB_SPELL_THAUMATURGY"]);
  });

  it("offers a 2024 barbarian the 2024 cantrips, not the first-authored 2014 pair", () => {
    expect(giantPowerOptions("ID_WOTC_PHB24_CLASS_BARBARIAN")).toEqual([
      "ID_WOTC_PHB24_SPELL_DRUIDCRAFT",
      "ID_WOTC_PHB24_SPELL_THAUMATURGY",
    ]);
  });
});
