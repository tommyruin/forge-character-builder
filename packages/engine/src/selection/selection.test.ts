import { beforeAll, describe, expect, it } from "vitest";
import { parseDnd5e } from "../dnd5e/document.js";
import { CharacterService } from "../character/service.js";
import { type RegisteredElement } from "../character/state.js";
import { getCharacterAdjustments } from "../character/options.js";
import { type ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import { pendingSelectionRules, selectionOptions, setSelection, selectionRuleFor } from "./selection.js";
import { buildCharacterDetail } from "./detail.js";
import { buildRogue5, select } from "../testing/character-factory.js";
import type { SelectionRule } from "./selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

const REVIEWED_PROFILE_PATHS = new Set([
  "system/system-elements.xml",
  "system/system-proxies.xml",
  "testdata/core/ALE.xml",
  "testdata/core/internal.xml",
  "testdata/core/players-handbook/source.xml",
  "testdata/core/dungeon-masters-guide/source.xml",
  "testdata/core/monster-manual/source.xml",
  "testdata/core/players-handbook/archetypes/fighter-champion.xml",
  "testdata/core/players-handbook/archetypes/wizard-evocation.xml",
  "testdata/core/players-handbook/backgrounds/background-acolyte.xml",
  "testdata/core/players-handbook/deities.xml",
  "testdata/core/players-handbook/languages.xml",
  "testdata/core/players-handbook/proficiencies.xml",
  "testdata/core/players-handbook/spells.xml",
  "testdata/supplements/extra-life/one-grung-above.xml",
  "testdata/supplements/xanathars-guide-to-everything/source.xml",
  "testdata/supplements/xanathars-guide-to-everything/spells.xml",
  "testdata/supplements/xanathars-guide-to-everything/archetypes/ranger-gloomstalker.xml",
  ...[
    "barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
  ].map((name) => `testdata/core/players-handbook/classes/class-${name}.xml`),
  ...[
    "dragonborn", "dwarf", "elf", "gnome", "halfelf", "halfling", "halforc", "human", "tiefling",
  ].map((name) => `testdata/core/players-handbook/races/race-${name}.xml`),
  ...["armor", "gear", "instrument", "packs", "tools", "weapons"].map((name) => `testdata/core/players-handbook/items/items-${name}.xml`),
  ...["armor", "poison", "potions", "rings", "rods", "staffs", "wands", "weapons", "wondrous"].map((name) => `testdata/core/dungeon-masters-guide/items/items-${name}.xml`),
]);


let library: ElementLibrary;
let reviewedLibrary: ElementLibrary;

const ABILITIES = {
  strength: 15,
  dexterity: 13,
  constitution: 14,
  intelligence: 10,
  wisdom: 12,
  charisma: 8,
};

/** Flat sequence of every node under the race wrapper: wrappers by registered, elements by id. */
function flattenSeq(nodes: RegisteredElement[]): string[] {
  const out: string[] = [];
  const walk = (node: RegisteredElement): void => {
    out.push(node.registered && node.registered !== "" ? node.registered : node.id);
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

beforeAll(async () => {
  [library, reviewedLibrary] = await Promise.all([
    buildCorpusLibrary(),
    buildCorpusLibrary((path) => REVIEWED_PROFILE_PATHS.has(path)),
  ]);
}, 120_000);

describe("selection engine against the real corpus and fixtures", () => {
  it.each([
    {
      name: "Hill Dwarf tool proficiency",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-dwarf-tools";
        service.createCharacter(id);
        service.setAbilities(id, ABILITIES);
        let state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
        state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");
        state = service.getCharacter(id);
        const rule = pendingSelectionRules(state).find((candidate) => candidate.name === "Dwarven Tool Proficiency");
        if (!rule) throw new Error("Dwarven Tool Proficiency rule is not pending");
        return selectionOptions(state, reviewedLibrary, rule).map((option) => option.id);
      },
      expected: [
        "ID_PROFICIENCY_TOOL_PROFICIENCY_BREWERS_SUPPLIES",
        "ID_PROFICIENCY_TOOL_PROFICIENCY_MASONS_TOOLS",
        "ID_PROFICIENCY_TOOL_PROFICIENCY_SMITHS_TOOLS",
      ],
    },
    {
      name: "Fighter 3 Martial Archetype",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-fighter-archetype";
        service.createCharacter(id);
        service.setAbilities(id, ABILITIES);
        let state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
        service.levelUp(id);
        service.levelUp(id);
        state = service.getCharacter(id);
        const rule = ruleOfType(pendingSelectionRules(state), "Archetype");
        return selectionOptions(state, reviewedLibrary, rule).map((option) => option.id);
      },
      expected: ["ID_WOTC_PHB_ARCHETYPE_CHAMPION"],
    },
    {
      name: "Wizard 2 Arcane Tradition",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-wizard-archetype";
        service.createCharacter(id);
        service.setAbilities(id, { ...ABILITIES, intelligence: 14 });
        let state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_WIZARD");
        service.levelUp(id);
        state = service.getCharacter(id);
        const rule = ruleOfType(pendingSelectionRules(state), "Archetype");
        return selectionOptions(state, reviewedLibrary, rule).map((option) => option.id);
      },
      expected: ["ID_WOTC_PHB_ARCHETYPE_WIZARD_SCHOOL_OF_EVOCATION"],
    },
    {
      name: "Wizard 4 ability score improvement",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-wizard-improvement";
        service.createCharacter(id);
        service.setAbilities(id, { ...ABILITIES, intelligence: 14 });
        let state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_WIZARD");
        for (let level = 2; level <= 4; level++) service.levelUp(id);
        state = service.getCharacter(id);
        const rule = pendingSelectionRules(state).find((candidate) => candidate.name === "Improvement Option (Wizard 4)");
        if (!rule) throw new Error("Wizard 4 improvement rule is not pending");
        return selectionOptions(state, reviewedLibrary, rule).map((option) => option.id);
      },
      // The improvement offers the feat variant alongside the ability score
      // increase whenever the feats optional rule is on (default). The
      // original pin predated the feat clone gaining its select machinery.
      expected: ["ID_INTERNAL_CLASS_FEATURE_FEAT_4_WIZARD", "ID_INTERNAL_CLASS_FEATURE_ASI_4_WIZARD"],
    },
    {
      name: "Fighter 2 eligible Rogue multiclass",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-multiclass";
        service.createCharacter(id);
        service.setAbilities(id, ABILITIES);
        let state = service.getCharacter(id);
        service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
        service.levelUp(id);
        service.levelUpMode(id, { mode: "new-multiclass" });
        state = service.getCharacter(id);
        const rule = ruleOfType(pendingSelectionRules(state), "Multiclass");
        return selectionOptions(state, reviewedLibrary, rule).map((option) => option.id);
      },
      expected: ["ID_WOTC_PHB_MULTICLASS_BARBARIAN", "ID_WOTC_PHB_MULTICLASS_ROGUE"],
    },
    {
      name: "Familiar Selection adjustment",
      inspect(service: CharacterService): string[] {
        const id = "shipped-base-familiar";
        service.createCharacter(id);
        return getCharacterAdjustments(service.getCharacter(id), reviewedLibrary)
          .filter((adjustment) => adjustment.name === "Familiar Selection")
          .map((adjustment) => adjustment.elementId);
      },
      expected: ["ID_INTERNAL_ITEM_PROXY_FAMILIAR_SELECTION"],
    },
  ])("exposes the reviewed shipped-base choice: $name", ({ inspect, expected }) => {
    const service = new CharacterService(undefined, reviewedLibrary);
    expect(inspect(service)).toEqual(expected);
  });

  it("selecting the Wizard 4 improvement creates two level-four ability picks", () => {
    const service = new CharacterService(undefined, reviewedLibrary);
    const id = "wizard-four-asi";
    service.createCharacter(id);
    service.setAbilities(id, { ...ABILITIES, intelligence: 14 });
    let state = service.getCharacter(id);
    service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_WIZARD");
    for (let level = 2; level <= 4; level++) service.levelUp(id);
    state = service.getCharacter(id);
    const improvement = pendingSelectionRules(state).find(
      (candidate) => candidate.name === "Improvement Option (Wizard 4)",
    )!;

    service.setSelection(id, improvement.identifier, "ID_INTERNAL_CLASS_FEATURE_ASI_4_WIZARD");
    state = service.getCharacter(id);
    const picks = pendingSelectionRules(state).filter(
      (candidate) => candidate.name === "Ability Score Increase (WIZARD 4)",
    );

    expect(picks).toHaveLength(2);
    expect(picks.map((pick) => pick.requiredLevel)).toEqual([4, 4]);
    expect(selectionOptions(state, reviewedLibrary, picks[0]!).map((option) => option.id)).toEqual([
      "ID_INTERNAL_ASI_CHARISMA",
      "ID_INTERNAL_ASI_CONSTITUTION",
      "ID_INTERNAL_ASI_DEXTERITY",
      "ID_INTERNAL_ASI_INTELLIGENCE",
      "ID_INTERNAL_ASI_STRENGTH",
      "ID_INTERNAL_ASI_WISDOM",
    ]);
  });

  it("allows both ability picks to target the same score for a +2", () => {
    const service = new CharacterService(undefined, reviewedLibrary);
    const id = "wizard-four-asi-double";
    service.createCharacter(id);
    service.setAbilities(id, { ...ABILITIES, intelligence: 14 });
    let state = service.getCharacter(id);
    service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_WIZARD");
    for (let level = 2; level <= 4; level++) service.levelUp(id);
    state = service.getCharacter(id);
    const improvement = pendingSelectionRules(state).find(
      (candidate) => candidate.name === "Improvement Option (Wizard 4)",
    )!;
    service.setSelection(id, improvement.identifier, "ID_INTERNAL_CLASS_FEATURE_ASI_4_WIZARD");

    const picksOf = (current: ReturnType<CharacterService["getCharacter"]>): SelectionRule[] =>
      pendingSelectionRules(current).filter(
        (candidate) => candidate.name === "Ability Score Increase (WIZARD 4)",
      );
    state = service.getCharacter(id);
    service.setSelection(id, picksOf(state)[0]!.identifier, "ID_INTERNAL_ASI_INTELLIGENCE");

    // ASI elements allow duplicates: the remaining pick still offers Intelligence.
    state = service.getCharacter(id);
    const secondPick = picksOf(state)[0]!;
    expect(selectionOptions(state, reviewedLibrary, secondPick).map((option) => option.id)).toContain(
      "ID_INTERNAL_ASI_INTELLIGENCE",
    );
    service.setSelection(id, secondPick.identifier, "ID_INTERNAL_ASI_INTELLIGENCE");

    state = service.getCharacter(id);
    const registered = state.sum.elements.filter((entry) => entry.id === "ID_INTERNAL_ASI_INTELLIGENCE");
    expect(registered).toHaveLength(2);
    expect(computeStatistics(state, reviewedLibrary)["intelligence:score"]).toBe(16);
  });

  it("selecting the Rock Gnome registers the Grants markers and the default options", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Spike");
    service.setAbilities("Spike", ABILITIES);

    const state = service.getCharacter("Spike");
    const rules = pendingSelectionRules(state);
    const raceRule = ruleOfType(rules, "Race");
    const options = selectionOptions(state, library, raceRule);
    const optionIds = options.map((o) => o.id);
    expect(optionIds).toContain("ID_SRD_RACE_DWARF");
    expect(optionIds).toContain("ID_RACE_GNOME");

    service.setSelection("Spike", raceRule.identifier, "ID_RACE_GNOME");
    let after = service.getCharacter("Spike");

    const level1 = after.elements.find((n) => n.type === "Level")!;
    expect(level1.children[0]!.registered).toBe("ID_RACE_GNOME");
    expect(after.race).toBe("Gnome");
    const pendingAfterRace = pendingSelectionRules(after);
    expect(pendingAfterRace.map((r) => r.type)).toContain("Sub Race");

    const subRaceRule = ruleOfType(pendingAfterRace, "Sub Race");
    service.setSelection("Spike", subRaceRule.identifier, "ID_SUB_RACE_ROCK_GNOME");
    after = service.getCharacter("Spike");
    expect(after.race).toBe("Rock Gnome");

    // The captured gnome subtree (probed live; tst.dnd5e predates the marker
    // grants): the Grants marker registers after the languages.
    const gnomeLevel = after.elements.find((n) => n.type === "Level")!;
    expect(flattenSeq([gnomeLevel.children[0]!])).toEqual([
      "ID_RACE_GNOME",
      "ID_SIZE_SMALL",
      "ID_VISION_DARKVISION",
      "ID_RACIAL_TRAIT_GNOME_CUNNING",
      "ID_LANGUAGE_COMMON",
      "ID_LANGUAGE_GNOMISH",
      "ID_INTERNAL_GRANT_RACE_GNOME",
      "ID_RACIAL_TRAIT_GNOME_SUBRACE",
      "ID_SUB_RACE_ROCK_GNOME",
      "ID_RACIAL_TRAIT_ARTIFICERS_LORE",
      "ID_RACIAL_TRAIT_TINKER",
      "ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS",
    ]);
    expect(after.sum.elementCount).toBe(20);
    expect(after.registeredCount).toBe(5);

    const xml = service.exportCharacterXml("Spike");
    expect(() => parseDnd5e(xml)).not.toThrow();
    const reimported = service.importCharacterXml("Spike2", xml);
    const reimportedLevel = reimported.elements.find((n) => n.type === "Level")!;
    expect(flattenSeq([reimportedLevel.children[0]!])).toEqual(flattenSeq([gnomeLevel.children[0]!]));
    expect(reimported.race).toBe("Rock Gnome");
    expect(reimported.registeredCount).toBe(5);
  });

  it("the pure setSelection transforms the state identically (no document)", () => {
    const service = new CharacterService();
    service.createCharacter("S2");
    let state = service.getCharacter("S2");
    const raceRule = ruleOfType(pendingSelectionRules(state), "Race");
    state = setSelection(state, library, raceRule, "ID_RACE_GNOME");
    const level1 = state.elements.find((n) => n.type === "Level")!;
    expect(level1.children[0]!.registered).toBe("ID_RACE_GNOME");
    expect(state.race).toBe("Gnome");
    expect(state.sum.elementCount).toBe(16);

    const subRaceRule = ruleOfType(pendingSelectionRules(state), "Sub Race");
    state = setSelection(state, library, subRaceRule, "ID_SUB_RACE_ROCK_GNOME");
    expect(state.race).toBe("Rock Gnome");
    expect(state.sum.elementCount).toBe(20);
    expect(state.sum.elements.map((e) => e.id)).toContain("ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS");
    expect(state.registeredCount).toBe(5);
  });

  it("the Dwarf race cascade builds the expected tree (marker grants + appended proficiencies)", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Dwarf");
    service.setAbilities("Dwarf", ABILITIES);
    let state = service.getCharacter("Dwarf");
    service.setSelection("Dwarf", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
    state = service.getCharacter("Dwarf");

    const level1 = state.elements.find((n) => n.type === "Level")!;
    expect(flattenSeq([level1.children[0]!])).toEqual([
      "ID_SRD_RACE_DWARF",
      "ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT",
      "ID_SIZE_MEDIUM",
      "ID_VISION_DARKVISION",
      "ID_LANGUAGE_COMMON",
      "ID_LANGUAGE_DWARVISH",
      "ID_INTERNAL_GRANT_RACE_DWARF",
      "ID_RACIAL_TRAIT_DWARVEN_RESILIENCE",
      "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_POISON",
      "ID_RACIAL_TRAIT_DWARVEN_COMBAT_TRAINING",
      "ID_PROFICIENCY_WEAPON_PROFICIENCY_BATTLEAXE",
      "ID_PROFICIENCY_WEAPON_PROFICIENCY_HANDAXE",
      "ID_PROFICIENCY_WEAPON_PROFICIENCY_LIGHT_HAMMER",
      "ID_PROFICIENCY_WEAPON_PROFICIENCY_WARHAMMER",
      "ID_RACIAL_TRAIT_DWARVEN_TOOL_PROFICIENCY",
      "",
      "ID_RACIAL_TRAIT_STONECUNNING",
      "ID_RACIAL_TRAIT_DWARVEN_SUBRACE",
      "",
    ]);
    expect(state.sum.elements.map((e) => e.id)).toContain("ID_INTERNAL_GRANT_RACE_DWARF");
  });

  it("writes fixture-pinned checksums for selection wrappers spawned by selected elements", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Checksums");
    service.setAbilities("Checksums", ABILITIES);
    let state = service.getCharacter("Checksums");
    service.setSelection("Checksums", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
    state = service.getCharacter("Checksums");
    service.setSelection("Checksums", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");

    const xml = service.exportCharacterXml("Checksums");
    expect(xml).toContain('name="Dwarven Tool Proficiency" requiredLevel="1" checksum="ce831231"');
    expect(xml).toContain('name="Dwarven Subrace" requiredLevel="1" checksum="d463e2d5"');
    expect(xml).toContain('name="Skill Proficiency (Fighter)" requiredLevel="1" number="1" checksum="5f3c7a8a"');
    expect(xml).toContain('name="Skill Proficiency (Fighter)" requiredLevel="1" number="2" checksum="c6352b30"');
    expect(xml).toContain('name="Fighting Style" requiredLevel="1" checksum="2ebc9f3b"');
  });

  it("the class selection registers the multiclass grants and appends the fighter's armor/weapon proficiency subtrees", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Spike");
    service.setAbilities("Spike", ABILITIES);
    let state = service.getCharacter("Spike");
    service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
    state = service.getCharacter("Spike");
    service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");
    state = service.getCharacter("Spike");
    service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
    state = service.getCharacter("Spike");

    const [multiclassOption, featsOption] = state.elements;
    expect(multiclassOption!.id).toBe("ID_INTERNAL_OPTION_ALLOW_MULTICLASSING");
    expect(multiclassOption!.children.map((c) => c.id)).toEqual(["ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING"]);
    expect(featsOption!.children).toHaveLength(0);

    const level1 = state.elements.find((n) => n.type === "Level")!;
    const base = level1.children.find((n) => n.id === "ID_INTERNAL_GRANTS_CHARACTER_BASE")!;
    expect(base.children.map((c) => c.id)).toEqual(["ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20"]);

    const classWrapper = level1.children.find((n) => n.type === "Class")!;
    const classChildren = classWrapper.children;
    expect(classChildren[classChildren.length - 1]!.id).toBe("ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE");

    const fighterIds = flattenSeq([classWrapper]);
    expect(fighterIds).toContain("ID_SCAG_PROFICIENCY_ARMOR_PROFICIENCY_SPIKED_ARMOR");
    expect(fighterIds).toContain("ID_WOTC_ERLW_WEAPON_PROFICIENCY_DOUBLE_BLADED_SCIMITAR");
    expect(fighterIds).toContain("ID_WOTC_PHB24_PROFICIENCY_WEAPON_PROFICIENCY_MUSKET");
    expect(fighterIds).toContain("ID_WOTC_PHB24_PROFICIENCY_WEAPON_PROFICIENCY_PISTOL");

    const sum = state.sum.elements.map((e) => e.id);
    const raceLast = sum.indexOf("ID_RACIAL_TRAIT_DWARVEN_TOUGHNESS");
    expect(sum.indexOf("ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20")).toBe(2);
    expect(sum.indexOf("ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING")).toBe(sum.indexOf("ID_INTERNAL_OPTION_ALLOW_MULTICLASSING") + 1);
    expect(sum.indexOf("ID_LEVEL_2")).toBe(-1);
    expect(sum.indexOf("ID_WOTC_PHB_CLASS_FIGHTER")).toBe(raceLast + 1);
    expect(sum[sum.length - 1]).toBe("ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE");
  });

  it("a class whose multiclass prerequisites are unmet registers no prereq or spellcasting grants", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Weak");
    service.setAbilities("Weak", { strength: 8, dexterity: 8, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    let state = service.getCharacter("Weak");
    service.setSelection("Weak", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
    state = service.getCharacter("Weak");

    const level1 = state.elements.find((n) => n.type === "Level")!;
    const classWrapper = level1.children.find((n) => n.type === "Class")!;
    const ids = flattenSeq([classWrapper]);
    expect(ids).not.toContain("ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE");
    const option = state.elements[0]!;
    expect(option.children.map((c) => c.id)).not.toContain("ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING");
    const base = level1.children.find((n) => n.id === "ID_INTERNAL_GRANTS_CHARACTER_BASE")!;
    expect(base.children.map((c) => c.id)).toEqual(["ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20"]);
  });

  it("replaces an already filled rule and removes the former subtree", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("C");
    const rule = ruleOfType(pendingSelectionRules(service.getCharacter("C")), "Race");
    service.setSelection("C", rule.identifier, "ID_RACE_GNOME");
    service.setSelection("C", rule.identifier, "ID_SRD_RACE_DWARF");
    const state = service.getCharacter("C");
    expect(state.sum.elements.map((entry) => entry.id)).not.toContain("ID_RACE_GNOME");
    expect(state.sum.elements.map((entry) => entry.id)).toContain("ID_SRD_RACE_DWARF");
    expect(state.race).toBe("Dwarf");
  });

  it("keeps the current selection visible when options are reopened", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Reopen");
    const raceRule = ruleOfType(pendingSelectionRules(service.getCharacter("Reopen")), "Race");
    service.setSelection("Reopen", raceRule.identifier, "ID_RACE_DRAGONBORN");

    const state = service.getCharacter("Reopen");
    const filledRule = selectionRuleFor(state, raceRule.identifier)!;
    expect(selectionOptions(state, library, filledRule).map((option) => option.id)).toContain("ID_RACE_DRAGONBORN");
  });

  it("filters a filled Dragonborn variant rule by its registered parent", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Dragonborn");
    const raceRule = ruleOfType(pendingSelectionRules(service.getCharacter("Dragonborn")), "Race");
    service.setSelection("Dragonborn", raceRule.identifier, "ID_RACE_DRAGONBORN");
    const state = service.getCharacter("Dragonborn");
    const variantRule = ruleOfType(pendingSelectionRules(state), "Race Variant");
    const options = selectionOptions(state, library, variantRule);
    expect(options.map((option) => option.id)).toContain("ID_WOTC_EGTW_RACE_VARIANT_DRAGONBORN_DRACONBLOOD");
    expect(options.map((option) => option.id)).not.toContain("ID_RACE_VARIANT_HUMAN_VARIANT");
  });

  it("offers and persists inline List choices for every list slot", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("ListChoices");
    const raceRule = ruleOfType(pendingSelectionRules(service.getCharacter("ListChoices")), "Race");
    service.setSelection("ListChoices", raceRule.identifier, "ID_RACE_DRAGONBORN");
    const classRule = ruleOfType(pendingSelectionRules(service.getCharacter("ListChoices")), "Class");
    service.setSelection("ListChoices", classRule.identifier, "ID_WOTC_PHB_CLASS_BARBARIAN");
    const backgroundRule = ruleOfType(pendingSelectionRules(service.getCharacter("ListChoices")), "Background");
    service.setSelection("ListChoices", backgroundRule.identifier, "ID_BACKGROUND_ACOLYTE");

    const idealRule = pendingSelectionRules(service.getCharacter("ListChoices"))
      .find((rule) => rule.type === "List" && rule.name === "Ideal")!;
    const idealOptions = selectionOptions(service.getCharacter("ListChoices"), library, idealRule);
    expect(idealOptions.map((option) => option.id)).toEqual(["1", "2", "3", "4", "5", "6"]);

    service.setSelection("ListChoices", idealRule.identifier, "5");
    const after = service.getCharacter("ListChoices");
    const selectedIdeal = selectionRuleFor(after, idealRule.identifier)!;
    expect(selectedIdeal.selectedElementIds).toEqual(["5"]);
    const detail = buildCharacterDetail(after, library);
    expect(detail.selectionRules.find((rule) => rule.identifier === idealRule.identifier))
      .toMatchObject({ isList: true, selectedElementNames: ["Faith. I trust that my deity will guide my actions. I have faith that if I work hard, things will go well. (Lawful)"] });
    expect(detail.ideals).toBe("Faith. I trust that my deity will guide my actions. I have faith that if I work hard, things will go well. (Lawful)");
    expect(service.exportCharacterXml("ListChoices")).toContain(
      'type="List" name="Ideal" requiredLevel="1"',
    );
    expect(service.exportCharacterXml("ListChoices")).toContain(
      'registered="5">Faith. I trust that my deity will guide my actions.',
    );

    const traitRules = pendingSelectionRules(after).filter(
      (rule) => rule.type === "List" && rule.name === "Personality Trait",
    );
    expect(traitRules).toHaveLength(2);
    const traitOptions = selectionOptions(after, library, traitRules[0]!);
    expect(traitOptions).toHaveLength(8);
    const firstTrait = traitOptions[0]!;
    const secondTrait = traitOptions[1]!;
    service.setSelection("ListChoices", traitRules[0]!.identifier, firstTrait.id, 1);
    service.setSelection("ListChoices", traitRules[0]!.identifier, secondTrait.id, 2);
    const traitsAfter = service.getCharacter("ListChoices");
    const firstTraitRule = selectionRuleFor(traitsAfter, traitRules[0]!.identifier)!;
    const secondTraitRule = selectionRuleFor(traitsAfter, traitRules[1]!.identifier)!;
    expect(firstTraitRule.selectedElementIds).toEqual([firstTrait.id]);
    expect(secondTraitRule.selectedElementIds).toEqual([secondTrait.id]);
    expect(buildCharacterDetail(traitsAfter, library).personalityTraits).toBe(
      `${firstTrait.name}\r\n${secondTrait.name}`,
    );

    service.clearSelection("ListChoices", idealRule.identifier);
    const cleared = service.getCharacter("ListChoices");
    expect(selectionRuleFor(cleared, idealRule.identifier)?.selectedElementIds).toEqual([]);
    expect(buildCharacterDetail(cleared, library).ideals).toBe("");
  });

  it("keeps generic numbered selection slots independent", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Numbered");
    const classRule = ruleOfType(pendingSelectionRules(service.getCharacter("Numbered")), "Class");
    service.setSelection("Numbered", classRule.identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
    const state = service.getCharacter("Numbered");
    const skillRules = pendingSelectionRules(state).filter((rule) => rule.name === "Skill Proficiency (Fighter)");
    expect(skillRules).toHaveLength(2);
    const options = selectionOptions(state, library, skillRules[0]!);
    const first = options[0]!.id;
    const second = options[1]!.id;
    service.setSelection("Numbered", skillRules[0]!.identifier, first, 1);
    service.setSelection("Numbered", skillRules[0]!.identifier, second, 2);
    const after = service.getCharacter("Numbered");
    const selected = pendingSelectionRules(after).find((rule) => rule.identifier === skillRules[1]!.identifier);
    expect(selected).toBeUndefined();
    const firstRule = selectionRuleFor(after, skillRules[0]!.identifier)!;
    const secondRule = selectionRuleFor(after, skillRules[1]!.identifier)!;
    expect(firstRule.selectedElementIds).toEqual([first]);
    expect(secondRule.selectedElementIds).toEqual([second]);
  });

  it("clears a selected subtree without removing a sibling selection", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("Clear");
    const raceRule = ruleOfType(pendingSelectionRules(service.getCharacter("Clear")), "Race");
    service.setSelection("Clear", raceRule.identifier, "ID_RACE_DRAGONBORN");
    const variantRule = ruleOfType(pendingSelectionRules(service.getCharacter("Clear")), "Race Variant");
    service.setSelection("Clear", variantRule.identifier, "ID_WOTC_EGTW_RACE_VARIANT_DRAGONBORN_DRACONBLOOD");
    const classRule = ruleOfType(pendingSelectionRules(service.getCharacter("Clear")), "Class");
    service.setSelection("Clear", classRule.identifier, "ID_WOTC_PHB_CLASS_FIGHTER");

    service.clearSelection("Clear", raceRule.identifier);

    const after = service.getCharacter("Clear");
    const level = after.elements.find((node) => node.type === "Level")!;
    const race = level.children.find((node) => node.type === "Race")!;
    const klass = level.children.find((node) => node.type === "Class")!;
    const sumIds = after.sum.elements.map((entry) => entry.id);
    expect(race.registered).toBe("");
    expect(klass.registered).toBe("ID_WOTC_PHB_CLASS_FIGHTER");
    expect(sumIds).not.toContain("ID_RACE_DRAGONBORN");
    expect(sumIds).not.toContain("ID_WOTC_EGTW_RACE_VARIANT_DRAGONBORN_DRACONBLOOD");
    expect(sumIds).not.toContain("ID_WOTC_EGTW_GRANTS_DRAGONBORN_VARIANT");
    expect(sumIds).toContain("ID_WOTC_PHB_CLASS_FIGHTER");
  });

  it("a feat with a dexterity requirement is not offered at dexterity 8", () => {
    const service = new CharacterService();
    service.createCharacter("F");
    service.setAbilities("F", { ...ABILITIES, dexterity: 8 });
    const featRule: SelectionRule = {
      identifier: "test-feat-rule",
      type: "Feat",
      name: "Feat",
      requiredLevel: 1,
      hasSelection: false,
      selectedElementIds: [],
      path: [],
    };
    let options = selectionOptions(service.getCharacter("F"), library, featRule);
    expect(options.map((o) => o.id)).not.toContain("ID_PHB_FEAT_DEFENSIVE_DUELIST");

    service.setAbilities("F", { ...ABILITIES, dexterity: 13 });
    options = selectionOptions(service.getCharacter("F"), library, featRule);
    expect(options.map((o) => o.id)).toContain("ID_PHB_FEAT_DEFENSIVE_DUELIST");
  });

  it("selectionOptions respects restricted sources", () => {
    const service = new CharacterService();
    service.createCharacter("R");
    const state = service.getCharacter("R");
    state.restrictedSources.push("ID_WOTC_SOURCE_VOLOS_GUIDE_TO_MONSTERS");
    const raceRule = ruleOfType(pendingSelectionRules(state), "Race");
    const options = selectionOptions(state, library, raceRule);
    expect(options.map((o) => o.id)).not.toContain("ID_WOTC_VGTM_RACE_KOBOLD");
    expect(options.map((o) => o.id)).toContain("ID_RACE_GNOME");
  });

  it("buildCharacterDetail works for a built character and a fresh character", () => {
    const { service, id } = buildRogue5(library);
    select(service, id, "Background", "ID_BACKGROUND_ACOLYTE");
    const rogue = buildCharacterDetail(service.getCharacter(id), library);
    expect(rogue.name).toBe(id);
    expect(rogue.race).toBe("Hill Dwarf");
    expect(rogue.class).toBe("Rogue");
    expect(rogue.background).toBe("Acolyte");
    expect(rogue.level).toBe(5);
    expect(rogue.registeredElements.length).toBeGreaterThan(0);
    expect(rogue.registeredElements[0]).toMatchObject({ id: "ID_LEVEL_1", type: "Level" });
    expect(rogue.selectionRules.length).toBeGreaterThan(0);
    expect(rogue.loadIssues).toEqual([]);

    service.createCharacter("Fresh");
    const fresh = buildCharacterDetail(service.getCharacter("Fresh"));
    expect(fresh.selectionRules.map((r) => r.type)).toEqual([
      "Race",
      "Class",
      "Background",
      "Alignment",
      "Deity",
    ]);
    expect(fresh.registeredElements.map((e) => e.id)).toEqual([
      "ID_LEVEL_1",
      "ID_INTERNAL_GRANTS_CHARACTER_BASE",
      "ID_INTERNAL_GRANTS_SPELLCASTING_BASE",
      "ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE",
      "ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER",
      "ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER",
      "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING",
      "ID_INTERNAL_OPTION_ALLOW_FEATS",
    ]);
    const strength = fresh.abilities.find((a) => a.abbreviation === "Str")!;
    expect(strength).toMatchObject({ baseScore: 10, finalScore: 10, modifier: 0 });
  });
});
