/**
 * A feature whose recovery changes at a level states the new usage on that
 * level's description; the sheet prints the tier the character has reached
 * over the usage the sheet states for every level. The element is synthetic.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { buildCharacterSheetModel } from "./model.js";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Tide Forge" type="Source" source="Tide Forge" id="ID_TEST_SOURCE_TIDE_FORGE">
\t\t<description><p>Homebrew.</p></description>
\t\t<setters><set name="abbreviation">TF</set><set name="url">https://local.homebrew</set><set name="homebrew">true</set></setters>
\t</element>
\t<element name="Tide Surge" type="Feat" source="Tide Forge" id="ID_TEST_FEAT_TIDE_SURGE">
\t\t<description><p>The tide lifts you.</p></description>
\t\t<sheet usage="1/Long Rest">
\t\t\t<description>The tide lifts you once.</description>
\t\t\t<description level="3" usage="1/Short Rest">The tide lifts you more often.</description>
\t\t\t<description level="9" usage="2/Short Rest">The tide lifts you twice.</description>
\t\t</sheet>
\t</element>
\t<element name="Tide Step" type="Feat" source="Tide Forge" id="ID_TEST_FEAT_TIDE_STEP">
\t\t<description><p>The tide carries you.</p></description>
\t\t<sheet usage="1/Long Rest">
\t\t\t<description>The tide carries you.</description>
\t\t\t<description level="3">The tide carries you further.</description>
\t\t</sheet>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/tiered-usage-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

function featureLines(): string[] {
  const { service, id } = buildFighter3(library, "Tiers");
  service.addGrantedFeat(id, { featId: "ID_TEST_FEAT_TIDE_SURGE" });
  service.addGrantedFeat(id, { featId: "ID_TEST_FEAT_TIDE_STEP" });
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  return model.pages.flatMap((page) => page.sections.flatMap((section) =>
    section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : row.tokens))));
}

describe("tiered feature usage", () => {
  it("prints the reached tier's usage over the sheet's", () => {
    expect(featureLines()).toContainEqual(expect.stringContaining("Tide Surge (1/Short Rest). The tide lifts you more often."));
  });

  it("falls back to the sheet's usage when the tier states none", () => {
    expect(featureLines()).toContainEqual(expect.stringContaining("Tide Step (1/Long Rest). The tide carries you further."));
  });
});
