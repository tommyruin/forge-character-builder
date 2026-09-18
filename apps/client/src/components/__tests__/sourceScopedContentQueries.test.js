import fs from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relative) =>
  fs.readFileSync(new URL(relative, import.meta.url), "utf8");

// Content catalogue reads that have a character in scope must pass its id so
// the engine prunes disabled sources; without it the query reads the whole
// library (the content-manager view).
describe("source-scoped content queries", () => {
  it("scopes the equipment catalog, category pages and search to the character", () => {
    const source = readSource("../tabs/EquipmentTab.jsx");
    expect(source).toContain("api.content.equipmentCategories(id)");
    expect(source).toContain("characterId: id");
  });

  it("scopes the DM/homebrew spell and feat grants to the character", () => {
    expect(readSource("../tabs/magic/AddSpellModal.jsx")).toContain(
      "characterId: id",
    );
    expect(readSource("../tabs/feats/AddFeatModal.jsx")).toContain(
      "characterId: id",
    );
  });
});
