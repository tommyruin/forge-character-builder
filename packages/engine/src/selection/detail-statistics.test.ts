/**
 * The character detail carries the statistics dictionary computed during its
 * own build, so a mutation's response gives the client both the detail and
 * the statistics in one engine pass (no separate getStatistics round trip).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "../statistics/calculator.js";
import { pendingSelectionRules } from "./selection.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

describe("detail statistics", () => {
  it("carries the computed statistics dictionary on the detail", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("stat-carrier");
    service.setAbilities("stat-carrier", {
      strength: 14, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8,
    });
    const state = service.getCharacter("stat-carrier");
    const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
    service.setSelection("stat-carrier", classRule.identifier, "ID_WOTC_PHB_CLASS_FIGHTER");

    const detail = service.getCharacterDetail("stat-carrier");
    const expected = computeStatistics(service.getCharacter("stat-carrier"), library);
    expect(detail.statistics).toEqual(expected);
    expect(detail.statistics?.["hp"]).toBeGreaterThan(0);
  });
});
