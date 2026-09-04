/**
 * Level-gated rules on elements registered by an EARLIER level.
 *
 * Two shapes, one planner pass (`withNestedLevelRules`):
 *
 * - `<select>` rules on adjustment items (Manage -> Character -> Additional
 *   features) and races, which sit beside the class wrapper, outside the
 *   level-up walk of the class subtree, so their later choices need their own
 *   pass. Their `level=` gate is the CHARACTER level, unlike a class feature's,
 *   which is the class level;
 * - `<grant>` rules on a feature the class registered earlier — the 2024
 *   subclass spell tables — whose targets only become eligible at a later
 *   class level.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions, type SelectionRule } from "../selection/selection.js";
import type { CharacterState } from "../character/state.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const ID_FIGHTER = "ID_WOTC_PHB_CLASS_FIGHTER";
const ID_BONUS_FEATS = "ID_WOTC_DSDQ_ITEM_BONUS_FEATS";
const ID_ELADRIN = "ID_WOTC_MOTM_RACE_ELADRIN";
const ID_FEAT_SKILLED = "ID_PHB_FEAT_SKILLED";
const ID_FEAT_TOUGH = "ID_PHB_FEAT_TOUGH";
const ID_FEAT_KNIGHT_OF_THE_CROWN = "ID_WOTC_DSDQ_FEAT_KNIGHT_OF_THE_CROWN";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
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

const ID_SORCERER_24 = "ID_WOTC_PHB24_CLASS_SORCERER";
const ID_DRACONIC_24 = "ID_WOTC_PHB24_ARCHETYPE_SORCERER_DRACONIC_SORCERY";
const ID_DRACONIC_SPELLS_24 = "ID_WOTC_PHB24_ARCHETYPE_FEATURE_SORCERER_DRACONIC_SORCERY_DRACONIC_SPELLS";
const ID_SPELL_CHROMATIC_ORB = "ID_WOTC_PHB24_SPELL_CHROMATIC_ORB";
const ID_SPELL_FEAR = "ID_WOTC_PHB24_SPELL_FEAR";
const ID_SPELL_FLY = "ID_WOTC_PHB24_SPELL_FLY";
const ID_SPELL_ARCANE_EYE = "ID_WOTC_PHB24_SPELL_ARCANE_EYE";

/** A 2024 sorcerer at `levels`, taking Draconic Sorcery at level 3. */
function buildDraconic(id: string, levels: number): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter(id);
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 10, dexterity: 14, constitution: 13, intelligence: 14, wisdom: 10, charisma: 15 });
  service.setCharacterOption(id, { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (candidate) => candidate.type === type && !candidate.hasSelection,
    );
    if (!rule) throw new Error(`no pending ${type} rule`);
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", "ID_WOTC_PHB24_RACE_HUMAN");
  pick("Class", ID_SORCERER_24);
  pick("Background", "ID_WOTC_PHB24_BACKGROUND_SOLDIER");
  for (let level = 2; level <= levels; level++) {
    service.levelUp(id);
    if (level === 3) pick("Archetype", ID_DRACONIC_24);
  }
  return service;
}

/** The ids registered directly beneath the feature that grants the subclass spells. */
function draconicSpellChildren(service: CharacterService, id: string): string[] {
  const out: string[] = [];
  const walk = (nodes: CharacterState["elements"]): void => {
    for (const node of nodes) {
      if (node.id === ID_DRACONIC_SPELLS_24) out.push(...node.children.map((child) => child.id));
      else walk(node.children);
    }
  };
  walk(service.getCharacter(id).elements);
  return out;
}

describe("level-gated grants on an already-registered feature", () => {
  it("registers the 5th-level subclass spells when the class level reaches 5", () => {
    const service = buildDraconic("Draconic", 5);

    // Chromatic Orb came with the feature at 3; Fear and Fly are `level="5"`
    // grants on that same feature and register underneath it, not in the
    // class container.
    expect(draconicSpellChildren(service, "Draconic")).toEqual([
      ID_SPELL_CHROMATIC_ORB,
      "ID_WOTC_PHB24_SPELL_COMMAND",
      "ID_WOTC_PHB24_SPELL_ALTER_SELF",
      "ID_WOTC_PHB24_SPELL_DRAGONS_BREATH",
      ID_SPELL_FEAR,
      ID_SPELL_FLY,
    ]);
    const sum = service.getCharacter("Draconic").sum.elements.map((entry) => entry.id);
    expect(sum.filter((entry) => entry === ID_SPELL_FEAR)).toHaveLength(1);
    expect(sum).toContain(ID_SPELL_FLY);
    // The 7th-level row waits for level 7.
    expect(sum).not.toContain(ID_SPELL_ARCANE_EYE);
  });

  it("takes them back on delevel and puts them back on undo", () => {
    const service = buildDraconic("DraconicDown", 5);

    service.levelDown("DraconicDown");
    expect(draconicSpellChildren(service, "DraconicDown")).not.toContain(ID_SPELL_FEAR);
    expect(service.getCharacter("DraconicDown").sum.elements.map((e) => e.id)).not.toContain(ID_SPELL_FEAR);
    expect(() => service.exportCharacterXml("DraconicDown")).not.toThrow();

    service.undoDelevel("DraconicDown");
    expect(service.getCharacter("DraconicDown").level).toBe(5);
    expect(draconicSpellChildren(service, "DraconicDown")).toContain(ID_SPELL_FEAR);
    expect(service.getCharacter("DraconicDown").sum.elements.map((e) => e.id)).toContain(ID_SPELL_FEAR);
  });

  it("round-trips through export and import, and the replayed record still removes them", () => {
    const service = buildDraconic("DraconicRound", 5);
    const exported = service.exportCharacterXml("DraconicRound");
    service.importCharacterXml("DraconicImported", exported);

    expect(service.exportCharacterXml("DraconicImported")).toBe(exported);
    expect(draconicSpellChildren(service, "DraconicImported")).toContain(ID_SPELL_FEAR);
    // The reconstructed record has to name the spliced grants: without them
    // level 5 either refuses to come off or leaves the spells behind.
    service.levelDown("DraconicImported");
    expect(draconicSpellChildren(service, "DraconicImported")).not.toContain(ID_SPELL_FEAR);
    expect(service.getCharacter("DraconicImported").sum.elements.map((e) => e.id)).not.toContain(ID_SPELL_FEAR);
  });

  it("gates a class feature's grant on the CLASS level, not the character level", () => {
    // Sorcerer 4 / Wizard 1 is character level 5 with a 4th-level sorcerer:
    // the subclass's 5th-level spells stay out.
    const service = buildDraconic("DraconicMC", 4);
    service.levelUpMode("DraconicMC", { mode: "new-multiclass" });
    const rule = ruleOfType(pendingSelectionRules(service.getCharacter("DraconicMC")), "Multiclass");
    service.setSelection("DraconicMC", rule.identifier, "ID_WOTC_PHB24_MULTICLASS_WIZARD");

    expect(service.getCharacter("DraconicMC").level).toBe(5);
    expect(draconicSpellChildren(service, "DraconicMC")).not.toContain(ID_SPELL_FEAR);
  });
});

const ID_CHAMPION = "ID_WOTC_PHB_ARCHETYPE_CHAMPION";
const ID_IMPROVED_CRITICAL = "ID_WOTC_PHB_ARCHETYPE_FEATURE_IMPROVEDCRITICAL";
const ID_REMARKABLE_ATHLETE = "ID_WOTC_PHB_ARCHETYPE_FEATURE_REMARKABLEATHLETE";
const ID_ADDITIONAL_FIGHTING_STYLE = "ID_WOTC_PHB_ARCHETYPE_FEATURE_ADDITIONALFIGHTINGSTYLE";
const ID_ELEMENTAL_AFFINITY_24 =
  "ID_WOTC_PHB24_ARCHETYPE_FEATURE_SORCERER_DRACONIC_SORCERY_ELEMENTAL_AFFINITY";

/** How many times an id is registered anywhere in the tree. */
function registrationCount(service: CharacterService, id: string, elementId: string): number {
  let count = 0;
  const walk = (nodes: CharacterState["elements"]): void => {
    for (const node of nodes) {
      if (node.id === elementId) count++;
      walk(node.children);
    }
  };
  walk(service.getCharacter(id).elements);
  return count;
}

/** A 2014 fighter at `levels`, taking Champion at `archetypeAt`. */
function buildChampion(id: string, levels: number, archetypeAt = 3): CharacterService {
  const service = buildFighter(id);
  for (let level = 2; level <= levels; level++) {
    service.levelUp(id);
    if (level === archetypeAt) {
      service.setSelection(id, ruleOfType(pendingSelectionRules(service.getCharacter(id)), "Archetype").identifier, ID_CHAMPION);
    }
  }
  return service;
}

describe("level-gated rules on a subclass the player picked", () => {
  it("registers Champion's Remarkable Athlete at fighter level 7", () => {
    // The grant is declared by the Champion element, which lives in the tree as
    // the pick inside the Archetype wrapper rather than as a node of its own.
    const atSix = buildChampion("Champ6", 6);
    expect(registrationCount(atSix, "Champ6", ID_REMARKABLE_ATHLETE)).toBe(0);
    expect(registrationCount(atSix, "Champ6", ID_IMPROVED_CRITICAL)).toBe(1);

    const atSeven = buildChampion("Champ7", 7);
    expect(registrationCount(atSeven, "Champ7", ID_REMARKABLE_ATHLETE)).toBe(1);
    expect(atSeven.getCharacter("Champ7").sum.elements.map((e) => e.id)).toContain(ID_REMARKABLE_ATHLETE);
    // Level 10's feature keeps waiting.
    expect(registrationCount(atSeven, "Champ7", ID_ADDITIONAL_FIGHTING_STYLE)).toBe(0);
  });

  it("takes the subclass feature back on delevel and puts it back on undo", () => {
    const service = buildChampion("ChampDown", 7);

    service.levelDown("ChampDown");
    expect(service.getCharacter("ChampDown").level).toBe(6);
    expect(registrationCount(service, "ChampDown", ID_REMARKABLE_ATHLETE)).toBe(0);
    expect(service.getCharacter("ChampDown").sum.elements.map((e) => e.id)).not.toContain(ID_REMARKABLE_ATHLETE);
    expect(() => service.exportCharacterXml("ChampDown")).not.toThrow();

    service.undoDelevel("ChampDown");
    expect(service.getCharacter("ChampDown").level).toBe(7);
    expect(registrationCount(service, "ChampDown", ID_REMARKABLE_ATHLETE)).toBe(1);
  });

  it("round-trips through export and import, and the replayed record still removes it", () => {
    const service = buildChampion("ChampRound", 7);
    const exported = service.exportCharacterXml("ChampRound");
    service.importCharacterXml("ChampImported", exported);

    expect(service.exportCharacterXml("ChampImported")).toBe(exported);
    expect(registrationCount(service, "ChampImported", ID_REMARKABLE_ATHLETE)).toBe(1);

    service.levelDown("ChampImported");
    expect(registrationCount(service, "ChampImported", ID_REMARKABLE_ATHLETE)).toBe(0);
  });

  it("registers both earlier features exactly once for a subclass chosen late", () => {
    // Choosing at 8 registers everything eligible on the spot; the levels
    // already taken must not add a second copy, and level 9 must not either.
    const service = buildChampion("ChampLate", 8, 8);
    expect(registrationCount(service, "ChampLate", ID_IMPROVED_CRITICAL)).toBe(1);
    expect(registrationCount(service, "ChampLate", ID_REMARKABLE_ATHLETE)).toBe(1);

    service.levelUp("ChampLate");
    expect(registrationCount(service, "ChampLate", ID_IMPROVED_CRITICAL)).toBe(1);
    expect(registrationCount(service, "ChampLate", ID_REMARKABLE_ATHLETE)).toBe(1);
    const sum = service.getCharacter("ChampLate").sum.elements.map((e) => e.id);
    expect(sum.filter((entry) => entry === ID_REMARKABLE_ATHLETE)).toHaveLength(1);
  });

  it("registers the 2024 Draconic Sorcerer's Elemental Affinity at level 6", () => {
    const atFive = buildDraconic("Draconic5Aff", 5);
    expect(registrationCount(atFive, "Draconic5Aff", ID_ELEMENTAL_AFFINITY_24)).toBe(0);

    const atSix = buildDraconic("Draconic6", 6);
    expect(registrationCount(atSix, "Draconic6", ID_ELEMENTAL_AFFINITY_24)).toBe(1);
    // The feature's own choice of damage type comes with it.
    expect(rulesNamed(atSix.getCharacter("Draconic6"), "Elemental Affinity (Draconic Sorcery)")).toHaveLength(1);
  });

  it("gates a subclass feature on the CLASS level, not the character level", () => {
    // Sorcerer 5 / Wizard 1 is character level 6 with a 5th-level sorcerer.
    const service = buildDraconic("DraconicAffMC", 5);
    service.levelUpMode("DraconicAffMC", { mode: "new-multiclass" });
    const rule = ruleOfType(pendingSelectionRules(service.getCharacter("DraconicAffMC")), "Multiclass");
    service.setSelection("DraconicAffMC", rule.identifier, "ID_WOTC_PHB24_MULTICLASS_WIZARD");

    expect(service.getCharacter("DraconicAffMC").level).toBe(6);
    expect(registrationCount(service, "DraconicAffMC", ID_ELEMENTAL_AFFINITY_24)).toBe(0);
  });
});
