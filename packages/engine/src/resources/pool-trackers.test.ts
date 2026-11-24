/**
 * Book pools the usage reader cannot see: point pools with no usage line
 * (Sorcery Points, Focus Points, Ki Points), and pools of dice whose line reads
 * "4d8/Short Rest". Real corpus characters check that each becomes a tracker,
 * prints in the Resources paragraph and closes its own feature's text; an audit
 * of the corpus keeps any new pool from slipping past both readers unnoticed.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { TrackerDto } from "@forge-cb/api";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { freshService, select, sharedLibrary } from "../testing/character-factory.js";
import { POOL_TRACKERS } from "./pools.js";
import { inlineUsesText, resourceSheetText } from "./sheet.js";
import { parseUsageText } from "./usage.js";

const SPECIES_2024 = "ID_WOTC_PHB24_RACE_AASIMAR";
const SORCERER_2024 = "ID_WOTC_PHB24_CLASS_SORCERER";
const FIGHTER_2024 = "ID_WOTC_PHB24_CLASS_FIGHTER";
const MONK_2024 = "ID_WOTC_PHB24_CLASS_MONK";
const BATTLE_MASTER_2024 = "ID_WOTC_PHB24_ARCHETYPE_FIGHTER_BATTLE_MASTER";
const FONT_OF_MAGIC_2024 = "ID_WOTC_PHB24_CLASS_FEATURE_SORCERER_FONT_OF_MAGIC";
const MONKS_FOCUS_2024 = "ID_WOTC_PHB24_CLASS_FEATURE_MONK_MONKS_FOCUS";
const COMBAT_SUPERIORITY_2024 = "ID_WOTC_PHB24_ARCHETYPE_FEATURE_FIGHTER_BATTLE_MASTER_COMBAT_SUPERIORITY";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
});

/** A 2024 character of `classId` at `levels`, with the subclass picked at 3 when given. */
function build(id: string, classId: string, levels: number, subclass?: string): { service: CharacterService; id: string } {
  const service = freshService(library);
  service.createCharacter(id);
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 14, dexterity: 15, constitution: 14, intelligence: 10, wisdom: 12, charisma: 13 });
  select(service, id, "Race", SPECIES_2024);
  select(service, id, "Class", classId);
  for (let level = 2; level <= levels; level++) {
    service.levelUp(id);
    if (level === 3 && subclass !== undefined) select(service, id, "Archetype", subclass);
  }
  return { service, id };
}

const trackerOf = (service: CharacterService, id: string, key: string): TrackerDto | undefined =>
  service.getResources(id).trackers.find((tracker) => tracker.id === key);

/** Every line of the character page's features box. */
function featureLines(service: CharacterService, id: string): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full", resourceTrackersList: true });
  const details = model.pages.find((page) => page.templateKind === "details")!;
  return details.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : [])));
}

describe("book pools with no usage line", () => {
  it("tracks a level 8 sorcerer's Sorcery Points and prints them in Resources and beside Font of Magic", () => {
    const { service, id } = build("PoolSorcerer", SORCERER_2024, 8);
    const tracker = trackerOf(service, id, `usage:${FONT_OF_MAGIC_2024}`);
    expect(tracker).toMatchObject({ label: "Sorcery Points", max: 8, used: 0, unit: "points", recharge: "longRest", isCustom: false, tracked: true });
    expect(tracker!.sources).toEqual([{ name: "Font of Magic", kind: "book", elementId: FONT_OF_MAGIC_2024 }]);

    const lines = featureLines(service, id);
    const resources = lines.find((line) => line.startsWith("Resources."));
    expect(resources).toContain(resourceSheetText([tracker!])!.replace(/^Resources\. /, ""));
    const font = lines.find((line) => line.startsWith("Font of Magic"));
    // Font of Magic states no usage line, so its uses carry the recharge.
    expect(font?.endsWith(inlineUsesText([tracker!], { recharge: true })!)).toBe(true);
    // A large pool prints as a blank count to fill in, never "8 / 8", and stays fresh when points are spent.
    expect(resources).toContain("Sorcery Points ____ / 8 (LR)");
    expect(font).toMatch(/ \[Points: ____ \/ 8 \(LR\)\]$/);
    service.setTrackerUsed(id, { trackerId: tracker!.id, used: 3 });
    expect(featureLines(service, id)).toEqual(lines);
  });

  it("tracks a monk's Focus Points, refilled by a short rest", () => {
    const { service, id } = build("PoolMonk", MONK_2024, 5);
    expect(trackerOf(service, id, `usage:${MONKS_FOCUS_2024}`)).toMatchObject({ label: "Focus Points", max: 5, unit: "points", recharge: "shortRest" });
  });

  it("adds no pool before the feature that grants it", () => {
    const { service, id } = build("PoolMonk1", MONK_2024, 1);
    expect(trackerOf(service, id, `usage:${MONKS_FOCUS_2024}`)).toBeUndefined();
  });
});

describe("pools of dice", () => {
  it("tracks a level 3 Battle Master's Superiority Dice from its usage line", () => {
    const { service, id } = build("PoolBattleMaster", FIGHTER_2024, 3, BATTLE_MASTER_2024);
    expect(trackerOf(service, id, `usage:${COMBAT_SUPERIORITY_2024}`)).toMatchObject({ label: "Combat Superiority", max: 4, unit: "uses", recharge: "shortRest" });
  });
});

/**
 * Elements whose sheet names a pool of points by a statistic ("{{x}} Ki Points") or whose
 * usage line is a pool of dice, but which neither the usage reader nor `POOL_TRACKERS`
 * tracks. Each was reviewed; a new id here needs the same review.
 */
const REVIEWED_UNTRACKED_POOLS: ReadonlyMap<string, string> = new Map([
  // Not a pool: the most extra ki points one use may spend.
  ["ID_WOTC_SCAG_ARCHETYPE_FEATURE_WAY_OF_THE_SUN_SOUL_SEARING_ARC_STRIKE", "spending cap"],
  ["ID_WOTC_XGTE_ARCHETYPE_FEATURE_SUN_SOUL_SEARING_ARC_STRIKE", "spending cap"],
  // Unearthed Arcana leftovers: playtest pools, left untracked.
  ["ID_WOTC_UA20161205_ARCHETYPE_FEATURE_KNIGHT_IMPLACABLE_MARK", "playtest"],
  ["ID_WOTC_UA20170313_CLASS_FEATURE_MYSTIC_PSIONICS", "playtest"],
  ["ID_WOTC_UA20170313_CLASS_FEATURE_MYSTIC_PSIONIC_MASTERY", "playtest"],
  ["ID_WOTC_UA_ASTRAL_SELF_ARCHETYPE_FEATURE_COMPLETE_ASTRAL_SELF", "playtest"],
]);

/** "{{stat}} Sorcery Points": a token, up to three words, then "points" (hit points are not a pool). */
const POINT_POOL_TEXT = /\{\{[^}]+\}\}((?:\s+[A-Za-z'’-]+){0,3})\s+points\b/gi;
const DICE_USAGE = /^\s*(?:\d+|\{\{[^}]+\}\})d(?:\d+|\{\{[^}]+\}\})\s*\//i;

describe("the corpus audit of pools", () => {
  it("knows every pool element by its id and statistic", () => {
    for (const [id, pool] of POOL_TRACKERS) {
      const element = library.byId.get(id);
      expect(element, id).toBeDefined();
      expect(element!.rules.some((rule) => rule.kind === "stat" && rule.name === pool.stat), id).toBe(true);
    }
  });

  it("finds no pool that nothing tracks beyond the reviewed ones", () => {
    // A token filled in with any count, as the sheet fills it before reading the line.
    const filled = (text: string): string => text.replace(/\{\{[^}]+\}\}/g, "3");
    const untracked: string[] = [];
    for (const [id, element] of library.byId) {
      for (const sheet of element.sheets) {
        const usages = [sheet.usage, ...sheet.descriptions.map((description) => description.usage)].filter((usage): usage is string => usage !== undefined && usage !== "");
        if (POOL_TRACKERS.has(id) || usages.some((usage) => parseUsageText(filled(usage)) !== null)) continue;
        const namesPoints = sheet.descriptions.some((description) =>
          [...description.text.matchAll(POINT_POOL_TEXT)].some((match) => !/\bhit$/i.test(match[1]!.trim())));
        if (namesPoints || usages.some((usage) => DICE_USAGE.test(usage))) untracked.push(id);
      }
    }
    expect([...new Set(untracked)].sort()).toEqual([...REVIEWED_UNTRACKED_POOLS.keys()].sort());
  });
});
