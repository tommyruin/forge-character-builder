/**
 * The archetype builders are the replacement for pre-made `.dnd5e` fixtures,
 * so they carry their own tests: each must build a character the rest of the
 * suite can rely on, and each must survive an export/import round trip.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import {
  buildFighter3,
  buildMulticlassCaster,
  buildRogue5,
  buildWizard4,
  freshService,
  sharedLibrary,
  syntheticPortrait,
} from "./character-factory.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

describe("character factory archetypes", () => {
  it("builds a level-5 rogue with the expected class, level and proficiency", () => {
    const { service, id } = buildRogue5(library);
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);

    expect(state.level).toBe(5);
    expect(values["level"]).toBe(5);
    expect(values["proficiency"]).toBe(3);
    expect(values["dexterity:modifier"]).toBe(3);
  });

  it("builds a level-4 wizard with prepared spellcasting slots", () => {
    const { service, id } = buildWizard4(library);
    const values = computeStatistics(service.getCharacter(id), library);

    expect(values["level"]).toBe(4);
    expect(values["spellcasting:slot:1"] ?? values["wizard:spellcasting:slots:1"]).toBeGreaterThan(0);
    expect(values["intelligence:modifier"]).toBe(3);
  });

  it("builds a level-3 fighter", () => {
    const { service, id } = buildFighter3(library);
    expect(service.getCharacter(id).level).toBe(3);
  });

  it("builds a fighter/wizard multiclass carrying both classes", () => {
    const { service, id } = buildMulticlassCaster(library);
    const xml = service.exportCharacterXml(id);

    expect(service.getCharacter(id).level).toBe(4);
    expect(xml).toContain("ID_WOTC_PHB_CLASS_FIGHTER");
    expect(xml).toContain("ID_WOTC_PHB_MULTICLASS_WIZARD");
  });

  it("round-trips every archetype through export and import byte-identically", () => {
    for (const build of [buildRogue5, buildWizard4, buildFighter3, buildMulticlassCaster]) {
      const { service, id } = build(library);
      const exported = service.exportCharacterXml(id);

      const reader = freshService(library);
      reader.importCharacterXml(id, exported);

      expect(reader.exportCharacterXml(id)).toBe(exported);
      expect(reader.getCharacter(id).level).toBe(service.getCharacter(id).level);
    }
  });

  it("builds characters deterministically for a given seed", () => {
    expect(buildRogue5(library, "A").service.exportCharacterXml("A"))
      .toBe(buildRogue5(library, "A").service.exportCharacterXml("A"));
  });

  it("produces a synthetic portrait of the requested size", () => {
    const portrait = syntheticPortrait(1024);
    expect(Buffer.from(portrait, "base64")).toHaveLength(1024);
    expect(portrait).toBe(syntheticPortrait(1024));
  });
});
