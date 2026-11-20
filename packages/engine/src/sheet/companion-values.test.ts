/**
 * The companion page's numeric boxes print numbers: the computed armour
 * class, the hit point maximum with Current Hit Points left for the player,
 * and hit dice worked out from the stat block's text, never its prose cut off
 * at the box's edge. The proficiency bonus prints signed: a stat block with a
 * dash for its challenge rating takes its owner's bonus, any other its own.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { buildCharacterSheetModel } from "./model.js";

const RACE_STATS = "ID_TEST_RACE_COMPANION_VALUES_STATS";
const RACE_PLAIN = "ID_TEST_RACE_COMPANION_VALUES_PLAIN";
const RACE_BOUND = "ID_TEST_RACE_COMPANION_VALUES_BOUND";
const RACE_SET = "ID_TEST_RACE_COMPANION_VALUES_SET";

const beast = (id: string, ac: string, hp: string, challenge = "1/4"): string => `
  <element name="Values ${id}" type="Companion" source="Homebrew" id="ID_TEST_COMPANION_VALUES_${id}">
    <description><p>Synthetic companion for the sheet values test.</p></description>
    <setters>
      <set name="strength">10</set><set name="dexterity">12</set><set name="constitution">10</set>
      <set name="intelligence">4</set><set name="wisdom">12</set><set name="charisma">6</set>
      <set name="ac">${ac}</set>
      <set name="hp">${hp}</set>
      <set name="speed">40 ft.</set>
      <set name="type">Beast</set><set name="size">Medium</set><set name="alignment">unaligned</set>
      <set name="challenge">${challenge}</set>
    </setters>
  </element>`;

const CONTENT_XML = `<elements>
  <element name="Values Handler" type="Race" source="Homebrew" id="${RACE_STATS}">
    <description><p>Grants a companion whose numbers are computed.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules>
      <select type="Companion" name="Values Companion" />
      <stat name="companion:ac" value="15" />
      <stat name="companion:hp:max" value="45" bonus="base" />
    </rules>
  </element>
  <element name="Values Handler (Plain)" type="Race" source="Homebrew" id="${RACE_PLAIN}">
    <description><p>Grants a companion with only stat block text.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules><select type="Companion" name="Values Companion" /></rules>
  </element>
  <element name="Values Handler (Bound)" type="Race" source="Homebrew" id="${RACE_BOUND}">
    <description><p>Grants a companion that uses its owner's proficiency bonus, written as the owner's bonus less an implicit 2.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules>
      <select type="Companion" name="Values Companion" />
      <stat name="companion:proficiency" value="proficiency" bonus="base" />
      <stat name="companion:proficiency" value="-2" bonus="base implicit removal" />
    </rules>
  </element>
  <element name="Values Handler (Set)" type="Race" source="Homebrew" id="${RACE_SET}">
    <description><p>Grants a companion with a proficiency bonus set by a rule.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules>
      <select type="Companion" name="Values Companion" />
      <stat name="companion:proficiency" value="6" bonus="base" />
    </rules>
  </element>
  ${beast("BOUND", "13 + your Wisdom modifier", "5 + five times your Ranger level", "\u2014")}
  ${beast("HYPHEN", "13", "5 + five times your Ranger level", "-")}
  ${beast("CR5", "15 (natural armor)", "60 (8d10 + 16)", "5")}
  ${beast("LEVEL", "13 + your Wisdom modifier (natural armor)",
    "5 + five times your Ranger level (the beast has a number of Hit Dice [d10s] equal to your Ranger level)")}
  ${beast("DICE", "12 (natural armor)", "11 (2d8 + 2)")}
  ${beast("PROSE", "Natural armour of the beast", "Varies with the beast's age")}
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/companion-values-test.xml", base64: encodeBase64(new TextEncoder().encode(CONTENT_XML)) },
  ]);
}, 120_000);

/** A Ranger of `levels` (5 by default) with the companion `which`, granted by `race`. */
function companionValues(race: string, which: string, levels = 5): Record<string, string> {
  const service = new CharacterService(undefined, library);
  const id = `Values ${which}`;
  service.createCharacter(id);
  service.setAbilities(id, { strength: 10, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 14, charisma: 8 });
  const rule = (type: string) => service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type)!;
  service.setSelection(id, rule("Race").identifier, race);
  service.setSelection(id, rule("Class").identifier, "ID_WOTC_PHB_CLASS_RANGER");
  for (let level = 2; level <= levels; level += 1) service.levelUp(id);
  service.setSelection(id, rule("Companion").identifier, `ID_TEST_COMPANION_VALUES_${which}`);
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "lite" });
  return model.formValues ?? {};
}

describe("companion page values", () => {
  it("prints the computed armour class and hit point maximum, and leaves current hit points blank", () => {
    const fields = companionValues(RACE_STATS, "LEVEL");
    expect(fields["companion_armor_class"]).toBe("15");
    expect(fields["companion_hp_max"]).toBe("45");
    expect(fields["companion_hp_current"]).toBe("");
  });

  it("works hit dice out from the Ranger level and the die in the text", () => {
    expect(companionValues(RACE_STATS, "LEVEL")["companion_hd"]).toBe("5d10");
  });

  it("takes hit dice from a dice expression in brackets", () => {
    expect(companionValues(RACE_PLAIN, "DICE")["companion_hd"]).toBe("2d8");
  });

  it("prints the number from armour class text that has one, not its prose", () => {
    expect(companionValues(RACE_PLAIN, "DICE")["companion_armor_class"]).toBe("12");
    expect(companionValues(RACE_STATS, "LEVEL")["companion_armor_class"]).not.toContain("Wisdom");
  });

  it("falls back to the armour class text only when there is no number, and leaves unreadable hit dice empty", () => {
    const fields = companionValues(RACE_PLAIN, "PROSE");
    expect(fields["companion_armor_class"]).toBe("Natural armour of the beast");
    expect(fields["companion_hd"]).toBe("");
  });

  it("prints its owner's proficiency bonus, signed, for a stat block with no challenge rating", () => {
    // The rules give the owner's bonus less 2; the sheet reads the owner's bonus.
    const level8 = companionValues(RACE_BOUND, "BOUND", 8);
    expect(level8["companion_proficiency"]).toBe("+3");
    expect(level8["companion_proficiency_bonus"]).toBe("+3");
    expect(companionValues(RACE_BOUND, "BOUND", 9)["companion_proficiency"]).toBe("+4");
    // Without any rule, and with a hyphen for the dash.
    expect(companionValues(RACE_PLAIN, "BOUND", 9)["companion_proficiency"]).toBe("+4");
    expect(companionValues(RACE_PLAIN, "HYPHEN", 5)["companion_proficiency"]).toBe("+3");
  });

  it("keeps a rated creature's own proficiency bonus, signed, whatever its owner's", () => {
    expect(companionValues(RACE_PLAIN, "DICE", 9)["companion_proficiency"]).toBe("+2");
    expect(companionValues(RACE_PLAIN, "CR5", 1)["companion_proficiency"]).toBe("+3");
    expect(companionValues(RACE_PLAIN, "CR5", 1)["companion_proficiency_bonus"]).toBe("+3");
    // A rule that sets the bonus still wins for a rated creature.
    expect(companionValues(RACE_SET, "DICE", 1)["companion_proficiency"]).toBe("+6");
  });
});
