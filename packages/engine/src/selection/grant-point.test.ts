/**
 * An empty choice is judged as of the level that granted it. A multi-level
 * level-up (Warlock 1->5 in one go) leaves the level-2 invocations open at
 * level 5; they still may not take a "5th level" invocation, while the
 * level-5 choice may. A filled choice is a swap and is judged as of now.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { createEmptyLibrary, replaceLibraryFiles } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { freshService, ID, select, seededRng, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { pendingSelectionRules, selectionOptions, selectionRuleFor } from "./selection.js";

const WARLOCK = "ID_WOTC_PHB_CLASS_WARLOCK";
const MIRE_THE_MIND = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_MIRE_THE_MIND";
const ARMOR_OF_SHADOWS = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_ARMOR_OF_SHADOWS";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function warlock5() {
  const service = freshService(library);
  const id = "Warlock5";
  service.createCharacter(id);
  service.setAbilities(id, { ...STANDARD_ARRAY, charisma: 16 });
  select(service, id, "Race", ID.RACE_DWARF);
  select(service, id, "Sub Race", ID.SUB_RACE_HILL_DWARF);
  select(service, id, "Class", WARLOCK);
  for (let level = 2; level <= 5; level++) service.levelUp(id);
  return { service, id };
}

function invocationRule(service: ReturnType<typeof warlock5>["service"], id: string, level: number) {
  const rule = pendingSelectionRules(service.getCharacter(id))
    .find((candidate) => candidate.name === `Eldritch Invocation (Level ${level})`);
  if (rule === undefined) throw new Error(`no open level-${level} invocation`);
  return rule;
}

describe("choices left open by a multi-level level-up", () => {
  it("offer what the granting level allows", () => {
    const { service, id } = warlock5();
    const options = (level: number) =>
      selectionOptions(service.getCharacter(id), library, invocationRule(service, id, level)).map((option) => option.id);
    expect(options(2)).toContain(ARMOR_OF_SHADOWS);
    expect(options(2)).not.toContain(MIRE_THE_MIND);
    expect(options(5)).toContain(MIRE_THE_MIND);
    expect(() => service.setSelection(id, invocationRule(service, id, 2).identifier, MIRE_THE_MIND)).toThrowError(/not eligible/);
  });

  it("let a filled choice be swapped for what the current level allows", () => {
    const { service, id } = warlock5();
    const ruleId = invocationRule(service, id, 2).identifier;
    service.setSelection(id, ruleId, ARMOR_OF_SHADOWS);
    const filled = selectionRuleFor(service.getCharacter(id), ruleId)!;
    expect(selectionOptions(service.getCharacter(id), library, filled).map((option) => option.id)).toContain(MIRE_THE_MIND);
    expect(() => service.setSelection(id, ruleId, MIRE_THE_MIND)).not.toThrow();
  });
});

const TEST_CLASS = "ID_TEST_CLASS_CASTER";
const TEST_FEATURE = "ID_TEST_CLASS_FEATURE_BOON";
const TEST_OPENER = "ID_TEST_CLASS_FEATURE_OPENER";
const TEST_PLAIN_FEAT = "ID_TEST_FEAT_PLAIN";
const TEST_GATED_FEAT = "ID_TEST_FEAT_FOURTH";

/** A class whose level-4 feature holds a feat select with no `level` of its own. */
const SYNTHETIC_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Test Caster" type="Class" source="Grant Test" id="${TEST_CLASS}">
    <setters><set name="hd">d8</set></setters>
    <rules>
      <grant type="Class Feature" id="${TEST_OPENER}" />
      <grant type="Class Feature" id="${TEST_FEATURE}" level="4" />
    </rules>
  </element>
  <element name="Opener" type="Class Feature" source="Grant Test" id="${TEST_OPENER}" />
  <element name="Boon" type="Class Feature" source="Grant Test" id="${TEST_FEATURE}">
    <rules>
      <select type="Feat" name="Boon Feat" />
    </rules>
  </element>
  <element name="Plain Feat" type="Feat" source="Grant Test" id="${TEST_PLAIN_FEAT}" />
  <element name="Fourth Feat" type="Feat" source="Grant Test" id="${TEST_GATED_FEAT}">
    <requirements>[character:4]</requirements>
  </element>
</elements>`;

describe("a level-less choice inside a later-level feature", () => {
  it("is judged as of the feature's level, not level 1", () => {
    const syntheticLibrary = createEmptyLibrary();
    replaceLibraryFiles(syntheticLibrary, new Map([["test/grant.xml", SYNTHETIC_CONTENT]]));
    const service = new CharacterService(undefined, syntheticLibrary, { rng: seededRng(1) });
    const id = service.createCharacter("Caster4").id;
    select(service, id, "Class", TEST_CLASS);
    for (let level = 2; level <= 4; level++) service.levelUp(id);

    const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.name === "Boon Feat");
    if (rule === undefined) throw new Error("no open feat choice");
    const offered = selectionOptions(service.getCharacter(id), syntheticLibrary, rule).map((option) => option.id);
    expect(offered).toEqual(expect.arrayContaining([TEST_PLAIN_FEAT, TEST_GATED_FEAT]));
    expect(() => service.setSelection(id, rule.identifier, TEST_GATED_FEAT)).not.toThrow();

    // Levelling on must not push the open choice back to level 1 either.
    const other = service.createCharacter("Caster5").id;
    select(service, other, "Class", TEST_CLASS);
    for (let level = 2; level <= 5; level++) service.levelUp(other);
    const later = pendingSelectionRules(service.getCharacter(other)).find((candidate) => candidate.name === "Boon Feat")!;
    expect(selectionOptions(service.getCharacter(other), syntheticLibrary, later).map((option) => option.id)).toContain(TEST_GATED_FEAT);
  });
});
