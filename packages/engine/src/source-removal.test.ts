/**
 * Disabling a book removes the character's choices from it. Applying a source
 * restriction clears every selection whose chosen element the character can
 * no longer use — race, background, subclass and the rest — and reports them,
 * except class picks: clearing one would delete every level in that class, so
 * those are kept and reported as warnings instead.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "./content/library.js";
import { CharacterService } from "./character/service.js";
import { pendingSelectionRules } from "./selection/selection.js";
import { buildCorpusLibrary } from "./testing/corpus.js";
import { createEngineMethodHandlers } from "./worker-handlers.js";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

const AI_SOURCE = "ID_WOTC_SOURCE_ACQUISITIONS_INCORPORATED";
const EGTW_SOURCE = "ID_WOTC_SOURCE_EXPLORERS_GUIDE_TO_WILDEMOUNT";
const TCOE_SOURCE = "ID_WOTC_SOURCE_TASHAS_CAULDRON_OF_EVERYTHING";

const VERDAN = "ID_WOTC_ACQINC_RACE_VERDAN";
const GRINNER = "ID_WOTC_EGTW_BACKGROUND_GRINNER";
const ECHO_KNIGHT = "ID_WOTC_EGTW_ARCHETYPE_FIGHTER_ECHO_KNIGHT";
const ARTIFICER = "ID_WOTC_TCOE_CLASS_ARTIFICER";

interface NamedSelection {
  name: string;
  type: string;
}
interface SourceEditResponse {
  restrictedSourceIds: string[];
  removedSpellNames: string[];
  removedSelections: NamedSelection[];
  keptSelections: NamedSelection[];
}

function newCharacter(ruleset: "2014" | "2024", name: string): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter(name).id;
  service.setRulesetMode(id, ruleset);
  service.setAbilities(id, {
    strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14,
  });
  return { service, id };
}

function choose(service: CharacterService, id: string, type: string, elementId: string): void {
  const rule = pendingSelectionRules(service.getCharacter(id)).find((candidate) => candidate.type === type);
  expect(rule, `pending ${type} rule`).toBeDefined();
  service.setSelection(id, rule!.identifier, elementId);
}

function restrict(service: CharacterService, id: string, restrictedSourceIds: string[]): SourceEditResponse {
  return createEngineMethodHandlers(service, library).setCharacterSources!(id, {
    restrictedSourceIds,
  }) as unknown as SourceEditResponse;
}

/** Ids of every registered element and filled selection in the character tree. */
function registeredIds(service: CharacterService, id: string): string[] {
  const ids: string[] = [];
  const walk = (nodes: ReturnType<CharacterService["getCharacter"]>["elements"]): void => {
    for (const node of nodes) {
      if (node.id) ids.push(node.id);
      if (node.registered) ids.push(node.registered);
      walk(node.children);
    }
  };
  walk(service.getCharacter(id).elements);
  return ids;
}

function expectRoundTrip(service: CharacterService, id: string): void {
  const xml = service.exportCharacterXml(id);
  const reader = new CharacterService(undefined, library);
  reader.importCharacterXml(id, xml);
  expect(reader.exportCharacterXml(id)).toBe(xml);
}

describe("disabling a book removes the character's choices from it", () => {
  it("clears a Verdan race and its traits when Acquisitions Incorporated is disabled", () => {
    const { service, id } = newCharacter("2024", "Verdan");
    choose(service, id, "Race", VERDAN);
    expect(registeredIds(service, id).some((entry) => entry.startsWith("ID_WOTC_ACQINC_RACIAL_TRAIT_"))).toBe(true);

    const response = restrict(service, id, [AI_SOURCE]);

    expect(response.removedSelections).toContainEqual({ name: "Verdan", type: "Race" });
    expect(response.keptSelections).toEqual([]);
    expect(response.removedSpellNames).toEqual([]);
    const raceRule = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race");
    expect(raceRule, "race is pending again").toBeDefined();
    expect(registeredIds(service, id).filter((entry) => entry.startsWith("ID_WOTC_ACQINC_"))).toEqual([]);
    expect(service.exportCharacterXml(id)).not.toContain("ID_WOTC_ACQINC_");
    expectRoundTrip(service, id);
  });

  it("clears a Grinner background when Explorer's Guide to Wildemount is disabled", () => {
    const { service, id } = newCharacter("2014", "Grinner");
    choose(service, id, "Background", GRINNER);

    const response = restrict(service, id, [EGTW_SOURCE]);

    expect(response.removedSelections).toContainEqual({ name: "Grinner", type: "Background" });
    expect(pendingSelectionRules(service.getCharacter(id)).some((rule) => rule.type === "Background")).toBe(true);
    expect(service.exportCharacterXml(id)).not.toContain("ID_WOTC_EGTW_");
    expectRoundTrip(service, id);
  });

  it("clears an Echo Knight subclass and its features but keeps the Fighter levels", () => {
    const { service, id } = newCharacter("2014", "Echo Knight");
    choose(service, id, "Class", "ID_WOTC_PHB_CLASS_FIGHTER");
    while (service.getCharacter(id).level < 3) service.levelUp(id);
    choose(service, id, "Archetype", ECHO_KNIGHT);
    expect(registeredIds(service, id).some((entry) => entry.startsWith("ID_WOTC_EGTW_ARCHETYPE_FEATURE_"))).toBe(true);

    const response = restrict(service, id, [EGTW_SOURCE]);

    expect(response.removedSelections).toContainEqual({ name: "Echo Knight", type: "Archetype" });
    expect(response.keptSelections).toEqual([]);
    expect(service.getCharacter(id).level).toBe(3);
    expect(pendingSelectionRules(service.getCharacter(id)).some((rule) => rule.type === "Archetype")).toBe(true);
    expect(registeredIds(service, id).filter((entry) => entry.startsWith("ID_WOTC_EGTW_"))).toEqual([]);
    expect(service.exportCharacterXml(id)).not.toContain("ID_WOTC_EGTW_");
    expectRoundTrip(service, id);
  });

  it("keeps a class from a disabled book and reports it", () => {
    const { service, id } = newCharacter("2014", "Artificer");
    choose(service, id, "Class", ARTIFICER);
    service.levelUp(id);

    const response = restrict(service, id, [TCOE_SOURCE]);

    expect(response.keptSelections).toEqual([{ name: "Artificer", type: "Class" }]);
    expect(response.removedSelections).not.toContainEqual(expect.objectContaining({ type: "Class" }));
    expect(service.getCharacter(id).level).toBe(2);
    expect(registeredIds(service, id)).toContain(ARTIFICER);
    expectRoundTrip(service, id);
  });

  it("reports removed spells as Spell selections alongside removedSpellNames", () => {
    const { service, id } = newCharacter("2024", "Druid");
    choose(service, id, "Class", "ID_WOTC_PHB24_CLASS_DRUID");
    const spellId = "ID_POTA_SPELL_ABSORBELEMENTS";
    service.setPrepared(id, service.getSpellcasting(id)[0]!.identifier, { spellId, prepared: true });
    const source = [...library.sources.values()].find((entry) => entry.identity.name === "Princes of the Apocalypse")!;

    const response = restrict(service, id, [source.identity.id]);

    expect(response.removedSpellNames).toContain("Absorb Elements");
    // Every removed spell is reported as a Spell choice, and nothing else is.
    expect(response.removedSelections).toEqual(
      response.removedSpellNames.map((name) => ({ name, type: "Spell" })),
    );
    expect(response.keptSelections).toEqual([]);
    expect(service.exportCharacterXml(id)).not.toContain(spellId);
  });

  it("reports nothing when no chosen element comes from the disabled book", () => {
    const { service, id } = newCharacter("2024", "Untouched");
    choose(service, id, "Class", "ID_WOTC_PHB24_CLASS_FIGHTER");
    const before = service.exportCharacterXml(id);

    const response = restrict(service, id, [AI_SOURCE]);

    expect(response.removedSelections).toEqual([]);
    expect(response.keptSelections).toEqual([]);
    expect(service.exportCharacterXml(id)).toBe(
      before.replace("<restricted />", `<restricted><source id="${AI_SOURCE}" /></restricted>`)
        .replace("<restricted></restricted>", `<restricted><source id="${AI_SOURCE}" /></restricted>`),
    );
  });
});
