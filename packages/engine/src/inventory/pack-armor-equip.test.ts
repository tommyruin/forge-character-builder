/**
 * Unpacking a shipped class equipment pack wears its armor. The 2024 Paladin
 * pack lists Chain Mail and a Shield as fixed extras; a player who unpacks it
 * expects the sheet to show the mail as worn armor and the shield in the
 * Armor Class, without equipping either by hand.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { SYSTEM_ROOT } from "../testing/corpus.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const PALADIN_PACK = "ID_WOTC_PHB24_ITEM_CLASS_EQUIPMENT_PACK_PALADIN";
const CHAIN_MAIL = "ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL";
const SHIELD = "ID_WOTC_PHB24_ARMOR_SHIELD";
const LONGSWORD = "ID_WOTC_PHB24_WEAPON_LONGSWORD";

/** The content the client ships (the public base profile plus the system proxies). */
async function shippedLibrary(): Promise<ElementLibrary> {
  const { PUBLIC_BASE_PATHS } = (await import(
    fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
  )) as { PUBLIC_BASE_PATHS: Set<string> };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
  for (const name of ["system-proxies.xml", "system-unarmed-riders.xml"]) {
    files.set(`system/${name}`, await readFile(join(SYSTEM_ROOT, name), "utf8"));
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

let library: ElementLibrary;
beforeAll(async () => {
  library = await shippedLibrary();
}, 120_000);

describe("unpacking the shipped 2024 Paladin equipment pack", () => {
  it("wears the Chain Mail and holds the Shield on the sheet", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Paladin Unpacker").id;
    const added = service.addItem(id, { itemId: PALADIN_PACK, amount: 1, baseElementId: null });
    const pack = added.items.find((item) => item.itemId === PALADIN_PACK)!;
    const unarmored = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" }).formValues!;
    expect(unarmored["details_equipped_armor"]).toMatch(/^Unarmored \(10\)$/);

    const dto = service.extractItem(id, pack.identifier);
    expect(dto.items.find((item) => item.itemId === CHAIN_MAIL)?.equippedLocation).toBe("Armor");
    expect(dto.items.find((item) => item.itemId === SHIELD)?.equippedLocation).toBe("Secondary Hand");
    expect(dto.items.find((item) => item.itemId === LONGSWORD)?.isEquipped).toBe(false);

    const sheet = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" }).formValues!;
    expect(sheet["details_equipped_armor"]).toBe("Chain Mail");
    expect(sheet["details_equipped_shield"]).toBe("Shield");
    // Chain Mail's 16 plus the Shield's 2 (heavy armor adds no Dexterity).
    expect(sheet["details_armor_class"]).toBe("18");
  });
});
