/**
 * Spell points (the public 5e optional rule): the resource carries the
 * per-slot-level cost table (levels 6-9 once per long rest), and the maximum
 * is the sum of the caster's actual slots weighted by cost — so half casters
 * get half-caster totals, not the full-caster progression.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "../selection/selection.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const ID_PALADIN = "ID_WOTC_PHB_CLASS_PALADIN";
const ID_OPTION_SPELL_POINTS = "ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

function buildCaster(classId: string, levels: number): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter("SP");
  service.setAbilities("SP", {
    strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14,
  });
  const state = service.getCharacter("SP");
  const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
  service.setSelection("SP", classRule.identifier, classId);
  for (let i = 1; i < levels; i++) service.levelUp("SP");
  service.setCharacterOption("SP", { optionId: ID_OPTION_SPELL_POINTS, enabled: true });
  return service;
}

describe("caster allowReplace", () => {
  it("surfaces the spellcasting block's allowReplace flag on the caster DTO", () => {
    const sorcerer = buildCaster("ID_WOTC_PHB_CLASS_SORCERER", 2).getSpellcasting("SP")[0]!;
    expect(sorcerer.allowReplace).toBe(true);
    const wizard = buildCaster(ID_WIZARD, 2).getSpellcasting("SP")[0]!;
    expect(wizard.allowReplace).toBe(false);
  });
});

describe("spell point resources", () => {
  it("derives a full caster's maximum from its slots weighted by cost", () => {
    const service = buildCaster(ID_WIZARD, 5);
    const caster = service.getSpellcasting("SP")[0]!;
    expect(caster.resource.mode).toBe("spellPoints");
    if (caster.resource.mode !== "spellPoints") return;
    expect(caster.resource.maximumPoints).toBe(27);
    expect(caster.resource.currentPoints).toBe(27);
  });

  it("derives a half caster's maximum from its own slot table", () => {
    const service = buildCaster(ID_PALADIN, 5);
    const caster = service.getSpellcasting("SP")[0]!;
    expect(caster.resource.mode).toBe("spellPoints");
    if (caster.resource.mode !== "spellPoints") return;
    expect(caster.resource.maximumPoints).toBe(14);
  });

  it("carries the per-level cost table with once-per-long-rest flags", () => {
    const service = buildCaster(ID_WIZARD, 5);
    const caster = service.getSpellcasting("SP")[0]!;
    if (caster.resource.mode !== "spellPoints") {
      expect.unreachable("expected spell point mode");
    }
    expect(caster.resource.costs).toHaveLength(9);
    expect(caster.resource.costs[0]).toEqual({ spellLevel: 1, points: 2, oncePerLongRest: false });
    expect(caster.resource.costs[4]).toEqual({ spellLevel: 5, points: 7, oncePerLongRest: false });
    expect(caster.resource.costs[8]).toEqual({ spellLevel: 9, points: 13, oncePerLongRest: true });
  });
});
