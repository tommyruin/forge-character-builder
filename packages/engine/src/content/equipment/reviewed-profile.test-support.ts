import { type ElementLibrary } from "../library.js";
import { buildCorpusLibrary } from "../../testing/corpus.js";

/** The 54 corpus files used by the reviewed-test profile (fixture compatibility set). */
export const REVIEWED_PROFILE_PATHS = new Set([
  "system/system-elements.xml",
  "system/system-proxies.xml",
  "testdata/core/ALE.xml",
  "testdata/core/internal.xml",
  "testdata/core/players-handbook/source.xml",
  "testdata/core/dungeon-masters-guide/source.xml",
  "testdata/core/monster-manual/source.xml",
  "testdata/core/players-handbook/archetypes/fighter-champion.xml",
  "testdata/core/players-handbook/archetypes/wizard-evocation.xml",
  "testdata/core/players-handbook/backgrounds/background-acolyte.xml",
  "testdata/core/players-handbook/deities.xml",
  "testdata/core/players-handbook/languages.xml",
  "testdata/core/players-handbook/proficiencies.xml",
  "testdata/core/players-handbook/spells.xml",
  "testdata/supplements/extra-life/one-grung-above.xml",
  "testdata/supplements/xanathars-guide-to-everything/source.xml",
  "testdata/supplements/xanathars-guide-to-everything/spells.xml",
  "testdata/supplements/xanathars-guide-to-everything/archetypes/ranger-gloomstalker.xml",
  ...[
    "barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
  ].map((name) => `testdata/core/players-handbook/classes/class-${name}.xml`),
  ...[
    "dragonborn", "dwarf", "elf", "gnome", "halfelf", "halfling", "halforc", "human", "tiefling",
  ].map((name) => `testdata/core/players-handbook/races/race-${name}.xml`),
  ...["armor", "gear", "instrument", "packs", "tools", "weapons"].map((name) => `testdata/core/players-handbook/items/items-${name}.xml`),
  ...["armor", "poison", "potions", "rings", "rods", "staffs", "wands", "weapons", "wondrous"].map((name) => `testdata/core/dungeon-masters-guide/items/items-${name}.xml`),
]);

export async function buildReviewedLibrary(): Promise<ElementLibrary> {
  return buildCorpusLibrary((path) => REVIEWED_PROFILE_PATHS.has(path));
}
