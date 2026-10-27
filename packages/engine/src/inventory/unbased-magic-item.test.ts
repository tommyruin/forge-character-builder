/**
 * A magic weapon or armour (an element whose `weapon`/`armor` setter names
 * the base it is laid over) added without that base cannot be wielded or worn
 * -- it has no equip location -- so it conveys nothing while it is only
 * carried. Slotless magic items (cloaks, rings) are unaffected: attunement,
 * or wearing them, is what turns them on.
 *
 * A Magic Item is a weapon or armour only through that base setter, as in
 * the .dnd5e format: `<set name="type" addition="longsword">Weapon</set>` is the item's
 * printed type line ("Weapon (longsword)") and nothing more, and every
 * shipped magic weapon that is not ammunition names its base. One authored
 * without a base is ordinary slotless gear -- worn, not wielded -- and
 * `missingMagicItemBase` names it so a pack check can say why.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { missingMagicItemBase } from "../content/equipment/categories.js";
import { computeStatistics, initiativeAdvantageSources } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { sharedLibrary } from "../testing/character-factory.js";
import { itemBaseOptions, itemBenefitsActive } from "./inventory.js";

const SENTINEL_SHIELD = "ID_WOTC_DMG_MAGIC_ITEM_SENTINEL_SHIELD";
const SHIELD_2024 = "ID_WOTC_PHB24_ARMOR_SHIELD";
const CLOAK_OF_PROTECTION = "ID_WOTC_DMG_MAGIC_ITEM_CLOAK_OF_PROTECTION";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function withItem(itemId: string, baseElementId: string | null = null) {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Unbased Magic").id;
  const passiveBefore = computeStatistics(service.getCharacter(id), library)["perception:passive"];
  const acBefore = computeStatistics(service.getCharacter(id), library)["ac"];
  service.addItem(id, { itemId, amount: 1, baseElementId });
  const record = () => service.getCharacter(id).items.at(-1)!;
  return { service, id, record, passiveBefore, acBefore };
}

const advantageValue = (service: CharacterService, id: string) =>
  buildCharacterSheetModel(service.getCharacter(id), library, { mode: "lite" }).formValues?.["details_initiative_advantage"];

describe("a magic item added without the base it needs", () => {
  it("does not grant a carried, unbased Sentinel Shield's initiative advantage or passive Perception", () => {
    const { service, id, record, passiveBefore } = withItem(SENTINEL_SHIELD);
    expect(record()).toMatchObject({ itemId: SENTINEL_SHIELD, adorners: [], equipped: false });
    expect(service.getInventory(id).items[0]!.isEquippable).toBe(false);
    expect(itemBenefitsActive(library, record())).toBe(false);
    expect(initiativeAdvantageSources(service.getCharacter(id), library)).toEqual([]);
    expect(advantageValue(service, id)).toBe("");
    expect(computeStatistics(service.getCharacter(id), library)["perception:passive"]).toBe(passiveBefore);
    // Attuning cannot switch it on either: it still cannot be worn.
    service.attuneItem(id, record().identifier, true);
    expect(itemBenefitsActive(library, record())).toBe(false);
    expect(initiativeAdvantageSources(service.getCharacter(id), library)).toEqual([]);
  }, 120_000);

  it("grants a Sentinel Shield's benefits once it is on a Shield base and equipped", () => {
    const { service, id, record, passiveBefore, acBefore } = withItem(SENTINEL_SHIELD, SHIELD_2024);
    expect(record()).toMatchObject({ itemId: SHIELD_2024, adorners: [SENTINEL_SHIELD], equipped: true });
    expect(itemBenefitsActive(library, record())).toBe(true);
    expect(initiativeAdvantageSources(service.getCharacter(id), library)).toEqual([
      { id: SENTINEL_SHIELD, name: "Sentinel Shield" },
    ]);
    expect(advantageValue(service, id)).toBe("true");
    const stats = computeStatistics(service.getCharacter(id), library);
    expect(stats["perception:passive"]).toBe(passiveBefore! + 5);
    expect(stats["ac"]).toBe(acBefore! + 2);
  }, 120_000);

  it("keeps an attuned Cloak of Protection active while carried", () => {
    const { service, id, record, acBefore } = withItem(CLOAK_OF_PROTECTION);
    expect(record()).toMatchObject({ itemId: CLOAK_OF_PROTECTION, adorners: [], equipped: false });
    expect(itemBenefitsActive(library, record())).toBe(false);
    service.attuneItem(id, record().identifier, true);
    expect(itemBenefitsActive(library, record())).toBe(true);
    expect(computeStatistics(service.getCharacter(id), library)["ac"]).toBe(acBefore! + 1);
  }, 120_000);
});

const UNBASED_BLADE = "ID_TEST_MAGIC_ITEM_UNBASED_BLADE";
const BASED_BLADE = "ID_TEST_MAGIC_ITEM_BASED_BLADE";
const UNBASED_BOLTS = "ID_TEST_MAGIC_ITEM_UNBASED_BOLTS";
const UNBASED_PLATE = "ID_TEST_MAGIC_ITEM_UNBASED_PLATE";
const LONGSWORD_2024 = "ID_WOTC_PHB24_WEAPON_LONGSWORD";

const UNBASED_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Unbased Blade" type="Magic Item" source="Unbased Magic Test" id="${UNBASED_BLADE}">
\t\t<description><p>A test blade with no base.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="longsword">Weapon</set>
\t\t\t<set name="rarity">Rare</set>
\t\t\t<set name="damage" type="slashing">1d8</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Vision" id="ID_VISION_BLINDSIGHT" />
\t\t</rules>
\t</element>
\t<element name="Based Blade" type="Magic Item" source="Unbased Magic Test" id="${BASED_BLADE}">
\t\t<description><p>The same blade on a longsword.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="longsword">Weapon</set>
\t\t\t<set name="weapon">${LONGSWORD_2024}</set>
\t\t</setters>
\t</element>
\t<element name="Unbased Bolts" type="Magic Item" source="Unbased Magic Test" id="${UNBASED_BOLTS}">
\t\t<description><p>Test ammunition.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Weapons</set>
\t\t\t<set name="type" addition="any ammunition">Weapon</set>
\t\t\t<set name="stackable">true</set>
\t\t</setters>
\t</element>
\t<element name="Unbased Plate" type="Magic Item" source="Unbased Magic Test" id="${UNBASED_PLATE}">
\t\t<description><p>Test armor with no base.</p></description>
\t\t<setters>
\t\t\t<set name="category">Magic Armor</set>
\t\t\t<set name="type" addition="plate">Armor</set>
\t\t</setters>
\t</element>
</elements>
`;

describe("a magic weapon or armor authored without a base", () => {
  let packLibrary: ElementLibrary;
  beforeAll(() => {
    const files = new Map(library.fileContents);
    files.set("imports/unbased-magic-test.xml", UNBASED_PACK);
    packLibrary = { ...library, fileContents: new Map<string, string>() } as ElementLibrary;
    replaceLibraryFiles(packLibrary, files);
  }, 120_000);

  it("names the base a Magic Item's type line claims but no base setter supplies", () => {
    const element = (id: string) => packLibrary.byId.get(id);
    expect(missingMagicItemBase(element(UNBASED_BLADE))).toBe("weapon");
    expect(missingMagicItemBase(element(UNBASED_PLATE))).toBe("armor");
    // A base setter, stackable ammunition and plain gear need no base.
    expect(missingMagicItemBase(element(BASED_BLADE))).toBeNull();
    expect(missingMagicItemBase(element(UNBASED_BOLTS))).toBeNull();
    expect(missingMagicItemBase(element(SENTINEL_SHIELD))).toBeNull();
    expect(missingMagicItemBase(element(CLOAK_OF_PROTECTION))).toBeNull();
    expect(missingMagicItemBase(element(LONGSWORD_2024))).toBeNull();
    expect(missingMagicItemBase(undefined)).toBeNull();
  });

  it("flags no shipped magic item", () => {
    const flagged = (packLibrary.byType.get("Magic Item") ?? [])
      .filter((item) => item.declaredBy !== "imports/unbased-magic-test.xml")
      .filter((item) => missingMagicItemBase(item) !== null)
      .map((item) => item.identity.id);
    expect(flagged).toEqual([]);
  });

  it("is slotless gear: worn rather than wielded, with no attack row and no base to pick", () => {
    const service = new CharacterService(undefined, packLibrary);
    const id = service.createCharacter("Unbased Blade").id;
    const dto = service.addItem(id, { itemId: UNBASED_BLADE, amount: 1, baseElementId: null });
    const record = dto.items.at(-1)!;
    expect(record).toMatchObject({ itemId: UNBASED_BLADE, isEquipped: false, equipLocations: ["worn"], hasAttackRow: false });
    expect(itemBaseOptions(packLibrary, UNBASED_BLADE)).toEqual({ slot: null, options: [] });

    // Worn, it conveys what it grants, the way any slotless item does.
    service.equipItem(id, record.identifier, "worn");
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain(`id="${UNBASED_BLADE}"`);
    expect(xml.slice(xml.indexOf("<sum "), xml.indexOf("</sum>"))).toContain("ID_VISION_BLINDSIGHT");
    expect(service.getInventory(id).items.at(-1)!.hasAttackRow).toBe(false);
  }, 120_000);
});
