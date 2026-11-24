/**
 * A few features' sheet text breaks its line mid-thought, and those print as
 * one paragraph. Every other feature keeps its line breaks, which separate
 * distinct benefits. The element here is synthetic and only borrows the id.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { buildCharacterSheetModel } from "./model.js";

const JOINED_ID = "ID_WOTC_PHB24_CLASS_FEATURE_SORCERER_INNATE_SORCERY";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Tide Forge" type="Source" source="Tide Forge" id="ID_TEST_SOURCE_TIDE_FORGE">
\t\t<description><p>Homebrew.</p></description>
\t\t<setters><set name="abbreviation">TF</set><set name="url">https://local.homebrew</set><set name="homebrew">true</set></setters>
\t</element>
\t<element name="Tide Gift" type="Feat" source="Tide Forge" id="${JOINED_ID}">
\t\t<description><p>The tide carries you.</p></description>
\t\t<sheet><description>The tide rises around you. &#13;
\t\t\tIt falls again at dusk.</description></sheet>
\t</element>
\t<element name="Tide Ward" type="Feat" source="Tide Forge" id="ID_TEST_FEAT_TIDE_WARD">
\t\t<description><p>The tide guards you.</p></description>
\t\t<sheet><description>You have advantage on saving throws against being stunned by the surf or charmed. &#13;
\t\t\tYou have advantage on Wisdom saving throws.</description></sheet>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/one-paragraph-text-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

function sheet(): { lines: string[]; note: string | undefined } {
  const { service, id } = buildFighter3(library, "Paragraphs");
  service.addGrantedFeat(id, { featId: JOINED_ID });
  service.addGrantedFeat(id, { featId: "ID_TEST_FEAT_TIDE_WARD" });
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const lines = model.pages.flatMap((page) => page.sections.flatMap((section) =>
    section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : row.tokens))));
  return { lines, note: model.formValues?.["details_saving_throws"] };
}

describe("one-paragraph sheet text", () => {
  it("runs a named feature's sentences together", () => {
    expect(sheet().lines).toContain("Tide Gift. The tide rises around you. It falls again at dusk.");
  });

  it("keeps the line breaks of every other feature", () => {
    const ward = sheet().lines.find((line) => line.startsWith("Tide Ward."));
    expect(ward).toMatch(/[\r\n]/);
  });
});

describe("Saving Throw Notes on the sheet", () => {
  it("prints what the character's printed features grant", () => {
    expect(sheet().note).toContain("Wis");
  });
});
