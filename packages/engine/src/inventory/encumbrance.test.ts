/**
 * Encumbrance semantics: the weight setter's `lb` attribute is the
 * authoritative numeric weight (display text is a fallback only),
 * `excludeEncumbrance="true"` drops an item's contribution to carried
 * weight entirely, stack multiplication only applies to items the content
 * marks `stackable`, and an adorner's own weight setter (when present)
 * replaces the base item's weight rather than adding to it.
 */

import { describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let libraryPromise: Promise<ElementLibrary> | null = null;
const library = (): Promise<ElementLibrary> => {
  libraryPromise ??= buildCorpusLibrary();
  return libraryPromise;
};

const freshService = async (): Promise<CharacterService> => new CharacterService(undefined, await library());

// weight setter: <set name="weight" lb="0.3125">5 oz.</set> — the display
// text has no "lb" substring at all, so only the lb attribute parses correctly.
const ENERGY_CELL = "ID_WOTC_DMG_ITEM_ENERGY_CELL";
// weight setter: <set name="weight" lb="600" excludeEncumbrance="true">600 lb.</set>
const CARRIAGE = "ID_WOTC_PHB_ITEM_CARRIAGE";
// no <set name="stackable"> setter (non-stackable).
const LONGSWORD = "ID_WOTC_PHB_WEAPON_LONGSWORD";
// Magic Item with its own weight setter (lb="0"), auto-adorned onto a
// Breastplate (weight lb="20") via its "armor" base setter.
const DRAGONGUARD = "ID_WOTC_LMOP_MAGIC_ITEM_DRAGONGUARD";

describe("encumbrance weight computation", () => {
  it("uses the weight setter's lb attribute over its display text", async () => {
    const service = await freshService();
    const id = service.createCharacter("Weight lb Char").id;
    const dto = service.addItem(id, { itemId: ENERGY_CELL, amount: 1, baseElementId: null });
    expect(dto.equipmentWeight).toBe(0.3125);
  });

  it("excludes an excludeEncumbrance item from carried weight", async () => {
    const service = await freshService();
    const id = service.createCharacter("Vehicle Char").id;
    const dto = service.addItem(id, { itemId: CARRIAGE, amount: 1, baseElementId: null });
    expect(dto.equipmentWeight).toBe(0);
  });

  it("does not multiply a non-stackable item's weight by its amount", async () => {
    const service = await freshService();
    const id = service.createCharacter("Non Stackable Char").id;
    const dto = service.addItem(id, { itemId: LONGSWORD, amount: 2, baseElementId: null });
    expect(dto.equipmentWeight).toBe(3);
  });

  it("uses an adorner's own weight setter in place of the base item's weight", async () => {
    const service = await freshService();
    const id = service.createCharacter("Adorner Weight Char").id;
    const dto = service.addItem(id, { itemId: DRAGONGUARD, amount: 1 });
    expect(dto.equipmentWeight).toBe(0);
  });

  it("counts coins at fifty per pound across all denominations", async () => {
    const service = await freshService();
    const id = service.createCharacter("Coin Weight Char").id;
    service.setCoins(id, { copper: 30, silver: 10, electrum: 5, gold: 50, platinum: 5 });
    const dto = service.getInventory(id);
    expect(dto.equipmentWeight).toBe(2);
  });

  it("adds coin weight on top of item weight", async () => {
    const service = await freshService();
    const id = service.createCharacter("Coin Plus Item Char").id;
    service.addItem(id, { itemId: LONGSWORD, amount: 1, baseElementId: null });
    service.setCoins(id, { copper: 0, silver: 0, electrum: 0, gold: 25, platinum: 0 });
    const dto = service.getInventory(id);
    expect(dto.equipmentWeight).toBe(3.5);
  });
});
