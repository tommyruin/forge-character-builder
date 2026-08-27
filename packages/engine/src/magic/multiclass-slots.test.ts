/**
 * Multiclass spell slots. The combined PHB table is keyed by the derived
 * multiclass caster level (full casters add their class level, half casters
 * half, third casters a third; artificer-style rates round up), not by
 * character level. Characters with two or more slot-progression classes are
 * combined casters: every non-Pact caster block carries the combined slots
 * and the magic root records multiclass="true" level="N". Pact Magic and
 * single-progression characters keep their own tables.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const ID_WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const ID_FIGHTER = "ID_WOTC_PHB_CLASS_FIGHTER";
const ID_MC_CLERIC = "ID_WOTC_PHB_MULTICLASS_CLERIC";
const ID_MC_FIGHTER = "ID_WOTC_PHB_MULTICLASS_FIGHTER";
const ID_MC_WIZARD = "ID_WOTC_PHB_MULTICLASS_WIZARD";
const ID_MC_WARLOCK = "ID_WOTC_PHB_MULTICLASS_WARLOCK";
const ID_EK = "ID_WOTC_PHB_ARCHETYPE_FIGHTER_ELDRITCH_KNIGHT";
const ID_OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the main class at `mainLevels` plus one trailing empty level
 * wrapper: startMulticlass converts the last empty wrapper into the
 * multiclass start instead of adding a level.
 */
function build(mainClassId: string, mainLevels: number): CharacterService {
  const service = new CharacterService(undefined, library, { rng: seededRng(23) });
  service.createCharacter("MC");
  service.setAbilities("MC", {
    strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14,
  });
  const state = service.getCharacter("MC");
  const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
  service.setSelection("MC", classRule.identifier, mainClassId);
  for (let i = 0; i < mainLevels; i++) service.levelUp("MC");
  service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
  return service;
}

function statistics(service: CharacterService): Record<string, number> {
  return computeStatistics(service.getCharacter("MC"), library);
}

describe("multiclass spell slots", () => {
  it("combines two full casters at the summed caster level", () => {
    const service = build(ID_WIZARD, 3);
    service.startMulticlass("MC", ID_MC_CLERIC);
    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MC_CLERIC });

    const values = statistics(service);
    expect(values["multiclass:spellcasting:level"]).toBe(5);
    expect(values["multiclass:spellcasting:slot:1"]).toBe(4);
    expect(values["multiclass:spellcasting:slot:2"]).toBe(3);
    expect(values["multiclass:spellcasting:slot:3"]).toBe(2);
    expect(values["multiclass:spellcasting:slot:4"]).toBeUndefined();

    const xml = service.exportCharacterXml("MC");
    expect(xml).toContain('<magic multiclass="true" level="5">');
    const magic = service.getCharacter("MC").magic!;
    for (const caster of magic.casters) {
      expect(caster.slots.s1).toBe("4");
      expect(caster.slots.s2).toBe("3");
      expect(caster.slots.s3).toBe("2");
    }
  });

  it("keys the slot table by caster level, not character level, when a non-caster class joins", () => {
    const service = build(ID_WIZARD, 3);
    service.startMulticlass("MC", ID_MC_FIGHTER);
    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MC_FIGHTER });

    const values = statistics(service);
    expect(values["multiclass:spellcasting:level"]).toBe(3);
    expect(values["multiclass:spellcasting:slot:2"]).toBe(2);
    expect(values["multiclass:spellcasting:slot:3"]).toBeUndefined();
  });

  it("counts an Eldritch Knight as a third-caster progression", () => {
    const service = build(ID_FIGHTER, 3);
    const state = service.getCharacter("MC");
    const archetypeRule = pendingSelectionRules(state).find((rule) => rule.type === "Archetype")!;
    service.setSelection("MC", archetypeRule.identifier, ID_EK);
    service.startMulticlass("MC", ID_MC_WIZARD);

    const values = statistics(service);
    expect(values["multiclass:spellcasting:level"]).toBe(2);
    expect(values["multiclass:spellcasting:slot:1"]).toBe(3);
    expect(values["multiclass:spellcasting:slot:2"]).toBeUndefined();

    const xml = service.exportCharacterXml("MC");
    expect(xml).toContain('<magic multiclass="true" level="2">');
  });

  it("does not combine when Pact Magic is the only other progression", () => {
    const service = build(ID_WIZARD, 2);
    service.startMulticlass("MC", ID_MC_WARLOCK);

    const values = statistics(service);
    const xml = service.exportCharacterXml("MC");
    expect(xml).not.toContain("<magic multiclass=");
    const magic = service.getCharacter("MC").magic!;
    const wizard = magic.casters.find((caster) => caster.name.toLowerCase().includes("wizard"))!;
    expect(wizard.slots.s1).toBe("3");
    expect(values["multiclass:spellcasting:level"]).toBe(2);
  });
});
