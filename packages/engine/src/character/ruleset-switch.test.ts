/**
 * Switching ruleset mode works in both directions: 2024 picks repair to their
 * 2014 counterparts (same name, other edition) or are removed when no
 * counterpart exists, exactly as 2014 -> 2024 already behaves.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "./service.js";
import { pendingSelectionRules } from "../selection/selection.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_WIZARD_2024 = "ID_WOTC_PHB24_CLASS_WIZARD";
const ID_WIZARD_2014 = "ID_WOTC_PHB_CLASS_WIZARD";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

function build2024Wizard(levels: number): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter("RS");
  service.setAbilities("RS", {
    strength: 10, dexterity: 14, constitution: 14, intelligence: 15, wisdom: 12, charisma: 8,
  });
  service.setRulesetMode("RS", "2024");
  const state = service.getCharacter("RS");
  const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
  service.setSelection("RS", classRule.identifier, ID_WIZARD_2024);
  for (let i = 1; i < levels; i++) service.levelUp("RS");
  return service;
}

describe("setRulesetMode 2024 -> 2014", () => {
  it("repairs a level-1 2024 class pick to its 2014 counterpart", () => {
    const service = build2024Wizard(1);
    service.setRulesetMode("RS", "2014");
    const state = service.getCharacter("RS");
    expect(state.rulesetMode).toBe("2014");
    expect(state.sum.elements.some((entry) => entry.id === ID_WIZARD_2014)).toBe(true);
    expect(state.sum.elements.some((entry) => entry.id === ID_WIZARD_2024)).toBe(false);
  });

  it("survives nested 2024 wrappers (class with granted subtree at level 3)", () => {
    const service = build2024Wizard(3);
    const subclassRule = pendingSelectionRules(service.getCharacter("RS"))
      .find((rule) => rule.type === "Archetype");
    if (subclassRule) {
      service.setSelection("RS", subclassRule.identifier, "ID_WOTC_PHB24_ARCHETYPE_WIZARD_EVOKER");
    }
    service.setRulesetMode("RS", "2014");
    const state = service.getCharacter("RS");
    expect(state.rulesetMode).toBe("2014");
    expect(state.sum.elements.some((entry) => entry.id === ID_WIZARD_2014)).toBe(true);
    const xml = service.exportCharacterXml("RS");
    expect(xml).toContain('<ruleset mode="2014"');
  });

  it("survives a full character: picks, switch, level-up, round-trip, switch again", () => {
    const service = build2024Wizard(3);
    const pickPending = (type: string, id: string): void => {
      const rule = pendingSelectionRules(service.getCharacter("RS")).find((r) => r.type === type);
      if (rule) service.setSelection("RS", rule.identifier, id);
    };
    pickPending("Archetype", "ID_WOTC_PHB24_ARCHETYPE_WIZARD_EVOKER");
    service.setRulesetMode("RS", "2014");
    expect(service.getCharacter("RS").rulesetMode).toBe("2014");
    service.levelUp("RS");

    const roundTrip = new CharacterService(undefined, library);
    roundTrip.importCharacterXml("RS2", service.exportCharacterXml("RS"));
    roundTrip.setRulesetMode("RS2", "2024");
    roundTrip.setRulesetMode("RS2", "2014");
    expect(roundTrip.getCharacter("RS2").rulesetMode).toBe("2014");
  });

  it("repairs uploaded homebrew picks across editions", async () => {
    const uploaded = await buildLibrary(CORPUS_ROOT);
    const pack = `<elements>
      <element name="Wardenkin" type="Race" source="Homebrew" id="ID_HB_RACE_WARDENKIN_2024">
        <setters><set name="ruleset">2024</set></setters>
      </element>
      <element name="Wardenkin" type="Race" source="Homebrew" id="ID_HB_RACE_WARDENKIN_2014">
        <setters><set name="ruleset">2014</set></setters>
      </element>
    </elements>`;
    await ingestContentFiles(uploaded, [
      { path: "imports/wardenkin.xml", base64: encodeBase64(new TextEncoder().encode(pack)) },
    ]);
    const service = new CharacterService(undefined, uploaded);
    service.createCharacter("HB");
    service.setRulesetMode("HB", "2024");
    const raceRule = pendingSelectionRules(service.getCharacter("HB")).find((rule) => rule.type === "Race")!;
    service.setSelection("HB", raceRule.identifier, "ID_HB_RACE_WARDENKIN_2024");
    service.setRulesetMode("HB", "2014");
    const state = service.getCharacter("HB");
    expect(state.rulesetMode).toBe("2014");
    expect(state.sum.elements.some((entry) => entry.id === "ID_HB_RACE_WARDENKIN_2014")).toBe(true);
    expect(state.sum.elements.some((entry) => entry.id === "ID_HB_RACE_WARDENKIN_2024")).toBe(false);
  });
});
