/**
 * Detail DTO tests: the client-facing character view must expose the pinned
 * shape and fields of the character detail contract.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { type ElementLibrary } from "../content/library.js";
import { REVIEWED_PROFILE_PATHS } from "../content/equipment/reviewed-profile.test-support.js";
import { ID, buildCharacter, select } from "../testing/character-factory.js";
import { buildCharacterDetail } from "./detail.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "./selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

let library: ElementLibrary;
let reviewedLibrary: ElementLibrary;

function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

function buildSpike(service: CharacterService): void {
  service.createCharacter("Spike");
  service.setAbilities("Spike", {
    strength: 15,
    dexterity: 13,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
  });
  let state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
  state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");
  state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
}

beforeAll(async () => {
  [library, reviewedLibrary] = await Promise.all([
    buildCorpusLibrary(),
    buildCorpusLibrary((path) => REVIEWED_PROFILE_PATHS.has(path)),
  ]);
}, 120_000);

describe("detail DTO (pinned contract)", () => {
  it("the fresh-character detail carries the pinned summary fields", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Fresh");
    const detail = buildCharacterDetail(service.getCharacter("Fresh"), library);
    expect(detail).toMatchObject({
      name: "Fresh",
      playerName: "Player One",
      gender: "Male",
      race: "",
      class: "",
      background: "",
      level: 1,
      experience: 0,
      armorClass: 10,
      initiative: 0,
      speed: 0,
      proficiency: 2,
      loadWarning: null,
      loadIssues: [],
      personalityTraits: "",
      ideals: "",
      bonds: "",
      flaws: "",
      rulesetMode: "all",
    });
    expect(detail.registeredElements.map((e) => e.id)).toEqual([
      "ID_LEVEL_1",
      "ID_INTERNAL_GRANTS_CHARACTER_BASE",
      "ID_INTERNAL_GRANTS_SPELLCASTING_BASE",
      "ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE",
      "ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER",
      "ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER",
      "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING",
      "ID_INTERNAL_OPTION_ALLOW_FEATS",
    ]);
    expect(detail.registeredElements[0]).toMatchObject({ name: "1", type: "Level", source: "Internal" });
  });

  it("abilities are an array with base/additional/final/modifier and bonus sources", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Spike");
    service.setAbilities("Spike", {
      strength: 15,
      dexterity: 13,
      constitution: 14,
      intelligence: 10,
      wisdom: 12,
      charisma: 8,
    });
    let state = service.getCharacter("Spike");
    service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
    state = service.getCharacter("Spike");
    service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");

    const detail = buildCharacterDetail(service.getCharacter("Spike"), library);
    const byName = Object.fromEntries(detail.abilities.map((a) => [a.abbreviation, a]));
    expect(detail.abilities.map((a) => a.abbreviation)).toEqual(["Str", "Dex", "Con", "Int", "Wis", "Cha"]);
    expect(byName.Con).toMatchObject({
      name: "Constitution",
      baseScore: 14,
      additionalScore: 2,
      finalScore: 16,
      modifier: 3,
      additionalSummary: "Dwarf (2)",
      bonusSources: [{ source: "Dwarf", value: 2 }],
    });
    expect(byName.Wis).toMatchObject({
      baseScore: 12,
      additionalScore: 1,
      finalScore: 13,
      modifier: 1,
      additionalSummary: "Hill Dwarf (1)",
      bonusSources: [{ source: "Hill Dwarf", value: 1 }],
    });
    expect(byName.Str).toMatchObject({ baseScore: 15, additionalScore: 0, finalScore: 15, modifier: 2 });
  });

  it("selection rules group consecutive wrappers and mark Deity optional", () => {
    const service = new CharacterService(undefined, library);
    buildSpike(service);
    const detail = buildCharacterDetail(service.getCharacter("Spike"), library);
    const rules = detail.selectionRules;
    const fighterSkills = rules.filter((r) => r.name === "Skill Proficiency (Fighter)");
    expect(fighterSkills).toHaveLength(1);
    expect(fighterSkills[0]).toMatchObject({
      type: "Proficiency",
      selectionCount: 2,
      isList: false,
      isOptional: false,
      hasSelection: false,
      selectedElementIds: [null, null],
      selectedElementNames: [null, null],
      wasInvalidated: false,
      previousElementId: null,
      previousElementName: null,
      spellcastingName: null,
    });
    const deity = rules.find((r) => r.type === "Deity")!;
    expect(deity.isOptional).toBe(true);
    const race = rules.find((r) => r.type === "Race")!;
    expect(race.hasSelection).toBe(true);
    expect(race.selectedElementIds).toEqual(["ID_SRD_RACE_DWARF"]);
    expect(race.selectedElementNames).toEqual(["Dwarf"]);
  });

  it("statistics stubs match the pinned values for the spike: AC, initiative, speed, proficiency", () => {
    const service = new CharacterService(undefined, library);
    buildSpike(service);
    service.levelUp("Spike");
    service.levelUp("Spike");
    const detail = buildCharacterDetail(service.getCharacter("Spike"), library);
    expect(detail).toMatchObject({ armorClass: 11, initiative: 1, speed: 25, proficiency: 2 });
  });

  it("selection options carry the pinned element DTO", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Opts");
    const state = service.getCharacter("Opts");
    const raceRule = ruleOfType(pendingSelectionRules(state), "Race");
    const options = selectionOptions(state, library, raceRule);
    const dwarf = options.find((o) => o.id === "ID_SRD_RACE_DWARF")!;
    expect(dwarf).toMatchObject({ name: "Dwarf", kind: "element", canInspect: true, detail: null });
    expect(dwarf.source).toBe("Player’s Handbook");
  });

  it("propagates authored optional selects and reports zero legal Variant Feature options", () => {
    const { service, id } = buildCharacter(reviewedLibrary, {
      id: "test",
      classId: ID.CLASS_FIGHTER,
    });
    select(service, id, "Background", "ID_BACKGROUND_ACOLYTE");

    const detail = buildCharacterDetail(service.getCharacter(id), reviewedLibrary);
    expect(detail.selectionRules.find((rule) => rule.name === "Variant Feature")).toMatchObject({
      type: "Background Feature",
      isOptional: true,
      hasSelection: false,
      hasAvailableOptions: false,
    });
  });
});
