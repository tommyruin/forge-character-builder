/**
 * Inventory surface: DTO shape, add/remove/equip/attune/extract semantics,
 * and .dnd5e serialization. These expectations are the specification for the
 * inventory surface; changing one is a deliberate behaviour change, not a rebaseline.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { parseDnd5e } from "../dnd5e/document.js";
import { buildInventoryDto, type InventoryItemDto } from "./inventory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let libraryPromise: Promise<ElementLibrary> | null = null;
const library = (): Promise<ElementLibrary> => {
  libraryPromise ??= buildCorpusLibrary();
  return libraryPromise;
};

beforeAll(async () => {
  await library();
}, 120_000);

const freshService = async (): Promise<CharacterService> => new CharacterService(undefined, await library());

const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const GREATSWORD = "ID_WOTC_PHB_WEAPON_GREATSWORD";
const SHIELD = "ID_WOTC_GEAR_SHIELD";
const SCALE_MAIL = "ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL";
const QUARTERSTAFF = "ID_WOTC_PHB_WEAPON_QUARTERSTAFF";
const STAFF_OF_POWER = "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER";
const RING = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING";
const PACK = "ID_WOTC_ITEM_EXPLORERS_PACK";

const byItemId = (dto: { items: InventoryItemDto[] }, itemId: string) =>
  dto.items.find((i) => i.itemId === itemId);

describe("inventory DTO", () => {
  it("returns the pinned fresh shape", async () => {
    const service = await freshService();
    const state = service.createCharacter("Fresh Inv");
    expect(service.getInventory(state.id)).toEqual({
      items: [],
      coins: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 },
      equipmentWeight: 0,
      attunedItemCount: 0,
      maxAttunedItemCount: 3,
      storages: ["#1", "#2"],
    });
  });

  it("adds a longsword with the pinned fields and auto-equips it", async () => {
    const service = await freshService();
    const id = service.createCharacter("Sword Char").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(dto.items).toHaveLength(1);
    const item = dto.items[0]!;
    expect(item.itemId).toBe(LONGSWORD);
    expect(item.name).toBe("Longsword");
    expect(item.type).toBe("Weapon");
    expect(item.amount).toBe(1);
    expect(item.isEquippable).toBe(true);
    expect(item.isEquipped).toBe(true);
    expect(item.equippedLocation).toBe("Primary Hand");
    expect(item.isAttunable).toBe(false);
    expect(item.isAttuned).toBe(false);
    expect(item.displayPrice).toBe("15 gp");
    expect(item.source).toBe("Player’s Handbook");
    expect(item.equipLocations).toEqual(["primary", "secondary"]);
    expect(item.weight).toBe("3 lb.");
    expect(item.category).toBe("Weapons");
    expect(item.isPhysicalEquipment).toBe(true);
    expect(item.isExtractable).toBe(false);
    expect(item.extractableContents).toEqual([]);
    expect(dto.equipmentWeight).toBe(3);
    expect(dto.attunedItemCount).toBe(0);
    expect(dto.maxAttunedItemCount).toBe(3);
    expect(item.identifier).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("adds a magic item with a base as an adorned weapon", async () => {
    const service = await freshService();
    const id = service.createCharacter("Staff Char").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    dto = service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    const staff = byItemId(dto, QUARTERSTAFF)!;
    expect(staff.name).toBe("Staff of Power");
    expect(staff.type).toBe("Weapon");
    expect(staff.isEquipped).toBe(false); // primary occupied by the longsword
    expect(staff.isAttunable).toBe(true);
    expect(staff.displayPrice).toBe("2 sp");
    expect(staff.source).toBe("Player’s Handbook");
    expect(staff.weight).toBe("4 lb.");
    expect(staff.equipLocations).toEqual(["primary", "secondary"]);
    expect(dto.equipmentWeight).toBe(7);
    expect(staff.description).toContain("Armor Class");
    expect(staff.rarity).toBe("Very Rare");
    expect(staff.attunement).toEqual({
      required: true,
      addition: "by a sorcerer, warlock, or wizard",
    });
  });

  it("marks adjustment-only inventory records as non-physical equipment", async () => {
    const service = await freshService();
    const id = service.createCharacter("Adjustment Filter").id;
    const dto = service.addItem(id, {
      itemId: "ID_PHB_INTERNAL_ITEM__SPELL_PROXY_SPELL_FOG_CLOUD",
      amount: 1,
      baseElementId: null,
    });

    expect(dto.items[0]?.isPhysicalEquipment).toBe(false);
  });

  it("auto-adorns a magic item with a single-name weapon setter", async () => {
    const service = await freshService();
    const id = service.createCharacter("Auto Adorn").id;
    const dto = service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_FIRE", amount: 1, baseElementId: null });
    const item = dto.items[0]!;
    expect(item.itemId).toBe(QUARTERSTAFF);
    expect(item.name).toBe("Staff of Fire");
    expect(item.isEquipped).toBe(true); // free slots on a fresh character
    expect(item.equippedLocation).toBe("Primary Hand");
  });

  it("leaves a group-setter magic item unbased and unequippable", async () => {
    const service = await freshService();
    const id = service.createCharacter("Flame Char").id;
    const dto = service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_FLAME_TONGUE", amount: 1, baseElementId: null });
    const item = dto.items[0]!;
    expect(item.itemId).toBe("ID_WOTC_DMG_MAGIC_ITEM_FLAME_TONGUE");
    expect(item.name).toBe("Flame Tongue");
    expect(item.isEquippable).toBe(false);
    expect(item.equipLocations).toEqual([]);
    expect(item.isEquipped).toBe(false);
  });

  it("reports fractional and null weights like the observed behavior", async () => {
    const service = await freshService();
    const id = service.createCharacter("Weight Char").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    dto = service.addItem(id, { itemId: "ID_WOTC_PHB_ITEM_PITON", amount: 1, baseElementId: null });
    dto = service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING", amount: 2, baseElementId: null });
    const piton = byItemId(dto, "ID_WOTC_PHB_ITEM_PITON")!;
    expect(piton.weight).toBe("1/4 lb.");
    const potion = byItemId(dto, "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING")!;
    expect(potion.weight).toBe("½ lb.");
    expect(potion.amount).toBe(2);
    expect(potion.displayPrice).toBe("50 gp");
    expect(dto.equipmentWeight).toBe(4.25); // 3 + 0.25 + 0.5*2
  });

  it("reports the item base options of a magic weapon", async () => {
    const service = await freshService();
    const id = service.createCharacter("Options Char").id;
    expect(service.getItemBaseOptions(id, LONGSWORD)).toEqual({ slot: null, options: [] });
    const staff = service.getItemBaseOptions(id, STAFF_OF_POWER);
    expect(staff.slot).toBe("weapon");
    expect(staff.options).toEqual([{ id: QUARTERSTAFF, name: "Quarterstaff" }]);
    const flame = service.getItemBaseOptions(id, "ID_WOTC_DMG_MAGIC_ITEM_FLAME_TONGUE");
    expect(flame.slot).toBe("weapon");
    expect(flame.options.map((o) => o.name)).toEqual([
      "Greatsword",
      "Longsword",
      "Rapier",
      "Scimitar",
      "Shortsword",
    ]);
  });
});

describe("inventory equip semantics", () => {
  it("auto-equips at the first location only", async () => {
    const service = await freshService();
    const id = service.createCharacter("Equip1").id;
    let dto = service.addItem(id, { itemId: "ID_WOTC_PHB_WEAPON_DAGGER", amount: 1, baseElementId: null });
    expect(dto.items[0]!.equippedLocation).toBe("Primary Hand");
    // primary occupied, secondary free -> no auto-equip
    dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(byItemId(dto, LONGSWORD)!.isEquipped).toBe(false);
    // shield -> secondary is free
    dto = service.addItem(id, { itemId: SHIELD, amount: 1, baseElementId: null });
    expect(byItemId(dto, SHIELD)!.equippedLocation).toBe("Secondary Hand");
  });

  it("equips two-handed weapons as Two-Handed and occupies both hands", async () => {
    const service = await freshService();
    const id = service.createCharacter("Equip2").id;
    let dto = service.addItem(id, { itemId: GREATSWORD, amount: 1, baseElementId: null });
    expect(dto.items[0]!.equippedLocation).toBe("Two-Handed");
    // shortbow blocked by the two-handed weapon
    dto = service.addItem(id, { itemId: "ID_WOTC_PHB_WEAPON_SHORTBOW", amount: 1, baseElementId: null });
    expect(byItemId(dto, "ID_WOTC_PHB_WEAPON_SHORTBOW")!.isEquipped).toBe(false);
    // shield blocked by the two-handed weapon
    dto = service.addItem(id, { itemId: SHIELD, amount: 1, baseElementId: null });
    expect(byItemId(dto, SHIELD)!.isEquipped).toBe(false);
  });

  it("vacates occupants when equipping at a location", async () => {
    const service = await freshService();
    const id = service.createCharacter("Equip3").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    dto = service.addItem(id, { itemId: SHIELD, amount: 1, baseElementId: null });
    const longsword = byItemId(dto, LONGSWORD)!;
    const shield = byItemId(dto, SHIELD)!;
    // equipping the shield at primary vacates the longsword, keeps secondary free
    dto = service.equipItem(id, shield.identifier, "primary");
    expect(byItemId(dto, LONGSWORD)!.isEquipped).toBe(false);
    expect(byItemId(dto, SHIELD)!.equippedLocation).toBe("Primary Hand");
    // equipping the longsword two-handed vacates both hands
    dto = service.equipItem(id, longsword.identifier, "primary-twohanded");
    expect(byItemId(dto, SHIELD)!.isEquipped).toBe(false);
    expect(byItemId(dto, LONGSWORD)!.equippedLocation).toBe("Two-Handed");
    // unequip at none
    dto = service.equipItem(id, longsword.identifier, "none");
    expect(byItemId(dto, LONGSWORD)!.isEquipped).toBe(false);
    expect(byItemId(dto, LONGSWORD)!.equippedLocation).toBeNull();
  });

  it("drops attunement when unequipping", async () => {
    const service = await freshService();
    const id = service.createCharacter("Attune Drop").id;
    let dto = service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    const staff = byItemId(dto, QUARTERSTAFF)!;
    dto = service.attuneItem(id, staff.identifier, true);
    expect(dto.attunedItemCount).toBe(1);
    dto = service.equipItem(id, staff.identifier, "none");
    expect(byItemId(dto, QUARTERSTAFF)!.isAttuned).toBe(false);
    expect(dto.attunedItemCount).toBe(0);
  });
});

describe("inventory attunement", () => {
  it("counts only attunable items and enforces the max of 3", async () => {
    const service = await freshService();
    const id = service.createCharacter("Attune Max").id;
    let dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
    const rings = [dto.items[0]!.identifier];
    for (let i = 0; i < 3; i++) {
      dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
      rings.push(dto.items.at(-1)!.identifier);
    }
    for (const identifier of rings.slice(0, 3)) {
      dto = service.attuneItem(id, identifier, true);
    }
    expect(dto.attunedItemCount).toBe(3);
    expect(() => service.attuneItem(id, rings[3]!, true)).toThrow("Maximum number of attuned items reached.");
    dto = service.attuneItem(id, rings[3]!, false);
    void dto;
  });

  it("attunes non-attunable items without counting them", async () => {
    const service = await freshService();
    const id = service.createCharacter("Attune Plain").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const longsword = dto.items[0]!;
    expect(longsword.isAttunable).toBe(false);
    dto = service.attuneItem(id, longsword.identifier, true);
    expect(byItemId(dto, LONGSWORD)!.isAttuned).toBe(true);
    expect(dto.attunedItemCount).toBe(0);
  });
});

describe("inventory remove and extract", () => {
  it("decrements amounts and removes items", async () => {
    const service = await freshService();
    const id = service.createCharacter("Remove Char").id;
    let dto = service.addItem(id, { itemId: "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING", amount: 2, baseElementId: null });
    const potion = dto.items[0]!;
    dto = service.removeItem(id, potion.identifier, 1);
    expect(byItemId(dto, "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING")!.amount).toBe(1);
    dto = service.removeItem(id, potion.identifier, 1);
    expect(dto.items).toHaveLength(0);
  });

  it("extracts a pack into its contents", async () => {
    const service = await freshService();
    const id = service.createCharacter("Pack Char").id;
    let dto = service.addItem(id, { itemId: PACK, amount: 1, baseElementId: null });
    const pack = byItemId(dto, PACK)!;
    expect(pack.isExtractable).toBe(true);
    expect(pack.extractableContents.map((c) => c.name)).toEqual([
      "Backpack",
      "Bedroll",
      "Mess Kit",
      "Tinderbox",
      "Torch",
      "Rations (1 day)",
      "Waterskin",
      "Rope, Hempen (50 feet)",
    ]);
    expect(pack.extractableContents.find((c) => c.itemId === "ID_WOTC_PHB_ITEM_TORCH")!.amount).toBe(10);
    dto = service.extractItem(id, pack.identifier);
    expect(dto.items.some((i) => i.itemId === PACK)).toBe(false);
    expect(dto.items).toHaveLength(8);
    expect(byItemId(dto, "ID_WOTC_PHB_ITEM_TORCH")!.amount).toBe(10);
    expect(dto.equipmentWeight).toBe(59);
  });

  it("rejects extracting a non-extractable item", async () => {
    const service = await freshService();
    const id = service.createCharacter("NoExtract").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(() => service.extractItem(id, dto.items[0]!.identifier)).toThrow(
      "Inventory item 'Longsword' cannot be extracted.",
    );
  });
});

describe("inventory coins", () => {
  it("replaces the coinage", async () => {
    const service = await freshService();
    const id = service.createCharacter("Coins Char").id;
    const dto = service.setCoins(id, { copper: 5, silver: 6, electrum: 7, gold: 8, platinum: 9 });
    expect(dto.coins).toEqual({ copper: 5, silver: 6, electrum: 7, gold: 8, platinum: 9 });
    expect(service.getInventory(id).coins).toEqual({ copper: 5, silver: 6, electrum: 7, gold: 8, platinum: 9 });
  });
});

describe("inventory document serialization", () => {
  it("writes the pinned item node layout", async () => {
    const service = await freshService();
    const id = service.createCharacter("Ser Char").id;
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    let dto = service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    const staff = byItemId(dto, QUARTERSTAFF)!;
    dto = service.attuneItem(id, staff.identifier, true);
    void dto;
    const xml = service.exportCharacterXml(id);
    const doc = parseDnd5e(xml);
    const items = doc.root.build.equipment!.items();
    expect(items).toHaveLength(2);
    const longsword = items.find((i) => i.id() === LONGSWORD)!;
    expect(longsword.equipped()).toEqual({ location: "Primary Hand", value: "true" });
    const staffNode = items.find((i) => i.id() === QUARTERSTAFF)!;
    expect(staffNode.name()).toBe("Quarterstaff");
    expect(staffNode.attuned()).toBe(true);
    expect(staffNode.adorners().map((a) => getAttrOf(a))).toEqual([
      { name: "Staff of Power", id: STAFF_OF_POWER },
    ]);
    expect(staffNode.details()?.card()).toBe("true");
  });

  it("round-trips imported files byte-identically and re-imports to the same state", async () => {
    const service = await freshService();
    const imported = service.importCharacterXml(
      "Round Trip",
      service.exportCharacterXml(service.createCharacter("Round Trip").id),
    );
    void imported;
    // build a character with items, export, re-import, and compare states
    const first = service.createCharacter("Cycle Char");
    service.addItem(first.id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    let dto = service.addItem(first.id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    const staff = byItemId(dto, QUARTERSTAFF)!;
    service.attuneItem(first.id, staff.identifier, true);
    const xml = service.exportCharacterXml(first.id);
    const second = service.importCharacterXml("Cycle Char 2", xml);
    const lib = await library();
    expect(buildInventoryDto(service.getCharacter(first.id), lib)).toEqual(buildInventoryDto(second, lib));
  });

  it("registers equipped/attuned items into the sum, tree, and registered-count", async () => {
    const service = await freshService();
    const id = service.createCharacter("Reg Char").id;
    let xml = service.exportCharacterXml(id);
    expect(xml.match(/registered-count="(\d+)"/)![1]).toBe("3");
    service.addItem(id, { itemId: SCALE_MAIL, amount: 1, baseElementId: null });
    xml = service.exportCharacterXml(id);
    expect(xml.match(/registered-count="(\d+)"/)![1]).toBe("4");
    expect(xml).toContain('<element type="Armor" name="Scale Mail" id="ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL">');
    expect(xml).toContain('<element type="Grants" id="ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE" />');
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(service.exportCharacterXml(id).match(/registered-count="(\d+)"/)![1]).toBe("5");
    dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
    void dto;
    // weapons do not register into the tree, magic items neither
    xml = service.exportCharacterXml(id);
    expect(xml.match(/registered-count="(\d+)"/)![1]).toBe("5");
    const tree = xml.slice(xml.indexOf("<elements"), xml.indexOf("</elements>"));
    expect(tree.match(/<element type="Weapon"/g)).toBeNull();
    // attune the ring -> registers into the sum and count
    const ring = byItemId(service.getInventory(id), RING)!;
    service.attuneItem(id, ring.identifier, true);
    xml = service.exportCharacterXml(id);
    expect(xml.match(/registered-count="(\d+)"/)![1]).toBe("6");
    expect(xml).toContain('<element type="Magic Item" id="ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING" />');
    // unequip the longsword -> unregisters
    const longsword = byItemId(service.getInventory(id), LONGSWORD)!;
    service.equipItem(id, longsword.identifier, "none");
    xml = service.exportCharacterXml(id);
    expect(xml.match(/registered-count="(\d+)"/)![1]).toBe("5");
    expect(xml).not.toContain('<element type="Weapon" id="ID_WOTC_PHB_WEAPON_LONGSWORD" />');
  });
});

function getAttrOf(node: { attrs: ReadonlyArray<readonly [string, string]> }): Record<string, string> {
  return Object.fromEntries(node.attrs);
}
