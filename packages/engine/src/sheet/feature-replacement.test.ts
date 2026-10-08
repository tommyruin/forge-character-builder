import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import type { ElementLibrary } from "../content/library.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCharacterSheetModel } from "./model.js";

/**
 * A feature whose own <requirements> fail (typically `!<replacement marker>`,
 * granted by a subclass feature or an optional-class-feature control) is
 * replaced: the calculator already ignores its rules, and the printed
 * features box must leave it out too.
 */

let library: ElementLibrary;
beforeAll(async () => { library = await buildCorpusLibrary(); }, 120_000);

const ABILITIES = { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 };
const BASE_WILD_SHAPE = "Known Forms of CR 1/4 or lower";

function pick(service: CharacterService, id: string, type: string, elementId: string): void {
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection);
  expect(rule, `an open ${type} selection`).toBeDefined();
  service.setSelection(id, rule!.identifier, elementId);
}

function druid(level: number, archetype?: string) {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Druid").id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  pick(service, id, "Class", "ID_WOTC_PHB24_CLASS_DRUID");
  while (service.getCharacter(id).level < level) service.levelUp(id);
  if (archetype !== undefined) pick(service, id, "Archetype", archetype);
  return { service, id };
}

function featureLines(service: CharacterService, id: string): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const page = model.pages[0] as { sections: readonly { title: string; rows: readonly { lines?: readonly string[]; tokens?: readonly string[] }[] }[] };
  return page.sections.find((section) => section.title === "features")!.rows.map((row) => (row.lines ?? row.tokens ?? []).join(" "));
}

const wildShapeLines = (lines: string[]) => lines.filter((line) => line.startsWith("Wild Shape (Bonus Action"));

describe("features replaced through marker elements", () => {
  it("prints only the Circle of the Moon Wild Shape for a level-3 Moon druid", () => {
    const { service, id } = druid(3, "ID_WOTC_PHB24_ARCHETYPE_DRUID_CIRCLE_OF_THE_MOON");
    const lines = featureLines(service, id);
    const wildShape = wildShapeLines(lines);
    expect(wildShape).toHaveLength(1);
    expect(wildShape[0]).toMatch(/^Wild Shape \(Bonus Action—2\/Long Rest\)/);
    expect(wildShape[0]).toContain("Known Forms of CR1");
    expect(wildShape[0]).not.toContain("CR 1/4");
  }, 60_000);

  it("keeps the base Wild Shape for a level-3 Circle of the Land druid", () => {
    const { service, id } = druid(3, "ID_WOTC_PHB24_ARCHETYPE_DRUID_CIRCLE_OF_THE_LAND");
    const wildShape = wildShapeLines(featureLines(service, id));
    expect(wildShape).toHaveLength(1);
    expect(wildShape[0]).toContain(BASE_WILD_SHAPE);
  }, 60_000);

  it("keeps the base Wild Shape for a level-2 druid", () => {
    const { service, id } = druid(2);
    const wildShape = wildShapeLines(featureLines(service, id));
    expect(wildShape).toHaveLength(1);
    expect(wildShape[0]).toContain(BASE_WILD_SHAPE);
  }, 60_000);

  it("swaps Favored Enemy for Favored Foe while the Tasha's control is on, and back when it is off", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Ranger").id;
    service.setRulesetMode(id, "2014");
    service.setAbilities(id, ABILITIES);
    pick(service, id, "Class", "ID_WOTC_PHB_CLASS_RANGER");
    const named = (lines: string[], title: string) => lines.filter((line) => line.startsWith(`${title}.`) || line.startsWith(`${title} (`));

    const before = featureLines(service, id);
    expect(named(before, "Favored Enemy")).toHaveLength(1);
    expect(named(before, "Favored Foe")).toHaveLength(0);

    service.setCharacterControl(id, { key: "item:ID_WOTC_TCOE_ITEM_OCF_RANGER_FAVORED_FOE", enabled: true });
    const replaced = featureLines(service, id);
    expect(named(replaced, "Favored Foe")).toHaveLength(1);
    expect(named(replaced, "Favored Enemy")).toHaveLength(0);

    service.setCharacterControl(id, { key: "item:ID_WOTC_TCOE_ITEM_OCF_RANGER_FAVORED_FOE", enabled: false });
    const restored = featureLines(service, id);
    expect(named(restored, "Favored Enemy")).toHaveLength(1);
    expect(named(restored, "Favored Foe")).toHaveLength(0);
  }, 60_000);
});

describe("feature description tiers", () => {
  it("picks a multiclass druid's Wild Shape tier by druid level, not character level", () => {
    // Druid 2 / Fighter 2 is character level 4: the druid's level-4 tier
    // (CR 1/2) is not reached yet.
    const { service, id } = druid(2);
    service.setCharacterOption(id, { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
    service.levelUpMode(id, { mode: "new-multiclass" });
    pick(service, id, "Multiclass", "ID_WOTC_PHB24_MULTICLASS_FIGHTER");
    service.levelUpMode(id, { mode: "multiclass", classId: "ID_WOTC_PHB24_MULTICLASS_FIGHTER" });
    expect(service.getCharacter(id).level).toBe(4);
    const wildShape = wildShapeLines(featureLines(service, id));
    expect(wildShape).toHaveLength(1);
    expect(wildShape[0]).toContain(BASE_WILD_SHAPE);
    expect(wildShape[0]).not.toContain("CR 1/2");
  }, 60_000);
});
