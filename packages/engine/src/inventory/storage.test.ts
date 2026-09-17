/**
 * Item storage assignment: an inventory item's `<storage><location>` child
 * names the vehicle/cargo container it is stowed in (`state.storages`). A
 * stowed item is not on the character's person: its stat-rule benefits stop
 * applying, its weight leaves carried weight, and stowing an equipped item
 * unequips it (equipping likewise clears storage) -- the single-location
 * principle.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { parseDnd5e } from "../dnd5e/document.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildInventoryDto, type InventoryItemDto } from "./inventory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
// Requires attunement; grants ac:misc +2 while equipped AND attuned.
const STAFF_OF_POWER = "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER";
const QUARTERSTAFF = "ID_WOTC_PHB_WEAPON_QUARTERSTAFF";
// A stackable consumable: ½ lb. per potion while carried.
const POTION = "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

const byItemId = (dto: { items: InventoryItemDto[] }, itemId: string) =>
  dto.items.find((i) => i.itemId === itemId);

describe("item storage assignment", () => {
  it("starts items Carried and exposes the two container names on the DTO", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Fresh").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(dto.storages).toEqual(["#1", "#2"]);
    expect(dto.items[0]!.storage).toBeNull();
  });

  it("assigns and clears an item's storage container", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Basic").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const longsword = dto.items[0]!;
    expect(longsword.isEquipped).toBe(true); // auto-equipped, free hand
    dto = service.setItemStorage(id, longsword.identifier, "#1");
    const stowed = byItemId(dto, LONGSWORD)!;
    expect(stowed.storage).toBe("#1");
    dto = service.setItemStorage(id, longsword.identifier, null);
    expect(byItemId(dto, LONGSWORD)!.storage).toBeNull();
  });

  it("excludes a stowed item's weight from carried encumbrance", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Weight").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    expect(dto.equipmentWeight).toBe(3);
    const longsword = dto.items[0]!;
    dto = service.setItemStorage(id, longsword.identifier, "#1");
    expect(dto.equipmentWeight).toBe(0);
    dto = service.setItemStorage(id, longsword.identifier, "");
    expect(dto.equipmentWeight).toBe(3);
  });

  it("stops a stowed item's stat-rule benefits from applying, even while attuned", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Gate").id;
    const dto = service.addItem(id, { itemId: STAFF_OF_POWER, amount: 1, baseElementId: QUARTERSTAFF });
    const staff = byItemId(dto, QUARTERSTAFF)!;
    service.attuneItem(id, staff.identifier, true);
    let state = service.getCharacter(id);
    expect(computeStatistics(state, library)["ac:misc"]).toBe(2);

    service.setItemStorage(id, staff.identifier, "#1");
    state = service.getCharacter(id);
    expect(computeStatistics(state, library)["ac:misc"] ?? 0).toBe(0);
    const stowedDto = buildInventoryDto(state, library);
    const stowedItem = byItemId(stowedDto, QUARTERSTAFF)!;
    expect(stowedItem.isEquipped).toBe(false);
    expect(stowedItem.isAttuned).toBe(true);
    expect(stowedDto.attunedItemCount).toBe(1); // attunement slot still consumed
  });

  it("stowing an equipped item unequips it (single location principle)", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Unequips").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const longsword = dto.items[0]!;
    expect(longsword.isEquipped).toBe(true);
    const stowed = service.setItemStorage(id, longsword.identifier, "#1");
    const item = byItemId(stowed, LONGSWORD)!;
    expect(item.isEquipped).toBe(false);
    expect(item.equippedLocation).toBeNull();
    expect(item.storage).toBe("#1");
  });

  it("equipping a stowed item clears its storage", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Equip Clears").id;
    let dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const longsword = dto.items[0]!;
    dto = service.setItemStorage(id, longsword.identifier, "#1");
    expect(byItemId(dto, LONGSWORD)!.storage).toBe("#1");
    dto = service.equipItem(id, longsword.identifier, "primary");
    const equipped = byItemId(dto, LONGSWORD)!;
    expect(equipped.isEquipped).toBe(true);
    expect(equipped.storage).toBeNull();
  });

  it("writes the storage location node and round-trips through export/import", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Roundtrip").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    const longsword = dto.items[0]!;
    service.setItemStorage(id, longsword.identifier, "#1");

    const xml = service.exportCharacterXml(id);
    expect(xml).toContain("<storage><location>#1</location></storage>");
    const doc = parseDnd5e(xml);
    const items = doc.root.build.equipment!.items();
    const item = items.find((i) => i.id() === LONGSWORD)!;
    expect(item.storage()).toBe("#1");

    const imported = service.importCharacterXml("Storage Roundtrip 2", xml);
    expect(byItemId(buildInventoryDto(imported, library), LONGSWORD)!.storage).toBe("#1");
  });
});

describe("partial item storage moves", () => {
  it("stows part of a stack and leaves the remainder carried", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Split").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 5, baseElementId: null });
    expect(dto.equipmentWeight).toBe(2.5);
    const potion = dto.items[0]!;

    dto = service.setItemStorage(id, potion.identifier, "#1", 4);
    const rows = dto.items.filter((i) => i.itemId === POTION);
    expect(rows).toHaveLength(2);
    const carried = rows.find((i) => i.storage === null)!;
    const stowed = rows.find((i) => i.storage === "#1")!;
    expect(carried.identifier).toBe(potion.identifier);
    expect(carried.amount).toBe(1);
    expect(stowed.amount).toBe(4);
    expect(dto.equipmentWeight).toBe(0.5); // only the carried potion weighs

    // The split record is written in the pinned layout and round-trips.
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain('amount="4"');
    expect(xml).toContain("<storage><location>#1</location></storage>");
    const imported = service.importCharacterXml("Storage Split 2", xml);
    const importedRows = buildInventoryDto(imported, library).items.filter((i) => i.itemId === POTION);
    expect(importedRows).toHaveLength(2);
    expect(importedRows.find((i) => i.storage === "#1")!.amount).toBe(4);
    expect(importedRows.find((i) => i.storage === null)!.amount).toBe(1);
  });

  it("joins the remainder to a stack already in the container", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Join").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 5, baseElementId: null });
    const potion = dto.items[0]!;
    dto = service.setItemStorage(id, potion.identifier, "#1", 4);
    const carried = dto.items.find((i) => i.itemId === POTION && i.storage === null)!;

    dto = service.setItemStorage(id, carried.identifier, "#1", 1);
    const rows = dto.items.filter((i) => i.itemId === POTION);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(5);
    expect(rows[0]!.storage).toBe("#1");
    expect(dto.equipmentWeight).toBe(0);
  });

  it("returns part of a stowed stack into an identical carried stack", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Return").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 5, baseElementId: null });
    const potion = dto.items[0]!;
    dto = service.setItemStorage(id, potion.identifier, "#1", 3);
    const stowed = dto.items.find((i) => i.itemId === POTION && i.storage === "#1")!;
    expect(stowed.amount).toBe(3);

    dto = service.setItemStorage(id, stowed.identifier, null, 2);
    const rows = dto.items.filter((i) => i.itemId === POTION);
    expect(rows).toHaveLength(2);
    expect(rows.find((i) => i.storage === null)!.amount).toBe(4); // 2 carried + 2 returned
    expect(rows.find((i) => i.storage === "#1")!.amount).toBe(1);
    expect(dto.equipmentWeight).toBe(2);
  });

  it("consolidates a whole carried stack into an identical stowed stack", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Consolidate").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 4, baseElementId: null });
    const potion = dto.items[0]!;
    dto = service.setItemStorage(id, potion.identifier, "#1"); // whole record
    expect(dto.items.filter((i) => i.itemId === POTION)).toHaveLength(1);

    dto = service.addItem(id, { itemId: POTION, amount: 2, baseElementId: null });
    expect(dto.items.filter((i) => i.itemId === POTION)).toHaveLength(2);
    const carried = dto.items.find((i) => i.itemId === POTION && i.storage === null)!;
    dto = service.setItemStorage(id, carried.identifier, "#1"); // whole record, merges
    const rows = dto.items.filter((i) => i.itemId === POTION);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(6);
    expect(rows[0]!.storage).toBe("#1");
    expect(dto.equipmentWeight).toBe(0);
  });

  it("rejects move amounts outside the stack", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Storage Guard").id;
    const dto = service.addItem(id, { itemId: POTION, amount: 3, baseElementId: null });
    const potion = dto.items[0]!;
    expect(() => service.setItemStorage(id, potion.identifier, "#1", 0)).toThrow(/invalid storage amount/);
    expect(() => service.setItemStorage(id, potion.identifier, "#1", 4)).toThrow(/invalid storage amount/);
    expect(() => service.setItemStorage(id, potion.identifier, "#1", 1.5)).toThrow(/invalid storage amount/);
  });
});
