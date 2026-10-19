/**
 * The compiler's output is read back with the real parser: every block type
 * must come out as the rule the engine reads, and a bad draft must be refused
 * with the field it is about.
 */

import { describe, expect, it } from "vitest";
import { parseElementsFile } from "../content/parser.js";
import { compileCustomElement, compileCustomPack } from "./compile.js";
import {
  CUSTOM_DRAFT_SCHEMA_VERSION,
  createCustomDraft,
  isCustomElementId,
  newCustomElementId,
  type CustomBlock,
  type CustomDraft,
} from "./schema.js";
import { customDraftIssues, readCustomDraft } from "./validate.js";

function draftWith(blocks: CustomBlock[], extra: Partial<CustomDraft> = {}): CustomDraft {
  return { ...createCustomDraft("boon", "Ember Ward"), id: "ID_CUSTOM_TEST0001", description: "A warm light.", blocks, ...extra };
}

function parse(draft: CustomDraft, source?: string) {
  const xml = compileCustomElement(draft, source === undefined ? {} : { source });
  const [element] = parseElementsFile(`<elements>${xml}</elements>`, "test.xml");
  return { xml, element: element! };
}

describe("ids and drafts", () => {
  it("generates ids that are stable-looking, unique and not derived from a name", () => {
    const first = newCustomElementId();
    expect(first).toMatch(/^ID_CUSTOM_[0-9A-F]{20}$/);
    expect(newCustomElementId()).not.toBe(first);
    expect(isCustomElementId(first)).toBe(true);
    expect(isCustomElementId("ID_PHB_FEAT_ALERT")).toBe(false);
    expect(createCustomDraft("feat", "Anything").id).not.toContain("ANYTHING");
  });

  it("reads a draft saved before versioning as version 1 and refuses a newer one", () => {
    const { schemaVersion: _omitted, ...unversioned } = draftWith([]);
    expect(readCustomDraft(unversioned).schemaVersion).toBe(CUSTOM_DRAFT_SCHEMA_VERSION);
    expect(() => readCustomDraft({ ...draftWith([]), schemaVersion: 2 })).toThrow(
      expect.objectContaining({ code: "invalid-argument", message: expect.stringContaining("newer version") }),
    );
  });
});

describe("element identity and presentation", () => {
  it("emits the element attributes, with the source the caller names", () => {
    const { element } = parse(draftWith([]), "Moonwell Campaign");
    expect(element.identity).toEqual({ id: "ID_CUSTOM_TEST0001", name: "Ember Ward", type: "Custom Feature", source: "Moonwell Campaign" });
    expect(parse(draftWith([])).element.identity.source).toBe("Custom");
  });

  it("maps where an entry shows to the element type", () => {
    const type = (showsUnder: CustomDraft["showsUnder"]) => parse(draftWith([], { showsUnder })).element.identity.type;
    expect(type("race")).toBe("Racial Trait");
    expect(type("class")).toBe("Class Feature");
    expect(type("feats")).toBe("Feat");
    expect(type("other")).toBe("Custom Feature");
  });

  it("escapes names and text, and splits paragraphs on blank lines", () => {
    const { element, xml } = parse(draftWith([], { name: 'Tom & "Jerry" <Ward>', description: "One & <two>.\n\nThree." }));
    expect(element.identity.name).toBe('Tom & "Jerry" <Ward>');
    expect(element.descriptionXml).toBe("<p>One &amp; &lt;two&gt;.</p><p>Three.</p>");
    expect(xml).not.toContain("<Ward>");
  });

  it("always emits a sheet block carrying the description unless hidden", () => {
    const { element } = parse(draftWith([]));
    expect(element.sheets).toHaveLength(1);
    expect(element.sheets[0]!.descriptions[0]!.text).toBe("A warm light.");
    expect(element.sheets[0]!.display).toBeUndefined();
  });

  it("writes the B6 presentation: title, action, usage, text and level tiers", () => {
    const { element } = parse(
      draftWith([], {
        sheet: {
          title: "Ember Ward (Boon)",
          action: "bonusAction",
          usage: "1/Long Rest",
          text: "Gain {{proficiency}} temporary hit points.",
          tiers: [{ level: 9, text: "Gain twice that." }, { level: 5, text: "Gain thrice that." }],
        },
      }),
    );
    const sheet = element.sheets[0]!;
    expect(sheet.alt).toBe("Ember Ward (Boon)");
    expect(sheet.action).toBe("Bonus Action");
    expect(sheet.usage).toBe("1/Long Rest");
    expect(sheet.descriptions.map((entry) => [entry.level, entry.text])).toEqual([
      [undefined, "Gain {{proficiency}} temporary hit points."],
      [5, "Gain thrice that."],
      [9, "Gain twice that."],
    ]);
  });

  it("hides the feature from the sheet", () => {
    expect(parse(draftWith([], { sheet: { show: false } })).element.sheets[0]!.display).toBe(false);
  });

  it("writes the action None as no action", () => {
    expect(parse(draftWith([], { sheet: { action: "none" } })).element.sheets[0]!.action).toBeUndefined();
  });

  it("writes tags as supports and the ruleset as a setter", () => {
    const { element } = parse(draftWith([], { template: "feat", showsUnder: "feats", tags: ["Epic Boon", "General"], ruleset: "2024" }));
    expect(element.supports).toEqual(["Epic Boon", "General"]);
    expect(element.setters).toContainEqual({ name: "ruleset", value: "2024" });
  });

  it("turns a requirements tree into the gating expression and a readable prerequisite", () => {
    const { element } = parse(
      draftWith([], {
        requirements: {
          kind: "group",
          op: "all",
          items: [{ kind: "ability", ability: "charisma", min: 13 }, { kind: "level", min: 4 }],
        },
      }),
    );
    expect(element.requirements).toBe("[cha:13],[level:4]");
    expect(element.prerequisite).toBe("Charisma 13 or higher; Character level 4 or higher");
  });
});

describe("modifier blocks (B1)", () => {
  const modifier = (extra: Partial<Extract<CustomBlock, { kind: "modifier" }>>): CustomBlock => ({
    kind: "modifier",
    id: "m1",
    target: "strength",
    mode: "add",
    value: { kind: "number", value: 1 },
    ...extra,
  });
  const stats = (block: CustomBlock) =>
    parse(draftWith([block])).element.rules.filter((rule) => rule.kind === "stat");

  it("adds a number to a target", () => {
    expect(stats(modifier({}))).toEqual([expect.objectContaining({ name: "strength", value: "1", bonus: undefined })]);
  });

  it("sets a base, which competes instead of stacking", () => {
    expect(stats(modifier({ target: "speed:fly", mode: "setBase", value: { kind: "number", value: 40 } }))).toEqual([
      expect.objectContaining({ name: "speed:fly", value: "40", bonus: "base" }),
    ]);
  });

  it("sets an ability score through its own set key", () => {
    expect(stats(modifier({ mode: "setBase", value: { kind: "number", value: 19 } }))).toEqual([
      expect.objectContaining({ name: "strength:score:set", value: "19", bonus: "base" }),
    ]);
  });

  it("puts a best-of modifier in its named bucket, or the target's default bucket", () => {
    expect(stats(modifier({ target: "ac:misc", mode: "bestOf", bucket: "ward", value: { kind: "number", value: 2 } }))[0]).toMatchObject({ bonus: "ward" });
    expect(stats(modifier({ target: "extra attack:count", mode: "bestOf", value: { kind: "number", value: 2 } }))[0]).toMatchObject({ bonus: "extra attack" });
  });

  it("raises an ability maximum", () => {
    expect(stats(modifier({ target: "strength:max", mode: "raiseMax", value: { kind: "number", value: 2 } }))[0]).toMatchObject({
      name: "strength:max",
      value: "2",
    });
  });

  it("takes a reference as the value, negated or capped", () => {
    expect(stats(modifier({ target: "initiative", value: { kind: "reference", ref: "wisdom:modifier" }, cap: { kind: "number", value: 3 } }))[0]).toMatchObject({
      value: "wisdom:modifier",
      maximum: "3",
    });
    expect(stats(modifier({ target: "hp", value: { kind: "reference", ref: "level", negate: true } }))[0]).toMatchObject({ value: "-level" });
    expect(stats(modifier({ target: "hp", value: { kind: "classLevel", className: "Druid" } }))[0]).toMatchObject({ value: "level:druid" });
  });

  it("writes every gate: level, equipment, requirements, a switch, and the label", () => {
    const [rule] = stats(
      modifier({
        target: "ac:misc",
        gates: {
          level: 5,
          equipped: [{ slot: "armor", value: "none" }, { slot: "shield", value: "any", negate: true }],
          requirements: { kind: "element", id: "ID_TEST_A" },
          switch: "Moonlit form",
        },
        label: "Ember Ward",
      }),
    );
    expect(rule).toMatchObject({
      level: 5,
      equipped: "[armor:none],![shield:any]",
      requirements: "ID_TEST_A",
      condition: "Moonlit form",
      alt: "Ember Ward",
    });
  });

  it("builds an armor class calculation from a base and ability modifiers", () => {
    const rules = stats(
      modifier({ target: "ac:calculation", mode: "setBase", value: { kind: "number", value: 10 }, addAbilities: ["dexterity", "wisdom"], gates: { equipped: [{ slot: "armor", value: "none" }] } }),
    );
    expect(rules.map((rule) => [rule.name, rule.value, rule.bonus])).toEqual([
      ["ac:custom m1", "10", undefined],
      ["ac:custom m1", "dexterity:modifier", undefined],
      ["ac:custom m1", "wisdom:modifier", undefined],
      ["ac:calculation", "ac:custom m1", "calculation"],
    ]);
    expect(rules.every((rule) => rule.kind === "stat" && rule.equipped === "[armor:none]")).toBe(true);
  });
});

describe("grant blocks (B2)", () => {
  const grants = (block: CustomBlock) => parse(draftWith([block])).element.rules.filter((rule) => rule.kind === "grant");

  it("grants by id", () => {
    expect(grants({ kind: "grant", id: "g1", target: { by: "id", type: "Language", id: "ID_TEST_LANGUAGE" } })).toEqual([
      expect.objectContaining({ type: "Language", id: "ID_TEST_LANGUAGE" }),
    ]);
  });

  it("grants by type and name, at a level, when requirements are met", () => {
    expect(
      grants({
        kind: "grant",
        id: "g1",
        target: { by: "name", type: "Proficiency", name: "Skill Proficiency (Stealth)" },
        level: 5,
        requirements: { kind: "level", min: 5 },
      }),
    ).toEqual([expect.objectContaining({ type: "Proficiency", name: "Skill Proficiency (Stealth)", level: 5, requirements: "[level:5]" })]);
  });

  it("writes a spell's caster, always-prepared flag, cast ability and free-cast usage", () => {
    const { element } = parse(
      draftWith([
        {
          kind: "grant",
          id: "g1",
          target: { by: "id", type: "Spell", id: "ID_TEST_SPELL" },
          spell: { caster: "Druid", prepared: true, castAbility: "wisdom", usage: "1/Long Rest" },
        },
      ]),
    );
    expect(element.rules[0]).toMatchObject({ kind: "grant", type: "Spell", spellcasting: "Druid", prepared: true });
    expect(element.setters).toContainEqual({ name: "spellcasting ability", value: "Wisdom" });
    expect(element.sheets[0]!.usage).toBe("1/Long Rest");
  });

  it("lets the sheet's own usage win over a spell's", () => {
    const { element } = parse(
      draftWith(
        [{ kind: "grant", id: "g1", target: { by: "id", type: "Spell", id: "ID_TEST_SPELL" }, spell: { usage: "1/Long Rest" } }],
        { sheet: { usage: "1/Short Rest" } },
      ),
    );
    expect(element.sheets[0]!.usage).toBe("1/Short Rest");
  });
});

describe("choice blocks (B3)", () => {
  const selects = (block: CustomBlock) => parse(draftWith([block])).element.rules.filter((rule) => rule.kind === "select");

  it("offers a typed, counted, level-gated choice", () => {
    expect(selects({ kind: "choice", id: "c1", type: "Language", name: "Tongue", count: 2, level: 3, optional: true })).toEqual([
      expect.objectContaining({ type: "Language", name: "Tongue", number: 2, level: 3, optional: true }),
    ]);
  });

  it("compiles a filter tree to the supports expression", () => {
    const [rule] = selects({
      kind: "choice",
      id: "c1",
      type: "Spell",
      name: "Ward spell",
      count: 1,
      supports: { kind: "group", op: "all", items: [{ kind: "tag", value: "Wizard" }, { kind: "level", value: 1 }] },
      castAbility: "intelligence",
      caster: "Wizard",
    });
    expect(rule).toMatchObject({ type: "Spell", supports: "Wizard,1", spellcasting: "Wizard" });
  });

  it("offers an inline list of items", () => {
    const [rule] = selects({ kind: "choice", id: "c1", type: "List", name: "Omen", count: 1, items: ["Crow", "Hare & Fox"] });
    expect(rule).toMatchObject({ type: "List", items: [{ id: "1", text: "Crow" }, { id: "2", text: "Hare & Fox" }] });
  });

  it("gates a choice on requirements", () => {
    const [rule] = selects({ kind: "choice", id: "c1", type: "Feat", name: "Gift", count: 1, requirements: { kind: "ability", ability: "wisdom", min: 13 } });
    expect(rule).toMatchObject({ requirements: "[wis:13]" });
  });
});

describe("a pack of drafts", () => {
  it("is one elements file the parser reads back in order", () => {
    const first = draftWith([], { id: "ID_CUSTOM_TEST0001", name: "One" });
    const second = draftWith([], { id: "ID_CUSTOM_TEST0002", name: "Two", showsUnder: "race" });
    const parsed = parseElementsFile(compileCustomPack([first, second], { source: "Moonwell Campaign" }), "pack.xml");
    expect(parsed.map((element) => [element.identity.id, element.identity.type, element.identity.source])).toEqual([
      ["ID_CUSTOM_TEST0001", "Custom Feature", "Moonwell Campaign"],
      ["ID_CUSTOM_TEST0002", "Racial Trait", "Moonwell Campaign"],
    ]);
  });
});

describe("invalid drafts", () => {
  const issuePaths = (draft: unknown) => customDraftIssues(draft).map((issue) => issue.path);

  it("name the exact field", () => {
    expect(issuePaths({ ...draftWith([]), name: " ", id: "nope" })).toEqual(["id", "name"]);
    expect(
      issuePaths(draftWith([{ kind: "modifier", id: "m1", target: "luck", mode: "add", value: { kind: "number", value: 1 } }])),
    ).toEqual(["blocks[0].target"]);
    expect(
      issuePaths(draftWith([{ kind: "modifier", id: "m1", target: "strength:max", mode: "add", value: { kind: "number", value: 1 } }])),
    ).toEqual(["blocks[0].mode"]);
    expect(
      issuePaths(draftWith([{ kind: "modifier", id: "m1", target: "strength", mode: "add", value: { kind: "number", value: 5000 } }])),
    ).toEqual(["blocks[0].value.value"]);
  });

  it("refuses a template that cannot show where asked", () => {
    expect(issuePaths({ ...draftWith([]), template: "feat", showsUnder: "race" })).toEqual(["showsUnder"]);
  });

  it("refuses shared block ids, mixed list and filter choices, and conflicting spell abilities", () => {
    const block = (id: string): CustomBlock => ({ kind: "choice", id, type: "Language", name: "Pick", count: 1 });
    expect(issuePaths(draftWith([block("a"), block("a")]))).toEqual(["blocks[1].id"]);
    expect(
      issuePaths(draftWith([{ kind: "choice", id: "c", type: "List", name: "Pick", count: 1, items: ["a"], supports: { kind: "tag", value: "x" } }])),
    ).toEqual(["blocks[0].items"]);
    expect(
      issuePaths(
        draftWith([
          { kind: "grant", id: "a", target: { by: "id", type: "Spell", id: "ID_TEST_A" }, spell: { castAbility: "wisdom" } },
          { kind: "grant", id: "b", target: { by: "id", type: "Spell", id: "ID_TEST_B" }, spell: { castAbility: "charisma" } },
        ]),
      ),
    ).toEqual(["blocks"]);
  });

  it("throws from compile with every issue in the details", () => {
    try {
      compileCustomElement({ ...draftWith([]), name: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid-argument", details: { issues: [{ path: "name" }] } });
    }
  });

  it("rejects a bucket named base, an always-prepared spell with no caster, and a tier written twice", () => {
    expect(
      issuePaths(draftWith([{ kind: "modifier", id: "m", target: "ac:misc", mode: "bestOf", bucket: "base", value: { kind: "number", value: 1 } }])),
    ).toEqual(["blocks[0].bucket"]);
    expect(
      issuePaths(draftWith([{ kind: "grant", id: "g", target: { by: "id", type: "Spell", id: "ID_TEST_A" }, spell: { prepared: true } }])),
    ).toEqual(["blocks[0].spell.caster"]);
    expect(issuePaths(draftWith([], { sheet: { tiers: [{ level: 5, text: "a" }, { level: 5, text: "b" }] } }))).toEqual(["sheet.tiers[1].level"]);
  });
});
