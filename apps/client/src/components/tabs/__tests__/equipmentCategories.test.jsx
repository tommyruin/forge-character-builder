import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeEquipmentCategories } from "../EquipmentTab.jsx";

const equipmentSource = readFileSync(new URL("../EquipmentTab.jsx", import.meta.url), "utf8");

describe("equipment category UI payloads", () => {
  it("normalizes legacy payloads into stable unique keys and structured filters", () => {
    const categories = normalizeEquipmentCategories([
      { id: "weapons", name: "Weapons" },
      { id: "weapons", name: "Weapons" },
      { label: "Magic Weapons", elementType: "Magic Item", equipSetter: "weapon" },
    ]);

    expect(categories).toEqual([
      {
        id: "weapons",
        name: "Weapons",
        key: "weapons",
        label: "Weapons",
        elementType: null,
        itemCategory: null,
        equipSetter: null,
      },
      {
        id: "weapons",
        name: "Weapons",
        key: "weapons-2",
        label: "Weapons",
        elementType: null,
        itemCategory: null,
        equipSetter: null,
      },
      {
        label: "Magic Weapons",
        elementType: "Magic Item",
        equipSetter: "weapon",
        key: "magic-weapons",
        itemCategory: null,
      },
    ]);
    expect(new Set(categories.map((category) => category.key)).size).toBe(categories.length);
  });

  it("uses each structured category field when loading its page", () => {
    expect(equipmentSource).toContain("if (activeCategory.elementType)");
    expect(equipmentSource).toContain("params.equipSetter = activeCategory.equipSetter");
    expect(equipmentSource).toContain("params.itemCategory = activeCategory.itemCategory");
    expect(equipmentSource).toContain("api.content.equipmentCategories()");
  });
});
