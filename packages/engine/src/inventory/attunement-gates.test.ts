/**
 * Item benefit gating: an item conveys its statistics only while it is
 * equipped, and an attunement-requiring item must ALSO be attuned. Attunement
 * alone (item not in use) conveys nothing, and an attunement-requiring item in
 * hand stays inert until attuned. The attuned counter tracks attunement
 * itself, never mere possession or equipment.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildInventoryDto, itemBenefitsActive } from "./inventory.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


// Requires attunement; grants ac:misc +2 and saving-throw bonuses while held.
const STAFF_OF_POWER = "ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER";
// No attunement requirement; grants its bonus while simply worn.
const DRAGONGUARD = "ID_WOTC_LMOP_MAGIC_ITEM_DRAGONGUARD";
// Requires attunement and has no equip slot; grants ac:misc +1 and +1 to all saves.
const CLOAK_OF_PROTECTION = "ID_WOTC_DMG_MAGIC_ITEM_CLOAK_OF_PROTECTION";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function withItem(itemId: string): { service: CharacterService; id: string; identifier: string } {
  const service = new CharacterService(undefined, library);
  const id = "gate-probe";
  service.createCharacter(id);
  service.addItem(id, { itemId, amount: 1 });
  const identifier = service.getCharacter(id).items.at(-1)!.identifier;
  return { service, id, identifier };
}

describe("attunement benefit gates", () => {
  it("keeps an attunement-requiring item inert while merely equipped", () => {
    const { service, id } = withItem(STAFF_OF_POWER);
    const state = service.getCharacter(id);
    expect(state.items.at(-1)!.equipped).toBe(true);
    expect(state.items.at(-1)!.attuned).toBe(false);
    const values = computeStatistics(state, library);
    expect(values["ac:misc"] ?? 0).toBe(0);
    expect(values["strength:save:misc"] ?? 0).toBe(0);
    expect(buildInventoryDto(state, library).attunedItemCount).toBe(0);
  });

  it("conveys the benefits once equipped AND attuned", () => {
    const { service, id, identifier } = withItem(STAFF_OF_POWER);
    service.attuneItem(id, identifier, true);
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    expect(values["ac:misc"]).toBe(2);
    expect(values["strength:save:misc"]).toBe(2);
    expect(buildInventoryDto(state, library).attunedItemCount).toBe(1);
  });

  it("keeps an attuned item inert while it is not equipped", () => {
    const { service, id, identifier } = withItem(STAFF_OF_POWER);
    service.equipItem(id, identifier, "none");
    service.attuneItem(id, identifier, true);
    const state = service.getCharacter(id);
    expect(state.items.at(-1)!.attuned).toBe(true);
    const values = computeStatistics(state, library);
    expect(values["ac:misc"] ?? 0).toBe(0);
    // The attunement slot is still consumed while attuned.
    expect(buildInventoryDto(state, library).attunedItemCount).toBe(1);
  });

  // A cloak has no hand or armour slot to fill, so attunement is its only
  // gate: the magical bond is what puts it to use. Saved characters model it
  // that way too -- an <attunement> node and a registered sum entry, with an
  // <equipped>true</equipped> node (no location) only when the wearer has no
  // attunement to record.
  it("activates a slotless attunement item on attunement alone", () => {
    const { service, id, identifier } = withItem(CLOAK_OF_PROTECTION);
    const before = computeStatistics(service.getCharacter(id), library);
    expect(before["ac:misc"] ?? 0).toBe(0);
    service.attuneItem(id, identifier, true);
    const state = service.getCharacter(id);
    const values = computeStatistics(state, library);
    expect(values["ac:misc"]).toBe(1);
    expect(values["wisdom:save:misc"]).toBe(1);
    expect(buildInventoryDto(state, library).attunedItemCount).toBe(1);
  });

  it("keeps a slotless attunement item active across export and reimport", () => {
    const { service, id, identifier } = withItem(CLOAK_OF_PROTECTION);
    service.attuneItem(id, identifier, true);
    const xml = service.exportCharacterXml(id);
    const reimport = new CharacterService(undefined, library);
    const { id: importedId } = reimport.importCharacterXml("gate-reimport", xml);
    const state = reimport.getCharacter(importedId);
    expect(state.items.at(-1)!.attuned).toBe(true);
    const values = computeStatistics(state, library);
    expect(values["ac:misc"]).toBe(1);
    expect(buildInventoryDto(state, library).attunedItemCount).toBe(1);
  });

  it("keeps a stowed slotless item inert even while attuned", () => {
    expect(
      itemBenefitsActive(library, {
        itemId: CLOAK_OF_PROTECTION,
        adorners: [],
        equipped: false,
        attuned: true,
        storage: "Backpack",
      }),
    ).toBe(false);
  });

  it("lets a non-attunement item convey its bonus while simply equipped", () => {
    const { service, id } = withItem(DRAGONGUARD);
    const state = service.getCharacter(id);
    const item = state.items.at(-1)!;
    expect(item.attuned).toBe(false);
    if (!item.equipped) service.equipItem(id, item.identifier, "Armor");
    const values = computeStatistics(service.getCharacter(id), library);
    expect(values["ac:armored:enhancement"]).toBe(1);
    expect(buildInventoryDto(service.getCharacter(id), library).attunedItemCount).toBe(0);
  });
});
