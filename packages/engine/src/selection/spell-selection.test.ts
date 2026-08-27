/**
 * Numbered spell-rule selections: group slots are filled by 1-based slot
 * number, partial groups report hasSelection when ANY slot is filled, and a
 * filled slot can be REPLACED (the three cantrip slots fill the
 * wizard cantrip slot 1 three times, each replacing the previous selection;
 * the export then carries only the final selections).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { selectionOptions, selectionRuleFor } from "./selection.js";
import { parseDnd5e } from "../dnd5e/document.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ARTIFICER = "ID_WOTC_TCOE_CLASS_ARTIFICER";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

/** A fresh level-1 Tasha's Artificer with the cantrip rule resolved. */
async function artificerWithCantripRule(): Promise<{ service: CharacterService; id: string; cantripRuleId: string }> {
  const service = new CharacterService(undefined, library);
  const id = "art-spells";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 10, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 8,
  });
  const detail = service.getCharacterDetail(id);
  const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, ARTIFICER, 1);
  const afterClass = service.getCharacterDetail(id);
  const cantripRule = afterClass.selectionRules.find(
    (rule) => rule.type === "Spell" && rule.name.startsWith("Cantrip") && rule.selectionCount === 2,
  )!;
  return { service, id, cantripRuleId: cantripRule.identifier };
}

/** The two candidate spells for the artificer cantrip rule (alphabetical). */
async function cantripOptions(service: CharacterService, id: string, ruleId: string): Promise<string[]> {
  const state = service.getCharacter(id);
  const rule = selectionRuleFor(state, ruleId)!;
  return selectionOptions(state, library, rule).map((option) => option.id);
}

describe("numbered spell-rule group selections", () => {
  it("fills group slots by number and reports the pair in slot order", async () => {
    const { service, id, cantripRuleId } = await artificerWithCantripRule();
    const options = await cantripOptions(service, id, cantripRuleId);
    const [first, second] = [options[0]!, options[1]!];
    expect(first).not.toBe(second);

    service.setSelection(id, cantripRuleId, first, 1);
    service.setSelection(id, cantripRuleId, second, 2);

    const detail = service.getCharacterDetail(id);
    const group = detail.selectionRules.find((rule) => rule.identifier === cantripRuleId)!;
    expect(group.selectionCount).toBe(2);
    expect(group.hasSelection).toBe(true);
    expect(group.selectedElementIds).toEqual([first, second]);
    expect(group.selectedElementNames).toEqual([
      library.byId.get(first)!.identity.name,
      library.byId.get(second)!.identity.name,
    ]);
  });

  it("reports hasSelection true for a partially filled group", async () => {
    const { service, id, cantripRuleId } = await artificerWithCantripRule();
    const options = await cantripOptions(service, id, cantripRuleId);
    service.setSelection(id, cantripRuleId, options[0]!, 1);

    const detail = service.getCharacterDetail(id);
    const group = detail.selectionRules.find((rule) => rule.identifier === cantripRuleId)!;
    expect(group.hasSelection).toBe(true);
    expect(group.selectedElementIds).toEqual([options[0]!, null]);
  });

  it("replaces a filled slot, removing the former spell's subtree and sum entry", async () => {
    const { service, id, cantripRuleId } = await artificerWithCantripRule();
    const options = await cantripOptions(service, id, cantripRuleId);
    const [first, second, third] = [options[0]!, options[1]!, options[2] ?? options[1]!];
    service.setSelection(id, cantripRuleId, first, 1);
    service.setSelection(id, cantripRuleId, second, 2);

    const before = service.getCharacter(id);
    expect(before.sum.elements.map((e) => e.id)).toContain(first);
    expect(before.sum.elements.map((e) => e.id)).toContain(second);

    service.setSelection(id, cantripRuleId, third, 1);

    const after = service.getCharacter(id);
    const sumIds = after.sum.elements.map((e) => e.id);
    expect(sumIds).not.toContain(first);
    expect(sumIds).toContain(second);
    expect(sumIds).toContain(third);
    expect(after.registeredCount).toBe(before.registeredCount);
    expect(after.sum.elementCount).toBe(before.sum.elementCount);

    const detail = service.getCharacterDetail(id);
    const group = detail.selectionRules.find((rule) => rule.identifier === cantripRuleId)!;
    expect(group.selectedElementIds).toEqual([third, second]);

    const magic = after.magic!;
    const caster = magic.casters[0]!;
    const cantripIds = caster.cantrips.map((spell) => spell.id);
    expect(cantripIds).not.toContain(first);
    expect(cantripIds).toContain(second);
    expect(cantripIds).toContain(third);

    const xml = service.exportCharacterXml(id);
    expect(() => parseDnd5e(xml)).not.toThrow();
    const reimported = service.importCharacterXml(`${id}-re`, xml);
    const reimportSum = reimported.sum.elements.map((e) => e.id);
    expect(reimportSum).not.toContain(first);
    expect(reimportSum).toContain(second);
    expect(reimportSum).toContain(third);
    expect(reimported.magic!.casters[0]!.cantrips.map((spell) => spell.id)).not.toContain(first);
  });

  it("keeps clamping a slot number beyond the group size to the last slot", async () => {
    const { service, id, cantripRuleId } = await artificerWithCantripRule();
    const options = await cantripOptions(service, id, cantripRuleId);
    service.setSelection(id, cantripRuleId, options[0]!, 1);
    service.setSelection(id, cantripRuleId, options[1]!, 99);

    const detail = service.getCharacterDetail(id);
    const group = detail.selectionRules.find((rule) => rule.identifier === cantripRuleId)!;
    expect(group.selectedElementIds).toEqual([options[0]!, options[1]!]);
  });
});
