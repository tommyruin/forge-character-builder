import { describe, expect, it } from "vitest";
import { buildLibrary } from "./library.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

/**
 * Content gate — per-type element counts of the built library.
 *
 * Pinned counts, with the recorded artifacts called out:
 * - the library's per-type counts, EXCEPT for the recorded artifacts:
 *   - Spell: 1079 distinct ids (corpus duplicates MYSTIC_CROWN_OF_DISGUST in
 *     one file) — status artifact, recorded.
 *   - Grants: 1130 vs 1131 (all 58 grants verified as type Grants in
 *     the library) — status artifact, recorded.
 *   - Feat Feature / Companion: status 379/132 vs library 381/133 —
 *     artifact, recorded.
 *   - Item / Magic Item: the library generates ingest-time proxies at build
 *     (13,548 "Additional ..." Item proxies + 1,079 per-spell "Spell Scroll"
 *     Magic Item candidates + 2 authored companion/familiar items), so the
 *     pins equal the generated counts (14,309 / 2,370 — the Magic Item count
 *     keeps the duplicate scroll list entries).
 * Changing any pin is a deliberate content-library change, not a rebaseline.
 */
const PINNED_TYPE_COUNTS: Record<string, number> = {
  "Archetype Feature": 1916,
  "Magic Item": 2370, // 1835 static + 535 generated scrolls
  Spell: 1079, // distinct ids (corpus duplicates MYSTIC_CROWN_OF_DISGUST in one file)
  Grants: 1130, // distinct ids
  "Class Feature": 1260,
  "Racial Trait": 998,
  Item: 14309, // 768 static + 13541 generated proxies
  "Feat Feature": 381, // status artifact: 379 reported, 381 in library (2 verified)
  Feat: 320,
  Deity: 296,
  Archetype: 272,
  Proficiency: 195,
  "Ability Score Improvement": 141,
  Race: 139,
  Background: 117,
  "Class": 29,
  Support: 29,
  Level: 20,
  "Damage Type": 14,
  "Weapon Property": 36,
  Condition: 39,
  "Weapon Group": 11,
  Option: 10,
  Size: 7,
  Property: 6,
  "Weapon Category": 5,
  "Spellcasting Focus Group": 4,
  "Armor Group": 4,
  Multiclass: 28,
  Ignore: 1,
};

describe("content gate — library type counts", () => {
  it("matches the pinned per-type counts", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    for (const [type, expected] of Object.entries(PINNED_TYPE_COUNTS)) {
      expect(lib.typeCounts[type], type).toBe(expected);
    }
    // byId size (26,366 also counts the 409 duplicate scroll list entries,
    // and the Feat Feature/Companion counts differ by the 3 recorded
    // artifacts).
    expect(lib.elementCount).toBe(25960);
  });

  it("resolves the authored system elements", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    for (const id of [
      "ID_LEVEL_9",
      "ID_LEVEL_20",
      "ID_INTERNAL_DAMAGE_TYPE_ACID",
      "ID_INTERNAL_CONDITION_DAMAGE_IMMUNITY_FORCE",
      "ID_INTERNAL_ARMOR_GROUP_HEAVY",
      "ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20",
    ]) {
      expect(lib.byId.get(id), id).toBeDefined();
    }
    expect(lib.byId.get("ID_LEVEL_9")!.identity.name).toBe("9");
    expect(lib.byId.get("ID_INTERNAL_DAMAGE_TYPE_ACID")!.identity.source).toBe("Internal");
  });

  it("includes the synthesized multiclass variants with flip-marker requirements", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    const rogue = lib.byId.get("ID_WOTC_PHB_MULTICLASS_ROGUE");
    expect(rogue).toBeDefined();
    expect(rogue!.identity.type).toBe("Multiclass");
    expect(rogue!.identity.name).toBe("Rogue");
    expect(rogue!.identity.source).toBe("Player’s Handbook");
    expect(rogue!.requirements).toMatch(/^!ID_WOTC_PHB_CLASS_ROGUE&&/);
    expect(lib.typeCounts["Multiclass"]).toBe(28);
  });

  it("includes the generated ASI class features", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    const asi = lib.byId.get("ID_INTERNAL_CLASS_FEATURE_ASI_10_ARTIFICER");
    expect(asi).toBeDefined();
    expect(asi!.identity.name).toBe("Ability Score Improvement (10)");
    expect(asi!.identity.type).toBe("Class Feature");
  });
});
