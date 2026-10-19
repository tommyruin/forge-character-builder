/**
 * A homebrew Racial Trait, Feat or Archetype Feature that carries no <sheet>
 * block still prints on the character sheet: its name and description, the
 * way a Class Feature does. Book content without a <sheet> block stays off the
 * sheet (it is deliberately unprinted), and so do internal helper elements.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { buildCharacterSheetModel } from "./model.js";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Moon Forge" type="Source" source="Moon Forge" id="ID_TEST_SOURCE_MOON_FORGE">
\t\t<description><p>Homebrew.</p></description>
\t\t<setters><set name="abbreviation">MF</set><set name="url">https://local.homebrew</set><set name="homebrew">true</set></setters>
\t</element>
\t<element name="Book Shelf" type="Source" source="Book Shelf" id="ID_TEST_SOURCE_BOOK_SHELF">
\t\t<description><p>A book.</p></description>
\t\t<setters><set name="abbreviation">BS</set><set name="url">https://example.invalid</set></setters>
\t</element>
\t<element name="Moon Boon" type="Feat" source="Moon Forge" id="ID_TEST_FEAT_MOON_BOON">
\t\t<description><p>The moon watches over you.</p></description>
\t\t<rules>
\t\t\t<grant type="Racial Trait" id="ID_TEST_TRAIT_MOON_GLOW" />
\t\t\t<grant type="Archetype Feature" id="ID_TEST_AFEAT_MOON_STEP" />
\t\t\t<grant type="Racial Trait" id="ID_INTERNAL_TEST_TRAIT_MOON_HELPER" />
\t\t\t<grant type="Racial Trait" id="ID_TEST_TRAIT_MOON_QUIET" />
\t\t\t<grant type="Racial Trait" id="ID_TEST_TRAIT_BOOK_STUB" />
\t\t</rules>
\t</element>
\t<element name="Moon Glow" type="Racial Trait" source="Moon Forge" id="ID_TEST_TRAIT_MOON_GLOW">
\t\t<description><p>Your skin <em>glows</em> softly.</p><p>It sheds dim light.</p></description>
\t</element>
\t<element name="Moon Step" type="Archetype Feature" source="Moon Forge" id="ID_TEST_AFEAT_MOON_STEP">
\t\t<description><p>You walk lightly.</p></description>
\t</element>
\t<element name="Moon Helper" type="Racial Trait" source="Moon Forge" id="ID_INTERNAL_TEST_TRAIT_MOON_HELPER">
\t\t<description><p>Bookkeeping for the moon.</p></description>
\t</element>
\t<element name="Moon Quiet" type="Racial Trait" source="Moon Forge" id="ID_TEST_TRAIT_MOON_QUIET">
\t\t<description><p>Hidden on purpose.</p></description>
\t\t<sheet display="false" />
\t</element>
\t<element name="Book Stub" type="Racial Trait" source="Book Shelf" id="ID_TEST_TRAIT_BOOK_STUB">
\t\t<description><p>A book stub.</p></description>
\t</element>
</elements>
`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/homebrew-trait-text-test.xml", PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

function sheetLines(): string[] {
  const { service, id } = buildFighter3(library, "Traits");
  service.addGrantedFeat(id, { featId: "ID_TEST_FEAT_MOON_BOON" });
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const lines: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) {
      for (const row of section.rows) lines.push(...(row.kind === "lines" ? row.lines : row.tokens));
    }
  }
  return lines;
}

describe("homebrew traits without a sheet block", () => {
  it("print their name and description", () => {
    const lines = sheetLines();
    expect(lines).toContain("Moon Glow. Your skin glows softly. It sheds dim light.");
    expect(lines).toContain("Moon Step. You walk lightly.");
  });

  it("print a homebrew feat that has no sheet block", () => {
    expect(sheetLines()).toContain("Moon Boon. The moon watches over you.");
  });

  it("leave out internal helpers, elements marked not displayed and book content", () => {
    const text = sheetLines().join("\n");
    expect(text).not.toContain("Moon Helper");
    expect(text).not.toContain("Moon Quiet");
    expect(text).not.toContain("Book Stub");
  });
});
