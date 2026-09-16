/**
 * Dragonborn breath weapon / draconic ancestry projection:
 * - the ancestry choice's `inline="true"` stats are text values, never
 *   numeric statistics (no "0" placeholders on the sheet);
 * - the breath weapon sheet text substitutes dice, damage type, shape, and
 *   DC (8 + CON modifier + proficiency);
 * - the dice count scales with character level (racial stat rules gate
 *   against character level, not a class level);
 * - every ancestry settles to exactly its own damage resistance. The 2024
 *   Draconic Resistance trait grants fire from three separate rules (Brass,
 *   Gold, Red) and the other types from two, so the requirement sweep must not
 *   let an unmet rule remove what a met rule granted;
 * - changing the ancestry keeps the `<sum>` in step with the elements tree.
 *   The sibling grants a replacing pick makes newly eligible (the resistance,
 *   the 2024 breath weapon) used to reach the tree but not the sum, so the
 *   resistance vanished from everything that reads the sum.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { type CharacterState, type RegisteredElement } from "../character/state.js";
import { computeInlineValues, computeStatistics } from "./calculator.js";
import { substitute } from "../sheet/model.js";
import { reconcileRegistrationRules } from "../selection/reconcile-rules.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const DRAGONBORN = "ID_RACE_DRAGONBORN";
const ANCESTRY_BLACK = "ID_RACIAL_TRAIT_DRACONIC_ANCESTRY_BLACK";
const PHB24_DRAGONBORN = "ID_WOTC_PHB24_RACE_DRAGONBORN";
const RESISTANCE_PREFIX = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_";

/** Each ancestry colour and the damage type it resists (same in both rulesets). */
const ANCESTRY_RESISTANCE: ReadonlyArray<{ colour: string; damage: string }> = [
  { colour: "BLACK", damage: "ACID" },
  { colour: "BLUE", damage: "LIGHTNING" },
  { colour: "BRASS", damage: "FIRE" },
  { colour: "BRONZE", damage: "LIGHTNING" },
  { colour: "COPPER", damage: "ACID" },
  { colour: "GOLD", damage: "FIRE" },
  { colour: "GREEN", damage: "POISON" },
  { colour: "RED", damage: "FIRE" },
  { colour: "SILVER", damage: "COLD" },
  { colour: "WHITE", damage: "COLD" },
];

const RULESETS = [
  { ruleset: "2024" as const, ancestryPrefix: "ID_WOTC_PHB24_RACIAL_TRAIT_DRAGONBORN_DRACONIC_ANCESTRY_" },
  { ruleset: "2014" as const, ancestryPrefix: "ID_RACIAL_TRAIT_DRACONIC_ANCESTRY_" },
];

const BREATH_SHEET_TEXT =
  "Exhale destructive energy. Your breath weapon does {{breath-weapon:dice count}}d{{breath-weapon:dice size}} {{draconic-ancestry:damage type}} damage in a {{draconic-ancestry:breath}}  DC {{breath-weapon:dc}}";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function blackDragonborn(): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = "dragonborn";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 13,
  });
  const detail = service.getCharacterDetail(id);
  const raceRule = detail.selectionRules.find((rule) => rule.type === "Race")!;
  service.setSelection(id, raceRule.identifier, DRAGONBORN);
  const afterRace = service.getCharacterDetail(id);
  const ancestryRule = afterRace.selectionRules.find(
    (rule) => rule.type === "Racial Trait" && rule.name === "Draconic Ancestry",
  )!;
  service.setSelection(id, ancestryRule.identifier, ANCESTRY_BLACK);
  return { service, id };
}

describe("dragonborn draconic ancestry", () => {
  it("keeps inline ancestry stats out of the numeric statistics", () => {
    const { service, id } = blackDragonborn();
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    expect(values["draconic-ancestry:damage type"]).toBeUndefined();
    expect(values["draconic-ancestry:breath"]).toBeUndefined();
    expect(values["breath-weapon:dc"]).toBe(8 + 2 + 2);
    expect(values["breath-weapon:dice count"]).toBe(2);
    expect(values["breath-weapon:dice size"]).toBe(6);
  });

  it("substitutes the breath weapon sheet text with the chosen ancestry", () => {
    const { service, id } = blackDragonborn();
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    const inline = computeInlineValues(state, library);
    expect(inline["draconic-ancestry"]).toBe("Black");
    expect(substitute(BREATH_SHEET_TEXT, values, inline)).toBe(
      "Exhale destructive energy. Your breath weapon does 2d6 Acid damage in a 5 by 30 ft. line (Dex. save)  DC 12",
    );
  });
});

/** Picks (or replaces) the Draconic Ancestry choice. */
function chooseAncestry(service: CharacterService, id: string, ancestryId: string): void {
  const ancestryRule = service.getCharacterDetail(id).selectionRules.find(
    (rule) => rule.type === "Racial Trait" && rule.name === "Draconic Ancestry",
  )!;
  service.setSelection(id, ancestryRule.identifier, ancestryId);
}

/** A level-1 dragonborn of either ruleset with `ancestryId` chosen. */
function dragonbornWithAncestry(ruleset: "2014" | "2024", ancestryId: string): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = `dragonborn-${ruleset}`;
  service.createCharacter(id);
  if (ruleset === "2024") service.setRulesetMode(id, "2024");
  const raceRule = service.getCharacterDetail(id).selectionRules.find((rule) => rule.type === "Race")!;
  service.setSelection(id, raceRule.identifier, ruleset === "2024" ? PHB24_DRAGONBORN : DRAGONBORN);
  chooseAncestry(service, id, ancestryId);
  return { service, id };
}

const resistances = (service: CharacterService, id: string): string[] =>
  service
    .getCharacter(id)
    .sum.elements.map((entry) => entry.id)
    .filter((elementId) => elementId.startsWith(RESISTANCE_PREFIX));

/** Ids registered in the elements tree that the flat `<sum>` does not list. */
function treeIdsMissingFromSum(state: CharacterState): string[] {
  const sumIds = new Set(state.sum.elements.map((entry) => entry.id));
  const missing = new Set<string>();
  const walk = (nodes: RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.id && !sumIds.has(node.id)) missing.add(node.id);
      walk(node.children);
    }
  };
  walk(state.elements);
  return [...missing];
}

describe.each(RULESETS)("$ruleset dragonborn damage resistance", ({ ruleset, ancestryPrefix }) => {
  it.each(ANCESTRY_RESISTANCE)("registers only $damage resistance for $colour", ({ colour, damage }) => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}${colour}`);
    expect(resistances(service, id)).toEqual([`${RESISTANCE_PREFIX}${damage}`]);
  });

  // A settled character is a fixpoint of the sweep. Colours whose resistance is
  // granted by more than one rule used to flip-flop (remove, re-add, remove…)
  // until the settle loop's repeat check gave up, leaving a document the next
  // sweep would still change.
  it.each(ANCESTRY_RESISTANCE)("settles $colour with nothing left for the sweep to change", ({ colour }) => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}${colour}`);
    const plan = reconcileRegistrationRules(service.documentOf(id), service.getCharacter(id), library);
    expect(plan.flips).toEqual([]);
    expect(plan.changed).toBe(false);
  });
});

/** The exported file with one `<sum>` entry cut out (and its element-count lowered to match). */
function withoutSumEntry(xml: string, elementId: string): string {
  return xml.replace(/<sum element-count="(\d+)">([\s\S]*?)<\/sum>/, (block, count: string, body: string) => {
    const entry = new RegExp(`\\s*<element type="[^"]*" id="${elementId}" />`);
    if (!entry.test(body)) return block;
    return `<sum element-count="${Number(count) - 1}">${body.replace(entry, "")}</sum>`;
  });
}

describe.each(RULESETS)("$ruleset dragonborn ancestry swap", ({ ruleset, ancestryPrefix }) => {
  it("keeps one tree and sum entry through Gold → Red → Brass and background replacement", () => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}GOLD`);
    const fire = `${RESISTANCE_PREFIX}FIRE`;
    const assertOne = (): void => {
      const count = (nodes: RegisteredElement[]): number => nodes.reduce(
        (total, node) => total + Number(node.id === fire) + count(node.children), 0,
      );
      expect(count(service.getCharacter(id).elements)).toBe(1);
      expect(resistances(service, id)).toEqual([fire]);
      const xml = service.exportCharacterXml(id);
      expect(xml.split(`id="${fire}"`)).toHaveLength(3); // one tree node + one sum entry
      const reader = new CharacterService(undefined, library);
      reader.importCharacterXml("reload", xml);
      expect(count(reader.getCharacter("reload").elements)).toBe(1);
    };
    for (const colour of ["GOLD", "RED", "BRASS"]) {
      chooseAncestry(service, id, `${ancestryPrefix}${colour}`);
      assertOne();
    }
    chooseAncestry(service, id, `${ancestryPrefix}GOLD`);
    const background = ruleset === "2024" ? "ID_WOTC_PHB24_BACKGROUND_SOLDIER" : "ID_BACKGROUND_SOLDIER";
    for (let i = 0; i < 2; i++) {
      const rule = service.getCharacterDetail(id).selectionRules.find((r) => r.type === "Background")!;
      service.setSelection(id, rule.identifier, background);
      assertOne();
    }
  });

  const SWAPS = [
    { colour: "RED", damage: "FIRE" },
    { colour: "BLACK", damage: "ACID" },
    { colour: "GOLD", damage: "FIRE" },
  ];

  it("keeps exactly one resistance and a sum matching the tree through Red → Black → Gold", () => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}RED`);
    for (const [step, { colour, damage }] of SWAPS.entries()) {
      if (step > 0) chooseAncestry(service, id, `${ancestryPrefix}${colour}`);
      const state = service.getCharacter(id);
      const firstPick = dragonbornWithAncestry(ruleset, `${ancestryPrefix}${colour}`);
      const firstPickState = firstPick.service.getCharacter(firstPick.id);
      expect(resistances(service, id), colour).toEqual([`${RESISTANCE_PREFIX}${damage}`]);
      expect(treeIdsMissingFromSum(state), colour).toEqual([]);
      expect(treeIdsMissingFromSum(firstPickState), `${colour} first pick`).toEqual([]);
      expect(state.sum.elementCount, colour).toBe(firstPickState.sum.elementCount);
    }
  });

  it("keeps the swapped resistance through export and re-import", () => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}RED`);
    chooseAncestry(service, id, `${ancestryPrefix}BLACK`);
    const reader = new CharacterService(undefined, library);
    const imported = reader.importCharacterXml("reimported", service.exportCharacterXml(id));
    expect(resistances(reader, imported.id)).toEqual([`${RESISTANCE_PREFIX}ACID`]);
    expect(treeIdsMissingFromSum(reader.getCharacter(imported.id))).toEqual([]);
  });

  // A file saved while the bug stood carries the resistance in the tree but not
  // in the sum. Re-picking the ancestry is the documented repair.
  it.each([
    { route: "a different colour and back", via: "RED" },
    { route: "the same colour again", via: "BLACK" },
  ])("repairs a saved file missing the resistance's sum entry by re-picking $route", ({ via }) => {
    const { service, id } = dragonbornWithAncestry(ruleset, `${ancestryPrefix}RED`);
    chooseAncestry(service, id, `${ancestryPrefix}BLACK`);
    const acid = `${RESISTANCE_PREFIX}ACID`;
    const reader = new CharacterService(undefined, library);
    const imported = reader.importCharacterXml("broken", withoutSumEntry(service.exportCharacterXml(id), acid));
    expect(resistances(reader, imported.id)).toEqual([]);
    expect(treeIdsMissingFromSum(reader.getCharacter(imported.id))).toContain(acid);

    chooseAncestry(reader, imported.id, `${ancestryPrefix}${via}`);
    if (via !== "BLACK") chooseAncestry(reader, imported.id, `${ancestryPrefix}BLACK`);
    expect(resistances(reader, imported.id)).toEqual([acid]);
    expect(treeIdsMissingFromSum(reader.getCharacter(imported.id))).toEqual([]);
  });
});

// Contrast case: a replacing pick whose selection makes no sibling grant newly
// eligible. It never had a tree/sum gap, so it guards the shared replacing path
// rather than the ancestry fix.
describe.each([
  {
    ruleset: "2024" as const,
    classId: "ID_WOTC_PHB24_CLASS_FIGHTER",
    archery: "ID_WOTC_PHB24_FEAT_ARCHERY",
    defense: "ID_WOTC_PHB24_FEAT_DEFENSE",
  },
  {
    ruleset: "2014" as const,
    classId: "ID_WOTC_PHB_CLASS_FIGHTER",
    archery: "ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_ARCHERY",
    defense: "ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_DEFENSE",
  },
])("contrast: $ruleset fighter Fighting Style swap", ({ ruleset, classId, archery, defense }) => {
  function fighterWithStyle(styleId: string): { service: CharacterService; id: string; styleRule: string } {
    const service = new CharacterService(undefined, library);
    const id = `fighter-${ruleset}`;
    service.createCharacter(id);
    if (ruleset === "2024") service.setRulesetMode(id, "2024");
    const classRule = service.getCharacterDetail(id).selectionRules.find((rule) => rule.type === "Class")!;
    service.setSelection(id, classRule.identifier, classId);
    const state = service.getCharacter(id);
    const styleRule = pendingSelectionRules(state).find((rule) =>
      selectionOptions(state, library, rule).some((option) => option.id === archery),
    )!;
    service.setSelection(id, styleRule.identifier, styleId);
    return { service, id, styleRule: styleRule.identifier };
  }

  it("keeps the sum in step with the tree before and after Archery → Defense", () => {
    const { service, id, styleRule } = fighterWithStyle(archery);
    expect(treeIdsMissingFromSum(service.getCharacter(id))).toEqual([]);
    service.setSelection(id, styleRule, defense);
    const state = service.getCharacter(id);
    const firstPick = fighterWithStyle(defense);
    const firstPickState = firstPick.service.getCharacter(firstPick.id);
    expect(state.sum.elements.map((entry) => entry.id)).toContain(defense);
    expect(state.sum.elements.map((entry) => entry.id)).not.toContain(archery);
    expect(treeIdsMissingFromSum(state)).toEqual([]);
    expect(state.sum.elementCount).toBe(firstPickState.sum.elementCount);
  });
});
