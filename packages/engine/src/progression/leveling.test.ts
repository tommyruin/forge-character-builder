/**
 * Leveling/progression engine.
 *
 * The structural gate builds a level-5 Rogue through the service API and pins
 * its shape. Checksums and rndhp values are per-instance and are masked in every
 * comparison; the gate compares the depth-first tree id-sequence, wrapper
 * attributes (requiredLevel/number/registered) and the sum id multiset.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { parseDnd5e } from "../dnd5e/document.js";
import { buildCharacter, buildRangerRogue8 } from "../testing/character-factory.js";
import { mapToState } from "../character/mapping.js";
import { CharacterService } from "../character/service.js";
import { type CharacterState, type RegisteredElement } from "../character/state.js";
import { type ElementLibrary } from "../content/library.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "../selection/selection.js";
import { extractHitDie, rollHitPoints } from "./leveling.js";
import { buildCorpusLibrary } from "../testing/corpus.js";



const ID_ROGUE = "ID_WOTC_PHB_CLASS_ROGUE";
const ID_FIGHTER = "ID_WOTC_PHB_CLASS_FIGHTER";
const ID_WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const ID_MULTICLASS_WIZARD = "ID_WOTC_PHB_MULTICLASS_WIZARD";
const ID_OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

let library: ElementLibrary;

/** Deterministic RNG for tests (mulberry32). */
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

/** One node of the masked tree sequence: id-sequence + wrapper attributes only. */
interface TreeSeqNode {
  id: string;
  requiredLevel?: number;
  number?: number;
  registered: string;
}

/** Depth-first sequence of the elements tree, optionally skipping a wrapper subtree. */
function treeSeq(nodes: RegisteredElement[], skipType?: string): TreeSeqNode[] {
  const out: TreeSeqNode[] = [];
  const walk = (list: RegisteredElement[], skip: boolean): void => {
    for (const node of list) {
      const isWrapper = node.requiredLevel !== undefined;
      const nodeSkip = skip || (isWrapper && node.type === skipType);
      if (!nodeSkip) {
        out.push({
          id: node.id,
          requiredLevel: node.requiredLevel,
          number: node.number,
          registered: node.registered ?? "",
        });
      }
      walk(node.children, nodeSkip);
    }
  };
  walk(nodes, false);
  return out;
}

/** Removes nodes whose id is in `drop` from a tree sequence (once each, subtree-inclusive). */
function without(seq: TreeSeqNode[], drop: string[]): TreeSeqNode[] {
  const drops = new Set(drop);
  return seq.filter((node) => !drops.has(node.id));
}

function sumIds(state: CharacterState): string[] {
  return state.sum.elements.map((e) => e.id);
}

/** The level wrappers of the elements tree (options and items precede levels). */
function levelsOf(state: CharacterState): RegisteredElement[] {
  return state.elements.filter((node) => node.type === "Level");
}

function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

function buildBillyGate(service: CharacterService): CharacterState {
  service.createCharacter("BillyGate");
  service.setAbilities("BillyGate", { strength: 10, dexterity: 10, constitution: 10, intelligence: 12, wisdom: 14, charisma: 14 });
  let state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
  state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_WOTC_ERLW_SUB_RACE_MARK_OF_WARDING");
  state = service.getCharacter("BillyGate");
  service.setSelection("BillyGate", ruleOfType(pendingSelectionRules(state), "Class").identifier, ID_ROGUE);
  for (let level = 2; level <= 5; level++) service.levelUp("BillyGate");
  state = service.getCharacter("BillyGate");
  const archetypeRule = ruleOfType(pendingSelectionRules(state), "Archetype");
  service.setSelection("BillyGate", archetypeRule.identifier, "ID_WOTC_SCAG_ARCHETYPE_SWASHBUCKLER");
  state = service.getCharacter("BillyGate");
  const expertiseRules = pendingSelectionRules(state).filter((r) => r.name === "Expertise (Rogue)");
  expect(expertiseRules).toHaveLength(2);
  service.setSelection("BillyGate", expertiseRules[0]!.identifier, "ID_EXPERTISE_TOOL_THIEVES_TOOLS");
  return service.getCharacter("BillyGate");
}

function buildSpikeGate(service: CharacterService): CharacterState {
  service.createCharacter("Spike");
  service.setAbilities("Spike", { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
  let state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
  state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");
  state = service.getCharacter("Spike");
  service.setSelection("Spike", ruleOfType(pendingSelectionRules(state), "Class").identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
  service.levelUp("Spike");
  service.levelUp("Spike");
  return service.getCharacter("Spike");
}

function buildMainClass(service: CharacterService, id: string, classId: string): CharacterState {
  service.createCharacter(id);
  service.setAbilities(id, { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
  let state = service.getCharacter(id);
  service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Race").identifier, "ID_SRD_RACE_DWARF");
  state = service.getCharacter(id);
  service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Sub Race").identifier, "ID_SUB_RACE_HILL_DWARF");
  state = service.getCharacter(id);
  service.setSelection(id, ruleOfType(pendingSelectionRules(state), "Class").identifier, classId);
  return service.getCharacter(id);
}

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

describe("hit point rolls (2024 classes)", () => {
  const ALL_ONES = Array(20).fill(1).join(",");

  function build2024Fighter(): CharacterService {
    const service = new CharacterService(undefined, library, { rng: seededRng(31) });
    service.createCharacter("F24");
    service.setAbilities("F24", { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    const state = service.getCharacter("F24");
    const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
    service.setSelection("F24", classRule.identifier, "ID_WOTC_PHB24_CLASS_FIGHTER");
    return service;
  }

  it("rolls real d10 values when a 2024 class is selected", () => {
    const service = build2024Fighter();
    const rolls = service.getCharacter("F24").hitPointRolls["ID_WOTC_PHB24_CLASS_FIGHTER"]!;
    expect(rolls).toHaveLength(20);
    expect(rolls[0]).toBe(10);
    for (const value of rolls) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(rolls.every((value) => value === 1)).toBe(false);
  });

  it("regenerates a degenerate all-1s roll array on level up", () => {
    const service = build2024Fighter();
    // A character saved while the hit die parsed as 0 carries rndhp="1,1,...".
    const corrupted = service.exportCharacterXml("F24").replace(/rndhp="[^"]*"/, `rndhp="${ALL_ONES}"`);
    service.importCharacterXml("F24C", corrupted);
    expect(service.getCharacter("F24C").hitPointRolls["ID_WOTC_PHB24_CLASS_FIGHTER"]!.every((v) => v === 1)).toBe(true);

    service.levelUp("F24C");

    const healed = service.getCharacter("F24C").hitPointRolls["ID_WOTC_PHB24_CLASS_FIGHTER"]!;
    expect(healed).toHaveLength(20);
    expect(healed[0]).toBe(10);
    expect(healed.every((value) => value === 1)).toBe(false);
    for (const value of healed) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(service.exportCharacterXml("F24C")).not.toContain(`rndhp="${ALL_ONES}"`);
  });

  it("leaves a healthy roll array untouched on level up", () => {
    const service = build2024Fighter();
    const before = [...service.getCharacter("F24").hitPointRolls["ID_WOTC_PHB24_CLASS_FIGHTER"]!];
    service.levelUp("F24");
    expect(service.getCharacter("F24").hitPointRolls["ID_WOTC_PHB24_CLASS_FIGHTER"]).toEqual(before);
  });
});

describe("hit dice (2024 classes)", () => {
  it("reads the hd setter when the prose uses the 2024 'Hit Point Die' table", () => {
    expect(extractHitDie(library.byId.get("ID_WOTC_PHB24_CLASS_FIGHTER")!)).toBe(10);
    expect(extractHitDie(library.byId.get("ID_WOTC_PHB24_CLASS_BARBARIAN")!)).toBe(12);
    expect(extractHitDie(library.byId.get("ID_WOTC_PHB24_CLASS_WIZARD")!)).toBe(6);
    expect(extractHitDie(library.byId.get("ID_WOTC_PHB24_CLASS_SORCERER")!)).toBe(6);
  });

  it("falls back to 2014 prose when no hd setter exists", () => {
    const rogue = library.byId.get(ID_ROGUE)!;
    expect(extractHitDie({ ...rogue, setters: rogue.setters.filter((s) => s.name !== "hd") })).toBe(8);
  });

  it("falls back to 2024 prose when no hd setter exists", () => {
    const fighter = library.byId.get("ID_WOTC_PHB24_CLASS_FIGHTER")!;
    expect(extractHitDie({ ...fighter, setters: fighter.setters.filter((s) => s.name !== "hd") })).toBe(10);
  });
});

describe("hit dice", () => {
  it("extracts the hit die size from the class description", () => {
    expect(extractHitDie(library.byId.get(ID_ROGUE)!)).toBe(8);
    expect(extractHitDie(library.byId.get(ID_WIZARD)!)).toBe(6);
    expect(extractHitDie(library.byId.get("ID_WOTC_PHB_CLASS_BARBARIAN")!)).toBe(12);
  });

  it("rolls 20 hit point values within the die range, deterministically", () => {
    const rng = seededRng(42);
    const rolls = rollHitPoints(library.byId.get(ID_WIZARD)!, rng);
    expect(rolls).toHaveLength(20);
    for (const value of rolls) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    const again = rollHitPoints(library.byId.get(ID_WIZARD)!, seededRng(42));
    expect(again).toEqual(rolls);
  });

  it.each([
    ["Fighter", ID_FIGHTER, 10],
    ["Wizard", ID_WIZARD, 6],
  ])("starts the main %s class at its hit-die maximum", (name, classId, maximum) => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = buildMainClass(service, `Main${name}`, classId);
    const rolls = state.hitPointRolls[classId]!;

    expect(rolls).toHaveLength(20);
    expect(rolls[0]).toBe(maximum);
  });

  it("keeps later main-class rolls bounded, editable, and stable across round trips", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildMainClass(service, "FighterHp", ID_FIGHTER);
    service.levelUp("FighterHp");
    service.levelUp("FighterHp");

    const initial = service.getCharacter("FighterHp").hitPointRolls[ID_FIGHTER]!;
    expect(initial).toHaveLength(20);
    expect(initial[0]).toBe(10);
    initial.slice(1).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    });

    service.setHitPointRoll("FighterHp", { classId: ID_FIGHTER, classLevel: 2, value: 9 });
    const edited = service.getCharacter("FighterHp").hitPointRolls[ID_FIGHTER]!;
    expect(edited).toHaveLength(20);
    expect(edited[1]).toBe(9);

    service.importCharacterXml("FighterHpReloaded", service.exportCharacterXml("FighterHp"));
    expect(service.getCharacter("FighterHpReloaded").hitPointRolls[ID_FIGHTER]).toEqual(edited);
    service.delevel("FighterHpReloaded", { mode: "last" });
    expect(service.getCharacter("FighterHpReloaded").hitPointRolls[ID_FIGHTER]).toEqual(edited);
    service.undoDelevel("FighterHpReloaded");
    expect(service.getCharacter("FighterHpReloaded").hitPointRolls[ID_FIGHTER]).toEqual(edited);
    service.importCharacterXml("FighterHpReimported", service.exportCharacterXml("FighterHpReloaded"));
    expect(service.getCharacter("FighterHpReimported").hitPointRolls[ID_FIGHTER]).toEqual(edited);
  });
});

describe("the multiclass-capable rogue build (structural, checksum/rndhp masked)", () => {
  it("builds a stable elements tree, sum and wrapper attributes", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = buildBillyGate(service);
    const actualTree = treeSeq(state.elements, "Background");

    // Building the same character twice yields the same tree and sum.
    const twin = buildBillyGate(new CharacterService(undefined, library, { rng: seededRng(7) }));
    expect(treeSeq(twin.elements, "Background")).toEqual(actualTree);
    expect([...sumIds(state)].sort()).toEqual([...sumIds(twin)].sort());

    expect(state.sum.elementCount).toBe(78);
    expect(state.levelCount).toBe(5);
    expect(state.registeredCount).toBe(12);

    const backgroundWrapper = levelsOf(state)[0]!.children.find((n) => n.type === "Background")!;
    expect(backgroundWrapper.registered).toBe("");

    const xml = service.exportCharacterXml("BillyGate");
    expect(() => parseDnd5e(xml)).not.toThrow();
    const reimported = service.importCharacterXml("BillyGateRe", xml);
    expect(treeSeq(reimported.elements, "Background")).toEqual(actualTree);
    expect(reimported.sum.elementCount).toBe(78);
    expect(reimported.level).toBe(5);
  });

  it("rolls the rndhp on the starting level wrapper at class selection", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = buildBillyGate(service);
    const rolls = state.hitPointRolls[ID_ROGUE]!;
    expect(rolls).toHaveLength(20);
    for (const value of rolls) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(8);
    }
    const xml = service.exportCharacterXml("BillyGate");
    const reimported = mapToState(parseDnd5e(xml), "x");
    expect(reimported.hitPointRolls[ID_ROGUE]).toEqual(rolls);
  });
});

describe("delevel and undo", () => {
  it("reconstructs imported rogue levels for delevel, undo, and reimport", () => {
    const source = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(source);
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const imported = service.importCharacterXml("BillyImported", source.exportCharacterXml("BillyGate"));
    const before = treeSeq(imported.elements);

    expect(service.getProgression("BillyImported").canLevelDown).toBe(true);

    const result = service.delevel("BillyImported", { mode: "last" });
    const afterIds = treeSeq(service.getCharacter("BillyImported").elements).map((node) => node.id);
    expect(result.character.level).toBe(4);
    expect(result.removedLevel).toMatchObject({
      totalLevel: 5,
      classId: ID_ROGUE,
      classLevel: 5,
      isMulticlass: false,
    });
    expect(afterIds).not.toContain("ID_LEVEL_5");
    expect(afterIds).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_UNCANNY_DODGE");
    expect(afterIds).toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_ABILITYSCOREIMPROVEMENT_ROGUE");
    expect(afterIds).toContain("ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT");
    expect(afterIds).toContain("ID_INTERNAL_GRANT_RACE_DWARF");
    expect(afterIds).toContain("ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20");
    expect(sumIds(service.getCharacter("BillyImported"))).toEqual(expect.arrayContaining([
      "ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT",
      "ID_INTERNAL_GRANT_RACE_DWARF",
      "ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20",
    ]));

    const restored = service.undoDelevel("BillyImported");
    const restoredTree = treeSeq(service.getCharacter("BillyImported").elements);
    expect(restored.character.level).toBe(5);
    // Undo restores the tree exactly, grants included.
    expect(restoredTree).toEqual(before);
    expect(restoredTree.map((node) => node.id)).toEqual(expect.arrayContaining([
      "ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT",
      "ID_INTERNAL_GRANT_RACE_DWARF",
      "ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20",
    ]));
    expect(service.getProgression("BillyImported").canLevelDown).toBe(true);

    service.delevel("BillyImported", { mode: "last" });
    const reimportedXml = service.exportCharacterXml("BillyImported");
    service.importCharacterXml("BillyReimported", reimportedXml);
    expect(service.getProgression("BillyReimported").canLevelDown).toBe(true);
    const second = service.delevel("BillyReimported", { mode: "last" });
    const secondIds = treeSeq(service.getCharacter("BillyReimported").elements).map((node) => node.id);
    expect(second.character.level).toBe(3);
    expect(secondIds).not.toContain("ID_LEVEL_4");
    expect(secondIds).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_ABILITYSCOREIMPROVEMENT_ROGUE");
    expect(secondIds).toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_CUNNINGACTION");
  });

  it("reconstructs imported multiclass levels without removing main-class features", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    service.importCharacterXml("GrungImported", buildRangerRogue8(library, "RR8").service.exportCharacterXml("RR8"));

    const importedProgression = service.getProgression("GrungImported");
    expect(importedProgression.canLevelDown).toBe(true);
    expect(importedProgression.levelHistory[5]).toMatchObject({
      totalLevel: 6,
      classLevel: 1,
      isClassStart: true,
      canRemove: true,
    });
    const result = service.delevel("GrungImported", { mode: "class", classId: "ID_WOTC_PHB_MULTICLASS_ROGUE" });
    const afterIds = treeSeq(service.getCharacter("GrungImported").elements).map((node) => node.id);

    expect(result.character.level).toBe(7);
    expect(result.character.class).toBe("Ranger (5) / Rogue (2)");
    expect(service.getCharacter("GrungImported").registeredCount).toBe(13);
    expect(result.removedLevel).toMatchObject({
      totalLevel: 8,
      classId: "ID_WOTC_PHB_MULTICLASS_ROGUE",
      classLevel: 3,
      isMulticlass: true,
    });
    expect(afterIds).not.toContain("ID_LEVEL_8");
    expect(afterIds).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_ROGUISHARCHETYPE");
    expect(afterIds).toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_CUNNINGACTION");
    expect(afterIds).toContain("ID_WOTC_CLASSFEATURE_RANGER_EXTRA_ATTACK");

    service.importCharacterXml("GrungReimported", service.exportCharacterXml("GrungImported"));
    const second = service.delevel("GrungReimported", { mode: "last" });
    const secondIds = treeSeq(service.getCharacter("GrungReimported").elements).map((node) => node.id);
    expect(second.character.level).toBe(6);
    expect(secondIds).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_CUNNINGACTION");
    expect(secondIds).toContain("ID_INTERNAL_MULTICLASS_LEVEL_6");
    expect(secondIds).toContain("ID_WOTC_CLASSFEATURE_RANGER_EXTRA_ATTACK");
  });

  it("rejects imported level-one and unresolved level trees", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    service.importCharacterXml("LevelOne", buildCharacter(library, { id: "L1", classId: ID_FIGHTER }).service.exportCharacterXml("L1"));
    expect(service.getProgression("LevelOne").canLevelDown).toBe(false);
    expect(() => service.delevel("LevelOne", { mode: "last" })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );

    const unresolved = buildRangerRogue8(library, "RR8u").service.exportCharacterXml("RR8u").replace(
      'class="ID_WOTC_PHB_MULTICLASS_ROGUE"',
      'class="ID_HOMEBREW_UNKNOWN_MULTICLASS"',
    );
    service.importCharacterXml("Unresolved", unresolved);
    expect(service.getProgression("Unresolved").canLevelDown).toBe(false);
    expect(() => service.delevel("Unresolved", { mode: "last" })).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("delevel(last) removes the level wrapper and that level's features; undo restores exactly", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const state = buildBillyGate(service);
    const before = treeSeq(state.elements);
    const beforeSum = sumIds(state);

    const result = service.delevel("BillyGate", { mode: "last" });
    expect(result.removedLevel).toMatchObject({
      totalLevel: 5,
      classId: ID_ROGUE,
      className: "Rogue",
      classLevel: 5,
      isMulticlass: false,
      isClassStart: false,
      isPending: false,
      canRemove: true,
    });
    expect(result.canUndo).toBe(true);
    expect(result.requiredRepicks).toEqual([]);

    expect(result.character).toMatchObject({ id: "BillyGate", level: 4, race: "Mark of Warding", class: "Rogue" });
    const after = service.getCharacter("BillyGate");
    expect(after.level).toBe(4);
    expect(after.levelCount).toBe(4);
    expect(after.sum.elementCount).toBe(76);
    expect(treeSeq(after.elements)).toEqual(
      without(before, ["ID_LEVEL_5", "ID_WOTC_PHB_CLASS_FEATURE_ROGUE_UNCANNY_DODGE"]),
    );
    expect([...sumIds(after)].sort()).toEqual(
      beforeSum.filter((id) => !["ID_LEVEL_5", "ID_WOTC_PHB_CLASS_FEATURE_ROGUE_UNCANNY_DODGE"].includes(id)).sort(),
    );
    expect(service.getProgression("BillyGate").canUndoDelevel).toBe(true);

    const restored = service.undoDelevel("BillyGate");
    expect(restored.character).toMatchObject({ id: "BillyGate", level: 5 });
    expect(restored.canUndo).toBe(false);
    expect(restored.removedLevel).toBeNull();
    expect(restored.requiredRepicks).toEqual([]);
    const afterUndo = service.getCharacter("BillyGate");
    expect(afterUndo.level).toBe(5);
    expect(afterUndo.levelCount).toBe(5);
    expect(treeSeq(afterUndo.elements)).toEqual(before);
    expect([...sumIds(afterUndo)].sort()).toEqual([...beforeSum].sort());
    expect(afterUndo.sum.elementCount).toBe(78);
    expect(service.getProgression("BillyGate").canUndoDelevel).toBe(false);
  });

  it("deleveling three levels keeps requiredRepicks empty; undo restores the sum with options first", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);

    const one = service.delevel("BillyGate", { mode: "last" });
    expect(one.character.level).toBe(4);
    expect(one.requiredRepicks).toEqual([]);

    const two = service.delevel("BillyGate", { mode: "last" });
    expect(two.character.level).toBe(3);
    expect(two.requiredRepicks).toEqual([]);
    const beforeThird = treeSeq(service.getCharacter("BillyGate").elements);

    const three = service.delevel("BillyGate", { mode: "last" });
    expect(three.character.level).toBe(2);
    expect(three.removedLevel!.totalLevel).toBe(3);
    expect(three.requiredRepicks).toEqual([]);

    const state = service.getCharacter("BillyGate");
    expect(state.sum.elements.map((e) => e.id)).not.toContain("ID_WOTC_SCAG_ARCHETYPE_SWASHBUCKLER");
    expect(state.sum.elements.map((e) => e.id)).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_ROGUISHARCHETYPE");
    expect(state.sum.elements.map((e) => e.id)).toContain("ID_EXPERTISE_TOOL_THIEVES_TOOLS");
    expect(state.sum.elements.map((e) => e.id)).toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_CUNNINGACTION");
    expect(state.registeredCount).toBe(8);

    const restored = service.undoDelevel("BillyGate");
    expect(restored.character.level).toBe(3);
    const afterUndo = service.getCharacter("BillyGate");
    expect(treeSeq(afterUndo.elements)).toEqual(beforeThird);
    expect(afterUndo.sum.elementCount).toBe(74);
    expect(service.getProgression("BillyGate").canUndoDelevel).toBe(false);
  });

  it("undo reorders the sum with option entries first, mirroring the observed behavior", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildSpikeGate(service);
    const beforeDelevel = sumIds(service.getCharacter("Spike"));
    service.delevel("Spike", { mode: "last" });
    service.undoDelevel("Spike");
    const afterUndo = sumIds(service.getCharacter("Spike"));
    const options = [
      "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING",
      "ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING",
      "ID_INTERNAL_OPTION_ALLOW_FEATS",
    ];
    expect(afterUndo.slice(0, 3)).toEqual(options);
    expect(afterUndo.slice(3)).toEqual(beforeDelevel.filter((id) => !options.includes(id)));
  });

  it("level-up sum anchors mirror the observed behavior: level wrappers at the level anchor, features at the class subtree end", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildSpikeGate(service);
    const sum = sumIds(service.getCharacter("Spike"));
    expect(sum.indexOf("ID_LEVEL_2")).toBe(sum.indexOf("ID_RACIAL_TRAIT_DWARVEN_TOUGHNESS") + 1);
    expect(sum.indexOf("ID_LEVEL_3")).toBe(sum.indexOf("ID_LEVEL_2") + 1);
    expect(sum.indexOf("ID_WOTC_PHB_CLASS_FEATURE_ACTIONSURGE")).toBeGreaterThan(
      sum.indexOf("ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE"),
    );
    expect(sum[sum.length - 1]).toBe("ID_WOTC_PHB_CLASS_FEATURE_MARTIALARCHETYPE");
  });

  it("writes the fixture-pinned checksum for a selection wrapper spawned on level-up", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildSpikeGate(service);

    expect(service.exportCharacterXml("Spike")).toContain(
      'name="Martial Archetype" requiredLevel="3" checksum="6da99adc"',
    );
  });

  it("level-up writes the XP threshold of the new level; delevel subtracts 50, mirroring the observed behavior", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildSpikeGate(service);
    const xml = service.exportCharacterXml("Spike");
    expect(xml).toContain("<experience>900</experience>");
    expect(mapToState(parseDnd5e(xml), "x").experience).toBe(900);

    service.delevel("Spike", { mode: "last" });
    expect(mapToState(parseDnd5e(service.exportCharacterXml("Spike")), "x").experience).toBe(850);

    service.undoDelevel("Spike");
    expect(mapToState(parseDnd5e(service.exportCharacterXml("Spike")), "x").experience).toBe(900);
  });

  it("levelDown is the convenience form of delevel(last)", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    const after = service.levelDown("BillyGate");
    expect(after.level).toBe(4);
    expect(service.getCharacter("BillyGate").level).toBe(4);
  });
});

describe("setHitPointRoll", () => {
  it("replaces the rndhp slot of (class, classLevel) in the exported document", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 2, value: 6 });
    const xml = service.exportCharacterXml("BillyGate");
    const reimported = mapToState(parseDnd5e(xml), "x");
    const rolls = reimported.hitPointRolls[ID_ROGUE]!;
    expect(rolls[1]).toBe(6);
    expect(reimported.hitPointRolls[ID_ROGUE]).toHaveLength(20);
    expect(xml).toContain('rndhp="');
  });

  it("rejects non-positive values", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    expect(() => service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 2, value: 0 })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
    expect(() => service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 2, value: -3 })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("rejects values above the class hit die", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    expect(() => service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 2, value: 9 })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("rejects editing level 1 of the main class (fixed at the die maximum)", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    expect(() => service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 1, value: 5 })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("rejects edits while average hit points are enabled", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    buildBillyGate(service);
    service.setCharacterOption("BillyGate", { optionId: "ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP", enabled: true });
    expect(() => service.setHitPointRoll("BillyGate", { classId: ID_ROGUE, classLevel: 2, value: 5 })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });
});

describe("multiclass invariants", () => {
  function buildMulticlassCandidate(mainClassId = ID_ROGUE): CharacterService {
    const service = new CharacterService(undefined, library, { rng: seededRng(11) });
    service.createCharacter("MC");
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
    let state = service.getCharacter("MC");
    service.setSelection("MC", ruleOfType(pendingSelectionRules(state), "Class").identifier, mainClassId);
    service.levelUp("MC");
    return service;
  }

  it("counts a main-class level in the displayed class of a multiclassed character", () => {
    const service = buildMulticlassCandidate(ID_FIGHTER);
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.startMulticlass("MC", "ID_WOTC_PHB_MULTICLASS_ROGUE");
    expect(service.getCharacterDetail("MC").class).toBe("Fighter (1) / Rogue (1)");

    service.levelUp("MC");

    expect(service.getCharacterDetail("MC").class).toBe("Fighter (2) / Rogue (1)");
  });

  it("writes the fixture-pinned checksum for a multiclass selection wrapper", () => {
    const service = buildMulticlassCandidate(ID_FIGHTER);
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.startMulticlass("MC", "ID_WOTC_PHB_MULTICLASS_ROGUE");

    expect(service.exportCharacterXml("MC")).toContain(
      'name="Skill Proficiency (Rogue)" requiredLevel="1" checksum="78285350"',
    );
  });

  it("writes the fixture-pinned checksum on spawned multiclass level wrappers", () => {
    const service = buildMulticlassCandidate(ID_FIGHTER);
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.startMulticlass("MC", "ID_WOTC_PHB_MULTICLASS_ROGUE");
    let xml = service.exportCharacterXml("MC");
    expect(xml).toContain('name="Multiclass (Level 2)" requiredLevel="2" checksum="8efd27e5"');

    service.levelUpMode("MC", { mode: "new-multiclass" });
    xml = service.exportCharacterXml("MC");
    expect(xml).toContain('name="Multiclass (Level 3)" requiredLevel="3" checksum="3c1b6721"');
    expect(xml).not.toContain('checksum=""');
  });

  it("rejects startMulticlass without the option enabled and with unmet prerequisites", () => {
    const service = buildMulticlassCandidate();
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: false });
    expect(() => service.startMulticlass("MC", ID_MULTICLASS_WIZARD)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    expect(() => service.startMulticlass("MC", ID_MULTICLASS_WIZARD)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("transforms the empty level wrapper into the starting multiclass wrapper and cascades per the flip semantics", () => {
    const service = buildMulticlassCandidate();
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });

    service.startMulticlass("MC", ID_MULTICLASS_WIZARD);
    const state = service.getCharacter("MC");

    const levels = levelsOf(state);
    const level2 = levels[1]!;
    expect(level2.multiclass).toBe(true);
    expect(level2.starting).toBe(true);
    expect(level2.classId).toBe(ID_MULTICLASS_WIZARD);
    expect(level2.id).toBe("ID_LEVEL_2");

    const rolls = state.hitPointRolls[ID_MULTICLASS_WIZARD]!;
    expect(rolls).toHaveLength(20);
    expect(rolls[0]).not.toBe(6);
    for (const value of rolls) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }

    const multiclassWrapper = level2.children[0]!;
    expect(multiclassWrapper.type).toBe("Multiclass");
    expect(multiclassWrapper.requiredLevel).toBe(2);
    expect(multiclassWrapper.registered).toBe(ID_MULTICLASS_WIZARD);
    const ids = treeSeq([multiclassWrapper]).map((n) => n.id);
    expect(ids).toContain("ID_INTERNAL_GRANT_MULTICLASS");
    expect(ids).toContain("ID_WOTC_PHB_CLASS_FEATURE_WIZARD_SPELLCASTING_WIZARD");
    expect(ids).toContain("ID_WOTC_PHB_CLASS_FEATURE_WIZARD_ARCANE_RECOVERY");
    expect(ids).not.toContain("ID_PROFICIENCY_WEAPON_PROFICIENCY_DAGGER");
    expect(ids).not.toContain("ID_PROFICIENCY_SAVINGTHROW_WISDOM");

    expect(level2.children[1]!.id).toBe("ID_INTERNAL_MULTICLASS_LEVEL_2");

    const sum = sumIds(state);
    expect(sum).toContain("ID_INTERNAL_MULTICLASS_LEVEL_2");
    expect(sum).toContain(ID_MULTICLASS_WIZARD);
    expect(sum).toContain("ID_INTERNAL_GRANT_MULTICLASS");
    expect(sum).toContain("ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL");
    expect(sum).toContain("ID_LEVEL_1");
    expect(sum).toContain("ID_LEVEL_2");

    const xml = service.exportCharacterXml("MC");
    expect(xml).toContain('multiclass="true" starting="true"');
    expect(xml).toContain(`class="${ID_MULTICLASS_WIZARD}"`);
    const reimported = service.importCharacterXml("MC2", xml);
    expect(levelsOf(reimported)[1]!.multiclass).toBe(true);
    expect(reimported.hitPointRolls[ID_MULTICLASS_WIZARD]).toEqual(rolls);
  });

  it("starts a pending multiclass choice before advancing the selected class", () => {
    const service = buildMulticlassCandidate(ID_FIGHTER);
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });

    service.levelUpMode("MC", { mode: "new-multiclass" });

    let state = service.getCharacter("MC");
    expect(state.level).toBe(3);
    expect(levelsOf(state)[2]).toMatchObject({
      id: "ID_LEVEL_3",
      children: [
        {
          type: "Multiclass",
          name: "Multiclass (Level 3)",
          requiredLevel: 3,
          registered: "",
        },
        { id: "ID_INTERNAL_MULTICLASS_LEVEL_3" },
      ],
    });
    expect(levelsOf(state)[2]!.multiclass).toBeUndefined();
    expect(service.getProgression("MC").levelHistory[2]).toMatchObject({
      totalLevel: 3,
      classId: null,
      className: "Unresolved multiclass",
      classLevel: null,
      isMulticlass: true,
      isClassStart: false,
      isPending: true,
    });
    expect(service.getProgression("MC")).toMatchObject({ canLevelUp: true, canMulticlass: true });

    const rule = ruleOfType(pendingSelectionRules(state), "Multiclass");
    expect(selectionOptions(state, library, rule).map((option) => option.id)).toEqual([
      "ID_WOTC_TCOE_MULTICLASS_ARTIFICER",
      "ID_WOTC_ERLW_MULTICLASS_ARTIFICER",
      "ID_WOTC_UA_MULTICLASS_ARTIFICER",
      "ID_WOTC_UA20190228_MULTICLASS_ARTIFICER",
      "ID_WOTC_PHB_MULTICLASS_BARBARIAN",
      "ID_WOTC_PHB24_MULTICLASS_BARBARIAN",
      "ID_WOTC_PHB_MULTICLASS_ROGUE",
      "ID_WOTC_PHB24_MULTICLASS_ROGUE",
      ID_MULTICLASS_WIZARD,
      "ID_WOTC_PHB24_MULTICLASS_WIZARD",
    ]);
    service.setSelection("MC", rule.identifier, ID_MULTICLASS_WIZARD);

    state = service.getCharacter("MC");
    expect(levelsOf(state)[2]).toMatchObject({
      id: "ID_LEVEL_3",
      multiclass: true,
      starting: true,
      classId: ID_MULTICLASS_WIZARD,
    });
    expect(service.getProgression("MC").classes.map(({ className, level }) => ({ className, level }))).toEqual([
      { className: "Fighter", level: 2 },
      { className: "Wizard", level: 1 },
    ]);

    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MULTICLASS_WIZARD });
    state = service.getCharacter("MC");
    expect(service.getProgression("MC").classes.map(({ className, level }) => ({ className, level }))).toEqual([
      { className: "Fighter", level: 2 },
      { className: "Wizard", level: 2 },
    ]);
    expect(state.klass).toBe("Fighter (2) / Wizard (2)");
    const advancedSum = sumIds(state);
    expect(advancedSum.indexOf("ID_LEVEL_4")).toBeLessThan(advancedSum.indexOf(ID_FIGHTER));
    expect(treeSeq(state.elements).filter((node) => node.id === "ID_WOTC_PHB_CLASS_FEATURE_WIZARD_SPELLCASTING_WIZARD")).toHaveLength(1);
    const findRegistered = (nodes: RegisteredElement[], id: string): RegisteredElement | undefined => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const nested = findRegistered(node.children, id);
        if (nested) return nested;
      }
      return undefined;
    };
    const wizardSpellcasting = findRegistered(
      state.elements,
      "ID_WOTC_PHB_CLASS_FEATURE_WIZARD_SPELLCASTING_WIZARD",
    )!;
    expect(
      wizardSpellcasting.children.map((node) => node.requiredLevel ?? node.id),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, "ID_INTERNAL_GRANTS_SPELLCASTING_FEATURE", "ID_INTERNAL_RITUAL_CASTING", "ID_INTERNAL_PROFICIENCY_SPELLFOCUS_GROUP_ARCANE_FOCUS"]);
    expect(
      pendingSelectionRules(state).filter(
        (candidate) => candidate.type === "Spell" && candidate.name === "Spellbook (Wizard)" && candidate.requiredLevel === 2,
      ),
    ).toHaveLength(2);

    service.importCharacterXml("MCImported", service.exportCharacterXml("MC"));
    expect(service.getProgression("MCImported").canLevelDown).toBe(true);
    service.delevel("MCImported", { mode: "last" });
    expect(
      pendingSelectionRules(service.getCharacter("MCImported")).filter(
        (candidate) => candidate.type === "Spell" && candidate.name === "Spellbook (Wizard)" && candidate.requiredLevel === 2,
      ),
    ).toHaveLength(0);

    service.delevel("MC", { mode: "last" });
    state = service.getCharacter("MC");
    expect(state.klass).toBe("Fighter (2) / Wizard (1)");
    expect(
      pendingSelectionRules(state).filter(
        (candidate) => candidate.type === "Spell" && candidate.name === "Spellbook (Wizard)" && candidate.requiredLevel === 2,
      ),
    ).toHaveLength(0);

    service.undoDelevel("MC");
    state = service.getCharacter("MC");
    expect(state.klass).toBe("Fighter (2) / Wizard (2)");
    expect(
      pendingSelectionRules(state).filter(
        (candidate) => candidate.type === "Spell" && candidate.name === "Spellbook (Wizard)" && candidate.requiredLevel === 2,
      ),
    ).toHaveLength(2);
  });

  it("re-picking an already-resolved multiclass choice actually changes the class", () => {
    const service = buildMulticlassCandidate(ID_FIGHTER);
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
    service.levelUpMode("MC", { mode: "new-multiclass" });
    let state = service.getCharacter("MC");
    const rule = ruleOfType(pendingSelectionRules(state), "Multiclass");

    service.setSelection("MC", rule.identifier, ID_MULTICLASS_WIZARD);
    state = service.getCharacter("MC");
    expect(levelsOf(state)[2]).toMatchObject({ classId: ID_MULTICLASS_WIZARD, multiclass: true, starting: true });
    const wizardRolls = state.hitPointRolls[ID_MULTICLASS_WIZARD];
    expect(wizardRolls).toHaveLength(20);

    // Reselecting must neither throw (it corrupted the document) nor leave the
    // class unchanged (it silently kept Wizard registered).
    const changed = service.setSelection("MC", rule.identifier, "ID_WOTC_PHB_MULTICLASS_ROGUE");
    expect(levelsOf(changed)[2]).toMatchObject({
      classId: "ID_WOTC_PHB_MULTICLASS_ROGUE",
      multiclass: true,
      starting: true,
    });
    expect(changed.level).toBe(3);
    expect(changed.klass).toBe("Fighter (2) / Rogue (1)");
    expect(changed.hitPointRolls["ID_WOTC_PHB_MULTICLASS_ROGUE"]).toHaveLength(20);
    expect(changed.hitPointRolls[ID_MULTICLASS_WIZARD]).toBeUndefined();
    const sum = sumIds(changed);
    expect(sum).toContain("ID_WOTC_PHB_MULTICLASS_ROGUE");
    expect(sum).not.toContain(ID_MULTICLASS_WIZARD);
    const ids = treeSeq(levelsOf(changed)).map((n) => n.id);
    expect(ids).not.toContain("ID_WOTC_PHB_CLASS_FEATURE_WIZARD_SPELLCASTING_WIZARD");

    // The document must still be well-formed and round-trip through export/import.
    const xml = service.exportCharacterXml("MC");
    const reimported = service.importCharacterXml("MC2", xml);
    expect(levelsOf(reimported)[2]!.classId).toBe("ID_WOTC_PHB_MULTICLASS_ROGUE");

    // Clearing the resolved selection removes the multiclass level entirely.
    const cleared = service.clearSelection("MC", rule.identifier);
    expect(cleared.level).toBe(2);
    expect(cleared.klass).toBe("Fighter");

    // Once leveled further into the multiclass, the choice can no longer be
    // swapped in place (the composed delevel+restart primitive only ever
    // removes the character's single most-recent level).
    service.levelUpMode("MC", { mode: "new-multiclass" });
    state = service.getCharacter("MC");
    const rule2 = ruleOfType(pendingSelectionRules(state), "Multiclass");
    service.setSelection("MC", rule2.identifier, ID_MULTICLASS_WIZARD);
    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MULTICLASS_WIZARD });
    expect(() => service.setSelection("MC", rule2.identifier, "ID_WOTC_PHB_MULTICLASS_ROGUE")).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("levelUpMulticlass appends a self-closing multiclass level wrapper and the next class level features", () => {
    const service = buildMulticlassCandidate();
    service.setCharacterOption("MC", { optionId: ID_OPTION_MULTICLASS, enabled: true });
    service.setAbilities("MC", { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
    service.startMulticlass("MC", ID_MULTICLASS_WIZARD);

    service.levelUpMode("MC", { mode: "multiclass", classId: ID_MULTICLASS_WIZARD });
    const state = service.getCharacter("MC");
    expect(state.level).toBe(3);
    const levels = levelsOf(state);
    const level3 = levels[2]!;
    expect(level3.multiclass).toBe(true);
    expect(level3.starting).toBeUndefined();
    expect(level3.classId).toBe(ID_MULTICLASS_WIZARD);
    expect(level3.children).toHaveLength(0);
    expect(sumIds(state)).toContain("ID_LEVEL_3");
    expect(sumIds(state)).toContain("ID_WOTC_PHB_CLASS_FEATURE_WIZARD_ARCANE_TRADITION");

    const multiclassWrapper = levels[1]!.children[0]!;
    const ids = treeSeq([multiclassWrapper]).map((n) => n.id);
    expect(ids).toContain("ID_WOTC_PHB_CLASS_FEATURE_WIZARD_ARCANE_TRADITION");

    expect(() => service.startMulticlass("MC", ID_MULTICLASS_WIZARD)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });
});
