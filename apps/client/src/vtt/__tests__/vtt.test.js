import { describe, it, expect } from "vitest";
import { collectExportModel } from "../collect.js";
import { buildFoundryActor } from "../foundry/buildActor.js";
import { buildItems, parseDamage } from "../foundry/items.js";
import { buildVttes } from "../roll20/buildVttes.js";
import { exportRoll20 } from "../index.js";
import {
  skillInfo,
  saveInfo,
  abilityMap,
  passivePerception,
} from "../rules5e.js";
import { fakeApi, statistics } from "./fixture.dwarfCleric.js";

// rules5e operates on the flat statistics map (collect.js unwraps StatisticsDto.values).
const statValues = statistics.values;

async function model() {
  return collectExportModel("dwarf-cleric", { api: fakeApi });
}

describe("rules5e", () => {
  const abilities = abilityMap([
    { abbreviation: "WIS", finalScore: 16, modifier: 3 },
    { abbreviation: "INT", finalScore: 10, modifier: 0 },
    { abbreviation: "STR", finalScore: 14, modifier: 2 },
  ]);

  it("computes a proficient skill bonus = prof + abilityMod + misc", () => {
    // medicine (wis): prof 2 + wis mod 3 + misc 0 = 5, proficient, not expertise
    const s = skillInfo(statValues, abilities, "medicine", 2);
    expect(s).toMatchObject({
      bonus: 5,
      proficient: true,
      expertise: false,
      multiplier: 1,
    });
  });

  it("detects expertise when prof >= 2*PB", () => {
    // history (int): prof 4 (=2*PB) + int 0 = 4, expertise
    const s = skillInfo(statValues, abilities, "history", 2);
    expect(s).toMatchObject({
      bonus: 4,
      proficient: true,
      expertise: true,
      multiplier: 2,
    });
  });

  it("non-proficient skill is ability mod only", () => {
    const s = skillInfo(statValues, abilities, "arcana", 2);
    expect(s).toMatchObject({ bonus: 0, proficient: false, multiplier: 0 });
  });

  it("computes a proficient save bonus", () => {
    const s = saveInfo(statValues, abilities, "wis");
    expect(s).toEqual({ bonus: 5, proficient: true });
  });

  it("passive perception = 10 + perception bonus", () => {
    // perception (wis): not proficient here -> 10 + 3 = 13
    expect(passivePerception(statValues, abilities, 2)).toBe(13);
  });
});

describe("parseDamage", () => {
  it("parses dice + bonus + type", () => {
    expect(parseDamage("1d6+3 bludgeoning")).toEqual({
      number: 1,
      denomination: 6,
      bonus: "+3",
      flat: null,
      types: ["bludgeoning"],
    });
  });
  it("returns null for unparseable homebrew strings", () => {
    expect(parseDamage("special (see description)")).toBeNull();
  });
  it("parses the flat damage of an unarmed strike with no die", () => {
    // A character with no unarmed feature deals 1 + their ability modifier,
    // which carries no dice for the exporter to read.
    expect(parseDamage("1+2 bludgeoning")).toEqual({
      number: 0,
      denomination: 0,
      bonus: "+2",
      flat: 3,
      types: ["bludgeoning"],
    });
  });
  it("parses a flat damage string with no bonus", () => {
    expect(parseDamage("1 bludgeoning")).toEqual({
      number: 0,
      denomination: 0,
      bonus: "",
      flat: 1,
      types: ["bludgeoning"],
    });
  });
  it("keeps a die roll free of the flat total", () => {
    expect(parseDamage("1d6+3 bludgeoning").flat).toBeNull();
  });
});

describe("collectExportModel", () => {
  it("assembles the flat export model", async () => {
    const m = await model();
    expect(m.meta.name).toBe("Thorin Stoneheart");
    expect(m.meta.ruleset).toBe("2014");
    expect(m.identity.alignment).toBe("Lawful Good");
    expect(m.identity.deity).toBe("Moradin");
    expect(m.languages).toEqual(["Common", "Dwarvish"]);
    expect(m.combat.senses).toEqual(["Darkvision 60 ft."]);
    expect(m.combat.maxHp).toBe(24);
    expect(m.classes[0]).toMatchObject({
      name: "Cleric",
      level: 3,
      hitDie: "d8",
      subclass: "Life Domain",
    });
    expect(m.spellcasters[0].slots).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.features.map((f) => f.name)).toContain("Disciple of Life");
    expect(
      m.features.find((f) => f.name === "Disciple of Life").description,
    ).toContain("healing");
    expect(m.currency.gp).toBe(25);
  });
});

describe("Roll20 rules version guard", () => {
  it("rejects an explicitly 2024 character before creating a VTTES file", async () => {
    const revisedApi = {
      ...fakeApi,
      characters: {
        ...fakeApi.characters,
        get: async () => ({
          ...(await fakeApi.characters.get()),
          rulesetMode: "2024",
        }),
      },
    };

    await expect(
      exportRoll20("dwarf-cleric", { api: revisedApi }),
    ).rejects.toThrow("supports 2014 rules characters only");
  });
});

describe("buildFoundryActor", () => {
  it("produces a dnd5e character actor with final values", async () => {
    const actor = buildFoundryActor(await model());
    expect(actor.type).toBe("character");
    expect(actor.system.attributes.ac).toEqual({ flat: 18, calc: "flat" });
    expect(actor.system.attributes.hp).toMatchObject({ value: 24, max: 24 });
    expect(actor.system.abilities.wis.value).toBe(16);
    expect(actor.system.abilities.wis.proficient).toBe(1); // wis save proficient
    expect(actor.system.skills.his.value).toBe(2); // history expertise
    expect(actor.system.skills.med.value).toBe(1); // medicine proficient
    expect(actor.system.skills.arc.value).toBe(0); // arcana not proficient
    expect(actor.system.spells.spell1.value).toBe(4);
    expect(actor.system.spells.spell2.value).toBe(2);
    expect(actor.system.details.faith).toBe("Moradin");
    expect(actor.system.attributes.senses.darkvision).toBe(60);
  });

  it("embeds class, subclass, race, background, feats, gear, weapon and spell items with unique 16-char ids", async () => {
    const actor = buildFoundryActor(await model());
    const types = actor.items.map((i) => i.type);
    expect(types).toContain("class");
    expect(types).toContain("subclass");
    expect(types).toContain("race");
    expect(types).toContain("background");
    expect(types).toContain("feat");
    expect(types).toContain("weapon");
    expect(types).toContain("spell");
    for (const item of actor.items)
      expect(item._id).toMatch(/^[A-Za-z0-9]{16}$/);
    const ids = actor.items.map((i) => i._id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    const clazz = actor.items.find((i) => i.type === "class");
    expect(clazz.system).toMatchObject({ levels: 3, hitDice: "d8" });
  });

  it("is deterministic (stable ids) across runs", async () => {
    const a = buildFoundryActor(await model());
    const b = buildFoundryActor(await model());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildVttes", () => {
  it("produces schema_version 3 with a valid attribs array", async () => {
    const out = buildVttes(await model());
    expect(out.schema_version).toBe(3);
    expect(out.type).toBe("character");
    expect(out.character.name).toBe("Thorin Stoneheart");
    // Every attrib MUST carry all four fields or VTTES rejects the import.
    for (const a of out.character.attribs) {
      expect(a).toHaveProperty("name");
      expect(a).toHaveProperty("current");
      expect(a).toHaveProperty("max");
      expect(a).toHaveProperty("id");
      expect(typeof a.name).toBe("string");
    }
  });

  it("carries core attributes and repeating rows", async () => {
    const out = buildVttes(await model());
    const map = Object.fromEntries(
      out.character.attribs.map((a) => [a.name, a.current]),
    );
    expect(map.strength).toBe("14");
    expect(map.ac).toBe("18");
    expect(map.hp).toBe("24");
    expect(map.pb).toBe("2");
    expect(map.lvl1_slots_total).toBe("4");
    expect(map.wisdom_save_prof).toBe("(@{pb})");
    expect(map.history_prof).toBe("(@{pb}*2)"); // expertise
    // Repeating rows exist for inventory, attacks, spells, traits, proficiencies.
    const names = out.character.attribs.map((a) => a.name);
    expect(names.some((n) => /^repeating_inventory_.*_itemname$/.test(n))).toBe(
      true,
    );
    expect(names.some((n) => /^repeating_attack_.*_atkname$/.test(n))).toBe(
      true,
    );
    expect(names.some((n) => /^repeating_spell-1_.*_spellname$/.test(n))).toBe(
      true,
    );
    expect(
      names.some((n) => /^repeating_spell-cantrip_.*_spellname$/.test(n)),
    ).toBe(true);
    expect(names.some((n) => /^repeating_traits_.*_name$/.test(n))).toBe(true);
  });

  it("is deterministic across runs", async () => {
    const a = buildVttes(await model());
    const b = buildVttes(await model());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("foundry weapon items for unarmed strikes", () => {
  const itemsFor = (damage) =>
    buildItems({
      attacks: [{ name: "Unarmed Strike", range: "5 ft", bonus: "+4 vs AC", damage, description: "" }],
      items: [],
      features: [],
      proficiencies: [],
      spellcasters: [],
      classes: [],
      identity: { race: "", background: "" },
    }).filter((item) => item.type === "weapon");

  it("exports a monk's die as a rollable formula", () => {
    const [weapon] = itemsFor("1d6+4 bludgeoning");
    expect(weapon.system.damage.parts).toEqual([["1d6+4", "bludgeoning"]]);
    expect(weapon.system.damage.base).toEqual({
      number: 1,
      denomination: 6,
      types: ["bludgeoning"],
    });
  });

  it("exports a flat unarmed strike as its total rather than dropping the damage", () => {
    const [weapon] = itemsFor("1+2 bludgeoning");
    expect(weapon.system.damage.parts).toEqual([["3", "bludgeoning"]]);
    expect(weapon.system.damage.base).toBeUndefined();
  });
});
