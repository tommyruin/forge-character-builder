/**
 * The unarmed strike profile: which damage die applies, which ability is the
 * default, and which content riders reach the attack and damage totals. These
 * expectations are the specification for the unarmed surface; changing one is a
 * deliberate behaviour change, not a rebaseline.
 *
 * These cases are corpus-free on purpose: they pin the resolver against
 * synthetic statistics maps so the rules stay verifiable without the fetched
 * third-party content. `attacks.test.ts` covers the same ground end to end
 * against the real corpus.
 */

import { describe, expect, it } from "vitest";
import { resolveUnarmedProfile } from "./unarmed.js";

const abilities = (strength: number, dexterity: number) => ({ strength, dexterity });

describe("unarmed strike profile", () => {
  it("is a flat 1 bludgeoning with Strength when no content applies", () => {
    const profile = resolveUnarmedProfile({}, abilities(16, 14));
    expect(profile.dice).toBe("1");
    expect(profile.dieSource).toBeNull();
    expect(profile.damageType).toBe("bludgeoning");
    expect(profile.defaultAbility).toBe("Strength");
    expect(profile.attackRiders).toBe(0);
    expect(profile.damageRiders).toBe(0);
  });

  it("follows the 2014 monk martial arts die progression", () => {
    for (const [dice, expected] of [[4, "1d4"], [6, "1d6"], [8, "1d8"], [10, "1d10"]] as const) {
      const profile = resolveUnarmedProfile({ "martial arts:dice": dice }, abilities(16, 14));
      expect(profile.dice).toBe(expected);
      expect(profile.dieSource).toBe("Martial Arts");
    }
  });

  it("follows the 2024 monk martial arts die progression", () => {
    for (const [dice, expected] of [[6, "1d6"], [8, "1d8"], [10, "1d10"], [12, "1d12"]] as const) {
      const profile = resolveUnarmedProfile({ "martial arts:dice": dice }, abilities(16, 14));
      expect(profile.dice).toBe(expected);
    }
  });

  it("reads the Unarmed Fighting die size", () => {
    const profile = resolveUnarmedProfile({ "unarmed fighting:size": 8 }, abilities(16, 10));
    expect(profile.dice).toBe("1d8");
    expect(profile.dieSource).toBe("Unarmed Fighting");
  });

  it("takes the largest die when several sources apply", () => {
    const profile = resolveUnarmedProfile(
      { "martial arts:dice": 6, "unarmed fighting:size": 8 },
      abilities(16, 10),
    );
    expect(profile.dice).toBe("1d8");
    expect(profile.dieSource).toBe("Unarmed Fighting");
  });

  it("reads the canonical custom-content die key", () => {
    const profile = resolveUnarmedProfile({ "unarmed strike:dice": 12 }, abilities(16, 10));
    expect(profile.dice).toBe("1d12");
  });

  it("ignores a die key that is not a usable die size", () => {
    const profile = resolveUnarmedProfile({ "martial arts:dice": 0 }, abilities(16, 10));
    expect(profile.dice).toBe("1");
    expect(profile.dieSource).toBeNull();
  });

  it("sums both spellings of the flat attack and damage riders", () => {
    const profile = resolveUnarmedProfile(
      {
        "unarmed strike:attack": 1,
        "unarmed:attack": 1,
        "unarmed strike:damage": 1,
        "unarmed:damage": 2,
      },
      abilities(16, 10),
    );
    expect(profile.attackRiders).toBe(2);
    expect(profile.damageRiders).toBe(3);
  });

  it("never applies the melee category keys", () => {
    const profile = resolveUnarmedProfile(
      { "melee:attack": 2, "melee:damage": 2 },
      abilities(16, 10),
    );
    expect(profile.attackRiders).toBe(0);
    expect(profile.damageRiders).toBe(0);
  });

  it("keeps Strength when martial arts is absent even with a higher Dexterity", () => {
    const profile = resolveUnarmedProfile({}, abilities(10, 18));
    expect(profile.defaultAbility).toBe("Strength");
  });

  it("chooses the higher of Strength and Dexterity for a 2014 monk", () => {
    expect(
      resolveUnarmedProfile({ "martial arts:attack": 4, "martial arts:damage": 4 }, abilities(10, 18))
        .defaultAbility,
    ).toBe("Dexterity");
    expect(
      resolveUnarmedProfile({ "martial arts:attack": 3, "martial arts:damage": 3 }, abilities(16, 12))
        .defaultAbility,
    ).toBe("Strength");
  });

  it("chooses the higher of Strength and Dexterity for a 2024 monk", () => {
    expect(
      resolveUnarmedProfile({ "martial arts:ability modifier": 4 }, abilities(10, 18)).defaultAbility,
    ).toBe("Dexterity");
  });

  it("ties to Strength so the row matches the weapon finesse rule", () => {
    const profile = resolveUnarmedProfile({ "martial arts:ability modifier": 3 }, abilities(16, 16));
    expect(profile.defaultAbility).toBe("Strength");
  });

  it("names the feature that supplied the die when the source is known", () => {
    // Tavern Brawler writes the generic unarmed strike:dice key, so the key
    // name alone would report "Unarmed Strike" back at the reader.
    const profile = resolveUnarmedProfile(
      { "unarmed strike:dice": 4 },
      abilities(16, 10),
      [{ key: "unarmed strike:dice", value: 4, label: "Tavern Brawler", elementId: "ID_TB" }],
    );
    expect(profile.dice).toBe("1d4");
    expect(profile.dieSource).toBe("Tavern Brawler");
  });

  it("names the largest contributor when several features offer a die", () => {
    const profile = resolveUnarmedProfile(
      { "unarmed strike:dice": 8 },
      abilities(16, 10),
      [
        { key: "unarmed strike:dice", value: 4, label: "Tavern Brawler", elementId: "ID_TB" },
        { key: "unarmed strike:dice", value: 8, label: "Unarmed Fighting", elementId: "ID_UF" },
      ],
    );
    expect(profile.dieSource).toBe("Unarmed Fighting");
  });

  it("falls back to the key's own label when no contributor is known", () => {
    expect(resolveUnarmedProfile({ "martial arts:dice": 6 }, abilities(16, 10)).dieSource)
      .toBe("Martial Arts");
  });

  it("reports the features behind the attack and damage riders", () => {
    const profile = resolveUnarmedProfile(
      { "unarmed strike:attack": 3, "unarmed strike:damage": 3 },
      abilities(16, 10),
      [
        { key: "unarmed strike:attack", value: 3, label: "Wraps of Unarmed Prowess +3", elementId: "ID_W" },
        { key: "unarmed strike:damage", value: 3, label: "Wraps of Unarmed Prowess +3", elementId: "ID_W" },
      ],
    );
    expect(profile.riderSources).toEqual([
      { name: "Wraps of Unarmed Prowess +3", elementId: "ID_W", attack: 3, damage: 3 },
    ]);
  });

  it("notes the 2024 grapple and shove save DC when content supplies it", () => {
    const profile = resolveUnarmedProfile(
      { "martial arts:dice": 6, "martial arts:dc": 13 },
      abilities(10, 18),
    );
    expect(profile.notes).toContain("Grapple or Shove save DC 13");
  });

  it("has no notes when content supplies no save DC", () => {
    expect(resolveUnarmedProfile({}, abilities(16, 10)).notes).toEqual([]);
  });
});
