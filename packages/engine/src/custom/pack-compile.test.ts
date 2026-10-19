/**
 * The kinds of element only a pack can hold: reference entries (a language, a
 * weapon, an armor ...), additions to an element another file defines, and
 * replacements of one. Each compiles to ordinary content the library reads, so
 * the pickers, statistics and attack rows need no special case.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { parseAppendsFile, parseElementsFile } from "../content/parser.js";
import { computeStatistics } from "../statistics/calculator.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { compileCustomElement, compileCustomPack } from "./compile.js";
import {
  createCustomAppendDraft,
  createCustomCatalogDraft,
  createCustomOverrideDraft,
  newCustomBlockId,
  type CustomBlock,
  type CustomCatalogDraft,
} from "./schema.js";
import { customPackDraftIssues, readCustomPackDraft } from "./validate.js";
import { serializeElement } from "./element-xml.js";

const compile = (draft: CustomCatalogDraft) => {
  const [element] = parseElementsFile(`<elements>${compileCustomElement(draft, { source: "Test Pack" })}</elements>`, "x.xml");
  return element!;
};
const setter = (element: ReturnType<typeof compile>, name: string) => element.setters.find((entry) => entry.name === name);

describe("a language, proficiency, vision, condition, deity, option, alignment or weapon property", () => {
  it("compiles a language with its category tag and the setters the language list reads", () => {
    const draft = { ...createCustomCatalogDraft("language", "Tidecant"), description: "The speech of the tides.", tags: ["Exotic"], fields: { Speakers: "Selkies", Script: "Runes" } };
    const element = compile(draft);
    expect(element.identity).toEqual({ id: draft.id, name: "Tidecant", type: "Language", source: "Test Pack" });
    expect(element.supports).toEqual(["Exotic"]);
    expect(setter(element, "Speakers")?.value).toBe("Selkies");
    expect(setter(element, "Script")?.value).toBe("Runes");
    expect(element.descriptionXml).toContain("The speech of the tides.");
  });

  it("gives a language the Standard tag when the author names none", () => {
    expect(compile(createCustomCatalogDraft("language", "Plain")).supports).toEqual(["Standard"]);
  });

  it.each([
    ["proficiency", "Proficiency"],
    ["vision", "Vision"],
    ["condition", "Condition"],
    ["deity", "Deity"],
    ["option", "Option"],
    ["alignment", "Alignment"],
    ["weaponProperty", "Weapon Property"],
  ] as const)("compiles a %s to an element of type %s", (template, type) => {
    const element = compile({ ...createCustomCatalogDraft(template, "Moon Thing"), description: "Text." });
    expect(element.identity.type).toBe(type);
  });

  it("writes a deity's fields and an alignment's abbreviation as setters", () => {
    const deity = compile({ ...createCustomCatalogDraft("deity", "Selune"), fields: { setting: "Sword Coast", alignment: "CG", domains: "Life, Light", symbol: "A pale moon" } });
    expect(deity.setters.map((entry) => [entry.name, entry.value])).toEqual([
      ["setting", "Sword Coast"],
      ["alignment", "CG"],
      ["domains", "Life, Light"],
      ["symbol", "A pale moon"],
    ]);
    const alignment = compile({ ...createCustomCatalogDraft("alignment", "Lawful Weird"), fields: { Abbreviation: "LW" } });
    expect(setter(alignment, "Abbreviation")?.value).toBe("LW");
  });

  it("compiles a condition with the tag that makes it a resistance", () => {
    const element = compile({ ...createCustomCatalogDraft("condition", "Resistance (Sonic)"), tags: ["Resistance"] });
    expect(element.supports).toEqual(["Resistance"]);
  });

  it("carries rules a proficiency grants, like any other draft", () => {
    const block: CustomBlock = { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Proficiency", id: "ID_PROFICIENCY_SKILL_STEALTH" } };
    const element = compile({ ...createCustomCatalogDraft("proficiency", "Cloak Craft"), blocks: [block] });
    expect(element.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_PROFICIENCY_SKILL_STEALTH" }));
  });

  it("names the field when an entry is not valid", () => {
    const issues = customPackDraftIssues({ ...createCustomCatalogDraft("deity", "X"), fields: { speakers: "no" } });
    expect(issues).toContainEqual(expect.objectContaining({ path: "fields.speakers" }));
    expect(customPackDraftIssues({ ...createCustomCatalogDraft("baseWeapon", "X"), weapon: undefined })).toContainEqual(
      expect.objectContaining({ path: "weapon" }),
    );
    expect(customPackDraftIssues({ ...createCustomCatalogDraft("language", "X"), weapon: createCustomCatalogDraft("baseWeapon").weapon })).toContainEqual(
      expect.objectContaining({ path: "weapon" }),
    );
  });
});

describe("a weapon", () => {
  const sword = (extra: Partial<NonNullable<CustomCatalogDraft["weapon"]>> = {}): CustomCatalogDraft => ({
    ...createCustomCatalogDraft("baseWeapon", "Moon Blade"),
    weapon: { category: "martialMelee", damage: { dice: "1d8", type: "slashing" }, hands: "onehand", ...extra },
  });

  it("is tagged for its category, damage type and properties, with the proficiency the attack row reads", () => {
    const element = compile(sword({ versatile: "1d10", range: "5", properties: ["ID_INTERNAL_WEAPON_PROPERTY_FINESSE"], weight: 3, cost: { amount: 15, currency: "gp" } }));
    expect(element.identity.type).toBe("Weapon");
    expect(element.supports).toEqual([
      "ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE",
      "ID_INTERNAL_DAMAGE_TYPE_SLASHING",
      "ID_INTERNAL_WEAPON_PROPERTY_FINESSE",
      "ID_INTERNAL_WEAPON_PROPERTY_VERSATILE",
    ]);
    expect(setter(element, "category")?.value).toBe("Weapons");
    expect(setter(element, "damage")).toMatchObject({ value: "1d8", attrs: { type: "slashing" } });
    expect(setter(element, "versatile")?.value).toBe("1d10");
    expect(setter(element, "slot")?.value).toBe("onehand");
    expect(setter(element, "proficiency")?.value).toBe("ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_MELEE_WEAPONS");
    expect(setter(element, "cost")).toMatchObject({ value: "15", attrs: { currency: "gp" } });
    expect(setter(element, "weight")).toMatchObject({ value: "3 lb.", attrs: { lb: "3" } });
  });

  it("adds a 2024 mastery property to the weapon's tags", () => {
    expect(compile(sword({ mastery: "ID_WOTC_PHB24_WEAPON_PROPERTY_SAP" })).supports).toContain("ID_WOTC_PHB24_WEAPON_PROPERTY_SAP");
  });

  it("accepts a property the pack or a book defines, and refuses anything that is not an id", () => {
    expect(customPackDraftIssues(sword({ properties: ["ID_HB_MOON_PROPERTY_MISFIRE"] }))).toEqual([]);
    expect(customPackDraftIssues(sword({ properties: ["misfire"] }))).toContainEqual(expect.objectContaining({ path: "weapon.properties" }));
  });
});

describe("an armor and a shield", () => {
  const armor = (extra: Partial<NonNullable<CustomCatalogDraft["armor"]>> = {}): CustomCatalogDraft => ({
    ...createCustomCatalogDraft("baseArmor", "Moon Mail"),
    armor: { group: "medium", ac: 15, ...extra },
  });

  it("writes the group, the base value and the proficiency, with the strength penalty and stealth grant it asks for", () => {
    const element = compile(armor({ strength: 13, stealthDisadvantage: true }));
    expect(element.supports).toEqual(["ID_INTERNAL_ARMOR_GROUP_MEDIUM"]);
    expect(setter(element, "armor")?.value).toBe("Medium");
    expect(setter(element, "armorClass")?.value).toBe("15 + Dex modifier (max 2)");
    expect(setter(element, "slot")?.value).toBe("body");
    expect(setter(element, "stealth")?.value).toBe("Disadvantage");
    expect(setter(element, "proficiency")?.value).toBe("ID_PROFICIENCY_ARMOR_PROFICIENCY_MEDIUM_ARMOR");
    expect(element.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "ac:armored:armor", value: "15" }));
    expect(element.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE" }));
    expect(element.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "speed", value: "-10", bonus: "armor" }));
  });

  it("makes a shield held in a hand that adds its bonus", () => {
    const element = compile(armor({ group: "shield", ac: 3 }));
    expect(setter(element, "type")?.value).toBe("Shield");
    expect(setter(element, "slot")?.value).toBe("onehand,secondary");
    expect(element.rules).toContainEqual(expect.objectContaining({ kind: "stat", name: "ac:shield", value: "3", bonus: "shield" }));
  });
});

describe("against the shipped rules", () => {
  let baseFiles: ReadonlyMap<string, string>;
  beforeAll(async () => {
    baseFiles = (await sharedLibrary()).fileContents ?? new Map<string, string>();
  }, 120_000);

  const withPack = (drafts: CustomCatalogDraft[]): ElementLibrary => {
    const lib = createEmptyLibrary();
    replaceLibraryFiles(lib, new Map([...baseFiles, ["imports/pack-compile.xml", compileCustomPack(drafts, { source: "Test Pack" })]]));
    return lib;
  };

  it("sets AC from a medium armor's base, capped, and from a shield's bonus", () => {
    const mail = { ...createCustomCatalogDraft("baseArmor", "Moon Mail"), armor: { group: "medium" as const, ac: 15 } };
    const buckler = { ...createCustomCatalogDraft("baseArmor", "Moon Buckler"), armor: { group: "shield" as const, ac: 3 } };
    const lib = withPack([mail, buckler]);
    const { service, id } = buildFighter3(lib, "PackArmor");
    service.addItem(id, { itemId: mail.id, amount: 1, baseElementId: null });
    const record = (service.getInventory(id) as unknown as { items: Array<{ itemId: string; identifier: string; isEquipped: boolean }> }).items.find((item) => item.itemId === mail.id)!;
    if (!record.isEquipped) service.equipItem(id, record.identifier, "armor");
    // base 15 + dexterity (+2, capped at +2)
    expect(computeStatistics(service.getCharacter(id), lib).ac).toBe(17);
  });

  it("gives a weapon the proficiency bonus the fighter holds for its category", () => {
    const blade = { ...createCustomCatalogDraft("baseWeapon", "Moon Blade"), weapon: { category: "martialMelee" as const, damage: { dice: "1d8", type: "slashing" as const }, hands: "onehand" as const } };
    const lib = withPack([blade]);
    const { service, id } = buildFighter3(lib, "PackWeapon");
    service.addItem(id, { itemId: blade.id, amount: 1, baseElementId: null });
    const record = (service.getInventory(id) as unknown as { items: Array<{ itemId: string; identifier: string; isEquipped: boolean }> }).items.find((item) => item.itemId === blade.id)!;
    if (!record.isEquipped) service.equipItem(id, record.identifier, "primary");
    const attack = service.getAttacks(id).find((row) => row.name === "Moon Blade");
    // strength 15 (+2) plus proficiency (+2) for a level 3 fighter
    expect(attack!.bonus).toMatch(/^\+4/);
  });
});

describe("an addition to an element another file defines", () => {
  it("compiles to a top-level append that adds rules and tags", () => {
    const block: CustomBlock = { kind: "grant", id: newCustomBlockId(), target: { by: "id", type: "Spell", id: "ID_BOOK_SPELL_ONE" } };
    const draft = { ...createCustomAppendDraft("ID_BOOK_SPELL_FROST_LANCE", "Frost Lance", "Frost Lance on the Druid list"), tags: ["Druid"], blocks: [block] };
    const xml = compileCustomElement(draft, { source: "Test Pack" });
    expect(xml.trim().startsWith("<append")).toBe(true);
    const [append] = parseAppendsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(append).toMatchObject({ id: "ID_BOOK_SPELL_FROST_LANCE", supports: ["Druid"] });
    expect(append!.rules).toContainEqual(expect.objectContaining({ kind: "grant", id: "ID_BOOK_SPELL_ONE" }));
  });

  it("reaches the target: the class list tag lands on the spell", () => {
    const lib = createEmptyLibrary();
    const book = `<elements><element name="Frost Lance" type="Spell" source="Book" id="ID_BOOK_SPELL_FROST_LANCE"><supports>Wizard</supports><description><p>x</p></description></element></elements>`;
    const draft = { ...createCustomAppendDraft("ID_BOOK_SPELL_FROST_LANCE", "Frost Lance"), name: "On the Druid list", tags: ["Druid"] };
    replaceLibraryFiles(lib, new Map([["imports/book.xml", book], ["imports/pack.xml", compileCustomPack([draft], { source: "Test Pack" })]]));
    expect(lib.byId.get("ID_BOOK_SPELL_FROST_LANCE")!.supports).toEqual(["Wizard", "Druid"]);
    expect(lib.diagnostics?.filter((diagnostic) => diagnostic.kind === "append-target")).toEqual([]);
  });

  it("needs a target and something to add", () => {
    const empty = createCustomAppendDraft("ID_BOOK_SPELL_FROST_LANCE", "", "Nothing");
    expect(customPackDraftIssues(empty)).toContainEqual(expect.objectContaining({ path: "blocks" }));
    expect(customPackDraftIssues({ ...empty, targetId: "frost lance", tags: ["Druid"] })).toContainEqual(expect.objectContaining({ path: "targetId" }));
  });
});

describe("a replacement for a book element", () => {
  let book: ReturnType<typeof parseElementsFile>[number];
  beforeAll(async () => {
    const library = await sharedLibrary();
    book = (library.byType.get("Feat") ?? []).find((element) => element.rules.length > 0 && element.children.length === 0 && element.sheets.length === 0)!;
  }, 120_000);

  const draftFor = (extra: Partial<ReturnType<typeof createCustomOverrideDraft>> = {}) => ({
    ...createCustomOverrideDraft({ targetId: book.identity.id, targetType: book.identity.type, baseXml: serializeElement(book).xml!, reflavour: true }),
    ...extra,
  });

  it("keeps the original's id and rules and takes the new name and text", () => {
    const xml = compileCustomElement({ ...draftFor(), name: "House Feat", description: "A new telling." }, { source: "Test Pack" });
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(element!.identity).toEqual({ id: book.identity.id, name: "House Feat", type: book.identity.type, source: "Test Pack" });
    expect(element!.rulesXml).toEqual(book.rulesXml);
    expect(element!.descriptionXml).toContain("A new telling.");
  });

  it("keeps the original name and text when the author leaves them empty", () => {
    const xml = compileCustomElement(draftFor(), { source: "Test Pack" });
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(element!.identity.name).toBe(book.identity.name);
    expect(element!.descriptionXml?.trim()).toBe((book.descriptionXml ?? "").trim());
  });

  it("applies the pack's rules version over the original's", () => {
    const xml = compileCustomElement({ ...draftFor(), ruleset: "2024" }, { source: "Test Pack" });
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(element!.setters.filter((entry) => entry.name === "ruleset").map((entry) => entry.value)).toEqual(["2024"]);
  });

  it("refuses XML that is not the element it says it replaces", () => {
    expect(customPackDraftIssues(draftFor({ baseXml: "<element" }))).toContainEqual(expect.objectContaining({ path: "baseXml" }));
    expect(customPackDraftIssues(draftFor({ targetType: "Spell" }))).toContainEqual(expect.objectContaining({ path: "baseXml" }));
    expect(customPackDraftIssues(draftFor({ id: "ID_SOMETHING_ELSE" }))).toContainEqual(expect.objectContaining({ path: "baseXml" }));
  });
});

describe("reading a stored pack draft", () => {
  it("reads every kind and refuses an unknown template", () => {
    expect(readCustomPackDraft(createCustomCatalogDraft("language", "Tidecant")).template).toBe("language");
    expect(readCustomPackDraft({ ...createCustomAppendDraft("ID_X", "", "Adds"), tags: ["Druid"] }).template).toBe("append");
    expect(() => readCustomPackDraft({ template: "unknown" })).toThrow(expect.objectContaining({ code: "invalid-argument" }));
    try {
      readCustomPackDraft({ template: "unknown" });
    } catch (cause) {
      expect((cause as { details: { issues: Array<{ path: string }> } }).details.issues).toContainEqual(expect.objectContaining({ path: "template" }));
    }
  });
});

describe("the element a pack stores for a draft", () => {
  it("names the element type of every kind of draft, so the Homebrew list can group them", async () => {
    const { packElementType, promoteCustomDraft } = await import("./promote.js");
    expect(packElementType(createCustomCatalogDraft("language", "Tidecant"))).toBe("Language");
    expect(packElementType(createCustomCatalogDraft("weaponProperty", "Cursed"))).toBe("Weapon Property");
    expect(packElementType(createCustomAppendDraft("ID_PHB_SPELL_SHIELD", "Shield"))).toBe("Append");
    const promoted = promoteCustomDraft(createCustomCatalogDraft("language", "Tidecant"), "Tide Campaign");
    expect(promoted.element).toMatchObject({ type: "Language", name: "Tidecant", idLocked: true, id: promoted.id });
    expect(promoted.element.rawXml).toBe(promoted.xml);
    expect(promoted.element.customDraft).toMatchObject({ template: "language" });
  });
});
