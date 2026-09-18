/**
 * Ability score allocations: the engine flags every selection rule that
 * resolves to an ability score bump, wherever the content authored the
 * choice — class improvements, Feat Feature sub-choices and racial traits —
 * so the client can group them all under Ability Scores. Ancestry pickers
 * and the 2024 level-4 feat chooser must stay unflagged.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "./selection.js";
import { ID, buildCharacter, freshService, sharedLibrary } from "../testing/character-factory.js";

const FIGHTER_2024 = "ID_WOTC_PHB24_CLASS_FIGHTER";
const WIZARD_2024 = "ID_WOTC_PHB24_CLASS_WIZARD";
const SOLDIER_2024 = "ID_WOTC_PHB24_BACKGROUND_SOLDIER";
const ACOLYTE_2024 = "ID_WOTC_PHB24_BACKGROUND_ACOLYTE";
const FEY_TOUCHED = "ID_WOTC_PHB24_FEAT_FEYTOUCHED";
const SPELL_SNIPER = "ID_WOTC_PHB24_FEAT_SPELLSNIPER";
const RESILIENT_2014 = "ID_PHB_FEAT_RESILIENT";
const IMPROVEMENT_FIGHTER_4 = "Improvement Option (Fighter 4)";
const FEAT_FIGHTER_4 = "Feat (FIGHTER 4)";
const CLASS_ASI_FIGHTER_4 = "Ability Score Improvement (Fighter 4)";

const ABILITIES = {
  strength: 15,
  dexterity: 14,
  constitution: 13,
  intelligence: 12,
  wisdom: 10,
  charisma: 8,
};

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** A 2024 character of `classId` with `background`, at `levels`. */
function build2024(
  label: string,
  classId: string,
  background: string,
  levels = 1,
): { service: CharacterService; id: string } {
  const service = freshService(library);
  const id = service.createCharacter(label).id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (candidate) => candidate.type === type && !candidate.hasSelection,
    );
    if (!rule) throw new Error(`${label}: no pending ${type} rule`);
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", "ID_WOTC_PHB24_RACE_HUMAN");
  pick("Class", classId);
  pick("Background", background);
  for (let level = 2; level <= levels; level++) service.levelUp(id);
  return { service, id };
}

/** Resolves the pending rule named `name` to `elementId`. */
function pickNamed(service: CharacterService, id: string, name: string, elementId: string): void {
  const rule = pendingSelectionRules(service.getCharacter(id)).find(
    (candidate) => candidate.name === name && !candidate.hasSelection,
  );
  if (!rule) throw new Error(`no pending rule named '${name}'`);
  service.setSelection(id, rule.identifier, elementId);
}

/** The detail rule named `name` (pending or filled); throws when absent. */
function detailRule(service: CharacterService, id: string, name: string) {
  const rule = service
    .getCharacterDetail(id)
    .selectionRules.find((candidate) => candidate.name === name);
  if (!rule) throw new Error(`no detail rule named '${name}'`);
  return rule;
}

describe("ability score allocation flags", () => {
  it("flags a Feat Feature ability sub-choice (Fey-Touched)", () => {
    const { service, id } = build2024("FeyTouchedAsi", FIGHTER_2024, SOLDIER_2024, 4);
    pickNamed(service, id, CLASS_ASI_FIGHTER_4, FEY_TOUCHED);
    expect(detailRule(service, id, "Ability Score Increase (Fey-Touched)").allocatesAbilityScores).toBe(true);
  });

  it("flags a type-authored ability selection (Spell Sniper)", () => {
    const { service, id } = build2024("SpellSniperAsi", WIZARD_2024, SOLDIER_2024, 4);
    pickNamed(service, id, "Ability Score Improvement (Wizard 4)", SPELL_SNIPER);
    expect(detailRule(service, id, "Ability Score Increase (Spell Sniper)").allocatesAbilityScores).toBe(true);
  });

  it("flags an oddly named feat sub-choice (2014 Resilient)", () => {
    const built = buildCharacter(library, {
      id: "ResilientAsi",
      raceId: ID.RACE_DWARF,
      subRaceId: ID.SUB_RACE_HILL_DWARF,
      classId: ID.CLASS_FIGHTER,
      levels: 4,
    });
    pickNamed(built.service, built.id, IMPROVEMENT_FIGHTER_4, "ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER");
    pickNamed(built.service, built.id, FEAT_FIGHTER_4, RESILIENT_2014);
    expect(detailRule(built.service, built.id, "Resilient (Feat)").allocatesAbilityScores).toBe(true);
  });

  it("flags a racial trait ability choice and leaves the variant picker alone", () => {
    const built = buildCharacter(library, {
      id: "HalfElfAsi",
      raceId: "ID_RACE_HALFELF",
      subRaceId: "",
      classId: ID.CLASS_FIGHTER,
      levels: 1,
    });
    expect(detailRule(built.service, built.id, "Ability Score Increase (Half-Elf)").allocatesAbilityScores).toBe(true);
    expect(detailRule(built.service, built.id, "Half-Elf Variant").allocatesAbilityScores).toBe(false);
  });

  it("leaves an ancestry picker that bundles stats unflagged", () => {
    const built = buildCharacter(library, {
      id: "DwarfPickerCheck",
      raceId: ID.RACE_DWARF,
      subRaceId: "",
      classId: ID.CLASS_FIGHTER,
      levels: 1,
    });
    expect(detailRule(built.service, built.id, "Dwarven Subrace").allocatesAbilityScores).toBe(false);
  });

  it("leaves the 2024 level-4 feat chooser unflagged", () => {
    const { service, id } = build2024("ClassChooser", FIGHTER_2024, SOLDIER_2024, 4);
    expect(detailRule(service, id, CLASS_ASI_FIGHTER_4).allocatesAbilityScores).toBe(false);
  });

  it("leaves a spellcasting-ability sub-choice unflagged", () => {
    const { service, id } = build2024("MagicInitiateAbility", FIGHTER_2024, ACOLYTE_2024, 1);
    expect(detailRule(service, id, "Spellcasting Ability (Magic Initiate)").allocatesAbilityScores).toBe(false);
  });
});
