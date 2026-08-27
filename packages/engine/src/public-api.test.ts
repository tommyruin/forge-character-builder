/**
 * The public surface of `@forge-cb/engine`.
 *
 * This test imports ONLY from the package root — no deep paths — and drives a
 * character end to end. It is what stops the published surface from drifting
 * out of step with the modules behind it, and it doubles as the worked example
 * a host follows when embedding the engine (see `docs/integration.md`).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { buildCorpusLibrary } from "./testing/corpus.js";
import {
  CharacterService,
  ENGINE_VERSION,
  buildCharacterDetail,
  buildCharacterSheetModel,
  computeStatistics,
  parseDnd5e,
  pendingSelectionRules,
  type ElementLibrary,
} from "@forge-cb/engine";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

describe("public engine API", () => {
  it("reports an engine version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("builds, levels, derives and serializes a character through the root export", () => {
    // 1. A service over the content library.
    const service = new CharacterService(undefined, library, { rng: () => 0.5 });

    // 2. Create a character and set its ability scores.
    const id = service.createCharacter("Public API").id;
    service.setAbilities(id, {
      strength: 15, dexterity: 14, constitution: 13,
      intelligence: 12, wisdom: 10, charisma: 8,
    });

    // 3. Resolve the pending selections, re-reading state after each one.
    const resolve = (type: string, elementId: string): void => {
      const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type)!;
      service.setSelection(id, rule.identifier, elementId);
    };
    resolve("Race", "ID_SRD_RACE_DWARF");
    resolve("Sub Race", "ID_SUB_RACE_HILL_DWARF");
    resolve("Class", "ID_WOTC_PHB_CLASS_FIGHTER");

    // 4. Level up.
    service.levelUp(id);
    service.levelUp(id);

    const state = service.getCharacter(id);
    expect(state.level).toBe(3);

    // 5. Derive values and the client-facing detail.
    const values = computeStatistics(state, library);
    expect(values["level"]).toBe(3);
    expect(values["proficiency"]).toBe(2);
    expect(values["ac"]).toBeGreaterThan(0);

    const detail = buildCharacterDetail(state, library);
    expect(detail.class).toBe("Fighter");
    expect(detail.loadIssues).toEqual([]);

    // 6. Build the character sheet model.
    const sheet = buildCharacterSheetModel(state, library, { mode: "lite" });
    expect(sheet.pages.length).toBeGreaterThan(0);

    // 7. Serialize to .dnd5e and read it back.
    const xml = service.exportCharacterXml(id);
    expect(parseDnd5e(xml).serialize()).toBe(xml);

    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml(id, xml);
    expect(reader.exportCharacterXml(id)).toBe(xml);
    expect(reader.getCharacter(id).level).toBe(3);
  });
});
