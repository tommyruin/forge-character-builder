/**
 * A feature select that offers Class Feature options (the Artificer's
 * "Replicate Magic Item" infusion is the shape) lists options from the
 * Dungeon Master's Guide in 2024 mode as it does in 2014 mode.
 *
 * Synthetic content only: invented names, a DMG-named source and another source.
 */
import { describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Tinker" type="Background" source="Option Test" id="ID_TEST_BACKGROUND_TINKER">
    <rules>
      <select type="Class Feature" name="Replicate Thing" supports="Replicate Magic Item Option" />
    </rules>
  </element>
  <element name="Glow Lamp" type="Class Feature" source="Dungeon Master’s Guide" id="ID_TEST_OPTION_DMG_LAMP">
    <supports>Replicate Magic Item Option</supports>
  </element>
  <element name="Straight Lamp" type="Class Feature" source="Dungeon Master's Guide" id="ID_TEST_OPTION_DMG_STRAIGHT">
    <supports>Replicate Magic Item Option</supports>
  </element>
  <element name="Other Lamp" type="Class Feature" source="Other Book" id="ID_TEST_OPTION_OTHER_LAMP">
    <supports>Replicate Magic Item Option</supports>
  </element>
  <element name="Marked 2014 Lamp" type="Class Feature" source="Other Book" id="ID_TEST_OPTION_MARKED_2014">
    <supports>Replicate Magic Item Option</supports>
    <setters><set name="ruleset">2014</set></setters>
  </element>
  <element name="Dull Wand" type="Magic Item" source="Dungeon Master’s Guide" id="ID_TEST_ITEM_DMG_WAND" />
  <element name="Dungeon Master’s Guide" type="Source" source="Core" id="ID_TEST_SOURCE_DMG" />
  <element name="Other Book" type="Source" source="Core" id="ID_TEST_SOURCE_OTHER" />
</elements>`;

function offered(mode: "2014" | "2024" | null, restrictedSources: string[] = []): string[] {
  const library: ElementLibrary = createEmptyLibrary();
  replaceLibraryFiles(library, new Map([["test/dmg-options.xml", xml]]));
  const service = new CharacterService(undefined, library, { rng: seededRng(5) });
  const id = service.createCharacter("Tinker").id;
  if (mode) service.setRulesetMode(id, mode);
  const background = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Background")!;
  service.setSelection(id, background.identifier, "ID_TEST_BACKGROUND_TINKER");
  service.getCharacter(id).restrictedSources = restrictedSources;
  const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Replicate Thing")!;
  return selectionOptions(service.getCharacter(id), library, rule).map((option) => option.name).sort();
}

describe("Class Feature options sourced from the Dungeon Master's Guide", () => {
  it("are offered in 2014 mode and with no mode set", () => {
    expect(offered("2014")).toEqual(["Glow Lamp", "Marked 2014 Lamp", "Other Lamp", "Straight Lamp"]);
    expect(offered(null)).toEqual(["Glow Lamp", "Marked 2014 Lamp", "Other Lamp", "Straight Lamp"]);
  });

  it("are offered in 2024 mode, apart from content explicitly marked 2014", () => {
    expect(offered("2024")).toEqual(["Glow Lamp", "Other Lamp", "Straight Lamp"]);
  });

  it("leave other Dungeon Master's Guide content 2014-only", () => {
    const library: ElementLibrary = createEmptyLibrary();
    replaceLibraryFiles(library, new Map([["test/dmg-options.xml", xml]]));
    expect(library.ruleset.get("ID_TEST_ITEM_DMG_WAND")).toBe("2014");
    expect(library.ruleset.get("ID_TEST_OPTION_DMG_LAMP")).toBe("shared");
  });

  it("still follow source restrictions", () => {
    expect(offered("2024", ["ID_TEST_SOURCE_DMG"])).toEqual(["Other Lamp"]);
  });
});
