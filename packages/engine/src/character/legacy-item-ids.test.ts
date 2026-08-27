/**
 * Legacy inventory ids from old exports (ID_WOTC_ITEM_*, ID_WOTC_WEAPON_*)
 * resolve to their ID_WOTC_PHB_* successors when the legacy id itself is not
 * in the library, so old files keep their equipment instead of reporting it
 * missing. Real legacy ids that still exist (the PHB packs) win unchanged.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "./service.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const ID_LEGACY_LONGSWORD = "ID_WOTC_WEAPON_LONGSWORD";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

describe("legacy item id migration", () => {
  it("resolves a legacy weapon id on load and reports no missing equipment", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("LEG");
    service.addItem("LEG", { itemId: ID_LONGSWORD, amount: 1, baseElementId: null });
    const xml = service.exportCharacterXml("LEG").replaceAll(ID_LONGSWORD, ID_LEGACY_LONGSWORD);

    const reload = new CharacterService(undefined, library);
    reload.importCharacterXml("LEG2", xml);
    const inventory = reload.getInventory("LEG2");
    expect(inventory.equipmentWeight).toBe(3);
    const detail = reload.getCharacterDetail("LEG2");
    expect(detail.loadIssues.filter((issue) => issue.kind === "equipmentMissing")).toEqual([]);
    const attacks = reload.getAttacks("LEG2");
    expect(attacks.some((row) => row.name === "Longsword" && row.damage.includes("slashing"))).toBe(true);
  });

  it("keeps a legacy id that still exists in the library untouched", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("PACK");
    const dto = service.addItem("PACK", { itemId: "ID_WOTC_ITEM_EXPLORERS_PACK", amount: 1, baseElementId: null });
    const pack = dto.items.find((item) => item.itemId === "ID_WOTC_ITEM_EXPLORERS_PACK");
    expect(pack).toBeDefined();
  });
});
