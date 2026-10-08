/**
 * Adding mundane armor, shields and weapons from the catalogue stores them as
 * themselves. A mundane Armor element carries `<set name="armor">` too, but
 * there it is the armour's own category (Light, Medium, Heavy, Shield), not
 * the "lay me over a base" setter a magic item carries. Reading it as a base
 * setter turned the 2024 Shield into the 2014 Shield wearing the 2024 one as
 * an adorner.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import type { ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import { sharedLibrary } from "../testing/character-factory.js";

const SHIELD_2024 = "ID_WOTC_PHB24_ARMOR_SHIELD";
const SHIELD_2014 = "ID_WOTC_GEAR_SHIELD";
const CHAIN_MAIL_2024 = "ID_WOTC_PHB24_ARMOR_HEAVY_CHAIN_MAIL";
const LONGSWORD_2024 = "ID_WOTC_PHB24_WEAPON_LONGSWORD";
const LONGSWORD_2014 = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const SCALE_MAIL_2014 = "ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL";
const SENTINEL_SHIELD = "ID_WOTC_DMG_MAGIC_ITEM_SENTINEL_SHIELD";
const FLAME_TONGUE = "ID_WOTC_DMG_MAGIC_ITEM_FLAME_TONGUE";
const STAFF_OF_FIRE = "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_FIRE";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function added(itemId: string, baseElementId: string | null = null) {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Catalogue Add").id;
  const acBefore = computeStatistics(service.getCharacter(id), library)["ac"];
  const dto = service.addItem(id, { itemId, amount: 1, baseElementId });
  const record = service.getCharacter(id).items.at(-1)!;
  const row = dto.items.find((item) => item.identifier === record.identifier)!;
  const ac = computeStatistics(service.getCharacter(id), library)["ac"];
  return { service, id, record, row, acBefore, ac };
}

describe("adding mundane equipment from the catalogue", () => {
  it("stores the 2024 Shield as itself, held in the secondary hand for +2 AC", () => {
    const { record, row, acBefore, ac } = added(SHIELD_2024);
    expect(record.itemId).toBe(SHIELD_2024);
    expect(record.adorners).toEqual([]);
    expect(row).toMatchObject({ name: "Shield", source: "Player’s Handbook (2024)", isEquipped: true });
    expect(row.equippedLocation).toBe("Secondary Hand");
    expect(ac).toBe(acBefore! + 2);
  }, 120_000);

  it("stores the 2014 Shield as itself, without itself as an adorner", () => {
    const { record, row, acBefore, ac } = added(SHIELD_2014);
    expect(record.itemId).toBe(SHIELD_2014);
    expect(record.adorners).toEqual([]);
    expect(row.equippedLocation).toBe("Secondary Hand");
    expect(ac).toBe(acBefore! + 2);
  }, 120_000);

  it("stores 2024 Chain Mail as itself, worn as armor", () => {
    const { record, row, ac } = added(CHAIN_MAIL_2024);
    expect(record.itemId).toBe(CHAIN_MAIL_2024);
    expect(record.adorners).toEqual([]);
    expect(row.equippedLocation).toBe("Armor");
    expect(ac).toBe(16);
  }, 120_000);

  it("stores 2014 Scale Mail as itself, worn as armor", () => {
    const { record, row } = added(SCALE_MAIL_2014);
    expect(record.itemId).toBe(SCALE_MAIL_2014);
    expect(record.adorners).toEqual([]);
    expect(row.equippedLocation).toBe("Armor");
  }, 120_000);

  it.each([LONGSWORD_2024, LONGSWORD_2014])("stores the Longsword %s as itself in the primary hand", (itemId) => {
    const { record, row } = added(itemId);
    expect(record.itemId).toBe(itemId);
    expect(record.adorners).toEqual([]);
    expect(row.equippedLocation).toBe("Primary Hand");
  }, 120_000);

  it("offers no base choice for mundane armor, shields or weapons", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Base Options").id;
    for (const itemId of [SHIELD_2024, SHIELD_2014, CHAIN_MAIL_2024, SCALE_MAIL_2014, LONGSWORD_2024]) {
      expect(service.getItemBaseOptions(id, itemId), itemId).toEqual({ slot: null, options: [] });
    }
  }, 120_000);

  it("round-trips the added 2024 Shield and Chain Mail through export and import", () => {
    const { service, id } = added(SHIELD_2024);
    service.addItem(id, { itemId: CHAIN_MAIL_2024, amount: 1, baseElementId: null });
    const xml = service.exportCharacterXml(id);
    expect(xml).not.toContain("<adorner");
    expect(xml).toContain(`id="${SHIELD_2024}"`);
    expect(xml).not.toContain(`id="${SHIELD_2014}"`);

    const reloaded = new CharacterService(undefined, library);
    const state = reloaded.importCharacterXml("Reloaded", xml);
    const shape = (items: typeof state.items) =>
      items.map(({ itemId, adorners, equipped, location }) => ({ itemId, adorners, equipped, location }));
    expect(shape(state.items)).toEqual(shape(service.getCharacter(id).items));
    expect(shape(state.items)).toEqual([
      { itemId: SHIELD_2024, adorners: [], equipped: true, location: expect.any(String) },
      { itemId: CHAIN_MAIL_2024, adorners: [], equipped: true, location: expect.any(String) },
    ]);
    expect(computeStatistics(state, library)["ac"]).toBe(18);
    expect(reloaded.exportCharacterXml(state.id)).toBe(xml);
  }, 120_000);
});

describe("adding magic armor and weapons from the catalogue", () => {
  it("lays a Sentinel Shield over the chosen 2024 Shield base", () => {
    const { record, row, acBefore, ac } = added(SENTINEL_SHIELD, SHIELD_2024);
    expect(record.itemId).toBe(SHIELD_2024);
    expect(record.adorners).toEqual([SENTINEL_SHIELD]);
    expect(row.name).toBe("Sentinel Shield");
    expect(row.equippedLocation).toBe("Secondary Hand");
    expect(ac).toBe(acBefore! + 2);
  }, 120_000);

  it("still offers Sentinel Shield and Flame Tongue their bases", () => {
    const service = new CharacterService(undefined, library);
    const id = service.createCharacter("Magic Options").id;
    const sentinel = service.getItemBaseOptions(id, SENTINEL_SHIELD);
    expect(sentinel.slot).toBe("armor");
    expect(sentinel.options.map((option) => option.name)).toEqual(["Shield"]);
    const flame = service.getItemBaseOptions(id, FLAME_TONGUE);
    expect(flame.slot).toBe("weapon");
    expect(flame.options.map((option) => option.name)).toContain("Longsword");
  }, 120_000);

  it("lays a Flame Tongue over a chosen 2024 Longsword base", () => {
    const { record, row } = added(FLAME_TONGUE, LONGSWORD_2024);
    expect(record.itemId).toBe(LONGSWORD_2024);
    expect(record.adorners).toEqual([FLAME_TONGUE]);
    expect(row.equippedLocation).toBe("Primary Hand");
  }, 120_000);

  it("still resolves a single-name base for a magic staff", () => {
    const { record } = added(STAFF_OF_FIRE);
    expect(record.itemId).toBe("ID_WOTC_PHB_WEAPON_QUARTERSTAFF");
    expect(record.adorners).toEqual([STAFF_OF_FIRE]);
  }, 120_000);
});
