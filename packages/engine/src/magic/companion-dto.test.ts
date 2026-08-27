/**
 * Companion DTO numeric fields resolve from the computed `companion:*`
 * statistics (content-authored via stat rules on the granting feature),
 * falling back to the companion element's text only when the statistic is
 * absent or zero. maxHp already read companion:hp:max exclusively; this
 * covers armorClass, initiative, speed and its modes, and the attack/damage
 * bonuses.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const ID_RACE_STATS = "ID_TEST_RACE_COMPANION_STATS";
const ID_COMPANION_STATS = "ID_TEST_COMPANION_STATS_BEAST";
const ID_RACE_FALLBACK = "ID_TEST_RACE_COMPANION_FALLBACK";
const ID_COMPANION_FALLBACK = "ID_TEST_COMPANION_FALLBACK_BEAST";

const CONTENT_XML = `<elements>
  <element name="Test Companion Handler" type="Race" source="Homebrew" id="${ID_RACE_STATS}">
    <description><p>Test race granting a companion with authored companion:* statistics.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules>
      <select type="Companion" name="Test Companion" />
      <stat name="companion:ac" value="16" />
      <stat name="companion:attack" value="7" />
      <stat name="companion:damage" value="4" />
      <stat name="companion:hp:max" value="42" bonus="base" />
      <stat name="companion:speed" value="25" bonus="base" />
      <stat name="companion:speed:fly" value="60" bonus="base" />
      <stat name="companion:speed:climb" value="20" bonus="base" />
      <stat name="companion:speed:swim" value="15" bonus="base" />
      <stat name="companion:speed:burrow" value="10" bonus="base" />
      <stat name="companion:initiative" value="3" />
      <stat name="companion:initiative:misc" value="1" />
      <stat name="companion:dexterity:modifier" value="2" />
    </rules>
  </element>
  <element name="Test Beast" type="Companion" source="Homebrew" id="${ID_COMPANION_STATS}">
    <description><p>Test companion beast (statistics-driven).</p></description>
    <setters>
      <set name="strength">10</set>
      <set name="dexterity">20</set>
      <set name="constitution">10</set>
      <set name="intelligence">4</set>
      <set name="wisdom">12</set>
      <set name="charisma">6</set>
      <set name="ac">10 (natural armor)</set>
      <set name="hp">5 (1d4+1)</set>
      <set name="speed">5 ft.</set>
      <set name="type">Beast</set>
      <set name="size">Medium</set>
      <set name="alignment">unaligned</set>
      <set name="challenge">1/4</set>
    </setters>
  </element>
  <element name="Test Companion Handler (No Stats)" type="Race" source="Homebrew" id="${ID_RACE_FALLBACK}">
    <description><p>Test race granting a companion with no authored companion:* statistics.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules>
      <select type="Companion" name="Test Companion Fallback" />
    </rules>
  </element>
  <element name="Test Beast (Fallback)" type="Companion" source="Homebrew" id="${ID_COMPANION_FALLBACK}">
    <description><p>Test companion beast with only element text (no stat rules).</p></description>
    <setters>
      <set name="strength">10</set>
      <set name="dexterity">12</set>
      <set name="constitution">10</set>
      <set name="intelligence">4</set>
      <set name="wisdom">12</set>
      <set name="charisma">6</set>
      <set name="ac">12 (natural armor)</set>
      <set name="hp">7 (2d4+2)</set>
      <set name="speed">20 ft.</set>
      <set name="type">Beast</set>
      <set name="size">Medium</set>
      <set name="alignment">unaligned</set>
      <set name="challenge">1/4</set>
    </setters>
  </element>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
  await ingestContentFiles(library, [
    { path: "imports/companion-dto-test.xml", base64: encodeBase64(new TextEncoder().encode(CONTENT_XML)) },
  ]);
}, 120_000);

function registerCompanion(service: CharacterService, id: string, raceId: string, companionId: string): void {
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
  });
  const raceRule = service.getCharacterDetail(id).selectionRules.find((rule) => rule.type === "Race")!;
  service.setSelection(id, raceRule.identifier, raceId);
  const companionRule = service.getCharacterDetail(id).selectionRules.find((rule) => rule.type === "Companion")!;
  service.setSelection(id, companionRule.identifier, companionId);
}

describe("companion DTO", () => {
  it("resolves numeric fields from computed companion:* statistics", () => {
    const service = new CharacterService(undefined, library);
    registerCompanion(service, "stats-companion", ID_RACE_STATS, ID_COMPANION_STATS);

    const companion = service.getCompanion("stats-companion");
    expect(companion).not.toBeNull();
    expect(companion!.armorClass).toBe(16);
    expect(companion!.maxHp).toBe(42);
    // companion:dexterity:modifier (2) + companion:initiative (3) + companion:initiative:misc (1)
    expect(companion!.initiative).toBe(6);
    expect(companion!.speed).toBe(25);
    expect(companion!.speedFly).toBe(60);
    expect(companion!.speedClimb).toBe(20);
    expect(companion!.speedSwim).toBe(15);
    expect(companion!.speedBurrow).toBe(10);
    expect(companion!.attackBonus).toBe(7);
    expect(companion!.damageBonus).toBe(4);
  });

  it("falls back to the element text when a companion statistic is absent", () => {
    const service = new CharacterService(undefined, library);
    registerCompanion(service, "fallback-companion", ID_RACE_FALLBACK, ID_COMPANION_FALLBACK);

    const companion = service.getCompanion("fallback-companion");
    expect(companion).not.toBeNull();
    expect(companion!.armorClass).toBe(12);
    expect(companion!.speed).toBe(20);
    expect(companion!.speedFly).toBe(0);
    expect(companion!.speedClimb).toBe(0);
    expect(companion!.speedSwim).toBe(0);
    expect(companion!.speedBurrow).toBe(0);
    expect(companion!.attackBonus).toBe(0);
    expect(companion!.damageBonus).toBe(0);
    expect(companion!.maxHp).toBe(0);
    expect(companion!.initiative).toBe(0);
  });
});

describe("companion portrait", () => {
  it("stores the portrait with the character and survives an export round trip", () => {
    const service = new CharacterService(undefined, library);
    const id = "portrait-companion";
    registerCompanion(service, id, ID_RACE_STATS, ID_COMPANION_STATS);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    expect(service.getCompanion(id)!.portrait).toBe("");
    service.setCompanionPortrait(id, png);
    expect(service.getCompanion(id)!.portrait).toBe(png);

    // The portrait rides inside the character document, so it travels through
    // export, import, and cloud sync with everything else.
    const reimported = new CharacterService(undefined, library);
    const restored = reimported.importCharacterXml("restored", service.exportCharacterXml(id));
    expect(reimported.getCompanion(restored.id)!.portrait).toBe(png);

    service.removeCompanionPortrait(id);
    expect(service.getCompanion(id)!.portrait).toBe("");
  }, 120_000);
});
