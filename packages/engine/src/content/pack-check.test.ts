/**
 * Pack health: what is wrong with a pack's file, found before it is loaded.
 * Each kind of problem is named with the element that carries it, so the editor
 * can offer the fix that fits.
 */

import { describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "./library.js";
import { ingestContentFiles } from "./ingestion.js";
import { checkContentFile } from "./pack-check.js";
import { encodeBase64 } from "../platform.js";

const BOOK = `<elements>
  <element name="Book Spell" type="Spell" source="Book" id="ID_BOOK_SPELL_ONE"><description><p>x</p></description></element>
  <element name="Book Wand" type="Magic Item" source="Book" id="ID_BOOK_MAGIC_ITEM_WAND"><description><p>x</p></description></element>
  <element name="Book Feature" type="Class Feature" source="Book" id="ID_BOOK_CFEAT_ONE"><description><p>x</p></description></element>
  <element name="Book Hermit" type="Background" source="Book" id="ID_BOOK_BACKGROUND_HERMIT">
    <description><p>x</p></description>
    <rules><grant type="Background Feature" id="ID_BOOK_BGFEAT_SHELTER" /></rules>
  </element>
  <element name="Shelter" type="Background Feature" source="Book" id="ID_BOOK_BGFEAT_SHELTER"><description><p>x</p></description></element>
</elements>`;

const PACK_PATH = "imports/pack-check.xml";

const PACK = `<elements>
  <element name="Moonwell Pact" type="Feat" source="Pack" id="ID_PACK_FEAT_PACT">
    <description><p>x</p></description>
    <rules>
      <grant type="Spell" id="ID_BOOK_SPELL_ONE" />
      <grant type="Spell" id="ID_PACK_SPELL_FROST_LANCE" />
    </rules>
  </element>
  <element name="Wand of Embers" type="Magic Item" source="Pack" id="ID_PACK_MAGIC_ITEM_EMBERS"><description><p>first</p></description></element>
  <element name="Wand of Embers" type="Magic Item" source="Pack" id="ID_PACK_MAGIC_ITEM_EMBERS"><description><p>second</p></description></element>
  <element name="Hermit's Retreat" type="Background Feature" source="Pack" id="ID_PACK_BGFEAT_RETREAT"><description><p>x</p></description></element>
  <element name="Lantern Home" type="Background" source="Pack" id="ID_PACK_BACKGROUND_LANTERN">
    <description><p>x</p></description>
    <rules><grant type="Background Feature" id="ID_PACK_BGFEAT_HOME" /></rules>
  </element>
  <element name="Home" type="Background Feature" source="Pack" id="ID_PACK_BGFEAT_HOME"><description><p>x</p></description></element>
  <element name="Gated" type="Feat" source="Pack" id="ID_PACK_FEAT_GATED">
    <requirements>[level:</requirements>
    <description><p>x</p></description>
    <rules><stat name="initiative" value="1" requirements="ID_A,," /></rules>
  </element>
  <element name="Redefined Feature" type="Class Feature" source="Pack" id="ID_BOOK_CFEAT_ONE"><description><p>changed</p></description></element>
  <append id="ID_NOT_LOADED_CLASS"><rules><grant type="Spell" id="ID_BOOK_SPELL_ONE" /></rules></append>
  <append id="ID_BOOK_SPELL_ONE"><rules><grant type="Spell" id="ID_PACK_SPELL_ALSO_MISSING" /></rules></append>
</elements>`;

function library(): ElementLibrary {
  const lib = createEmptyLibrary();
  replaceLibraryFiles(lib, new Map([["imports/book.xml", BOOK]]));
  return lib;
}

const find = (findings: ReturnType<typeof checkContentFile>, kind: string) => findings.filter((finding) => finding.kind === kind);

describe("checking a pack's file", () => {
  it("names a grant to something nothing defines, with the element that makes it", () => {
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: PACK }), "missing-grant");
    expect(findings).toContainEqual(
      expect.objectContaining({
        elementId: "ID_PACK_FEAT_PACT",
        elementName: "Moonwell Pact",
        missingId: "ID_PACK_SPELL_FROST_LANCE",
        missingType: "Spell",
      }),
    );
    // A grant to a spell the book defines is fine; a grant inside an append is checked too.
    expect(findings.some((finding) => finding.missingId === "ID_BOOK_SPELL_ONE")).toBe(false);
    expect(findings.some((finding) => finding.missingId === "ID_PACK_SPELL_ALSO_MISSING")).toBe(true);
  });

  it("does not call a spell missing when the same pack defines it", () => {
    const withSpell = PACK.replace(
      "</elements>",
      '<element name="Frost Lance" type="Spell" source="Pack" id="ID_PACK_SPELL_FROST_LANCE"><description><p>x</p></description></element></elements>',
    );
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: withSpell }), "missing-grant");
    expect(findings.some((finding) => finding.missingId === "ID_PACK_SPELL_FROST_LANCE")).toBe(false);
  });

  it("reports an id the pack defines twice, naming the element", () => {
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: PACK }), "duplicate-id");
    expect(findings).toContainEqual(expect.objectContaining({ elementId: "ID_PACK_MAGIC_ITEM_EMBERS", elementName: "Wand of Embers" }));
    expect(findings).toHaveLength(2);
  });

  it("reports a pack element that redefines a loaded one, unless the pack means to", () => {
    const plain = checkContentFile(library(), { path: PACK_PATH, xml: PACK });
    expect(find(plain, "duplicate-id")).toContainEqual(
      expect.objectContaining({ elementId: "ID_BOOK_CFEAT_ONE", otherFile: "imports/book.xml" }),
    );
    const intended = checkContentFile(library(), { path: PACK_PATH, xml: PACK, overrides: ["ID_BOOK_CFEAT_ONE"] });
    expect(find(intended, "duplicate-id").some((finding) => finding.elementId === "ID_BOOK_CFEAT_ONE")).toBe(false);
    expect(find(intended, "overrides")).toContainEqual(expect.objectContaining({ elementId: "ID_BOOK_CFEAT_ONE", otherFile: "imports/book.xml" }));
  });

  it("flags a Background Feature no Background grants, and not one a Background does", () => {
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: PACK }), "unattachable");
    expect(findings.map((finding) => finding.elementId)).toEqual(["ID_PACK_BGFEAT_RETREAT"]);
    expect(findings[0]).toMatchObject({ elementName: "Hermit's Retreat" });
  });

  it("counts a Background Feature a book background grants as attached", () => {
    const xml = `<elements><element name="Shelter Two" type="Background Feature" source="Pack" id="ID_BOOK_BGFEAT_SHELTER"><description><p>x</p></description></element></elements>`;
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml, overrides: ["ID_BOOK_BGFEAT_SHELTER"] }), "unattachable");
    expect(findings).toEqual([]);
  });

  it("reports an append whose target is not loaded", () => {
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: PACK }), "append-target");
    expect(findings).toEqual([expect.objectContaining({ targetId: "ID_NOT_LOADED_CLASS" })]);
  });

  it("reports requirements the engine cannot read, on the element or on a rule", () => {
    const findings = find(checkContentFile(library(), { path: PACK_PATH, xml: PACK }), "invalid-requirements");
    expect(findings.every((finding) => finding.elementId === "ID_PACK_FEAT_GATED")).toBe(true);
    expect(findings).toHaveLength(2);
  });

  it("does not count the pack's own earlier copy in the library as something else defining its ids", () => {
    const lib = library();
    replaceLibraryFiles(lib, new Map([...(lib.fileContents ?? []), [PACK_PATH, PACK]]));
    const findings = checkContentFile(lib, { path: PACK_PATH, xml: PACK, overrides: ["ID_BOOK_CFEAT_ONE"] });
    // The copy under the same path is replaced by the file being checked.
    expect(find(findings, "duplicate-id").some((finding) => finding.elementId === "ID_PACK_FEAT_PACT")).toBe(false);
    expect(find(findings, "missing-grant").some((finding) => finding.missingId === "ID_PACK_BGFEAT_HOME")).toBe(false);
  });

  it("finds nothing wrong with a clean pack", () => {
    const xml = `<elements><element name="Fine" type="Feat" source="Pack" id="ID_PACK_FEAT_FINE"><description><p>x</p></description><rules><grant type="Spell" id="ID_BOOK_SPELL_ONE" /></rules></element></elements>`;
    expect(checkContentFile(library(), { path: PACK_PATH, xml })).toEqual([]);
  });
});

describe("the same findings when a file is uploaded", () => {
  const upload = async (xml: string) => {
    const lib = library();
    return ingestContentFiles(lib, [{ path: PACK_PATH, base64: encodeBase64(new TextEncoder().encode(xml)) }]);
  };

  it("reports an unattachable Background Feature and unreadable requirements against the file", async () => {
    const result = await upload(PACK);
    const unattachable = result.diagnostics.filter((diagnostic) => diagnostic.kind === "unattachable");
    expect(unattachable).toEqual([
      expect.objectContaining({ file: PACK_PATH, elementId: "ID_PACK_BGFEAT_RETREAT", elementName: "Hermit's Retreat" }),
    ]);
    const invalid = result.diagnostics.filter((diagnostic) => diagnostic.kind === "invalid-requirements");
    expect(invalid).toHaveLength(2);
    expect(invalid.every((diagnostic) => diagnostic.elementId === "ID_PACK_FEAT_GATED")).toBe(true);
  });

  it("names the element on a duplicate id", async () => {
    const result = await upload(PACK);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.kind === "duplicate-id")).toContainEqual(
      expect.objectContaining({ elementId: "ID_BOOK_CFEAT_ONE" }),
    );
  });
});
