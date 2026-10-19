/**
 * Passive Perception on the sheet is the passive base plus the Perception
 * check bonus plus any dedicated passive bonus (a feature that says "+5 to
 * your passive Perception"): the sheet used to rebuild it from the check
 * components alone and print 10 + Wisdom + Perception however a feature
 * raised the passive score.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { buildCharacterSheetModel } from "./model.js";

const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Watchful Gift" type="Feat" source="Test Pack" id="ID_TEST_FEAT_WATCHFUL_GIFT">
    <description><p>You miss little.</p></description>
    <rules><stat name="perception:passive" value="5" /></rules>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/passive-test.xml", PACK]]));
}, 120_000);

describe("passive Perception on the sheet", () => {
  it("includes a dedicated passive bonus, in the form field and the canonical projection", () => {
    const { service, id } = buildFighter3(library, "PassiveSheet");
    const plain = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const baseline = Number(plain.formValues!.Passive);

    service.addGrantedFeat(id, { featId: "ID_TEST_FEAT_WATCHFUL_GIFT" });

    expect(computeStatistics(service.getCharacter(id), library)["perception:passive"]).toBe(15);
    const gifted = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    expect(Number(gifted.formValues!.Passive)).toBe(baseline + 5);
    expect(gifted.formValues!.details_passive_perception_total).toBe(`${baseline + 5}`);
  });
});
