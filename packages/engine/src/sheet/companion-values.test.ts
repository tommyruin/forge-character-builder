/**
 * The companion page's numeric boxes print numbers: the computed armour
 * class, the hit point maximum with Current Hit Points left for the player,
 * and hit dice worked out from the stat block's text, never its prose cut off
 * at the box's edge.
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

const beast = (id: string, ac: string, hp: string): string => `
  <element name="Values ${id}" type="Companion" source="Homebrew" id="ID_TEST_COMPANION_VALUES_${id}">
    <description><p>Synthetic companion for the sheet values test.</p></description>
    <setters>
      <set name="strength">10</set><set name="dexterity">12</set><set name="constitution">10</set>
      <set name="intelligence">4</set><set name="wisdom">12</set><set name="charisma">6</set>
      <set name="ac">${ac}</set>
      <set name="hp">${hp}</set>
      <set name="speed">40 ft.</set>
      <set name="type">Beast</set><set name="size">Medium</set><set name="alignment">unaligned</set>
      <set name="challenge">1/4</set>
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

/** A level-5 Ranger with the companion `which`, granted by `race`. */
function companionValues(race: string, which: string): Record<string, string> {
  const service = new CharacterService(undefined, library);
  const id = `Values ${which}`;
  service.createCharacter(id);
  service.setAbilities(id, { strength: 10, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 14, charisma: 8 });
  const rule = (type: string) => service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type)!;
  service.setSelection(id, rule("Race").identifier, race);
  service.setSelection(id, rule("Class").identifier, "ID_WOTC_PHB_CLASS_RANGER");
  for (let level = 2; level <= 5; level += 1) service.levelUp(id);
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
});
