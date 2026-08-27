/**
 * Ability scores clamp to the "{ability}:max" statistic (default 20). Content
 * raises the cap through "{ability}:max:extra" contributions, which the
 * internal Ability Score Maximum Over 20 grant converts into ":max" bumps.
 * A "{ability}:score:set" override bypasses the cap entirely.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "./calculator.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const APPENDS = `<elements>
  <append id="ID_WOTC_PHB_CLASS_CLERIC">
    <rules>
      <stat name="strength" value="4" />
    </rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_BARBARIAN">
    <rules>
      <stat name="strength" value="4" />
      <stat name="strength:max:extra" value="2" bonus="base" />
    </rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_FIGHTER">
    <rules>
      <stat name="strength:score:set" value="23" />
    </rules>
  </append>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/ability-max-test.xml", base64: encodeBase64(new TextEncoder().encode(APPENDS)) },
  ]);
}, 120_000);

function statisticsWithClass(classId: string): Record<string, number> {
  const service = new CharacterService(undefined, library);
  const id = "cap-test";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 19, dexterity: 14, constitution: 14, intelligence: 8, wisdom: 12, charisma: 10,
  });
  const detail = service.getCharacterDetail(id);
  const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, classId);
  return computeStatistics(service.getCharacter(id), library);
}

describe("ability score maximum", () => {
  it("clamps a final score above 20 to the default maximum", () => {
    const values = statisticsWithClass("ID_WOTC_PHB_CLASS_CLERIC");
    expect(values["strength:max"]).toBe(20);
    expect(values["strength:score"]).toBe(20);
    expect(values["strength:modifier"]).toBe(5);
  });

  it("clamps to a content-raised maximum via :max:extra", () => {
    const values = statisticsWithClass("ID_WOTC_PHB_CLASS_BARBARIAN");
    expect(values["strength:max"]).toBe(22);
    expect(values["strength:score"]).toBe(22);
    expect(values["strength:modifier"]).toBe(6);
  });

  it("lets a :score:set override bypass the cap", () => {
    const values = statisticsWithClass("ID_WOTC_PHB_CLASS_FIGHTER");
    expect(values["strength:score"]).toBe(23);
    expect(values["strength:modifier"]).toBe(6);
  });

  it("halves negative modifiers toward and away from zero", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("half-test");
    service.setAbilities("half-test", {
      strength: 4, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
    });
    const values = computeStatistics(service.getCharacter("half-test"), library);
    expect(values["strength:modifier"]).toBe(-3);
    expect(values["strength:modifier:half"]).toBe(-1);
    expect(values["strength:modifier:half:up"]).toBe(-2);
  });
});
