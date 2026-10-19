/**
 * Item drafts compile to the setters and rules the engine already reads for
 * book items, and a bad item draft is refused with the field it is about.
 */

import { describe, expect, it } from "vitest";
import { parseElementsFile } from "../content/parser.js";
import { compileCustomElement } from "./compile.js";
import {
  createCustomItemDraft,
  newCustomBlockId,
  type CustomBlock,
  type CustomItemDraft,
  type CustomItemTemplate,
} from "./schema.js";
import { customEntryIssues, customItemDraftIssues, readCustomEntry } from "./validate.js";

const LONGSWORD = { id: "ID_WOTC_PHB_WEAPON_LONGSWORD", name: "Longsword" };

function item(template: CustomItemTemplate, extra: Partial<CustomItemDraft> = {}): CustomItemDraft {
  return {
    ...createCustomItemDraft(template, "Frostbite"),
    id: "ID_CUSTOM_ITEMTEST01",
    description: "Rime gathers on the edge.",
    ...(template === "weapon" ? { base: LONGSWORD } : {}),
    ...(template === "armor" ? { base: { id: "ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL", name: "Scale Mail" } } : {}),
    ...(template === "worn" ? { slot: "neck" as const } : {}),
    ...extra,
  };
}

function parse(draft: CustomItemDraft) {
  const xml = compileCustomElement(draft);
  const [element] = parseElementsFile(`<elements>${xml}</elements>`, "test.xml");
  return { xml, element: element! };
}

const setters = (draft: CustomItemDraft, name: string) =>
  parse(draft).element.setters.filter((entry) => entry.name === name);

describe("a weapon item", () => {
  it("is a Magic Item over the base, with the bonus, extra dice and ability as setters", () => {
    const { element } = parse(
      item("weapon", {
        bonus: 1,
        rarity: "Rare",
        attunement: true,
        weapon: {
          extraDamage: [{ dice: "1d6", type: "cold" }, { dice: "1d4", type: "fire" }],
          attackAbility: "intelligence",
          damage: { dice: "1d10", type: "slashing" },
          versatile: "1d12",
          range: "20/60",
          properties: ["ID_INTERNAL_WEAPON_PROPERTY_FINESSE", "ID_INTERNAL_WEAPON_PROPERTY_THROWN"],
        },
      }),
    );
    expect(element.identity).toEqual({ id: "ID_CUSTOM_ITEMTEST01", name: "Frostbite", type: "Magic Item", source: "Custom" });
    const value = (name: string) => element.setters.find((entry) => entry.name === name);
    expect(value("category")?.value).toBe("Magic Weapons");
    expect(value("weapon")?.value).toBe(LONGSWORD.id);
    expect(value("type")).toMatchObject({ value: "Weapon", attrs: { addition: "Longsword" } });
    expect(value("enhancement")?.value).toBe("1");
    expect(value("attunement")?.value).toBe("true");
    expect(value("rarity")?.value).toBe("Rare");
    expect(element.setters.filter((entry) => entry.name === "extra damage").map((entry) => [entry.value, entry.attrs?.type])).toEqual([
      ["1d6", "cold"],
      ["1d4", "fire"],
    ]);
    expect(value("attack ability")?.value).toBe("Intelligence");
    expect(value("damage")).toMatchObject({ value: "1d10", attrs: { type: "slashing" } });
    expect(value("versatile")?.value).toBe("1d12");
    expect(value("range")?.value).toBe("20/60");
    expect(value("weapon properties")?.value).toBe("ID_INTERNAL_WEAPON_PROPERTY_FINESSE, ID_INTERNAL_WEAPON_PROPERTY_THROWN");
  });

  it("writes nothing for a bonus of zero or an attunement that is off", () => {
    const { element } = parse(item("weapon", { bonus: 0, attunement: false }));
    expect(element.setters.map((entry) => entry.name)).not.toContain("enhancement");
    expect(element.setters.map((entry) => entry.name)).not.toContain("attunement");
  });

  it("carries the blocks as rules and the spell ability as a setter", () => {
    const blocks: CustomBlock[] = [
      { kind: "modifier", id: newCustomBlockId(), target: "spellcasting:attack", mode: "add", value: { kind: "number", value: 1 } },
      { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Condition", id: "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_COLD" } },
      {
        kind: "grant",
        id: newCustomBlockId(),
        target: { by: "id", type: "Spell", id: "ID_PHB_SPELL_RAY_OF_FROST" },
        spell: { castAbility: "wisdom" },
      },
    ];
    const { element } = parse(item("weapon", { blocks }));
    expect(element.rules.map((rule) => rule.kind)).toEqual(["stat", "grant", "grant"]);
    expect(setters(item("weapon", { blocks }), "spellcasting ability")[0]?.value).toBe("Wisdom");
  });

  it("round-trips through the entry reader", () => {
    const draft = item("weapon", { bonus: 2, weapon: { attackAbility: "dexterity" } });
    expect(readCustomEntry(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    const { schemaVersion: _version, ...unversioned } = draft;
    expect(readCustomEntry(unversioned)).toEqual(draft);
  });
});

describe("an armor item", () => {
  it("adds its bonus to the armored total with the corpus's enhancement bucket", () => {
    const { element } = parse(item("armor", { bonus: 2 }));
    expect(element.rules).toEqual([expect.objectContaining({ kind: "stat", name: "ac:armored:enhancement", value: "2", bonus: "enhancement" })]);
    expect(element.setters.find((entry) => entry.name === "armor")?.value).toBe("ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL");
    expect(element.setters.find((entry) => entry.name === "slot")?.value).toBe("body");
  });

  it("adds a shield's bonus to the shield and gives it no body slot", () => {
    const draft = item("armor", { bonus: 1, base: { id: "ID_WOTC_GEAR_SHIELD", name: "Shield", shield: true } });
    const { element } = parse(draft);
    expect(element.rules).toEqual([expect.objectContaining({ name: "ac:shield", bonus: "enhancement" })]);
    expect(element.setters.map((entry) => entry.name)).not.toContain("slot");
  });
});

describe("a worn item", () => {
  it("is a Magic Item with a slot, a rarity and its effects as rules", () => {
    const blocks: CustomBlock[] = [
      { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Racial Trait", id: "ID_CUSTOM_ABCDEF0123456789ABCD" } },
    ];
    const { element } = parse(item("worn", { rarity: "Uncommon", attunement: true, slot: "ring", blocks, uses: "3 charges; regains all at dawn" }));
    expect(element.identity.type).toBe("Magic Item");
    expect(element.setters.find((entry) => entry.name === "slot")?.value).toBe("ring");
    expect(element.setters.find((entry) => entry.name === "category")?.value).toBe("Rings");
    expect(element.rules).toHaveLength(1);
    expect(element.descriptionXml).toContain("Uses: 3 charges; regains all at dawn");
  });

  it("files a non-ring slot under Wondrous Items", () => {
    expect(setters(item("worn", { slot: "head" }), "category")[0]?.value).toBe("Wondrous Items");
  });
});

describe("plain gear", () => {
  it("is an Item with a weight, a cost and a stack flag, and no rules", () => {
    const { element } = parse(item("gear", { name: "Signal Whistle", weight: 0.25, cost: { amount: 5, currency: "sp" }, stackable: true }));
    expect(element.identity.type).toBe("Item");
    expect(element.rules).toEqual([]);
    expect(element.setters.find((entry) => entry.name === "category")?.value).toBe("Adventuring Gear");
    expect(element.setters.find((entry) => entry.name === "weight")).toMatchObject({ value: "0.25 lb.", attrs: { lb: "0.25" } });
    expect(element.setters.find((entry) => entry.name === "cost")).toMatchObject({ value: "5", attrs: { currency: "sp" } });
    expect(element.setters.find((entry) => entry.name === "stackable")?.value).toBe("true");
  });
});

describe("item validation", () => {
  const paths = (draft: unknown) => customItemDraftIssues(draft).map((issue) => issue.path);

  it("accepts a complete draft of every template", () => {
    for (const template of ["weapon", "armor", "worn", "gear"] as const) {
      expect(customItemDraftIssues(item(template))).toEqual([]);
    }
  });

  it("names the field of each problem", () => {
    expect(paths({ ...item("weapon"), base: undefined })).toEqual(["base"]);
    expect(paths({ ...item("weapon"), name: " " })).toEqual(["name"]);
    expect(paths({ ...item("weapon"), bonus: 11 })).toEqual(["bonus"]);
    expect(paths({ ...item("weapon"), weapon: { extraDamage: [{ dice: "lots", type: "cold" }] } })).toEqual(["weapon.extraDamage[0].dice"]);
    expect(paths({ ...item("weapon"), weapon: { extraDamage: [{ dice: "1d6", type: "sparkles" }] } })).toEqual(["weapon.extraDamage[0].type"]);
    expect(paths({ ...item("weapon"), weapon: { attackAbility: "luck" } })).toEqual(["weapon.attackAbility"]);
    expect(paths({ ...item("weapon"), weapon: { range: "far" } })).toEqual(["weapon.range"]);
    expect(paths({ ...item("weapon"), weapon: { properties: ["ID_INTERNAL_WEAPON_PROPERTY_SILVERED"] } })).toEqual(["weapon.properties"]);
    expect(paths({ ...item("worn"), slot: undefined })).toEqual(["slot"]);
    expect(paths({ ...item("worn"), slot: "wrist" })).toEqual(["slot"]);
    expect(paths({ ...item("weapon"), rarity: "Mythic" })).toEqual(["rarity"]);
  });

  it("keeps each field to the templates it belongs to", () => {
    expect(paths({ ...item("worn"), base: LONGSWORD })).toEqual(["base"]);
    expect(paths({ ...item("worn"), bonus: 1 })).toEqual(["bonus"]);
    expect(paths({ ...item("armor"), weapon: { attackAbility: "dexterity" } })).toEqual(["weapon"]);
    expect(paths({ ...item("gear"), attunement: true })).toEqual(["attunement"]);
    expect(paths({ ...item("gear"), rarity: "Rare" })).toEqual(["rarity"]);
    expect(paths({ ...item("weapon"), stackable: true })).toEqual(["stackable"]);
    expect(paths({ ...item("weapon"), weight: 3 })).toEqual(["weight"]);
    expect(paths({ ...item("gear"), blocks: [{ kind: "modifier", id: "m1", target: "ac:misc", mode: "add", value: { kind: "number", value: 1 } }] })).toEqual(["blocks"]);
  });

  it("validates the blocks the way a feature does", () => {
    const issues = customItemDraftIssues({
      ...item("worn"),
      blocks: [{ kind: "modifier", id: "m1", target: "nonsense", mode: "add", value: { kind: "number", value: 1 } }],
    });
    expect(issues.map((issue) => issue.path)).toEqual(["blocks[0].target"]);
  });

  it("does not let an item offer a choice", () => {
    const choice: CustomBlock = { kind: "choice", id: "c1", type: "Language", name: "Tongue", count: 1 };
    expect(paths({ ...item("worn"), blocks: [choice] })).toEqual(["blocks[0]"]);
  });

  it("refuses to compile a bad draft and names the field", () => {
    expect(() => compileCustomElement({ ...item("weapon"), bonus: 11 })).toThrow(expect.objectContaining({ code: "invalid-argument", message: expect.stringContaining("bonus") }));
  });

  it("dispatches on the template", () => {
    expect(customEntryIssues(item("weapon"))).toEqual([]);
    expect(customEntryIssues({ ...item("weapon"), template: "boon" }).length).toBeGreaterThan(0);
  });

  it("refuses a newer schema", () => {
    expect(() => readCustomEntry({ ...item("gear"), schemaVersion: 2 })).toThrow(expect.objectContaining({ message: expect.stringContaining("newer version") }));
  });
});
