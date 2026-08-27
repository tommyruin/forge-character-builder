/**
 * Removing a level that is not the character's last one.
 *
 * The engine only ever pops the newest level, so lowering an earlier class
 * unwinds down to that level and replays everything above it. These tests pin
 * both halves: the levels above survive with their choices, and a level whose
 * class container has since gained unrelated content is still removable.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  buildCharacter,
  buildRangerRogue8,
  freshService,
  ruleOfType,
  sharedLibrary,
  ID,
} from "../testing/character-factory.js";
import { pendingSelectionRules } from "../selection/selection.js";
import type { CharacterState, RegisteredElement } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120000);

const ID_MULTICLASS_UNLOCKER = "ID_INTERNAL_ITEM_MULTICLASS_UNLOCKER";
const ID_MULTICLASSING_PREREQUISITE = "ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE";
const ID_WIZARD_ASI = "ID_WOTC_PHB_CLASS_FEATURE_WIZARD_ABILITYSCOREIMPROVEMENT_WIZARD";
const ID_CLASS_BARD = "ID_WOTC_PHB_CLASS_BARD";
const ID_COLLEGE_OF_SWORDS = "ID_WOTC_XGTE_ARCHETYPE_COLLEGE_OF_SWORDS";

/** Every element id registered in the tree, in depth-first order. */
function treeIds(state: CharacterState): string[] {
  const out: string[] = [];
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.id !== "") out.push(node.id);
      if ((node.registered ?? "") !== "") out.push(node.registered!);
      walk(node.children);
    }
  };
  walk(state.elements);
  return out;
}

describe("delevel with a changed class container", () => {
  it("removes the last level after the multiclass unlocker added a grant to the class container", () => {
    const id = "UnlockedWizard";
    const { service } = buildCharacter(library, { id, classId: ID.CLASS_WIZARD, levels: 4 });
    service.setCharacterControl(id, { key: `item:${ID_MULTICLASS_UNLOCKER}`, enabled: true });
    expect(treeIds(service.getCharacter(id))).toContain(ID_MULTICLASSING_PREREQUISITE);

    const result = service.delevel(id, { mode: "last" });

    expect(result.character.level).toBe(3);
    const after = treeIds(service.getCharacter(id));
    expect(after).not.toContain(ID_WIZARD_ASI);
    expect(after).toContain(ID_MULTICLASSING_PREREQUISITE);
  });
});

describe("delevel by class", () => {
  it("lowers the main class while a multiclass level sits on top", () => {
    const id = "BarbRogue";
    const { service } = buildCharacter(library, { id, classId: ID.CLASS_BARBARIAN, levels: 4 });
    service.setCharacterControl(id, { key: `item:${ID_MULTICLASS_UNLOCKER}`, enabled: true });
    service.levelUpMode(id, { mode: "new-multiclass" });
    const multiclass = ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Multiclass");
    service.setSelection(id, multiclass.identifier, ID.MULTICLASS_ROGUE);
    expect(service.getCharacterDetail(id).class).toBe("Barbarian (4) / Rogue (1)");

    const result = service.delevel(id, { mode: "class", classId: ID.CLASS_BARBARIAN });

    expect(result.character.level).toBe(4);
    expect(result.character.class).toBe("Barbarian (3) / Rogue (1)");
    expect(result.removedLevel).toMatchObject({
      classId: ID.CLASS_BARBARIAN,
      classLevel: 4,
      isMulticlass: false,
    });
    const history = service.getProgression(id).levelHistory;
    expect(history.map((entry) => `${entry.className} ${entry.classLevel}`)).toEqual([
      "Barbarian 1", "Barbarian 2", "Barbarian 3", "Rogue 1",
    ]);
  });

  it("lowers a main class level below a deep multiclass and keeps the later levels", () => {
    const { service, id } = buildRangerRogue8(library, "RR8Lower");
    const before = service.getCharacterDetail(id);
    expect(before.class).toBe("Ranger (5) / Rogue (3)");

    const result = service.delevel(id, { mode: "class", classId: ID.CLASS_RANGER });

    expect(result.character.level).toBe(7);
    expect(result.character.class).toBe("Ranger (4) / Rogue (3)");
    const after = treeIds(service.getCharacter(id));
    expect(after).toContain("ID_WOTC_PHB_CLASS_FEATURE_ROGUE_CUNNINGACTION");
    expect(after).not.toContain("ID_WOTC_CLASSFEATURE_RANGER_EXTRA_ATTACK");
  });

  it("restores the whole unwind and replay on undo", () => {
    const { service, id } = buildRangerRogue8(library, "RR8Undo");
    const beforeTree = treeIds(service.getCharacter(id));
    const beforeSum = [...service.getCharacter(id).sum.elements.map((entry) => entry.id)].sort();
    const beforeRules = pendingSelectionRules(service.getCharacter(id)).length;

    service.delevel(id, { mode: "class", classId: ID.CLASS_RANGER });
    const restored = service.undoDelevel(id);

    expect(restored.character.level).toBe(8);
    expect(restored.character.class).toBe("Ranger (5) / Rogue (3)");
    // Undo replays the captured document text; only the sum is re-serialized,
    // options first, so the ids come back as a set rather than in place.
    expect(treeIds(service.getCharacter(id))).toEqual(beforeTree);
    expect([...service.getCharacter(id).sum.elements.map((entry) => entry.id)].sort()).toEqual(beforeSum);
    expect(pendingSelectionRules(service.getCharacter(id)).length).toBe(beforeRules);
    expect(service.getProgression(id).canUndoDelevel).toBe(false);
  });

  it("still rejects lowering a class the character does not have", () => {
    const { service, id } = buildCharacter(library, { id: "Solo", classId: ID.CLASS_FIGHTER, levels: 3 });
    expect(() => service.delevel(id, { mode: "class", classId: ID.CLASS_ROGUE })).toThrowError(
      expect.objectContaining({ code: "not-found" }),
    );
  });
});

describe("imported characters", () => {
  it("removes a level whose own subtree holds one of its level-gated choices", () => {
    const id = "SwordsBard";
    const { service } = buildCharacter(library, { id, classId: ID_CLASS_BARD, levels: 3 });
    const archetype = ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Archetype");
    service.setSelection(id, archetype.identifier, ID_COLLEGE_OF_SWORDS);
    const imported = freshService(library);
    imported.importCharacterXml(id, service.exportCharacterXml(id));

    const result = imported.delevel(id, { mode: "last" });

    expect(result.character.level).toBe(2);
    const after = treeIds(imported.getCharacter(id));
    expect(after).not.toContain(ID_COLLEGE_OF_SWORDS);
    expect(after).toContain("ID_WOTC_PHB_CLASS_FEATURE_BARD_BARDIC_INSPIRATION");
    // The document has to survive the removal intact: the level's own content
    // and the choice nested inside it must not be planned as two edits.
    const reimported = freshService(library);
    reimported.importCharacterXml(id, imported.exportCharacterXml(id));
    expect(reimported.getCharacter(id).level).toBe(2);
    expect(treeIds(reimported.getCharacter(id))).toEqual(after);
  });


  it("reconstructs records for a character whose class container carries later grants", () => {
    const id = "UnlockedImport";
    const { service } = buildCharacter(library, { id, classId: ID.CLASS_WIZARD, levels: 4 });
    service.setCharacterControl(id, { key: `item:${ID_MULTICLASS_UNLOCKER}`, enabled: true });
    const imported = freshService(library);
    imported.importCharacterXml(id, service.exportCharacterXml(id));

    expect(imported.getProgression(id).canLevelDown).toBe(true);
    expect(imported.delevel(id, { mode: "last" }).character.level).toBe(3);
  });
});

describe("per-class removability", () => {
  it("marks every class whose most recent level the engine can still unwind to", () => {
    const { service, id } = buildRangerRogue8(library, "RR8Lowerable");
    const classes = service.getProgression(id).classes;

    expect(classes.map((entry) => [entry.className, entry.canLower])).toEqual([
      ["Ranger", true],
      ["Rogue", true],
    ]);
  });

  it("marks a class unlowerable when the levels above it have no registration records", () => {
    const { service, id } = buildRangerRogue8(library, "RR8Partial");
    const imported = freshService(library);
    imported.importCharacterXml(id, service.exportCharacterXml(id));
    // Imported characters only carry records for the levels the engine could
    // account for, and a class below the oldest of those cannot be unwound to.
    const state = imported.getCharacter(id);
    state.levelRegistrations = state.levelRegistrations.slice(-2);

    const classes = imported.getProgression(id).classes;
    expect(classes.find((entry) => entry.className === "Ranger")?.canLower).toBe(false);
    expect(classes.find((entry) => entry.className === "Rogue")?.canLower).toBe(true);
  });

  it("marks a level-1 character's only class unlowerable", () => {
    const { service, id } = buildCharacter(library, { id: "Novice", classId: ID.CLASS_FIGHTER, levels: 1 });
    expect(service.getProgression(id).classes[0]?.canLower).toBe(false);
  });
});
