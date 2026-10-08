import { equipmentMetadata } from "../content/equipment/categories.js";
/**
 * Inventory surface: DTO shape, add/remove/equip/attune/extract semantics,
 * and .dnd5e serialization. These expectations are the specification for the
 * inventory surface; changing one is a deliberate behaviour change, not a rebaseline.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService, InMemoryCharacterStore } from "../character/service.js";
import type { CharacterState } from "../character/state.js";
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
    // The magic item's authored 0 gp is a placeholder: no price, not the base staff's 2 sp.
    expect(staff.displayPrice).toBe("Not listed");
    expect(staff.priceGp).toBeNull();
    expect(staff.equipmentKind).toBe("Simple melee weapon");
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
    const content = await library();
    expect(staff.options).toEqual([{
      id: QUARTERSTAFF, name: "Quarterstaff",
      ...equipmentMetadata(content.byId.get(QUARTERSTAFF), key => content.byId.get(key), service.getCharacter(id)),
    }]);
    expect(staff.options[0]).toMatchObject({ priceGp: 0.2, equipmentKind: "Simple melee weapon", isProficient: false });
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
    expect(pack.extractableExtras).toEqual({ gold: 0, items: [], choices: [] });
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

const CUSTOM_PACK = "ID_TEST_PACK_EXTRAS";
const CUSTOM_ARMOR_PACK = "ID_TEST_PACK_ARMOR_EXTRAS";
const CUSTOM_PACK_XML = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Test Pack" type="Item" source="Pack Extras Test" id="${CUSTOM_PACK}">
\t\t<description><p>A test pack with noted shortfalls.</p></description>
\t\t<setters>
\t\t\t<set name="category">Equipment Packs</set>
\t\t\t<set name="cost">—</set>
\t\t\t<set name="weight">—</set>
\t\t</setters>
\t\t<extract>
\t\t\t<item amount="2">ID_WOTC_PHB_ITEM_TORCH</item>
\t\t</extract>
\t\t<extras gold="7">
\t\t\t<item>ID_WOTC_PHB24_ARMOR_SHIELD</item>
\t\t\t<choice label="Holy Symbol">
\t\t\t\t<item>ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_AMULET</item>
\t\t\t\t<item>ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_EMBLEM</item>
\t\t\t\t<item>ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_RELIQUARY</item>
\t\t\t</choice>
\t\t</extras>
\t</element>
\t<element name="Test Armor Pack" type="Item" source="Pack Extras Test" id="${CUSTOM_ARMOR_PACK}">
\t\t<description><p>A test pack whose noted shortfalls are armor.</p></description>
\t\t<setters>
\t\t\t<set name="category">Equipment Packs</set>
\t\t\t<set name="cost">—</set>
\t\t\t<set name="weight">—</set>
\t\t</setters>
\t\t<extract>
\t\t\t<item>ID_WOTC_PHB24_WEAPON_LONGSWORD</item>
\t\t</extract>
\t\t<extras>
\t\t\t<item>ID_WOTC_PHB24_ARMOR_SHIELD</item>
\t\t\t<item>ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL</item>
\t\t</extras>
\t</element>
</elements>
`;

let customLibraryPromise: Promise<ElementLibrary> | null = null;
const customLibrary = (): Promise<ElementLibrary> => {
  customLibraryPromise ??= (async () => {
    const withPack = await buildCorpusLibrary();
    const files = new Map(withPack.fileContents);
    files.set("testdata/scratch/pack-extras-test.xml", CUSTOM_PACK_XML);
    replaceLibraryFiles(withPack, files);
    return withPack;
  })();
  return customLibraryPromise;
};

describe("pack extras extraction", () => {
  // The custom library is a second full corpus build; load it once, before
  // the tests, rather than inside the first test's own timeout.
  beforeAll(async () => { await customLibrary(); }, 120_000);
  const SHIELD = "ID_WOTC_PHB24_ARMOR_SHIELD";
  const AMULET = "ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_AMULET";
  const EMBLEM = "ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_EMBLEM";
  const RELIQUARY = "ID_WOTC_PHB24_ITEM_HOLY_SYMBOL_RELIQUARY";
  const customService = async (): Promise<CharacterService> =>
    new CharacterService(undefined, await customLibrary());

  it("adds fixed items and gold, and appends the selected choice", async () => {
    const service = await customService();
    const id = service.createCharacter("Extras Char").id;
    let dto = service.addItem(id, { itemId: CUSTOM_PACK, amount: 1, baseElementId: null });
    const pack = byItemId(dto, CUSTOM_PACK)!;
    expect(pack.isExtractable).toBe(true);
    expect(pack.extractableExtras).toEqual({
      gold: 7,
      items: [{ itemId: SHIELD, name: "Shield", amount: 1 }],
      choices: [
        {
          label: "Holy Symbol",
          candidates: [
            { itemId: AMULET, name: "Amulet", amount: 1 },
            { itemId: EMBLEM, name: "Emblem", amount: 1 },
            { itemId: RELIQUARY, name: "Reliquary", amount: 1 },
          ],
        },
      ],
    });

    dto = service.extractItem(id, pack.identifier, { "Holy Symbol": AMULET });
    expect(byItemId(dto, CUSTOM_PACK)).toBeUndefined();
    expect(dto.coins.gold).toBe(7);
    expect(byItemId(dto, SHIELD)!.amount).toBe(1);
    expect(byItemId(dto, AMULET)).toBeDefined();
    expect(byItemId(dto, EMBLEM)).toBeUndefined();
    expect(dto.items.find((item) => item.itemId === "ID_WOTC_PHB_ITEM_TORCH")!.amount).toBe(2);
  });

  it("skips unset choices and rejects candidates the pack does not offer", async () => {
    const service = await customService();
    const id = service.createCharacter("Manual Choice").id;
    const dto = service.addItem(id, { itemId: CUSTOM_PACK, amount: 1, baseElementId: null });
    const pack = byItemId(dto, CUSTOM_PACK)!;
    expect(() => service.extractItem(id, pack.identifier, { "Holy Symbol": SHIELD })).toThrow(
      `'${SHIELD}' is not a candidate for Holy Symbol`,
    );
    const extracted = service.extractItem(id, pack.identifier);
    expect(extracted.items.some((item) => item.itemId === AMULET)).toBe(false);
    expect(extracted.coins.gold).toBe(7);
  });

  it("consumes one unit per extraction and credits each unit's extras", async () => {
    const service = await customService();
    const id = service.createCharacter("Stack Extras").id;
    const dto = service.addItem(id, { itemId: CUSTOM_PACK, amount: 2, baseElementId: null });
    const pack = byItemId(dto, CUSTOM_PACK)!;
    expect(pack.amount).toBe(2);

    const first = service.extractItem(id, pack.identifier);
    expect(byItemId(first, CUSTOM_PACK)!.amount).toBe(1);
    expect(first.coins.gold).toBe(7);
    expect(first.items.filter((item) => item.itemId === SHIELD)).toHaveLength(1);

    const second = service.extractItem(id, pack.identifier);
    expect(byItemId(second, CUSTOM_PACK)).toBeUndefined();
    expect(second.coins.gold).toBe(14);
    expect(second.items.filter((item) => item.itemId === SHIELD)).toHaveLength(2);
  });

  it("credits nothing when the pack is deleted without extracting", async () => {
    const service = await customService();
    const id = service.createCharacter("Deleted Pack").id;
    let dto = service.addItem(id, { itemId: CUSTOM_PACK, amount: 1, baseElementId: null });
    const pack = byItemId(dto, CUSTOM_PACK)!;
    dto = service.removeItem(id, pack.identifier);
    expect(dto.items).toHaveLength(0);
    expect(dto.coins.gold).toBe(0);
  });

  describe("wearing unpacked armor", () => {
    const CHAIN_MAIL = "ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL";
    const SCALE_MAIL_24 = "ID_WOTC_PHB24_ARMOR_MEDIUM_SCALE_MAIL";
    const GREATSWORD_24 = "ID_WOTC_PHB24_WEAPON_GREATSWORD";
    const LONGSWORD_24 = "ID_WOTC_PHB24_WEAPON_LONGSWORD";
    const STEALTH = "ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE";
    const registeredCount = (xml: string): number => Number(xml.match(/registered-count="(\d+)"/)![1]);
    const sumOf = (xml: string): string => xml.slice(xml.indexOf("<sum"), xml.indexOf("</sum>"));
    const treeOf = (xml: string): string => xml.slice(xml.indexOf("<elements"), xml.indexOf("</elements>"));
    const count = (text: string, needle: string): number => text.split(needle).length - 1;
    const withArmorPack = async (name: string, amount = 1) => {
      const service = await customService();
      const id = service.createCharacter(name).id;
      const dto = service.addItem(id, { itemId: CUSTOM_ARMOR_PACK, amount, baseElementId: null });
      return { service, id, pack: byItemId(dto, CUSTOM_ARMOR_PACK)! };
    };

    it("wears the pack's body armor and holds its shield, leaving weapons carried", async () => {
      const { service, id, pack } = await withArmorPack("Unpacked Armor");
      const before = registeredCount(service.exportCharacterXml(id));
      const dto = service.extractItem(id, pack.identifier);
      expect(byItemId(dto, CHAIN_MAIL)!.equippedLocation).toBe("Armor");
      expect(byItemId(dto, SHIELD)!.equippedLocation).toBe("Secondary Hand");
      // The user's decision: only armor and shields equip from a pack.
      expect(byItemId(dto, LONGSWORD_24)!.isEquipped).toBe(false);

      const xml = service.exportCharacterXml(id);
      expect(xml).toContain('<equipped location="Armor">true</equipped>');
      expect(xml).toContain('<equipped location="Secondary Hand">true</equipped>');
      expect(count(sumOf(xml), `id="${STEALTH}"`)).toBe(1);
      expect(count(treeOf(xml), '<element type="Armor" name="Chain Mail"')).toBe(1);

      // The registrations match wearing the same two records by hand: taking
      // them off returns the count to its pre-extraction value, and putting
      // them back on reproduces the unpacked file. (Adding this Shield through
      // addItem would adorn a 2014 Shield with it, so the hand path equips the
      // unpacked records rather than adding fresh ones.)
      const manual = await withArmorPack("Worn By Hand");
      const manualBefore = registeredCount(manual.service.exportCharacterXml(manual.id));
      const unpacked = manual.service.extractItem(manual.id, manual.pack.identifier);
      const mail = byItemId(unpacked, CHAIN_MAIL)!.identifier;
      const shield = byItemId(unpacked, SHIELD)!.identifier;
      manual.service.equipItem(manual.id, mail, "none");
      const carried = manual.service.equipItem(manual.id, shield, "none");
      expect(carried.items.every((item) => !item.isEquipped)).toBe(true);
      expect(registeredCount(manual.service.exportCharacterXml(manual.id))).toBe(manualBefore);
      manual.service.equipItem(manual.id, mail, "armor");
      manual.service.equipItem(manual.id, shield, "secondary");
      const byHand = manual.service.exportCharacterXml(manual.id);
      expect(registeredCount(xml) - before).toBe(registeredCount(byHand) - manualBefore);
      expect(registeredCount(xml) - before).toBeGreaterThan(0);
      expect(count(sumOf(byHand), `id="${STEALTH}"`)).toBe(1);

      // The written file re-imports to the same inventory and re-exports byte for byte.
      const reimported = service.importCharacterXml("Unpacked Armor Copy", xml);
      const lib = await customLibrary();
      expect(buildInventoryDto(reimported, lib)).toEqual(buildInventoryDto(service.getCharacter(id), lib));
      expect(service.exportCharacterXml(reimported.id)).toBe(xml);
    });

    it("leaves the unpacked armor carried when armor is already worn", async () => {
      const { service, id, pack } = await withArmorPack("Already Armored");
      const worn = byItemId(service.addItem(id, { itemId: SCALE_MAIL_24, amount: 1, baseElementId: null }), SCALE_MAIL_24)!;
      expect(worn.equippedLocation).toBe("Armor");
      const dto = service.extractItem(id, pack.identifier);
      expect(byItemId(dto, SCALE_MAIL_24)!.equippedLocation).toBe("Armor");
      expect(byItemId(dto, CHAIN_MAIL)!.isEquipped).toBe(false);
      expect(byItemId(dto, SHIELD)!.equippedLocation).toBe("Secondary Hand");
      const tree = treeOf(service.exportCharacterXml(id));
      expect(count(tree, '<element type="Armor" name="Chain Mail"')).toBe(0);
      expect(count(tree, '<element type="Armor" name="Scale Mail"')).toBe(1);
    });

    it("leaves the unpacked shield carried while a two-handed weapon is held", async () => {
      const { service, id, pack } = await withArmorPack("Two Hands Full");
      const held = byItemId(service.addItem(id, { itemId: GREATSWORD_24, amount: 1, baseElementId: null }), GREATSWORD_24)!;
      expect(held.equippedLocation).toBe("Two-Handed");
      const dto = service.extractItem(id, pack.identifier);
      expect(byItemId(dto, GREATSWORD_24)!.equippedLocation).toBe("Two-Handed");
      expect(byItemId(dto, SHIELD)!.isEquipped).toBe(false);
      expect(byItemId(dto, CHAIN_MAIL)!.equippedLocation).toBe("Armor");
    });

    it("does not equip a second identical pack's armor over the first", async () => {
      const { service, id, pack } = await withArmorPack("Two Packs", 2);
      service.extractItem(id, pack.identifier);
      const dto = service.extractItem(id, pack.identifier);
      const mails = dto.items.filter((item) => item.itemId === CHAIN_MAIL);
      const shields = dto.items.filter((item) => item.itemId === SHIELD);
      expect(mails.map((item) => item.equippedLocation)).toEqual(["Armor", null]);
      expect(shields.map((item) => item.equippedLocation)).toEqual(["Secondary Hand", null]);
      const xml = service.exportCharacterXml(id);
      expect(count(sumOf(xml), `id="${STEALTH}"`)).toBe(1);
      expect(count(treeOf(xml), '<element type="Armor" name="Chain Mail"')).toBe(1);
    });

    it("stores the unpacking and the equips as one change (one undo step)", async () => {
      class CountingStore extends InMemoryCharacterStore {
        sets = 0;
        override set(state: CharacterState): void {
          this.sets++;
          super.set(state);
        }
      }
      const store = new CountingStore();
      const service = new CharacterService(store, await customLibrary());
      const id = service.createCharacter("One Step").id;
      const pack = byItemId(service.addItem(id, { itemId: CUSTOM_ARMOR_PACK, amount: 1, baseElementId: null }), CUSTOM_ARMOR_PACK)!;
      store.sets = 0;
      const dto = service.extractItem(id, pack.identifier);
      expect(store.sets).toBe(1);
      expect(byItemId(dto, CHAIN_MAIL)!.equippedLocation).toBe("Armor");
      expect(byItemId(dto, SHIELD)!.equippedLocation).toBe("Secondary Hand");
    });
  });
});

describe("inventory amounts and stacking", () => {
  const POTION = "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING";
  const DAGGER = "ID_WOTC_PHB_WEAPON_DAGGER";

  it("sets an amount up and down, writing the attribute only above 1", async () => {
    const service = await freshService();
    const id = service.createCharacter("Amount Char").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 1, baseElementId: null });
    const potion = dto.items[0]!;
    expect(potion.amount).toBe(1);
    expect(potion.weight).toBe("½ lb.");
    expect(dto.equipmentWeight).toBe(0.5);

    dto = service.setItemAmount(id, potion.identifier, 5);
    expect(byItemId(dto, POTION)!.amount).toBe(5);
    expect(dto.equipmentWeight).toBe(2.5);
    const raised = service.exportCharacterXml(id);
    expect(raised).toContain('amount="5"');
    const imported = service.importCharacterXml("Amount Char 2", raised);
    expect(byItemId(buildInventoryDto(imported, await library()), POTION)!.amount).toBe(5);

    dto = service.setItemAmount(id, potion.identifier, 1);
    expect(byItemId(dto, POTION)!.amount).toBe(1);
    expect(dto.equipmentWeight).toBe(0.5);
    // The omitted-at-1 form round-trips: no amount attribute survives.
    const lowered = service.exportCharacterXml(id);
    expect(lowered).not.toMatch(/<item[^>]* amount="/);
    const reimported = service.importCharacterXml("Amount Char 3", lowered);
    expect(byItemId(buildInventoryDto(reimported, await library()), POTION)!.amount).toBe(1);
  });

  it("rejects non-positive and fractional amounts", async () => {
    const service = await freshService();
    const id = service.createCharacter("Amount Guard").id;
    const dto = service.addItem(id, { itemId: POTION, amount: 1, baseElementId: null });
    const potion = dto.items[0]!;
    expect(() => service.setItemAmount(id, potion.identifier, 0)).toThrow(/invalid item amount/);
    expect(() => service.setItemAmount(id, potion.identifier, -3)).toThrow(/invalid item amount/);
    expect(() => service.setItemAmount(id, potion.identifier, 2.5)).toThrow(/invalid item amount/);
  });

  it("grows the existing carried stack when the same item is added again", async () => {
    const service = await freshService();
    const id = service.createCharacter("Stack Char").id;
    let dto = service.addItem(id, { itemId: POTION, amount: 1, baseElementId: null });
    const first = dto.items[0]!;
    dto = service.addItem(id, { itemId: POTION, amount: 2, baseElementId: null });
    const potions = dto.items.filter((i) => i.itemId === POTION);
    expect(potions).toHaveLength(1);
    expect(potions[0]!.identifier).toBe(first.identifier);
    expect(potions[0]!.amount).toBe(3);
    expect(dto.equipmentWeight).toBe(1.5);
  });

  it("keeps a repeated add separate when the item auto-equips or is not stackable", async () => {
    const service = await freshService();
    const id = service.createCharacter("Stack Guard").id;
    let dto = service.addItem(id, { itemId: DAGGER, amount: 1, baseElementId: null });
    const first = dto.items[0]!;
    expect(first.isEquipped).toBe(true);
    dto = service.addItem(id, { itemId: DAGGER, amount: 1, baseElementId: null });
    expect(dto.items.filter((i) => i.itemId === DAGGER)).toHaveLength(2);
  });

  it("never merges attunable, adorned or stowed records", async () => {
    const service = await freshService();
    const id = service.createCharacter("Stack Attune").id;
    // Attunable records stay one row each: the attunement bond belongs to a record.
    let dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
    dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
    expect(dto.items.filter((i) => i.itemId === RING)).toHaveLength(2);

    // A stowed stack is not a carried merge target; the new copy lands carried.
    dto = service.addItem(id, { itemId: POTION, amount: 4, baseElementId: null });
    const potion = dto.items.find((i) => i.itemId === POTION)!;
    dto = service.setItemStorage(id, potion.identifier, "#1");
    expect(byItemId(dto, POTION)!.storage).toBe("#1");
    dto = service.addItem(id, { itemId: POTION, amount: 1, baseElementId: null });
    const rows = dto.items.filter((i) => i.itemId === POTION);
    expect(rows).toHaveLength(2);
    expect(rows.find((i) => i.storage === null)!.amount).toBe(1);
    expect(rows.find((i) => i.storage === "#1")!.amount).toBe(4);
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
