/**
 * Condition text tiers on the sheet's Resistances box.
 *
 * A Condition's sheet text can carry level tiers (`<description level="N">`).
 * When a class or subclass feature grants it, the tier is authored against
 * that class's level, as feature text is: a multiclass character reads the
 * tier its class has reached, not the one its total level would pick. Nothing
 * in the corpus or the bundled content is such a Condition (no Condition
 * element there carries sheet text at all), so a test pack appends one to a
 * real druid feature.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import type { CharacterState } from "../character/state.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCharacterSheetModel } from "./model.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { seededRng } from "../testing/character-factory.js";

const DRUIDIC = "ID_WOTC_PHB24_CLASS_FEATURE_DRUID_DRUIDIC";
const TIERED_WARD = "ID_TEST_CONDITION_TIERED_WARD";
const LOW_TIER = "Tiered Ward I: the druid's first tier.";
const HIGH_TIER = "Tiered Ward III: the druid's third tier.";

const TEST_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Tiered Ward" type="Condition" source="Sheet Defence Tiers Test" id="${TIERED_WARD}">
\t\t<sheet>
\t\t\t<description>${LOW_TIER}</description>
\t\t\t<description level="3">${HIGH_TIER}</description>
\t\t</sheet>
\t</element>
\t<append id="${DRUIDIC}">
\t\t<rules>
\t\t\t<grant type="Condition" id="${TIERED_WARD}" />
\t\t</rules>
\t</append>
</elements>
`;

const ABILITIES = { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 };

let library: ElementLibrary;

beforeAll(async () => {
  const base = await buildCorpusLibrary();
  const files = new Map(base.fileContents);
  files.set("imports/sheet-defence-tiers-test.xml", TEST_PACK);
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, files);
}, 120_000);

function pick(service: CharacterService, id: string, type: string, elementId: string): void {
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === type && !r.hasSelection);
  expect(rule, `an open ${type} selection`).toBeDefined();
  service.setSelection(id, rule!.identifier, elementId);
}

/** A 2024 druid of `druidLevels`, then one fighter level. */
function druidWithFighterDip(druidLevels: number): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const id = service.createCharacter("Tiered Druid").id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  pick(service, id, "Class", "ID_WOTC_PHB24_CLASS_DRUID");
  while (service.getCharacter(id).level < druidLevels) service.levelUp(id);
  service.setCharacterOption(id, { optionId: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING", enabled: true });
  service.levelUpMode(id, { mode: "new-multiclass" });
  pick(service, id, "Multiclass", "ID_WOTC_PHB24_MULTICLASS_FIGHTER");
  return { service, id };
}

const resistances = (state: CharacterState): string =>
  buildCharacterSheetModel(state, library, { mode: "full" }).formValues?.["details_resistances"] ?? "";

describe("condition text tiers by class level", () => {
  it("prints a druid 2 / fighter 1 the druid's level-1 tier, not the level-3 one", () => {
    const { service, id } = druidWithFighterDip(2);
    const state = service.getCharacter(id);
    expect(state.level).toBe(3);
    const text = resistances(state);
    expect(text).toContain(LOW_TIER);
    expect(text).not.toContain(HIGH_TIER);
  }, 60_000);

  it("prints the level-3 tier once the druid itself reaches level 3", () => {
    const { service, id } = druidWithFighterDip(3);
    expect(service.getCharacter(id).level).toBe(4);
    const text = resistances(service.getCharacter(id));
    expect(text).toContain(HIGH_TIER);
    expect(text).not.toContain(LOW_TIER);
  }, 60_000);

  it("crops the class level to the displayed level, as a delevel preview does", () => {
    // Druid 3 / Fighter 1 shown at level 2: the history beyond level 2 (the
    // third druid level and the fighter dip) is not counted.
    const { service, id } = druidWithFighterDip(3);
    const preview: CharacterState = { ...service.getCharacter(id), level: 2 };
    const text = resistances(preview);
    expect(text).toContain(LOW_TIER);
    expect(text).not.toContain(HIGH_TIER);
  }, 60_000);
});
