/**
 * A magic weapon or armour (an element whose `weapon`/`armor` setter names
 * the base it is laid over) added without that base cannot be wielded or worn
 * -- it has no equip location -- so it conveys nothing while it is only
 * carried. Slotless magic items (cloaks, rings) are unaffected: attunement,
 * or wearing them, is what turns them on.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import type { ElementLibrary } from "../content/library.js";
import { computeStatistics, initiativeAdvantageSources } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { sharedLibrary } from "../testing/character-factory.js";
import { itemBenefitsActive } from "./inventory.js";

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
