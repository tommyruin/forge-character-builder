/**
 * A grant (or a choice default) that names an element no loaded content
 * defines is dropped silently by the engine. Ingest reports each one against
 * the file that wrote it, naming the element and the missing id, and stays
 * quiet about ids the engine resolves itself.
 */

import { describe, expect, it } from "vitest";
import { createEmptyLibrary, type ElementLibrary } from "./library.js";
import { ingestContentFiles, removeContentFiles } from "./ingestion.js";
import { encodeBase64 } from "../platform.js";

const pack = (xml: string) => encodeBase64(new TextEncoder().encode(`<elements>${xml}</elements>`));

const BASE = `
<element name="Real Spell" type="Spell" source="Test" id="ID_TEST_SPELL_REAL"><description><p>x</p></description></element>
<element name="Inline Host" type="Feat" source="Test" id="ID_TEST_FEAT_INLINE_HOST">
  <description><p>x</p></description>
  <rules><grant type="Racial Trait" id="ID_TEST_TRAIT_INLINE" /></rules>
  <element name="Inline" type="Racial Trait" source="Test" id="ID_TEST_TRAIT_INLINE"><description><p>x</p></description></element>
</element>`;

const GRANTING = `
<element name="Moonwell Pact" type="Feat" source="Test" id="ID_TEST_FEAT_MOONWELL_PACT">
  <description><p>x</p></description>
  <rules>
    <grant type="Spell" id="ID_TEST_SPELL_REAL" />
    <grant type="Spell" id="ID_TEST_SPELL_FROST_LANCE" />
    <grant type="Spell" id="ID_TEST_SPELL_FROST_LANCE" />
    <grant type="Racial Trait" name="Nonexistent Trait" />
    <grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS" />
    <grant type="Size" id="ID_SIZE_SMALL" />
    <select type="Proficiency" name="Pick" default="ID_TEST_PROF_MISSING" />
    <select type="List" name="Words"><item id="1">alpha</item><item id="ID_TEST_NOT_AN_ELEMENT_BUT_TEXT">beta</item></select>
  </rules>
</element>
<append id="ID_TEST_SPELL_REAL"><rules><grant type="Spell" id="ID_TEST_SPELL_APPENDED_MISSING" /></rules></append>`;

async function library(): Promise<ElementLibrary> {
  const lib = createEmptyLibrary();
  await ingestContentFiles(lib, [{ path: "imports/base.xml", base64: pack(BASE) }]);
  return lib;
}

describe("missing-grant diagnostics", () => {
  it("reports each unresolved grant once with the element and the missing id", async () => {
    const lib = await library();
    const result = await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    const findings = result.diagnostics.filter((diagnostic) => diagnostic.kind === "missing-grant");

    const lance = findings.filter((finding) => finding.missingId === "ID_TEST_SPELL_FROST_LANCE");
    expect(lance).toHaveLength(1);
    expect(lance[0]).toMatchObject({
      file: "imports/granting.xml",
      elementId: "ID_TEST_FEAT_MOONWELL_PACT",
      elementName: "Moonwell Pact",
    });
    expect(lance[0]!.message).toContain("Moonwell Pact");
    expect(lance[0]!.message).toContain("ID_TEST_SPELL_FROST_LANCE");

    const missing = findings.map((finding) => finding.missingId).sort();
    expect(missing).toEqual([
      'Racial Trait "Nonexistent Trait"',
      "ID_TEST_PROF_MISSING",
      "ID_TEST_SPELL_APPENDED_MISSING",
      "ID_TEST_SPELL_FROST_LANCE",
    ].sort());
  });

  it("blames an appended rule on the file that wrote it, not the target's file", async () => {
    const lib = await library();
    const result = await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    const appended = result.diagnostics.find((finding) => finding.missingId === "ID_TEST_SPELL_APPENDED_MISSING")!;
    expect(appended.file).toBe("imports/granting.xml");
    expect(appended.elementId).toBe("ID_TEST_SPELL_REAL");
  });

  it("does not report engine-internal ids, inline elements, text lists or resolved grants", async () => {
    const lib = await library();
    const result = await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    const ids = result.diagnostics.map((finding) => finding.missingId);
    for (const quiet of ["ID_INTERNAL_GRANT_MULTICLASS", "ID_SIZE_SMALL", "ID_TEST_TRAIT_INLINE", "ID_TEST_SPELL_REAL", "ID_TEST_NOT_AN_ELEMENT_BUT_TEXT"]) {
      expect(ids).not.toContain(quiet);
    }
  });

  it("stays quiet for files other than the one being ingested", async () => {
    const lib = createEmptyLibrary();
    await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    const result = await ingestContentFiles(lib, [{ path: "imports/base.xml", base64: pack(BASE) }]);
    expect(result.diagnostics.filter((finding) => finding.kind === "missing-grant")).toEqual([]);
  });

  it("clears once the missing element is defined", async () => {
    const lib = await library();
    await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    const lance = `<element name="Frost Lance" type="Spell" source="Test" id="ID_TEST_SPELL_FROST_LANCE"><description><p>x</p></description></element>`;
    const result = await ingestContentFiles(lib, [{ path: "imports/lance.xml", base64: pack(lance) }]);
    expect(lib.diagnostics?.some((finding) => finding.missingId === "ID_TEST_SPELL_FROST_LANCE")).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps findings current when a file is removed", async () => {
    const lib = await library();
    await ingestContentFiles(lib, [{ path: "imports/granting.xml", base64: pack(GRANTING) }]);
    removeContentFiles(lib, ["imports/base.xml"]);
    // The granting file now points at a spell that is gone.
    expect(lib.diagnostics?.some((finding) => finding.missingId === "ID_TEST_SPELL_REAL")).toBe(true);
  });
});
