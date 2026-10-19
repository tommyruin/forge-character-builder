/**
 * Structured spell mechanics: a spell element that declares its roll in setters
 * is read from them, a book spell (prose only) keeps its regex reading, and the
 * two readings agree where a structured spell restates a book spell.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import type { ParsedElement } from "../content/parser.js";
import { parseSpellAttack, parseSpellSave } from "./reconcile.js";
import { structuredSpellMechanics } from "./structured-spell.js";
import { sharedLibrary } from "../testing/character-factory.js";

type Setter = { name: string; value: string; attrs?: Record<string, string> };
const spell = (...setters: Setter[]): Pick<ParsedElement, "setters"> => ({ setters });
const set = (name: string, value: string, attrs?: Record<string, string>): Setter => ({
  name,
  value,
  ...(attrs === undefined ? {} : { attrs }),
});

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

describe("reading a structured spell", () => {
  it("is absent for a spell that declares no roll", () => {
    expect(structuredSpellMechanics(spell(set("level", "1")), 5, 1)).toBeNull();
  });

  it("reads a ranged spell attack with its damage", () => {
    const read = structuredSpellMechanics(
      spell(set("spell roll", "ranged attack"), set("spell damage", "1d10", { type: "cold" })),
      1,
      0,
    )!;
    expect(read.save).toBeNull();
    expect(read.attack).toMatchObject({ damage: "1d10 cold", beamCount: 1, beamUnit: "attacks", warning: null, notes: [] });
  });

  it("lists every damage term", () => {
    const read = structuredSpellMechanics(
      spell(
        set("spell roll", "melee attack"),
        set("spell damage", "1d8", { type: "fire" }),
        set("spell damage", "1d6", { type: "radiant" }),
      ),
      1,
      2,
    )!;
    expect(read.attack!.damage).toBe("1d8 fire + 1d6 radiant");
  });

  it("raises the first damage die at each character-level tier", () => {
    const cantrip = spell(
      set("spell roll", "ranged attack"),
      set("spell damage", "1d10", { type: "fire" }),
      set("spell cantrip scaling", "2d10", { level: "5" }),
      set("spell cantrip scaling", "3d10", { level: "11" }),
      set("spell cantrip scaling", "4d10", { level: "17" }),
    );
    const damage = (level: number) => structuredSpellMechanics(cantrip, level, 0)!.attack!.damage;
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(damage)).toEqual([
      "1d10 fire", "1d10 fire", "2d10 fire", "2d10 fire", "3d10 fire", "3d10 fire", "4d10 fire", "4d10 fire",
    ]);
  });

  it("reads a saving throw spell with half damage on a success", () => {
    const read = structuredSpellMechanics(
      spell(
        set("spell roll", "saving throw"),
        set("spell save", "Dexterity"),
        set("spell save success", "half"),
        set("spell damage", "8d6", { type: "fire" }),
      ),
      5,
      3,
    )!;
    expect(read.attack).toBeNull();
    expect(read.save).toMatchObject({ ability: "Dexterity", damage: "8d6 fire", halfOnSuccess: true, warning: null });
  });

  it("warns that higher slots add dice, as the prose reading does", () => {
    const read = structuredSpellMechanics(
      spell(
        set("spell roll", "saving throw"),
        set("spell save", "Dexterity"),
        set("spell damage", "8d6", { type: "fire" }),
        set("spell slot scaling", "1d6"),
      ),
      5,
      3,
    )!;
    expect(read.save!.warning).toBe("Higher-level slots add 1d6 per slot level above 3rd.");
  });

  it("adds the spellcasting modifier when the spell says so", () => {
    const read = structuredSpellMechanics(
      spell(set("spell roll", "melee attack"), set("spell damage", "1d8", { type: "force" }), set("spell modifier", "true")),
      1,
      2,
    )!;
    expect(read.attack!.addsSpellcastingModifier).toBe(true);
  });

  it("is not an attack at all when the roll is none, whatever the prose says", () => {
    const read = structuredSpellMechanics(
      spell(set("spell roll", "none"), set("spell damage", "2d6", { type: "fire" })),
      1,
      1,
    )!;
    expect(read).toEqual({ attack: null, save: null });
  });

  it("gives no save row for a saving throw that deals no damage", () => {
    const read = structuredSpellMechanics(spell(set("spell roll", "saving throw"), set("spell save", "Wisdom")), 1, 1)!;
    expect(read.save).toBeNull();
  });
});

describe("a structured spell restates a book spell", () => {
  const book = (id: string) => {
    const element = library.byId.get(id);
    if (element === undefined) throw new Error(`${id} missing from the corpus`);
    return element;
  };

  it("matches the prose reading of an attack cantrip at every tier", () => {
    const fireBolt = book("ID_PHB_SPELL_FIRE_BOLT");
    const structured = spell(
      set("spell roll", "ranged attack"),
      set("spell damage", "1d10", { type: "fire" }),
      set("spell cantrip scaling", "2d10", { level: "5" }),
      set("spell cantrip scaling", "3d10", { level: "11" }),
      set("spell cantrip scaling", "4d10", { level: "17" }),
    );
    for (const level of [1, 5, 11, 17]) {
      const prose = parseSpellAttack(fireBolt.descriptionXml, level)!;
      const read = structuredSpellMechanics(structured, level, 0)!.attack!;
      expect(read.damage.toLowerCase()).toBe(prose.damage.toLowerCase());
      expect(read.beamCount).toBe(prose.beamCount);
      expect(read.warning).toBe(prose.warning);
    }
  });

  it("matches the prose reading of a saving throw cantrip", () => {
    const sacredFlame = book("ID_PHB_SPELL_SACRED_FLAME");
    const structured = spell(
      set("spell roll", "saving throw"),
      set("spell save", "Dexterity"),
      set("spell damage", "1d8", { type: "radiant" }),
      set("spell cantrip scaling", "2d8", { level: "5" }),
      set("spell cantrip scaling", "3d8", { level: "11" }),
      set("spell cantrip scaling", "4d8", { level: "17" }),
    );
    for (const level of [1, 5, 11, 17]) {
      const prose = parseSpellSave(sacredFlame.descriptionXml, level, sacredFlame.supports)!;
      const read = structuredSpellMechanics(structured, level, 0)!.save!;
      expect(read.ability).toBe(prose.ability);
      expect(read.damage.toLowerCase()).toBe(prose.damage.toLowerCase());
      expect(read.halfOnSuccess).toBe(prose.halfOnSuccess);
    }
  });

  it("matches the prose reading of a half-damage saving throw spell and its upcast warning", () => {
    const fireball = book("ID_PHB_SPELL_FIREBALL");
    const structured = spell(
      set("spell roll", "saving throw"),
      set("spell save", "Dexterity"),
      set("spell save success", "half"),
      set("spell damage", "8d6", { type: "fire" }),
      set("spell slot scaling", "1d6"),
    );
    const prose = parseSpellSave(fireball.descriptionXml, 5, fireball.supports)!;
    const read = structuredSpellMechanics(structured, 5, 3)!.save!;
    expect(read).toMatchObject({
      ability: prose.ability,
      halfOnSuccess: prose.halfOnSuccess,
      warning: prose.warning,
    });
    expect(read.damage.toLowerCase()).toBe(prose.damage.toLowerCase());
  });
});

describe("book spells are untouched", () => {
  it("no bundled spell declares a structured roll, so every one keeps its prose reading", () => {
    const spells = library.byType.get("Spell") ?? [];
    expect(spells.length).toBeGreaterThan(300);
    const declaring = spells.filter((element) => structuredSpellMechanics(element, 5, 1) !== null);
    expect(declaring.map((element) => element.identity.id)).toEqual([]);
  });
});
