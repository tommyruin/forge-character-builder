/**
 * Progression DTO — RED tests.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, type SelectionRule } from "../selection/selection.js";
import { type ElementLibrary } from "../content/library.js";
import { buildProgression, type Progression } from "./progression.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const ID_ROGUE = "ID_WOTC_PHB_CLASS_ROGUE";
const ID_MULTICLASS_WIZARD = "ID_WOTC_PHB_MULTICLASS_WIZARD";
const ID_OPTION_FEATS = "ID_INTERNAL_OPTION_ALLOW_FEATS";
const ID_OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

let library: ElementLibrary;

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

function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

function buildBillyGate(service: CharacterService): void {
  service.createCharacter("BillyGate");
  service.setAbilities("BillyGate", { strength: 10, dexterity: 10, constitution: 10, intelligence: 12, wisdom: 14, charisma: 14 });
  service.setCharacterOption("BillyGate", { optionId: ID_OPTION_FEATS, enabled: true });
  service.setCharacterOption("BillyGate", { optionId: ID_OPTION_MULTICLASS, enabled: true });
  let state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
  state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_WOTC_ERLW_SUB_RACE_MARK_OF_WARDING");
  state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Class").identifier, ID_ROGUE);
  for (let level = 2; level <= 5; level++) service.levelUp("BillyGate");
  state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Archetype").identifier, "ID_WOTC_SCAG_ARCHETYPE_SWASHBUCKLER");
  state = service.getCharacter("BillyGate");
  const expertiseRules = pendingSelectionRules(state).filter((r) => r.name === "Expertise (Rogue)");
  service.setSelection("BillyGate", expertiseRules[1]!.identifier, "ID_EXPERTISE_TOOL_THIEVES_TOOLS");
}

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

describe("buildProgression", () => {
  it("derives the progression DTO for a level-5 rogue", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(3) });
    buildBillyGate(service);
    const state = service.getCharacter("BillyGate");
    const progression = buildProgression(state, library);

    expect(progression.hasMainClass).toBe(true);
    expect(progression.hasMulticlass).toBe(false);
    expect(progression.multiclassRuleEnabled).toBe(true);
    expect(progression.canMulticlass).toBe(false);
    expect(progression.canLevelUp).toBe(true);
    expect(progression.canLevelDown).toBe(true);
    expect(progression.canUndoDelevel).toBe(false);
    expect(progression.usesAverageHitPoints).toBe(false);

    expect(progression.classes).toHaveLength(1);
    expect(progression.classes[0]).toMatchObject({
      classId: ID_ROGUE,
      className: "Rogue",
      level: 5,
      isMulticlass: false,
      hitDie: "d8",
    });
    expect(progression.classes[0]!.hitPointValues).toHaveLength(5);
    for (const value of progression.classes[0]!.hitPointValues) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(8);
    }

    expect(progression.levelHistory).toHaveLength(5);
    progression.levelHistory.forEach((entry, index) => {
      expect(entry.totalLevel).toBe(index + 1);
      expect(entry.classId).toBe(ID_ROGUE);
      expect(entry.className).toBe("Rogue");
      expect(entry.classLevel).toBe(index + 1);
      expect(entry.isMulticlass).toBe(false);
      expect(entry.isPending).toBe(false);
      expect(entry.canRemove).toBe(index > 0);
    });
    expect(progression.levelHistory[0]!.isClassStart).toBe(true);
    expect(progression.levelHistory[1]!.isClassStart).toBe(false);
  });

  it("reports delevel state and multiclass classes", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(3) });
    buildBillyGate(service);
    service.delevel("BillyGate", { mode: "last" });
    const progression: Progression = service.getProgression("BillyGate");
    expect(progression.canUndoDelevel).toBe(true);
    expect(progression.canLevelDown).toBe(true);
    expect(progression.levelHistory).toHaveLength(4);
    expect(progression.levelHistory[3]!.canRemove).toBe(true);
    expect(progression.levelHistory[2]!.canRemove).toBe(true);
  });

  it("includes the multiclass class with its own hit die and rolls", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(5) });
    service.createCharacter("MC");
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
    service.setCharacterOption("MC", { optionId: ID_OPTION_FEATS, enabled: true });
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    let state = service.getCharacter("MC");
    service.setSelection("MC", ruleOfType(pendingSelectionRules(state), "Class").identifier, ID_ROGUE);
    service.levelUp("MC");
    service.startMulticlass("MC", ID_MULTICLASS_WIZARD);
    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MULTICLASS_WIZARD });

    state = service.getCharacter("MC");
    const progression = buildProgression(state, library);
    expect(progression.hasMulticlass).toBe(true);
    expect(progression.classes).toHaveLength(2);
    expect(progression.classes[0]).toMatchObject({ classId: ID_ROGUE, level: 1, isMulticlass: false, hitDie: "d8" });
    expect(progression.classes[1]).toMatchObject({
      classId: ID_MULTICLASS_WIZARD,
      className: "Wizard",
      level: 2,
      isMulticlass: true,
      hitDie: "d6",
    });
    expect(progression.classes[1]!.hitPointValues).toHaveLength(2);
    expect(progression.levelHistory).toHaveLength(3);
    expect(progression.levelHistory[2]).toMatchObject({
      totalLevel: 3,
      classId: ID_MULTICLASS_WIZARD,
      className: "Wizard",
      classLevel: 2,
      isMulticlass: true,
    });
    expect(progression.levelHistory[1]).toMatchObject({
      totalLevel: 2,
      classId: ID_MULTICLASS_WIZARD,
      className: "Wizard",
      classLevel: 1,
      isMulticlass: true,
      isClassStart: true,
    });
  });

  it("canMulticlass requires the main class's multiclass prerequisites to be met", () => {
    const rogue = new CharacterService(undefined, library, { rng: seededRng(3) });
    rogue.createCharacter("PR");
    rogue.setAbilities("PR", { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    let state = rogue.getCharacter("PR");
    rogue.setSelection("PR", ruleOfType(pendingSelectionRules(state), "Class").identifier, ID_ROGUE);
    rogue.levelUp("PR");
    expect(rogue.getProgression("PR").canMulticlass).toBe(true);

    rogue.setAbilities("PR", { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    expect(rogue.getProgression("PR").canMulticlass).toBe(false);

    const fighter = new CharacterService(undefined, library, { rng: seededRng(3) });
    fighter.createCharacter("PF");
    fighter.setAbilities("PF", { strength: 8, dexterity: 8, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    state = fighter.getCharacter("PF");
    fighter.setSelection("PF", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
    fighter.levelUp("PF");
    expect(fighter.getProgression("PF").canMulticlass).toBe(false);
  });
});
