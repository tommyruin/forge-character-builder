/**
 * Spell drafts compile to an ordinary Spell element: the setters every book
 * spell carries, class lists as `supports` tags, and the structured mechanics
 * as the `spell …` setters the attack rows read. A bad spell draft is refused
 * with the field it is about.
 */

import { describe, expect, it } from "vitest";
import { parseElementsFile } from "../content/parser.js";
import { compileCustomElement } from "./compile.js";
import { createCustomSpellDraft, type CustomSpellDraft } from "./schema.js";
import { customEntryIssues, customSpellDraftIssues, readCustomEntry } from "./validate.js";

function spell(extra: Partial<CustomSpellDraft> = {}): CustomSpellDraft {
  return {
    ...createCustomSpellDraft("Frost Lance"),
    id: "ID_CUSTOM_SPELLTEST01",
    description: "A lance of ice flies at a creature.",
    level: 1,
    school: "Evocation",
    castingTime: "1 action",
    range: "120 feet",
    duration: "Instantaneous",
    components: { verbal: true, somatic: true, material: true, materialText: "a sliver of ice" },
    classes: ["Wizard", "Sorcerer"],
    ...extra,
  };
}

function parse(draft: CustomSpellDraft) {
  const xml = compileCustomElement(draft);
  const [element] = parseElementsFile(`<elements>${xml}</elements>`, "test.xml");
  return { xml, element: element! };
}

const setterValue = (draft: CustomSpellDraft, name: string): string | undefined =>
  parse(draft).element.setters.find((entry) => entry.name === name)?.value;

describe("a spell draft", () => {
  it("compiles to a Spell element with the setters a book spell carries", () => {
    const { element } = parse(spell({ concentration: true, ritual: true }));
    expect(element.identity).toEqual({ id: "ID_CUSTOM_SPELLTEST01", name: "Frost Lance", type: "Spell", source: "Custom" });
    const value = (name: string) => element.setters.find((entry) => entry.name === name)?.value;
    expect(value("level")).toBe("1");
    expect(value("school")).toBe("Evocation");
    expect(value("time")).toBe("1 action");
    expect(value("range")).toBe("120 feet");
    expect(value("duration")).toBe("Instantaneous");
    expect(value("hasVerbalComponent")).toBe("true");
    expect(value("hasSomaticComponent")).toBe("true");
    expect(value("hasMaterialComponent")).toBe("true");
    expect(value("materialComponent")).toBe("a sliver of ice");
    expect(value("isConcentration")).toBe("true");
    expect(value("isRitual")).toBe("true");
  });

  it("puts the class lists in supports so the classes' lists and pickers offer it", () => {
    expect(parse(spell()).element.supports).toEqual(["Wizard", "Sorcerer"]);
  });

  it("marks attack and save spells with the tags book spells carry", () => {
    const ranged = parse(spell({ mechanics: { roll: "attackRanged", damage: [{ dice: "2d8", type: "cold" }] } }));
    expect(ranged.element.supports).toEqual(["Wizard", "Sorcerer", "Spell Attack", "Ranged"]);
    const melee = parse(spell({ mechanics: { roll: "attackMelee" } }));
    expect(melee.element.supports).toContain("Melee");
    const save = parse(spell({ mechanics: { roll: "save", saveAbility: "wisdom", damage: [{ dice: "3d6", type: "fire" }] } }));
    expect(save.element.supports).toContain("Spell Saving Throw");
    const healing = parse(spell({ mechanics: { roll: "none", healing: "2d8" } }));
    expect(healing.element.supports).toContain("Healing Spell");
  });

  it("writes the structured mechanics as setters", () => {
    const { element } = parse(
      spell({
        level: 0,
        mechanics: {
          roll: "save",
          saveAbility: "dexterity",
          halfOnSave: true,
          damage: [{ dice: "1d8", type: "radiant" }, { dice: "1d4", type: "fire" }],
          addsModifier: true,
          scaling: { kind: "cantrip", tiers: [{ level: 5, dice: "2d8" }, { level: 11, dice: "3d8" }] },
        },
      }),
    );
    const all = (name: string) => element.setters.filter((entry) => entry.name === name);
    expect(all("spell roll").map((entry) => entry.value)).toEqual(["saving throw"]);
    expect(all("spell save").map((entry) => entry.value)).toEqual(["Dexterity"]);
    expect(all("spell save success").map((entry) => entry.value)).toEqual(["half"]);
    expect(all("spell damage").map((entry) => [entry.value, entry.attrs?.type])).toEqual([
      ["1d8", "radiant"],
      ["1d4", "fire"],
    ]);
    expect(all("spell modifier").map((entry) => entry.value)).toEqual(["true"]);
    expect(all("spell cantrip scaling").map((entry) => [entry.value, entry.attrs?.level])).toEqual([
      ["2d8", "5"],
      ["3d8", "11"],
    ]);
  });

  it("writes slot scaling, healing and the roll words for each roll kind", () => {
    const upcast = spell({ mechanics: { roll: "attackRanged", damage: [{ dice: "3d6", type: "force" }], scaling: { kind: "slot", dice: "1d6" } } });
    expect(setterValue(upcast, "spell slot scaling")).toBe("1d6");
    expect(setterValue(upcast, "spell roll")).toBe("ranged attack");
    expect(setterValue(spell({ mechanics: { roll: "attackMelee" } }), "spell roll")).toBe("melee attack");
    expect(setterValue(spell({ mechanics: { roll: "none", healing: "2d8" } }), "spell healing")).toBe("2d8");
    expect(setterValue(spell({ mechanics: { roll: "none" } }), "spell roll")).toBe("none");
  });

  it("states no roll at all when the draft carries no mechanics, leaving the text to be read", () => {
    const { element } = parse(spell({ mechanics: undefined }));
    expect(element.setters.map((entry) => entry.name)).not.toContain("spell roll");
  });

  it("keeps the text, with the higher-level text as its own paragraph", () => {
    const { element } = parse(spell({ description: "First.\n\nSecond.", higherLevels: "The damage increases by 1d6." }));
    const text = element.descriptionXml ?? "";
    expect(text).toContain("<p>First.</p>");
    expect(text).toContain("<p>Second.</p>");
    expect(text).toContain("At Higher Levels.");
    expect(text).toContain("The damage increases by 1d6.");
  });

  it("escapes text that would break the XML", () => {
    const { xml, element } = parse(spell({ name: "Fire & <Ice>", description: "a < b & c" }));
    expect(xml).toContain("Fire &amp; &lt;Ice&gt;");
    expect(element.identity.name).toBe("Fire & <Ice>");
  });

  it("carries the ruleset and a different source name when promoted", () => {
    const xml = compileCustomElement(spell({ ruleset: "2024" }), { source: "Moonwell Campaign" });
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "test.xml");
    expect(element!.identity.source).toBe("Moonwell Campaign");
    expect(element!.setters.find((entry) => entry.name === "ruleset")?.value).toBe("2024");
  });

  it("omits the material text when there is no material component", () => {
    const { element } = parse(spell({ components: { verbal: true } }));
    expect(element.setters.find((entry) => entry.name === "hasMaterialComponent")?.value).toBe("false");
    expect(element.setters.find((entry) => entry.name === "hasSomaticComponent")?.value).toBe("false");
  });
});

describe("a bad spell draft", () => {
  const field = (draft: unknown): string[] => customSpellDraftIssues(draft).map((issue) => issue.path);

  it("is valid when it is complete", () => {
    expect(customEntryIssues(spell({ mechanics: { roll: "attackRanged", damage: [{ dice: "2d8", type: "cold" }] } }))).toEqual([]);
  });

  it("names the field of each problem", () => {
    expect(field({ ...spell(), name: "" })).toContain("name");
    expect(field({ ...spell(), level: 10 })).toContain("level");
    expect(field({ ...spell(), level: 1.5 })).toContain("level");
    expect(field({ ...spell(), school: "Pyromancy" })).toContain("school");
    expect(field({ ...spell(), castingTime: "" })).toContain("castingTime");
    expect(field({ ...spell(), range: "" })).toContain("range");
    expect(field({ ...spell(), duration: "" })).toContain("duration");
    expect(field({ ...spell(), classes: ["Wiz,ard"] })).toContain("classes");
    expect(field({ ...spell(), components: { material: true, materialText: "x".repeat(300) } })).toContain("components.materialText");
  });

  it("refuses mechanics that contradict each other", () => {
    const bad = (mechanics: unknown) => field({ ...spell(), mechanics });
    expect(bad({ roll: "save" })).toContain("mechanics.saveAbility");
    expect(bad({ roll: "attackRanged", saveAbility: "wisdom" })).toContain("mechanics.saveAbility");
    expect(bad({ roll: "attackRanged", halfOnSave: true })).toContain("mechanics.halfOnSave");
    expect(bad({ roll: "fling" })).toContain("mechanics.roll");
    expect(bad({ roll: "none", damage: [{ dice: "d6", type: "fire" }] })).toContain("mechanics.damage[0].dice");
    expect(bad({ roll: "none", damage: [{ dice: "1d6", type: "mauve" }] })).toContain("mechanics.damage[0].type");
    expect(bad({ roll: "none", healing: "lots" })).toContain("mechanics.healing");
    expect(bad({ roll: "none", damage: Array.from({ length: 5 }, () => ({ dice: "1d4", type: "fire" })) })).toContain("mechanics.damage");
  });

  it("only lets a cantrip scale by character level and a levelled spell by slot", () => {
    const damage = [{ dice: "1d10", type: "fire" }];
    const tiers = { kind: "cantrip", tiers: [{ level: 5, dice: "2d10" }] };
    expect(field({ ...spell({ level: 1 }), mechanics: { roll: "attackRanged", damage, scaling: tiers } })).toContain("mechanics.scaling");
    expect(field({ ...spell({ level: 0 }), mechanics: { roll: "attackRanged", damage, scaling: tiers } })).toEqual([]);
    const slot = { kind: "slot", dice: "1d6" };
    expect(field({ ...spell({ level: 0 }), mechanics: { roll: "attackRanged", damage, scaling: slot } })).toContain("mechanics.scaling");
    expect(field({ ...spell({ level: 2 }), mechanics: { roll: "attackRanged", damage, scaling: slot } })).toEqual([]);
  });

  it("needs damage for scaling to raise, and distinct tier levels", () => {
    const base = spell({ level: 0 });
    expect(field({ ...base, mechanics: { roll: "attackRanged", scaling: { kind: "cantrip", tiers: [{ level: 5, dice: "2d10" }] } } })).toContain("mechanics.scaling");
    const damage = [{ dice: "1d10", type: "fire" }];
    expect(
      field({ ...base, mechanics: { roll: "attackRanged", damage, scaling: { kind: "cantrip", tiers: [{ level: 5, dice: "2d10" }, { level: 5, dice: "3d10" }] } } }),
    ).toContain("mechanics.scaling.tiers[1].level");
    expect(
      field({ ...base, mechanics: { roll: "attackRanged", damage, scaling: { kind: "cantrip", tiers: [{ level: 25, dice: "2d10" }] } } }),
    ).toContain("mechanics.scaling.tiers[0].level");
  });

  it("is refused by the compiler and the reader with the first problem", () => {
    expect(() => compileCustomElement({ ...spell(), level: 12 })).toThrow(/level/);
    expect(() => readCustomEntry({ ...spell(), school: "Pyromancy" })).toThrow(/school/);
  });

  it("reads a stored spell by its template, and a newer schema is refused", () => {
    expect(readCustomEntry(spell()).template).toBe("spell");
    expect(() => readCustomEntry({ ...spell(), schemaVersion: 9 })).toThrow(/newer version/);
  });
});
