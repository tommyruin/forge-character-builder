/**
 * Selection rules surface load invalidation: when a wrapper's registered
 * element cannot be restored, the matching selection-rule group reports
 * wasInvalidated with the previous element's id and (when resolvable) name,
 * sourced from the load issues.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules } from "./selection.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const ID_BOGUS = "ID_HB_CLASS_NO_LONGER_EXISTS";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

describe("selection-rule invalidation detail", () => {
  it("marks the rule whose registered element is missing from the library", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("INV");
    const classRule = pendingSelectionRules(service.getCharacter("INV")).find((rule) => rule.type === "Class")!;
    service.setSelection("INV", classRule.identifier, ID_WIZARD);
    const xml = service.exportCharacterXml("INV").replaceAll(ID_WIZARD, ID_BOGUS);

    const reload = new CharacterService(undefined, library);
    reload.importCharacterXml("INV2", xml);
    const detail = reload.getCharacterDetail("INV2");
    const rule = detail.selectionRules.find((r) => r.type === "Class")!;
    expect(rule.wasInvalidated).toBe(true);
    expect(rule.previousElementId).toBe(ID_BOGUS);
    expect(rule.previousElementName).toBeNull();
  });

  it("keeps valid selections unmarked", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("OK");
    const classRule = pendingSelectionRules(service.getCharacter("OK")).find((rule) => rule.type === "Class")!;
    service.setSelection("OK", classRule.identifier, ID_WIZARD);
    const detail = service.getCharacterDetail("OK");
    const rule = detail.selectionRules.find((r) => r.type === "Class")!;
    expect(rule.wasInvalidated).toBe(false);
    expect(rule.previousElementId).toBeNull();
    expect(rule.previousElementName).toBeNull();
  });
});
