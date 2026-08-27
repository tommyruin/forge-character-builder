/**
 * Requirement-gated rules have to settle whichever order the player works in.
 *
 * The two cases the user reported: Tasha's "Customized Language" swaps a race's
 * fixed language grants for a pick list, and a 2024 background's
 * ID_INTERNAL_GRANTS_BACKGROUND_ASI switches off the race's own ability-score
 * choice. Neither may depend on the marker already being registered at the
 * moment the race is: a select rule's requirements are re-read on every
 * reconcile.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "./selection.js";
import { computeStatistics } from "../statistics/calculator.js";
import {
  ID,
  buildRogue5,
  freshService,
  select,
  sharedLibrary,
  STANDARD_ARRAY,
} from "../testing/character-factory.js";

const OPTION_CUSTOM_LANGUAGE = "ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE";
const OPTION_CUSTOM_ASI = "ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI";
const BACKGROUND_ASI_MARKER = "ID_INTERNAL_GRANTS_BACKGROUND_ASI";
const PHB24_BACKGROUND_ACOLYTE = "ID_WOTC_PHB24_BACKGROUND_ACOLYTE";
const PHB24_RACE_HUMAN = "ID_WOTC_PHB24_RACE_HUMAN";
const LANGUAGE_COMMON = "ID_LANGUAGE_COMMON";
const LANGUAGE_DWARVISH = "ID_LANGUAGE_DWARVISH";
const LANGUAGE_INFERNAL = "ID_LANGUAGE_INFERNAL";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** A bare dwarf — no class, so the tree is just the race's own rules. */
function dwarf(id: string): CharacterService {
  const service = freshService(library);
  service.createCharacter(id);
  service.setAbilities(id, STANDARD_ARRAY);
  select(service, id, "Race", ID.RACE_DWARF);
  return service;
}

const ruleNames = (service: CharacterService, id: string): string[] =>
  pendingSelectionRules(service.getCharacter(id)).map((rule) => rule.name ?? rule.type);

const registered = (service: CharacterService, id: string): string[] =>
  service.getCharacter(id).sum.elements.map((entry) => entry.id);

describe("customized language (Tasha's)", () => {
  it("spawns the race's language picks when the option is enabled afterwards", () => {
    const service = dwarf("CL1");
    expect(ruleNames(service, "CL1")).not.toContain("Customized Language");
    expect(registered(service, "CL1")).toContain(LANGUAGE_DWARVISH);

    service.setCharacterOption("CL1", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });

    const customized = pendingSelectionRules(service.getCharacter("CL1")).filter(
      (rule) => rule.name === "Customized Language",
    );
    expect(customized).toHaveLength(2);
    expect(registered(service, "CL1")).not.toContain(LANGUAGE_COMMON);
    expect(registered(service, "CL1")).not.toContain(LANGUAGE_DWARVISH);
  });

  it("offers the Custom Race Language list on the spawned picks", () => {
    const service = dwarf("CL2");
    service.setCharacterOption("CL2", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });

    const state = service.getCharacter("CL2");
    const rule = pendingSelectionRules(state).find((candidate) => candidate.name === "Customized Language")!;
    const options = selectionOptions(state, library, rule).map((option) => option.id);
    expect(options).toContain("ID_LANGUAGE_ABYSSAL");
    expect(options).toContain(LANGUAGE_INFERNAL);
  });

  it("drops the customized picks and restores the fixed grants when disabled", () => {
    const service = dwarf("CL3");
    service.setCharacterOption("CL3", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    const rule = pendingSelectionRules(service.getCharacter("CL3")).find(
      (candidate) => candidate.name === "Customized Language",
    )!;
    service.setSelection("CL3", rule.identifier, LANGUAGE_INFERNAL);
    expect(registered(service, "CL3")).toContain(LANGUAGE_INFERNAL);

    service.setCharacterOption("CL3", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: false });

    expect(ruleNames(service, "CL3")).not.toContain("Customized Language");
    expect(registered(service, "CL3")).not.toContain(LANGUAGE_INFERNAL);
    expect(registered(service, "CL3")).toContain(LANGUAGE_COMMON);
    expect(registered(service, "CL3")).toContain(LANGUAGE_DWARVISH);
  });

  it("reaches the same state whichever order the option and race are chosen in", () => {
    const optionFirst = freshService(library);
    optionFirst.createCharacter("CL4");
    optionFirst.setAbilities("CL4", STANDARD_ARRAY);
    optionFirst.setCharacterOption("CL4", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    select(optionFirst, "CL4", "Race", ID.RACE_DWARF);

    const raceFirst = dwarf("CL5");
    raceFirst.setCharacterOption("CL5", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });

    expect(ruleNames(raceFirst, "CL5").filter((name) => name === "Customized Language")).toEqual(
      ruleNames(optionFirst, "CL4").filter((name) => name === "Customized Language"),
    );
    expect(registered(raceFirst, "CL5")).not.toContain(LANGUAGE_DWARVISH);
    expect(registered(optionFirst, "CL4")).not.toContain(LANGUAGE_DWARVISH);
  });
});

describe("background ability score increases (2024)", () => {
  it("removes the race's own ability-score choice when a 2024 background lands", () => {
    const service = freshService(library);
    service.createCharacter("BG1");
    service.setAbilities("BG1", STANDARD_ARRAY);
    select(service, "BG1", "Race", PHB24_RACE_HUMAN);
    expect(ruleNames(service, "BG1")).toContain("Ability Score Improvement Option (Human)");

    select(service, "BG1", "Background", PHB24_BACKGROUND_ACOLYTE);

    expect(registered(service, "BG1")).toContain(BACKGROUND_ASI_MARKER);
    expect(ruleNames(service, "BG1")).not.toContain("Ability Score Improvement Option (Human)");
  });

  it("offers the background's own +2/+1 or +1/+1/+1 choice instead", () => {
    const service = freshService(library);
    service.createCharacter("BG2");
    service.setAbilities("BG2", STANDARD_ARRAY);
    select(service, "BG2", "Race", PHB24_RACE_HUMAN);
    select(service, "BG2", "Background", PHB24_BACKGROUND_ACOLYTE);

    const state = service.getCharacter("BG2");
    const rule = pendingSelectionRules(state).find(
      (candidate) => candidate.name === "Ability Score Improvement Option",
    )!;
    expect(rule).toBeDefined();
    const options = selectionOptions(state, library, rule).map((option) => option.id);
    expect(options).toContain("ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_INT_WIS_CHA_1");
    expect(options).toContain("ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_INT_WIS_CHA_2");
  });

  it("brings the racial choice back when the background is cleared", () => {
    const service = freshService(library);
    service.createCharacter("BG3");
    service.setAbilities("BG3", STANDARD_ARRAY);
    select(service, "BG3", "Race", PHB24_RACE_HUMAN);
    select(service, "BG3", "Background", PHB24_BACKGROUND_ACOLYTE);

    const background = pendingSelectionRules(service.getCharacter("BG3"));
    expect(background.find((rule) => rule.type === "Background")).toBeUndefined();
    const filled = service.getCharacterDetail("BG3").selectionRules.find((rule) => rule.type === "Background")!;
    service.clearSelection("BG3", filled.identifier);

    expect(registered(service, "BG3")).not.toContain(BACKGROUND_ASI_MARKER);
    expect(ruleNames(service, "BG3")).toContain("Ability Score Improvement Option (Human)");
  });

  it("suppresses a 2014 race's ASI choice under the customized-ASI option too", () => {
    const service = dwarf("BG4");
    service.setCharacterOption("BG4", { optionId: OPTION_CUSTOM_ASI, enabled: true });
    expect(ruleNames(service, "BG4")).toContain("Custom Ability Score Improvement +2 (Dwarf)");

    select(service, "BG4", "Background", PHB24_BACKGROUND_ACOLYTE);

    expect(ruleNames(service, "BG4")).not.toContain("Custom Ability Score Improvement +2 (Dwarf)");
  });

  it("stops applying the racial bonus once the background grants the marker", () => {
    const service = dwarf("BG5");
    const before = computeStatistics(service.getCharacter("BG5"), library);
    select(service, "BG5", "Background", PHB24_BACKGROUND_ACOLYTE);
    const after = computeStatistics(service.getCharacter("BG5"), library);
    expect(before["constitution:score"]! - after["constitution:score"]!).toBe(2);
  });
});

describe("reconciliation safety", () => {
  it("leaves a character whose rules all agree completely untouched", () => {
    const { service, id } = buildRogue5(library, "Untouched");
    const before = service.exportCharacterXml(id);
    // A mutation that registers nothing new must not disturb the document.
    service.updateDetails(id, { gender: "Nonbinary" });
    const after = service.exportCharacterXml(id);
    expect(after.replace(/<gender>[^<]*<\/gender>/u, "")).toBe(
      before.replace(/<gender>[^<]*<\/gender>/u, ""),
    );
  });

  it("keeps the level-1 template wrappers, which no rule owns", () => {
    const service = dwarf("Template");
    service.setCharacterOption("Template", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    const detail = service.getCharacterDetail("Template").selectionRules.map((rule) => rule.type);
    for (const type of ["Race", "Class", "Background", "Alignment", "Deity"]) {
      expect(detail).toContain(type);
    }
  });

  it("round-trips byte-identically after a reconciling toggle", () => {
    const service = dwarf("RoundTrip");
    service.setCharacterOption("RoundTrip", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    const exported = service.exportCharacterXml("RoundTrip");
    const reimport = new CharacterService(undefined, library);
    reimport.importCharacterXml("RoundTrip", exported);
    expect(reimport.exportCharacterXml("RoundTrip")).toBe(exported);
  });

  it("does not duplicate a class's level-gated choices", () => {
    // The rogue's level-4 improvement choice belongs to the leveling planner,
    // which files it under the Level 4 node. A sweep must leave it exactly where
    // and as it found it rather than re-deriving a second copy under the class.
    const { service, id } = buildRogue5(library, "LevelScoped");
    const before = ruleNames(service, id).filter((name) => /Improvement Option/u.test(name));
    expect(before).toHaveLength(1);

    service.setCharacterOption(id, { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });

    expect(ruleNames(service, id).filter((name) => /Improvement Option/u.test(name))).toEqual(before);
  });

  it("keeps a selection-rule identifier valid across a reconciling mutation", () => {
    const service = freshService(library);
    service.createCharacter("Ident");
    service.setAbilities("Ident", STANDARD_ARRAY);
    const raceRule = pendingSelectionRules(service.getCharacter("Ident")).find((rule) => rule.type === "Race")!;
    service.setSelection("Ident", raceRule.identifier, ID.RACE_DWARF);

    // A sweep that adds and removes wrappers around it must not rebind the
    // identifier a caller is still holding.
    service.setCharacterOption("Ident", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    service.clearSelection("Ident", raceRule.identifier);

    expect(service.getCharacter("Ident").sum.elements.map((entry) => entry.id)).not.toContain(ID.RACE_DWARF);
  });

  it("does not offer the same choice twice when two elements declare it", () => {
    // The wizard's Spellcasting feature gates a "Find Familiar" Companion pick
    // on knowing the spell; the spell declares the same pick itself.
    const service = freshService(library);
    service.createCharacter("Fam");
    service.setAbilities("Fam", STANDARD_ARRAY);
    select(service, "Fam", "Race", ID.RACE_ELF);
    select(service, "Fam", "Sub Race", ID.SUB_RACE_HIGH_ELF);
    select(service, "Fam", "Class", ID.CLASS_WIZARD);
    for (const rule of pendingSelectionRules(service.getCharacter("Fam"))) {
      if (rule.type !== "Spell") continue;
      try {
        service.setSelection("Fam", rule.identifier, "ID_PHB_SPELL_FIND_FAMILIAR");
        break;
      } catch {
        // A cantrip slot cannot hold a 1st-level spell; try the next rule.
      }
    }
    expect(ruleNames(service, "Fam").filter((name) => name === "Find Familiar")).toHaveLength(1);
  });

  it("leaves an enabled optional class feature applied after a delevel", () => {
    // Its grant is gated on [level:barbarian:3]. Level-driven removal belongs to
    // the delevel planner, which keeps the feature until the item is disabled.
    const service = freshService(library);
    service.createCharacter("OCF");
    service.setAbilities("OCF", STANDARD_ARRAY);
    select(service, "OCF", "Race", ID.RACE_DWARF);
    select(service, "OCF", "Sub Race", ID.SUB_RACE_HILL_DWARF);
    select(service, "OCF", "Class", ID.CLASS_BARBARIAN);
    service.levelUp("OCF");
    service.levelUp("OCF");
    const ocf = "ID_WOTC_TCOE_ITEM_OCF_BARBARIAN_PRIMAL_KNOWLEDGE";
    service.setCharacterControl("OCF", { key: `item:${ocf}`, enabled: true });
    service.delevel("OCF", { mode: "last" });

    expect(registered(service, "OCF")).toContain("ID_WOTC_TCOE_CLASS_FEATURE_BARBARIAN_PRIMAL_KNOWLEDGE");
  });
});

describe("lone-pipe requirements the corpus ships", () => {
  it("grants Tieflings their Infernal, and drops it under customized languages", () => {
    const service = freshService(library);
    service.createCharacter("Tief");
    service.setAbilities("Tief", STANDARD_ARRAY);
    select(service, "Tief", "Race", "ID_RACE_TIEFLING");
    expect(registered(service, "Tief")).toContain(LANGUAGE_INFERNAL);

    service.setCharacterOption("Tief", { optionId: OPTION_CUSTOM_LANGUAGE, enabled: true });
    expect(registered(service, "Tief")).not.toContain(LANGUAGE_INFERNAL);
  });
});
