/**
 * A rule whose requirements test a level and also name an element has to leave
 * again when the element goes. The level part is the leveling planner's to
 * unwind (a delevel must not strip a feature the player still has the element
 * for), but the element part is an ordinary requirement: losing it takes the
 * grant away like it does for a rule without a level test.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";

const FLAG = "ID_TEST_OPTION_LEVEL_FLAG";
const GATED = "ID_TEST_CFEAT_LEVEL_GATED";
const TONGUE = "ID_TEST_LANGUAGE_LEVEL_TONGUE";
const LEVEL_ONLY = "ID_TEST_CFEAT_LEVEL_ONLY";
const LEVEL_ONLY_TONGUE = "ID_TEST_LANGUAGE_LEVEL_ONLY_TONGUE";

// Invented content: an optional rule, a feature that grants a language while the rule is on
// at level 2 or more, and a feature whose grant depends on the level alone.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Level Flag" type="Option" source="Level Gate Test" id="${FLAG}">
    <description><p>An optional rule.</p></description>
  </element>
  <element name="Level Tongue" type="Language" source="Level Gate Test" id="${TONGUE}">
    <supports>Standard</supports>
    <description><p>Spoken at depth.</p></description>
  </element>
  <element name="Level Only Tongue" type="Language" source="Level Gate Test" id="${LEVEL_ONLY_TONGUE}">
    <supports>Standard</supports>
    <description><p>Spoken high up.</p></description>
  </element>
  <element name="Level Gated" type="Class Feature" source="Level Gate Test" id="${GATED}">
    <description><p>Needs the rule and level 2.</p></description>
    <rules><grant type="Language" id="${TONGUE}" requirements="[level:2],${FLAG}" /></rules>
  </element>
  <element name="Level Only" type="Class Feature" source="Level Gate Test" id="${LEVEL_ONLY}">
    <description><p>Needs level 2.</p></description>
    <rules><grant type="Language" id="${LEVEL_ONLY_TONGUE}" requirements="[level:2]" /></rules>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/level-gate-test.xml", PACK]]));
}, 120_000);

let counter = 0;
const registered = (service: ReturnType<typeof buildFighter3>["service"], id: string): string[] =>
  service.getCharacter(id).sum.elements.map((entry) => entry.id);

describe("a rule gated on a level and an element", () => {
  it("grants when both hold and takes the grant away when the element is lost", () => {
    const { service, id } = buildFighter3(library, `LevelGate${counter++}`);
    service.addGrantedElement(id, { elementId: GATED });
    expect(registered(service, id)).not.toContain(TONGUE);

    service.setCharacterOption(id, { optionId: FLAG, enabled: true });
    expect(registered(service, id)).toContain(TONGUE);

    service.setCharacterOption(id, { optionId: FLAG, enabled: false });
    expect(registered(service, id)).not.toContain(TONGUE);
  });

  it("leaves a grant that depends on the level alone to the leveling planner", () => {
    const { service, id } = buildFighter3(library, `LevelGate${counter++}`);
    service.addGrantedElement(id, { elementId: LEVEL_ONLY });
    expect(registered(service, id)).toContain(LEVEL_ONLY_TONGUE);

    // Losing the level is not a reason to strip what the feature already gave.
    service.levelDown(id);
    service.levelDown(id);
    expect(service.getCharacter(id).level).toBe(1);
    expect(registered(service, id)).toContain(LEVEL_ONLY_TONGUE);
  });
});
