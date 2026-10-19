/**
 * An attack row is for the inventory record its identifier names. Weapon keys
 * (`longbow:attack`, `ranged:damage`, ...) follow that record, not whichever
 * item happens to share the row's name first.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { computeStatistics } from "./calculator.js";

const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
const LONGBOW = "ID_WOTC_PHB_WEAPON_LONGBOW";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function twinsNamedAlike() {
  const { service, id } = buildFighter3(library, "Twins");
  service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
  service.addItem(id, { itemId: LONGBOW, amount: 1, baseElementId: null });
  const state = structuredClone(service.getCharacter(id));
  const sword = state.items.find((item) => item.itemId === LONGSWORD)!;
  const bow = state.items.find((item) => item.itemId === LONGBOW)!;
  sword.name = "Heirloom";
  bow.name = "Heirloom";
  state.attacks = [{
    id: "attack-1", identifier: bow.identifier, name: "Heirloom", range: "", attack: "", damage: "",
    displayed: true, ability: "", kind: "weapon", abilityMode: "default", description: "", calculation: null,
  }];
  return state;
}

describe("weapon keys of an attack row", () => {
  it("follow the item the row's identifier names when another item shares its name", () => {
    const values = computeStatistics(twinsNamedAlike(), library);
    expect(values["longbow:attack"]).toBeDefined();
    expect(values["longsword:attack"]).toBeUndefined();
  });

  it("count every same-named item when the row names no record", () => {
    const state = twinsNamedAlike();
    state.attacks = state.attacks.map((attack) => ({ ...attack, identifier: "" }));
    const values = computeStatistics(state, library);
    expect(values["longbow:attack"]).toBeDefined();
    expect(values["longsword:attack"]).toBeDefined();
  });
});
