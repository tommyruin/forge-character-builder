import { beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { CharacterService } from "../character/service.js";
import { buildLoadIssues } from "../character/options.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import type { ElementLibrary } from "../content/library.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { evaluateRequirements } from "../selection/expr.js";
import { buildCharacterSheetModel, type CharacterSheetModel } from "../sheet/model.js";
import { classLevelLookup, computeStatistics, statRequirementContext } from "./calculator.js";

/**
 * Class-level requirement atoms ([level:warlock:2]) on an element's own
 * <requirements> gate its stat rules, its load validity and its sheet text.
 * Every one of those contexts must resolve the per-class level.
 */

let library: ElementLibrary;
beforeAll(async () => { library = await buildCorpusLibrary(); }, 120_000);

const SPEAR = "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_ELDRITCH_SPEAR";
const AGONIZING = "ID_WOTC_PHB24_CLASS_FEATURE_ELDRITCH_INVOCATION_AGONIZING_BLAST";

function warlock(level: number, invocations: string[]) {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Class-level requirements").id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 10, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 16 });
  const classRule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  service.setSelection(id, classRule.identifier, "ID_WOTC_PHB24_CLASS_WARLOCK");
  while (service.getCharacter(id).level < level) service.levelUp(id);
  for (const invocation of invocations) {
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.name === "Eldritch Invocation (Warlock 2)");
    expect(rule, "an open level-2 invocation slot").toBeDefined();
    service.setSelection(id, rule!.identifier, invocation);
  }
  return { service, id };
}

function featureText(model: CharacterSheetModel): string {
  const page = model.pages[0] as { sections: readonly { title: string; rows: readonly { kind: string; lines?: readonly string[]; tokens?: readonly string[] }[] }[] };
  const features = page.sections.find((section) => section.title === "features")!;
  return features.rows.map((row) => (row.lines ?? row.tokens ?? []).join(" ")).join("\n");
}

describe("class-level requirements in the calculator", () => {
  it("passes [level:warlock:2] in the stat-rule requirement context of a level-5 warlock, not at level 1", () => {
    const { service, id } = warlock(5, []);
    const state = service.getCharacter(id);
    const ctx = statRequirementContext(state, library, { ...state.abilities });
    expect(evaluateRequirements("[level:warlock:2]", ctx)).toBe(true);
    expect(evaluateRequirements("[level:warlock:5]", ctx)).toBe(true);
    expect(evaluateRequirements("[level:warlock:6]", ctx)).toBe(false);
    expect(evaluateRequirements("[level:wizard:1]", ctx)).toBe(false);
    const { service: low, id: lowId } = warlock(1, []);
    const lowState = low.getCharacter(lowId);
    expect(evaluateRequirements("[level:warlock:2]", statRequirementContext(lowState, library, { ...lowState.abilities }))).toBe(false);
  }, 60_000);

  it("resolves each class's own level for a multiclass character", async () => {
    // Druid (4) / Warlock (1) / Cleric (1): character level 6.
    const service = new CharacterService(undefined, library);
    const xml = await readFile(new URL("../../../../fixtures/coverage/characters/druid-warlock-cleric-6.dnd5e", import.meta.url), "utf8");
    service.importCharacterXml("mc", xml);
    const state = service.getCharacter("mc");
    const lookup = classLevelLookup(state, library);
    expect([lookup("druid"), lookup("warlock"), lookup("cleric"), lookup("wizard")]).toEqual([4, 1, 1, 0]);
    const ctx = statRequirementContext(state, library, { ...state.abilities });
    expect(evaluateRequirements("[level:druid:4]", ctx)).toBe(true);
    expect(evaluateRequirements("[level:warlock:2]", ctx)).toBe(false);
    expect(evaluateRequirements("[level:cleric:1]", ctx)).toBe(true);
  }, 60_000);

  it("applies Eldritch Spear's rules for a level-5 2024 warlock and prints its resolved text", () => {
    const { service, id } = warlock(5, [SPEAR]);
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    expect(values["eldritch spear:range"]).toBe(150);
    expect(values["eldritch spear:count"]).toBe(1);
    expect(buildLoadIssues(state, library).filter((issue) => issue.kind === "selectionInvalidated")).toEqual([]);
    const text = featureText(buildCharacterSheetModel(state, library, { mode: "full" }));
    expect(text).toContain("1 of your cantrips, chosen when you gain this Invocation, gain extra 150ft. of range");
    expect(text).not.toContain("{{");
  }, 60_000);

  it("applies Agonizing Blast's count for a level-5 2024 warlock", () => {
    const { service, id } = warlock(5, [AGONIZING]);
    const state = service.getCharacter(id);
    expect(computeStatistics(state, library)["agonizing blast:count"]).toBe(1);
    expect(buildLoadIssues(state, library).filter((issue) => issue.kind === "selectionInvalidated")).toEqual([]);
    const text = featureText(buildCharacterSheetModel(state, library, { mode: "full" }));
    expect(text).toContain("1 of your cantrips, chosen when you gain this Invocation, gain +3 bonus to damage");
    expect(text).not.toContain("{{");
  }, 60_000);
});

/**
 * Placeholders that legitimately stay raw: barbarian-1 is a Dragonborn whose
 * Draconic Ancestry choice was never made, so the ancestry's inline values do
 * not exist. Anything else unresolved is a leak.
 */
const UNMADE_CHOICE_PLACEHOLDERS = new Set([
  "barbarian-1.dnd5e: {{draconic-ancestry:damage type}}",
  "barbarian-1.dnd5e: {{draconic-ancestry:breath}}",
]);

describe("coverage fixture sheets", () => {
  it("leave no unresolved {{placeholder}} in any full sheet model", async () => {
    const dir = new URL("../../../../fixtures/coverage/characters/", import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".dnd5e")).sort();
    expect(files.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const file of files) {
      const service = new CharacterService(undefined, library);
      service.importCharacterXml(file, await readFile(new URL(file, dir), "utf8"));
      const model = buildCharacterSheetModel(service.getCharacter(file), library, { mode: "full" });
      for (const match of JSON.stringify(model).matchAll(/\{\{[^}]*\}\}/g)) {
        const leak = `${file}: ${match[0]}`;
        if (!UNMADE_CHOICE_PLACEHOLDERS.has(leak)) leaks.push(leak);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);
});
