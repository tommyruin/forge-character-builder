import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../EquipmentTab.jsx", import.meta.url), "utf8");

// Smart cards only ever decides the card of the record being added, and only
// when the player has switched it on; the off path is the add the builder has
// always sent.
describe("smart cards on add", () => {
  it("asks for significant-only cards only when the setting is on, read at the moment of the add", () => {
    expect(source).toMatch(/newItemCardOptions\(\s*sheetLayoutOptionsSettingStore\.getSnapshot\(\),?\s*\)/);
    expect(source).toMatch(/: api\.characters\.addItem\(id, item\.id, amount, baseElementId\)/);
  });

  it("passes the same choice to a pack extraction, leaving the old request when off", () => {
    expect(source).toMatch(/api\.characters\.extractItem\(\s*id,\s*item\.identifier,\s*selections,\s*cardOptions,?\s*\)/);
    expect(source).toMatch(/: api\.characters\.extractItem\(id, item\.identifier, selections\)/);
  });
});
