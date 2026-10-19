/**
 * The generalised grant: any feature-type element, from a book, a homebrew
 * file or the character's own pack, is granted at the top level and removed
 * again. The feat and ability-score methods are the same operation with a
 * narrower type check.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { createCustomDraft } from "./schema.js";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Test Pack" type="Source" source="Test Pack" id="ID_TEST_SOURCE_PACK">
    <description><p>Homebrew.</p></description>
    <setters><set name="abbreviation">TP</set><set name="url">https://local.homebrew</set><set name="homebrew">true</set></setters>
  </element>
  <element name="Tide Sense" type="Racial Trait" source="Test Pack" id="ID_TEST_TRAIT_TIDE_SENSE">
    <description><p>You feel the tide.</p></description>
    <rules><stat name="initiative" value="2" /></rules>
  </element>
  <element name="Lantern Warden" type="Class Feature" source="Test Pack" id="ID_TEST_CFEAT_LANTERN_WARDEN">
    <description><p>You guard the light.</p></description>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/grant-element-test.xml", PACK]]));
}, 120_000);

let counter = 0;
const fighter = () => buildFighter3(library, `GrantFighter${counter++}`);

describe("addGrantedElement", () => {
  it("grants a homebrew trait, applies its rules and lists it as homebrew", () => {
    const { service, id } = fighter();
    const before = computeStatistics(service.getCharacter(id), library).initiative!;
    service.addGrantedElement(id, { elementId: "ID_TEST_TRAIT_TIDE_SENSE" });
    expect(computeStatistics(service.getCharacter(id), library).initiative).toBe(before + 2);
    expect(service.getDmGrants(id)).toContainEqual({
      kind: "feature",
      id: "ID_TEST_TRAIT_TIDE_SENSE",
      name: "Tide Sense",
      source: "Test Pack",
      type: "Racial Trait",
      isCustom: true,
      origin: "homebrew",
      section: "race",
    });
  });

  it("grants a class feature and removes it again, restoring the counts", () => {
    const { service, id } = fighter();
    const before = service.getCharacter(id);
    service.addGrantedElement(id, { elementId: "ID_TEST_CFEAT_LANTERN_WARDEN" });
    expect(service.getDmGrants(id).find((grant) => grant.id === "ID_TEST_CFEAT_LANTERN_WARDEN")).toMatchObject({ kind: "feature", section: "class" });
    service.removeGrantedElement(id, { elementId: "ID_TEST_CFEAT_LANTERN_WARDEN" });
    const after = service.getCharacter(id);
    expect(after.registeredCount).toBe(before.registeredCount);
    expect(after.sum.elementCount).toBe(before.sum.elementCount);
    expect(service.getDmGrants(id).some((grant) => grant.id === "ID_TEST_CFEAT_LANTERN_WARDEN")).toBe(false);
  });

  it("refuses a second grant, an unknown id and an ungranted removal", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: "ID_TEST_TRAIT_TIDE_SENSE" });
    expect(() => service.addGrantedElement(id, { elementId: "ID_TEST_TRAIT_TIDE_SENSE" })).toThrow(expect.objectContaining({ code: "conflict" }));
    expect(() => service.addGrantedElement(id, { elementId: "ID_NOPE" })).toThrow(expect.objectContaining({ code: "not-found" }));
    expect(() => service.removeGrantedElement(id, { elementId: "ID_TEST_CFEAT_LANTERN_WARDEN" })).toThrow(expect.objectContaining({ code: "not-found" }));
  });

  it("does not grant what is not a feature: a spell, a class or a weapon", () => {
    const { service, id } = fighter();
    const ofType = (type: string) => library.byType.get(type)![0]!.identity.id;
    for (const type of ["Spell", "Class", "Weapon", "Race"]) {
      expect(() => service.addGrantedElement(id, { elementId: ofType(type) })).toThrow(expect.objectContaining({ code: "not-found" }));
    }
  });

  it("keeps the feat methods working, including for a custom feat", () => {
    const { service, id } = fighter();
    const draft = createCustomDraft("feat", "Quiet Hands");
    service.saveCustomDraft(id, { draft });
    expect(service.getDmGrants(id).find((grant) => grant.id === draft.id)).toMatchObject({ kind: "feat", isCustom: true, section: "feats" });
    service.removeGrantedFeat(id, { featId: draft.id });
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(false);
    service.addGrantedFeat(id, { featId: draft.id });
    expect(service.getDmGrants(id).some((grant) => grant.id === draft.id)).toBe(true);
  });
});
