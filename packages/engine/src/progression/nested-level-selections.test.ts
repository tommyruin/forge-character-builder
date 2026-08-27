/**
 * Level-gated <select> rules on elements OUTSIDE the class subtree.
 *
 * Adjustment items (Manage -> Character -> Additional features) and races sit
 * beside the class wrapper, outside the level-up walk of the class subtree, so
 * their later choices need their own pass. Their `level=` gate is the CHARACTER
 * level, unlike a class feature's, which is the class level.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "../selection/selection.js";
import type { CharacterState } from "../character/state.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_FIGHTER = "ID_WOTC_PHB_CLASS_FIGHTER";
const ID_BONUS_FEATS = "ID_WOTC_DSDQ_ITEM_BONUS_FEATS";
const ID_ELADRIN = "ID_WOTC_MOTM_RACE_ELADRIN";
const ID_FEAT_SKILLED = "ID_PHB_FEAT_SKILLED";
const ID_FEAT_TOUGH = "ID_PHB_FEAT_TOUGH";
const ID_FEAT_KNIGHT_OF_THE_CROWN = "ID_WOTC_DSDQ_FEAT_KNIGHT_OF_THE_CROWN";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

function rulesNamed(state: CharacterState, name: string): SelectionRule[] {
  return pendingSelectionRules(state).filter((rule) => rule.name === name);
}

function featNames(service: CharacterService, id: string): string[] {
  return service.getCharacterDetail(id).registeredElements.filter((e) => e.type === "Feat").map((e) => e.name);
}

/** A level-1 fighter with multiclassing enabled and the stats to qualify. */
function buildMulticlassReady(id: string): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter(id);
  service.setAbilities(id, { strength: 15, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
  service.setCharacterOption(id, { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
  service.setSelection(id, ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Class").identifier, ID_FIGHTER);
  return service;
}

/** A level-1 fighter, optionally of the given race. */
function buildFighter(id: string, raceId?: string): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter(id);
  service.setAbilities(id, { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
  if (raceId !== undefined) {
    service.setSelection(id, ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Race").identifier, raceId);
  }
  service.setSelection(id, ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Class").identifier, ID_FIGHTER);
  return service;
}

describe("level-gated selects outside the class subtree", () => {
  it("spawns the Dragonlance 4th-level bonus feat when the character reaches level 4", () => {
    const service = buildFighter("DL");
    service.setCharacterControl("DL", { key: `item:${ID_BONUS_FEATS}`, enabled: true });

    // At level 1 only the 1st-level slot exists, and it really is Skilled/Tough
    // only — that is the printed Dragonlance rule, enforced by the select's
    // supports expression.
    let state = service.getCharacter("DL");
    expect(rulesNamed(state, "Bonus Feat (4th Level)")).toHaveLength(0);
    const firstLevel = rulesNamed(state, "Bonus Feat (1st Level)");
    expect(firstLevel).toHaveLength(1);
    expect(selectionOptions(state, library, firstLevel[0]!).map((option) => option.id).sort()).toEqual(
      [ID_FEAT_SKILLED, ID_FEAT_TOUGH].sort(),
    );

    service.levelUp("DL");
    service.levelUp("DL");
    service.levelUp("DL");

    state = service.getCharacter("DL");
    const fourthLevel = rulesNamed(state, "Bonus Feat (4th Level)");
    expect(fourthLevel).toHaveLength(1);
    expect(fourthLevel[0]!.requiredLevel).toBe(4);
    // The 4th-level list is the 1st-level pair plus everything else the
    // Dragonlance rule allows whose own prerequisites this fighter meets. The
    // Knight and Adept feats are absent because they require Squire of
    // Solamnia / Initiate of High Sorcery, not because of the level gate.
    const options = selectionOptions(state, library, fourthLevel[0]!).map((option) => option.id).sort();
    expect(options).toEqual([
      "ID_PHB_FEAT_ALERT",
      "ID_PHB_FEAT_MOBILE",
      "ID_PHB_FEAT_SENTINEL",
      ID_FEAT_SKILLED,
      ID_FEAT_TOUGH,
      "ID_PHB_FEAT_WARCASTER",
    ].sort());
    expect(options).not.toContain(ID_FEAT_KNIGHT_OF_THE_CROWN);
  });

  it("removes the level-4 bonus feat slot again on delevel", () => {
    const service = buildFighter("DLDown");
    service.setCharacterControl("DLDown", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    service.levelUp("DLDown");
    service.levelUp("DLDown");
    service.levelUp("DLDown");
    expect(rulesNamed(service.getCharacter("DLDown"), "Bonus Feat (4th Level)")).toHaveLength(1);

    service.levelDown("DLDown");
    expect(rulesNamed(service.getCharacter("DLDown"), "Bonus Feat (4th Level)")).toHaveLength(0);
  });

  it("does not duplicate a slot the item already brought when it was equipped late", () => {
    const service = buildFighter("DLLate");
    service.levelUp("DLLate");
    service.levelUp("DLLate");
    service.levelUp("DLLate");
    // Equipping at level 4 registers both selects immediately.
    service.setCharacterControl("DLLate", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    expect(rulesNamed(service.getCharacter("DLLate"), "Bonus Feat (4th Level)")).toHaveLength(1);

    service.levelUp("DLLate");
    expect(rulesNamed(service.getCharacter("DLLate"), "Bonus Feat (4th Level)")).toHaveLength(1);
  });

  it("spawns a race's level-gated select (Eladrin Fey Step season at level 3)", () => {
    const service = buildFighter("Fey", ID_ELADRIN);
    expect(rulesNamed(service.getCharacter("Fey"), "Season (Fey Step)")).toHaveLength(0);

    service.levelUp("Fey");
    service.levelUp("Fey");

    const season = rulesNamed(service.getCharacter("Fey"), "Season (Fey Step)");
    expect(season).toHaveLength(1);
    expect(season[0]!.requiredLevel).toBe(3);
    expect(selectionOptions(service.getCharacter("Fey"), library, season[0]!).length).toBe(4);
  });

  it("spawns the slot when the character level comes from a multiclass level", () => {
    // Taking a new class raises the character level in its own step, before any
    // class advances — the character-level gate has to fire there too.
    const service = new CharacterService(undefined, library);
    service.createCharacter("MC");
    service.setAbilities("MC", { strength: 15, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 });
    service.setCharacterOption("MC", { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
    service.setSelection("MC", ruleOfType(pendingSelectionRules(service.getCharacter("MC")), "Class").identifier, ID_FIGHTER);
    service.setCharacterControl("MC", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    service.levelUp("MC");
    service.levelUp("MC");
    expect(rulesNamed(service.getCharacter("MC"), "Bonus Feat (4th Level)")).toHaveLength(0);

    service.levelUpMode("MC", { mode: "new-multiclass" });
    expect(service.getCharacter("MC").level).toBe(4);
    expect(rulesNamed(service.getCharacter("MC"), "Bonus Feat (4th Level)")).toHaveLength(1);

    const multiclass = ruleOfType(pendingSelectionRules(service.getCharacter("MC")), "Multiclass");
    service.setSelection("MC", multiclass.identifier, "ID_WOTC_PHB_MULTICLASS_WIZARD");
    expect(rulesNamed(service.getCharacter("MC"), "Bonus Feat (4th Level)")).toHaveLength(1);
  });

  it("takes back a FILLED slot on delevel without corrupting the document", () => {
    const service = buildFighter("DLFilled");
    service.setCharacterControl("DLFilled", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    service.levelUp("DLFilled");
    service.levelUp("DLFilled");
    service.levelUp("DLFilled");
    const slot = rulesNamed(service.getCharacter("DLFilled"), "Bonus Feat (4th Level)")[0]!;
    service.setSelection("DLFilled", slot.identifier, "ID_PHB_FEAT_ALERT");
    expect(featNames(service, "DLFilled")).toContain("Alert");

    service.levelDown("DLFilled");
    expect(service.getCharacter("DLFilled").level).toBe(3);
    expect(rulesNamed(service.getCharacter("DLFilled"), "Bonus Feat (4th Level)")).toHaveLength(0);
    expect(featNames(service, "DLFilled")).not.toContain("Alert");
    // The document still parses: a filled wrapper receives one removal edit,
    // never an overlapping clear-the-pick edit as well.
    expect(() => service.exportCharacterXml("DLFilled")).not.toThrow();
  });

  it("takes the slot back when the level being removed is a pending multiclass one", () => {
    const service = buildMulticlassReady("MCDown");
    service.setCharacterControl("MCDown", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    service.levelUp("MCDown");
    service.levelUp("MCDown");
    service.levelUpMode("MCDown", { mode: "new-multiclass" });
    const slot = rulesNamed(service.getCharacter("MCDown"), "Bonus Feat (4th Level)")[0]!;
    service.setSelection("MCDown", slot.identifier, "ID_PHB_FEAT_ALERT");

    service.levelDown("MCDown");
    expect(service.getCharacter("MCDown").level).toBe(3);
    expect(rulesNamed(service.getCharacter("MCDown"), "Bonus Feat (4th Level)")).toHaveLength(0);
    expect(featNames(service, "MCDown")).not.toContain("Alert");
  });

  it("round-trips the added slot through export and import", () => {
    const service = buildFighter("DLRound");
    service.setCharacterControl("DLRound", { key: `item:${ID_BONUS_FEATS}`, enabled: true });
    service.levelUp("DLRound");
    service.levelUp("DLRound");
    service.levelUp("DLRound");

    service.importCharacterXml("DLRoundImported", service.exportCharacterXml("DLRound"));
    expect(rulesNamed(service.getCharacter("DLRoundImported"), "Bonus Feat (4th Level)")).toHaveLength(1);
  });
});
