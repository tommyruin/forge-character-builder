/**
 * The companion's proficiency bonus for the corpus's own stat blocks. The
 * statistic starts from the block's bonus (its `proficiency` setter, else its
 * challenge rating's, +2 for a dash) and the content's rules add on top. A
 * dash-rated block without a setter has no bonus of its own and uses its
 * owner's: a Primal Companion or Steel Defender gets there by adding the
 * owner's bonus and a "base companion PB removal" of -2; a block whose rules
 * add the owner's bonus without that removal (a Homunculus Servant), or add
 * nothing (the UA Ancient and Primeval Companions), lands on its owner's bonus
 * all the same. Every other block keeps its own.
 *
 * The companions are picked through a synthetic race's open Companion
 * selection, with any element a block requires granted directly.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { computeStatistics } from "./calculator.js";

const RACE = "ID_TEST_RACE_COMPANION_PROFICIENCY";

const CONTENT_XML = `<elements>
  <element name="Companion Proficiency Handler" type="Race" source="Homebrew" id="${RACE}">
    <description><p>Test race offering any companion.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules><select type="Companion" name="Companion Proficiency Companion" /></rules>
  </element>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/companion-proficiency-test.xml", base64: encodeBase64(new TextEncoder().encode(CONTENT_XML)) },
  ]);
}, 120_000);

interface Setup {
  companionId: string;
  classId: string;
  level: number;
  /** The subclass to pick, whose features may pick the companion by default. */
  archetype?: string;
  /** Elements the block's requirements name, granted directly; a granted feature may pick the companion by default. */
  grants?: string[];
  /** Adjustment items the block's requirements name, switched on. */
  adjustments?: string[];
}

let counter = 0;

/** The companion statistics and DTO for one character. */
function companionOf(setup: Setup) {
  const service = new CharacterService(undefined, library);
  const id = `companion-proficiency-${(counter += 1)}`;
  service.createCharacter(id);
  service.setAbilities(id, { strength: 10, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 14, charisma: 8 });
  const rule = (type: string) => service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type)!;
  service.setSelection(id, rule("Race").identifier, RACE);
  service.setSelection(id, rule("Class").identifier, setup.classId);
  for (let level = 2; level <= setup.level; level += 1) service.levelUp(id);
  if (setup.archetype !== undefined) service.setSelection(id, rule("Archetype").identifier, setup.archetype);
  for (const elementId of setup.grants ?? []) service.addGrantedElement(id, { elementId });
  for (const itemId of setup.adjustments ?? []) service.setCharacterControl(id, { key: `item:${itemId}`, enabled: true });
  const picked = (): boolean => service.getCharacter(id).sum.elements.some((entry) => entry.id === setup.companionId);
  if (!picked()) {
    const companionRule = service
      .getCharacterDetail(id)
      .selectionRules.find((candidate) => candidate.type === "Companion" && candidate.name === "Companion Proficiency Companion")!;
    service.setSelection(id, companionRule.identifier, setup.companionId);
  }
  const state = service.getCharacter(id);
  expect(state.sum.elements.some((entry) => entry.id === setup.companionId)).toBe(true);
  const statistics = computeStatistics(state, library);
  return { statistics, proficiency: statistics["companion:proficiency"], dto: service.getCompanion(id)! };
}

const RANGER = "ID_WOTC_PHB_CLASS_RANGER";
const ARTIFICER = "ID_WOTC_ERLW_CLASS_ARTIFICER";
const WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";

describe("companion proficiency bonus from the corpus stat blocks", () => {
  it("keeps the owner's bonus for blocks whose rules add it and remove the dash's +2", () => {
    for (const companionId of [
      "ID_WOTC_PHB24_COMPANION_RANGER_BEAST_MASTER_PRIMAL_COMPANION_BEAST_OF_THE_LAND",
      "ID_WOTC_PHB24_COMPANION_RANGER_BEAST_MASTER_PRIMAL_COMPANION_BEAST_OF_THE_SKY",
      "ID_WOTC_PHB24_COMPANION_RANGER_BEAST_MASTER_PRIMAL_COMPANION_BEAST_OF_THE_SEA",
    ]) {
      expect(companionOf({ companionId, classId: RANGER, level: 8 }).proficiency, companionId).toBe(3);
      expect(companionOf({ companionId, classId: RANGER, level: 9 }).proficiency, companionId).toBe(4);
    }
    const tashas = companionOf({
      companionId: "ID_WOTC_TCOE_CLASS_FEATURE_RANGER_PRIMAL_COMPANION_BEAST_OF_THE_LAND",
      classId: RANGER,
      level: 8,
      adjustments: ["ID_WOTC_TCOE_ITEM_OCF_RANGER_PRIMAL_COMPANION"],
    });
    expect(tashas.proficiency).toBe(3);
    expect(tashas.dto.proficiency).toBe(3);
  });

  it("keeps the owner's bonus for both Steel Defenders, dash-rated or rated 1", () => {
    for (const companionId of ["ID_WOTC_TCOE_COMPANION_ARTIFICER_STEEL_DEFENDER", "ID_WOTC_ERLW_COMPANION_ARTIFICER_STEEL_DEFENDER"]) {
      expect(companionOf({ companionId, classId: ARTIFICER, level: 8 }).proficiency, companionId).toBe(3);
      expect(companionOf({ companionId, classId: ARTIFICER, level: 13 }).proficiency, companionId).toBe(5);
    }
  });

  it("keeps the owner's bonus for a drake whose setter is 0", () => {
    const drake = companionOf({ companionId: "ID_WOTC_FTOD_COMPANION_DRAKEWARDEN_DRAKE_COMPANION_SMALL", classId: RANGER, level: 8 });
    expect(drake.proficiency).toBe(3);
  });

  it("keeps a familiar's own +2 whatever its owner's", () => {
    for (const companionId of ["ID_WOTC_PHB_COMPANION_OWL", "ID_WOTC_MM25_COMPANION_OWL"]) {
      expect(companionOf({ companionId, classId: WIZARD, level: 9 }).proficiency, companionId).toBe(2);
    }
  });

  it("keeps a dash-rated block's own proficiency setter", () => {
    // The UA drake states its bonus per level band; the first band's is +2.
    const drake = companionOf({ companionId: "ID_WOTC_UA20201026_COMPANION_DRAKEWARDEN_DRAKE_COMPANION", classId: RANGER, level: 9 });
    expect(drake.proficiency).toBe(2);
  });

  it("gives the Homunculus Servant its creator's bonus, not that bonus plus 2", () => {
    // Its rules add the owner's bonus as a base and carry no removal; the
    // element id ends in a space, and still resolves.
    const servant = companionOf({ companionId: "ID_WOTC_ERLW_COMPANION_ARTIFICER_HOMUNCULUS_SERVANT ", classId: ARTIFICER, level: 8 });
    expect(servant.proficiency).toBe(3);
    expect(servant.dto.proficiency).toBe(3);
    expect(servant.dto.name).toBe("Homunculus Servant");
    // The skill and save proficiencies its rules give read the owner's bonus.
    expect(servant.statistics["companion:dexterity:save:proficiency"]).toBe(3);
    expect(companionOf({ companionId: "ID_WOTC_ERLW_COMPANION_ARTIFICER_HOMUNCULUS_SERVANT ", classId: ARTIFICER, level: 17 }).proficiency).toBe(6);
  });

  it("gives the UA Ancient and Primeval Companions their owner's bonus, which their text uses", () => {
    const ancient = companionOf({
      companionId: "ID_WOTC_UA20210608_COMPANION_ANCIENT_COMPANION",
      classId: WIZARD,
      level: 8,
      grants: ["ID_WOTC_UA20210608_ARCHETYPE_FEATURE_MAGE_OF_LOREHOLD_ANCIENT_COMPANION"],
    });
    expect(ancient.proficiency).toBe(3);
    expect(ancient.dto.proficiency).toBe(3);
    const primeval = companionOf({
      companionId: "ID_WOTC_UA20220523_COMPANION_PRIMEVAL_COMPANION_MEDIUM",
      classId: "ID_WOTC_PHB_CLASS_DRUID",
      level: 8,
      archetype: "ID_WOTC_UA20220523_ARCHETYPE_DRUID_CIRCLE_OF_THE_PRIMEVAL",
    });
    expect(primeval.proficiency).toBe(3);
    expect(primeval.dto.proficiency).toBe(3);
  });
});
