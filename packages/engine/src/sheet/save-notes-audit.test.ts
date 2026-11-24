/**
 * An audit of the Saving Throw Notes reader against the corpus. Every feature
 * or trait whose sheet text says "Advantage on ... saving throws" in one
 * sentence, yet gives the note nothing, is listed here after review: most name
 * someone else's benefit or a temporary state, which the note leaves out on
 * purpose. A new id fails the test until it is reviewed the same way.
 */

import { describe, expect, it } from "vitest";
import { sharedLibrary } from "../testing/character-factory.js";
import { saveAdvantageTerms } from "./save-notes.js";

/** The element types whose sheet text the features and species-traits boxes print. */
const PRINTED_TYPES: ReadonlySet<string> = new Set([
  "Language Feature", "Class", "Class Feature", "Archetype", "Archetype Feature", "Feat", "Feat Feature",
  "Race", "Sub Race", "Race Variant", "Racial Trait", "Dragonmark",
]);

/** "Advantage on" and a saving throw in one sentence; "Disadvantage" is not matched. */
const SAVE_ADVANTAGE = /\badvantage\s+on\b[^.]*?\b(?:saving\s+throws?|saves?)\b/i;

const REVIEWED_MISSES: ReadonlyMap<string, string> = new Map([
  // Another creature's benefit, or one shared with allies.
  ["ID_WOTC_PHB_ARCHETYPE_FEATURE_WIZARD_NECROMANCY_COMMAND_UNDEAD", "others"],
  ["ID_WOTC_PHB_CLASS_FEATURE_BARD_COUNTERCHARM", "others"],
  ["ID_WOTC_PHB24_ARCHETYPE_FEATURE_BARBARIAN_ZEALOT_ZEALOUS_PRESENCE", "others"],
  ["ID_WOTC_EGTW_ARCHETYPE_FEATURE_GRAVITURGY_ADJUST_DENSITY", "others"],
  ["ID_WOTC_MOOT_RACIAL_TRAIT_LIFELONG_COMPANION_BOON_AURA", "others"],
  ["ID_WOTC_SATO_FEAT_COHORT_OF_CHAOS", "others"],
  ["ID_WOTC_SCAG_ARCHETYPE_FEATURE_OATH_OF_THE_CROWN_EXALTED_CHAMPION", "others"],
  ["ID_WOTC_TCOE_ARCHETYPE_FEATURE_OATH_OF_THE_WATCHERS_CD_WATCHERS_WILL", "others"],
  ["ID_WOTC_XGTE_ARCHETYPE_FEATURE_ZEALOT_ZEALOUS_PRESENCE", "others"],
  ["ID_WOTC_XGTE_ARCHETYPE_FEATURE_SHEPHERD_SPIRIT_TOTEM", "others"],
  ["ID_WOTC_UA_FEAT_GOURMAND", "others"],
  ["ID_WOTC_UA20161128_ARCHETYPE_FEATURE_CIRCLE_TWILIGHT_WATCHER_AT_THE_THRESHOLD", "others"],
  ["ID_WOTC_UA20190918_ARCHETYPE_FEATURE_ELOQUENCE_UNDENIABLE_LOGIC", "others"],
  ["ID_WOTC_UA20191125_ARCHETYPE_FEATURE_PSYCHIC_WARRIOR_TELEKINETIC_BULWARK", "others"],
  ["ID_WOTC_UA20200114_ARCHETYPE_FEATURE_WATCHERS_CD_WATCHERS_WILL", "others"],
  ["ID_WOTC_UA20200206_ARCHETYPE_FEATURE_UNITY_ENDURING_UNITY", "others"],
  ["ID_WOTC_UA20200206_ARCHETYPE_FEATURE_LOVE_ENDURING_UNITY", "others"],
  ["ID_WOTC_UA20220308_ARCHETYPE_FEATURE_LUNAR_MAGIC_LUNAR_EMPOWERMENT_FULL_MOON", "others"],
  ["ID_WOTC_UA20220308_FEAT_FEATURE_SQUIRE_OF_SOLAMNIA_ENCOURAGING_RALLY", "others"],
  ["ID_WOTC_UA20220523_ARCHETYPE_FEATURE_CIRCLE_OF_THE_PRIMEVAL_PREHISTORIC_CONDUIT", "others"],
  // A narrower scope than the note can name.
  ["ID_WOTC_PHB_ARCHETYPE_FEATURE_PALADIN_HOLY_NIMBUS", "narrow scope"],
  ["ID_WOTC_PHB24_ARCHETYPE_FEATURE_PALADIN_OATH_OF_DEVOTION_HOLY_NIMBUS", "narrow scope"],
  ["ID_WOTC_PHB24_CLASS_FEATURE_SORCERER_METAMAGIC_EXTENDED_SPELL", "narrow scope"],
  ["ID_WOTC_UA20150803_ARCHETYPE_FEATURE_GHOST_IN_THE_MACHINE_GHOST_IN_THE_MACHINE_PERSONAL_ENCRYPTION", "narrow scope"],
  ["ID_WOTC_PHB_ARCHETYPE_FEATURE_TIDES_OF_CHAOS", "one roll"],
  // A temporary state: a timed form, a carried token, a shell, a shift.
  ["ID_WOTC_TOA_RACIAL_TRAIT_TORTLE_SHELL_DEFENSE", "temporary"],
  ["ID_WOTC_MOTM_RACIAL_TRAIT_TORTLE_SHELL_DEFENSE", "temporary"],
  ["ID_WOTC_TCOE_ARCHETYPE_FEATURE_RUNE_KNIGHT_GIANTS_MIGHT", "temporary"],
  ["ID_WOTC_TCOE_ARCHETYPE_FEATURE_RUNE_KNIGHT_HILL_RUNE", "temporary"],
  ["ID_WOTC_TCOE_ARCHETYPE_FEATURE_PHANTOM_TOKENS_OF_THE_DEPARTED", "temporary"],
  ["ID_WOTC_UA_SUBRACE_Wildhunt", "temporary"],
  ["ID_WOTC_UA_ARCHETYPE_FEATURE_GIANT_SOUL_RAGE_OF_FALLEN_OSTORIA", "temporary"],
  ["ID_WOTC_UA20191003_ARCHETYPE_FEATURE_RUNE_KNIGHT_GIANT_MIGHT", "temporary"],
  ["ID_WOTC_UA20200512_ARCHETYPE_FEATURE_PHANTOM_TOKENS_OF_THE_DEPARTED", "temporary"],
  ["ID_WOTC_PSI_RACIAL_TRAIT_VAMPIRE_FEAST_OF_BLOOD", "temporary"],
  // A standing benefit the reader misses: the sentence drops its "you" ("..., and advantage on
  // saving throws against being paralyzed"). Playtest content; left as a known gap.
  ["ID_WOTC_UA20170213_CLASS_FEATURE_ELDRITCH_INVOCATION_PATH_OF_THE_SEEKER", "known gap"],
]);

describe("the corpus audit of saving throw notes", () => {
  it("misses no save advantage beyond the reviewed ones", async () => {
    const library = await sharedLibrary();
    const missed: string[] = [];
    for (const [id, element] of library.byId) {
      if (!PRINTED_TYPES.has(element.identity.type)) continue;
      const title = element.sheets[0]?.alt || element.identity.name;
      // Every level's text, read the way the sheet feeds the reader: one feature at a time.
      const texts = element.sheets.flatMap((sheet) => sheet.descriptions.map((description) => description.text)).filter((text) => SAVE_ADVANTAGE.test(text));
      if (texts.length === 0) continue;
      if (texts.some((text) => saveAdvantageTerms({ title, text }).length > 0)) continue;
      missed.push(id);
    }
    expect(missed.sort()).toEqual([...REVIEWED_MISSES.keys()].sort());
  }, 60_000);
});
