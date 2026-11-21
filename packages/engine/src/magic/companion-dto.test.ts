/**
 * Companion DTO numeric fields resolve from the computed `companion:*`
 * statistics (content-authored via stat rules on the granting feature),
 * falling back to the companion element's text only when the statistic is
 * absent or zero. maxHp already read companion:hp:max exclusively; this
 * covers armorClass, initiative, speed and its modes, and the attack/damage
 * bonuses. The statistics themselves start from the active stat block: its
 * ability scores and its own proficiency bonus, which the content's rules
 * build on.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { computeStatistics } from "../statistics/calculator.js";


const ID_RACE_STATS = "ID_TEST_RACE_COMPANION_STATS";
const ID_COMPANION_STATS = "ID_TEST_COMPANION_STATS_BEAST";
const ID_RACE_FALLBACK = "ID_TEST_RACE_COMPANION_FALLBACK";
const ID_COMPANION_FALLBACK = "ID_TEST_COMPANION_FALLBACK_BEAST";
const ID_RACE_SEED = "ID_TEST_RACE_COMPANION_SEED";

/** A seeded-statistics test beast: no Charisma setter, so that score comes from the saved attributes. */
function seedBeast(which: string, challenge: string, dexterity: string, extraSetters: string, rules: string): string {
  return `
  <element name="Test Seed ${which}" type="Companion" source="Homebrew" id="ID_TEST_COMPANION_SEED_${which}">
    <description><p>Test companion beast for the seeded statistics.</p></description>
    <setters>
      <set name="strength">12</set>
      <set name="dexterity">${dexterity}</set>
      <set name="constitution">13</set>
      <set name="intelligence">3</set>
      <set name="wisdom">15</set>
      <set name="ac">12</set>
      <set name="hp">9 (2d8)</set>
      <set name="speed">30 ft.</set>
      <set name="type">Beast</set>
      <set name="size">Medium</set>
      <set name="alignment">unaligned</set>
      <set name="challenge">${challenge}</set>
      ${extraSetters}
    </setters>
    <rules>${rules}
    </rules>
  </element>`;
}

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
  <element name="Test Seed Handler" type="Race" source="Homebrew" id="${ID_RACE_SEED}">
    <description><p>Test race granting a companion whose statistics the stat block seeds.</p></description>
    <setters><set name="names">Test</set></setters>
    <rules><select type="Companion" name="Test Seed Companion" /></rules>
  </element>
  ${seedBeast("BOND", "\u2014", "14", "", `
      <stat name="companion:proficiency" value="proficiency" bonus="base" />
      <stat name="companion:proficiency" value="-2" bonus="base companion PB removal" />
      <stat name="companion:perception:proficiency" value="companion:proficiency" bonus="base" />
      <grant type="Companion Trait" id="ID_TEST_COMPANION_SEED_TRAIT" />`)}
  <element name="Test Seed Trait" type="Companion Trait" source="Homebrew" id="ID_TEST_COMPANION_SEED_TRAIT">
    <description><p>Test trait proficient in Stealth.</p></description>
    <rules><stat name="companion:stealth:proficiency" value="companion:proficiency" bonus="base" /></rules>
  </element>
  ${seedBeast("OWNER", "\u2014", "10", `<set name="proficiency">0</set>`, `
      <stat name="companion:proficiency" value="proficiency" bonus="proficiency" />`)}
  ${seedBeast("RATED", "5", "8", "", "")}
  ${seedBeast("TINY", "1/8", "17", "", `
      <stat name="companion:perception:proficiency" value="companion:proficiency" bonus="base" />`)}
  ${seedBeast("DASH", "-", "12", "", "")}
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
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
    // companion:dexterity:modifier (the block's Dex 20 gives +5, and a rule adds 2)
    // + companion:initiative (3) + companion:initiative:misc (1)
    expect(companion!.initiative).toBe(11);
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
    // The block's Dex 12.
    expect(companion!.initiative).toBe(1);
  });
});

/** A Ranger of `levels` with the seed companion `which`: the statistics before and after it is chosen. */
function seededCompanion(which: string, levels: number) {
  const service = new CharacterService(undefined, library);
  const id = `seed-${which}-${levels}`;
  service.createCharacter(id);
  service.setAbilities(id, { strength: 10, dexterity: 18, constitution: 12, intelligence: 10, wisdom: 16, charisma: 8 });
  const rule = (type: string) => service.getCharacterDetail(id).selectionRules.find((candidate) => candidate.type === type)!;
  service.setSelection(id, rule("Race").identifier, ID_RACE_SEED);
  service.setSelection(id, rule("Class").identifier, "ID_WOTC_PHB_CLASS_RANGER");
  for (let level = 2; level <= levels; level += 1) service.levelUp(id);
  const before = computeStatistics(service.getCharacter(id), library);
  service.setSelection(id, rule("Companion").identifier, `ID_TEST_COMPANION_SEED_${which}`);
  const statistics = computeStatistics(service.getCharacter(id), library);
  return { before, statistics, companion: service.getCompanion(id)! };
}

describe("companion statistics seeded from the active stat block", () => {
  it("adds the owner's bonus and its removal to the +2 a dash rating gives, as the content assumes", () => {
    const level8 = seededCompanion("BOND", 8);
    expect(level8.statistics["companion:proficiency"]).toBe(3);
    expect(level8.statistics["companion:proficiency:half"]).toBe(1);
    expect(level8.statistics["companion:proficiency:half:up"]).toBe(2);
    // Rules reading the statistic see it, on the block and on a granted trait.
    expect(level8.statistics["companion:perception:proficiency"]).toBe(3);
    expect(level8.statistics["companion:stealth:proficiency"]).toBe(3);
    expect(level8.companion.proficiency).toBe(3);
    const level9 = seededCompanion("BOND", 9);
    expect(level9.statistics["companion:proficiency"]).toBe(4);
    expect(level9.statistics["companion:perception:proficiency"]).toBe(4);
  });

  it("starts from the block's own proficiency setter when it has one", () => {
    // A bonus of 0 that the content raises by the owner's: the owner's bonus.
    expect(seededCompanion("OWNER", 5).statistics["companion:proficiency"]).toBe(3);
    expect(seededCompanion("OWNER", 13).companion.proficiency).toBe(5);
  });

  it("gives a rated creature its challenge rating's bonus whatever its owner's", () => {
    expect(seededCompanion("RATED", 1).statistics["companion:proficiency"]).toBe(3);
    const tiny = seededCompanion("TINY", 9);
    expect(tiny.statistics["companion:proficiency"]).toBe(2);
    expect(tiny.statistics["companion:perception:proficiency"]).toBe(2);
    // A dash rating with no rule keeps its +2.
    expect(seededCompanion("DASH", 9).companion.proficiency).toBe(2);
  });

  it("seeds the companion's ability scores, and so its initiative, from the block", () => {
    const { statistics, companion } = seededCompanion("BOND", 8);
    expect(statistics["companion:dexterity:score"]).toBe(14);
    expect(statistics["companion:dexterity:modifier"]).toBe(2);
    expect(statistics["companion:wisdom:modifier"]).toBe(2);
    expect(statistics["companion:intelligence:modifier"]).toBe(-4);
    // The block leaves Charisma out: the saved attributes (10) stand in.
    expect(statistics["companion:charisma:score"]).toBe(10);
    expect(companion.initiative).toBe(2);
    expect(seededCompanion("TINY", 1).companion.initiative).toBe(3);
  });

  it("leaves the owner's own statistics as they were", () => {
    const { before, statistics } = seededCompanion("BOND", 8);
    const own = (values: Record<string, number>) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("companion:")));
    expect(own(statistics)).toEqual(own(before));
    expect(statistics["proficiency"]).toBe(3);
    expect(statistics["dexterity:modifier"]).toBe(4);
    // With no companion chosen there is no companion bonus, and the scores keep the saved attributes.
    expect(before["companion:proficiency"]).toBeUndefined();
    expect(before["companion:dexterity:score"]).toBe(10);
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
