/**
 * Stat values are whole-number literals or references. A leading "+" is part
 * of a literal ("+2" as authors write bonuses), a fractional literal rounds
 * down (D&D rounds down and every stat key is a whole number), and a
 * `maximum` attribute caps the resolved value ("Dexterity modifier, maximum
 * of +2").
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "./calculator.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

const APPENDS = `<elements>
  <append id="ID_WOTC_PHB_CLASS_DRUID">
    <rules><stat name="ac:misc" value="+2" /></rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_WIZARD">
    <rules><stat name="ac:misc" value="1.9" /></rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_ROGUE">
    <rules><stat name="ac:misc" value="dexterity:modifier" maximum="2" /></rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_FIGHTER">
    <rules><stat name="ac:misc" value="dexterity:modifier" maximum="9" /></rules>
  </append>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/stat-literals-test.xml", base64: encodeBase64(new TextEncoder().encode(APPENDS)) },
  ]);
}, 120_000);

function acWithClass(classId: string, dexterity: number): number {
  const service = new CharacterService(undefined, library);
  const id = "stat-literal";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 10, dexterity, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
  });
  const classRule = service.getCharacterDetail(id).selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, classId);
  return computeStatistics(service.getCharacter(id), library).ac!;
}

describe("stat value literals", () => {
  it("reads a +N literal as a positive number", () => {
    // 10 + dex 2 + 2
    expect(acWithClass("ID_WOTC_PHB_CLASS_DRUID", 14)).toBe(14);
  });

  it("rounds a fractional literal down", () => {
    expect(acWithClass("ID_WOTC_PHB_CLASS_WIZARD", 14)).toBe(13);
  });

  it("caps a referenced value at the rule's maximum", () => {
    // dex 18 is +4; the rule adds at most +2 on top of 10 + 4.
    expect(acWithClass("ID_WOTC_PHB_CLASS_ROGUE", 18)).toBe(16);
  });

  it("leaves a value below its maximum untouched", () => {
    expect(acWithClass("ID_WOTC_PHB_CLASS_FIGHTER", 18)).toBe(18);
  });
});
