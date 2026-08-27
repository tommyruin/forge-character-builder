import { describe, expect, it } from "vitest";
import { SAMPLE_CASTER, SAMPLE_CHARACTER } from "../testing/dnd5e-samples.js";
import {
  parseDnd5e,
  child,
  childElements,
  getAttr,
  textContent,
  comments,
  type Dnd5eNode,
} from "./document.js";

const TST = "minimal";
const MEEPO = "caster";

const SAMPLES: Record<string, string> = { [TST]: SAMPLE_CHARACTER, [MEEPO]: SAMPLE_CASTER };
const FIXTURES = Object.keys(SAMPLES);

const readFixture = (name: string): string => SAMPLES[name]!;

describe("dnd5e document model", () => {
  it("round-trips every sample document byte-identically", () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    for (const file of FIXTURES) {
      const raw = readFixture(file);
      const doc = parseDnd5e(raw);
      expect(doc.serialize(), file).toBe(raw);
    }
  }, 120_000);

  it("preserves the UTF-8 BOM and exact EOF bytes for every sample", () => {
    for (const file of FIXTURES) {
      const raw = readFixture(file);
      const doc = parseDnd5e(raw);
      expect(doc.raw.charCodeAt(0), file).toBe(0xfeff);
      expect(doc.serialize(), file).toHaveLength(raw.length);
      expect(doc.raw.endsWith("\n"), file).toBe(false);
    }
  }, 120_000);

  it("preserves CRLF line endings and tab indentation", () => {
    const raw = readFixture(TST);
    expect(raw).toContain("\r\n");
    expect(raw.replaceAll("\r\n", "").includes("\n")).toBe(false);
    const doc = parseDnd5e(raw);
    expect(doc.raw).toContain("\t<build>");
    expect(doc.serialize()).toBe(raw);
  });

  it("preserves node-specific empty forms (self-closing vs paired)", () => {
    const doc = parseDnd5e(readFixture(TST));
    const build = child(doc.root.node, "build")!;
    const magic = child(build, "magic")!;
    expect(magic.selfClosing).toBe(true);
    expect(magic.raw).toBe("<magic />");

    const information = child(doc.root.node, "information")!;
    const group = child(information, "group")!;
    expect(group.selfClosing).toBe(false);
    expect(group.raw).toBe("<group>\r\n\t\t</group>");
    expect(textContent(group)).toBe("");

    const base64 = child(doc.root.node, "display-properties")!
      .children.find((c) => c.name === "portrait")!;
    const cdataNode = child(base64, "base64")!;
    expect(cdataNode.selfClosing).toBe(false);
    expect(cdataNode.raw).toContain("<![CDATA[]]>");
  });

  it("preserves attribute order on the Race wrapper", () => {
    const doc = parseDnd5e(readFixture(TST));
    const elements = child(doc.root.node, "build")!.children.find((c) => c.name === "elements")!;
    const level = childElements(elements, "element")[0]!;
    const race = childElements(level, "element")[0]!;
    expect(race.attrs.map(([n]) => n)).toEqual(["type", "name", "requiredLevel", "checksum", "registered"]);
    expect(getAttr(race, "registered")).toBe("ID_RACE_GNOME");
  });

  it("preserves attribute order on spell nodes", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const magic = doc.root.build.magic!;
    const spellcasting = child(magic, "spellcasting")!;
    const spells = child(spellcasting, "spells")!;
    const prepared = childElements(spells, "spell")[0]!;
    expect(prepared.attrs.map(([n]) => n)).toEqual(["name", "level", "id", "prepared"]);
    const known = childElements(spells, "spell")[4]!;
    expect(known.attrs.map(([n]) => n)).toEqual(["name", "level", "id", "prepared", "always-prepared", "known"]);
    expect(known.raw).toContain('prepared="true" always-prepared="true" known="true"');
  });

  it("exposes item identifiers as GUIDs", () => {
    const doc = parseDnd5e(readFixture(TST));
    const equipment = child(doc.root.node, "build")!.children.find((c) => c.name === "equipment")!;
    const item = childElements(equipment, "item")[0]!;
    expect(getAttr(item, "identifier")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("exposes root attributes version and preview", () => {
    const doc = parseDnd5e(readFixture(TST));
    expect(doc.root.version).toBe("1.0.3");
    expect(doc.root.preview).toBe("false");
  });

  it("exposes information section values", () => {
    const doc = parseDnd5e(readFixture(TST));
    expect(doc.root.information.group()).toBe("");
    expect(doc.root.information.generationOption()).toBe("1");
  });

  it("exposes display-properties values", () => {
    const doc = parseDnd5e(readFixture(TST));
    const dp = doc.root.displayProperties;
    expect(dp.name()).toBe("tst");
    expect(dp.race()).toBe("Rock Gnome");
    expect(dp.class()).toBe("");
    expect(dp.archetype()).toBe("");
    expect(dp.background()).toBe("");
    expect(dp.level()).toBe("1");
    expect(dp.portrait()?.local()).toBe("C:\\Portraits\\default-portrait.png");
    expect(dp.portrait()?.companion()).toBe("");
    expect(dp.portrait()?.base64()).toBe("");
  });

  it("exposes build/input values", () => {
    const doc = parseDnd5e(readFixture(TST));
    const input = doc.root.build.input!;
    expect(input.name()).toBe("tst");
    expect(input.gender()).toBe("Male");
    expect(input.playerName()).toBe("Player One");
    expect(input.experience()).toBe("0");
    expect(input.backstory()).toBe("");
    expect(input.backgroundTrinket()).toBe("");
    expect(input.backgroundTraits()).toBe("");
    expect(input.backgroundIdeals()).toBe("");
    expect(input.backgroundBonds()).toBe("");
    expect(input.backgroundFlaws()).toBe("");
    expect(input.backgroundFeature()?.name()).toBe("");
    expect(input.backgroundFeature()?.description()).toBe("");
    expect(input.organization()?.name()).toBe("");
    expect(input.organization()?.symbol()).toBe("");
    expect(input.organization()?.allies()).toBe("");
    expect(input.additionalFeatures()).toBe("");
    expect(input.quest()).toBe("");

    const currency = input.currency()!;
    expect(currency.copper()).toBe("0");
    expect(currency.silver()).toBe("0");
    expect(currency.electrum()).toBe("0");
    expect(currency.gold()).toBe("0");
    expect(currency.platinum()).toBe("0");
    expect(currency.equipment()).toBe("");
    expect(currency.treasure()).toBe("");

    const notes = input.notes()!;
    expect(notes.notes().map((n) => n.column)).toEqual(["left", "right"]);
  });

  it("exposes build/appearance values", () => {
    const doc = parseDnd5e(readFixture(TST));
    const appearance = doc.root.build.appearance!;
    expect(appearance.portrait()).toBe("C:\\Portraits\\default-portrait.png");
    expect(appearance.age()).toBe("");
    expect(appearance.height()).toBe('2\'11"');
    expect(appearance.weight()).toBe("35 lb.");
    expect(appearance.eyes()).toBe("");
    expect(appearance.skin()).toBe("");
    expect(appearance.hair()).toBe("");
  });

  it("exposes abilities with available-points and six scores", () => {
    const doc = parseDnd5e(readFixture(TST));
    const abilities = doc.root.build.abilities!;
    expect(abilities.availablePoints()).toBe("15");
    const scores = abilities.scores();
    expect(scores.strength).toBe("10");
    expect(scores.dexterity).toBe("10");
    expect(scores.constitution).toBe("10");
    expect(scores.intelligence).toBe("10");
    expect(scores.wisdom).toBe("10");
    expect(scores.charisma).toBe("10");
  });

  it("exposes the elements tree with level-count and registered-count", () => {
    const doc = parseDnd5e(readFixture(TST));
    const elements = doc.root.build.elements!;
    expect(elements.levelCount()).toBe(1);
    expect(elements.registeredCount()).toBe(3);

    const level = elements.elements()[0]!;
    expect(level.attrs.map(([n]) => n)).toEqual(["type", "name", "id"]);
    expect(getAttr(level, "type")).toBe("Level");

    const race = childElements(level, "element")[0]!;
    expect(getAttr(race, "name")).toBe("Race");
    const subraceWrapper = childElements(race, "element").find((e) => getAttr(e, "type") === "Racial Trait" && getAttr(e, "name") === "Gnome Subrace")!;
    const subrace = childElements(subraceWrapper, "element")[0]!;
    expect(getAttr(subrace, "registered")).toBe("ID_SUB_RACE_ROCK_GNOME");
    const tinker = childElements(subrace, "element").find((e) => getAttr(e, "name") === "Tinker")!;
    expect(getAttr(childElements(tinker, "element")[0]!, "type")).toBe("Proficiency");
  });

  it("exposes defenses conditional", () => {
    const doc = parseDnd5e(readFixture(TST));
    const defenses = doc.root.build.defenses!;
    expect(defenses.conditional()?.name).toBe("conditional");
    expect(textContent(defenses.conditional()!)).toBe("");
  });

  it("exposes companion attributes, saves, skills, and portrait location", () => {
    const doc = parseDnd5e(readFixture(TST));
    const companion = doc.root.build.companion!;
    expect(companion.name()).toBe("");
    expect(companion.attributeScores().strength).toBe("10");
    expect(companion.attributeScores().charisma).toBe("10");
    expect(companion.saves().map((s) => s.ability)).toEqual([
      "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
    ]);
    expect(companion.saves()[0]!.value).toBe("0");
    expect(companion.skills()[0]!.name).toBe("Acrobatics");
    expect(companion.skills()[17]!.name).toBe("Survival");
    expect(companion.portraitLocation()).toBe("local");
  });

  it("exposes equipment storage nodes and item details", () => {
    const doc = parseDnd5e(readFixture(TST));
    const equipment = doc.root.build.equipment!;
    expect(equipment.storage().map((s) => getAttr(s, "name"))).toEqual(["#1", "#2"]);
    const item = equipment.items()[0]!;
    expect(item.identifier()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(item.name()).toBe("Abacus");
    expect(item.id()).toBe("ID_WOTC_PHB_ITEM_ABACUS");
    expect(item.details()?.card()).toBe("true");
    expect(item.details()?.name()).toBe("");
    expect(item.details()?.notes()).toBe("");
    expect(item.equipped()).toBeNull();
  });

  it("exposes equipped items and adorners", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const equipment = doc.root.build.equipment!;
    const shortsword = equipment.items().find((i) => i.name() === "Shortsword")!;
    expect(shortsword.equipped()).toEqual({ location: "Primary Hand", value: "true" });
    const greataxe = equipment.items().find((i) => i.name() === "Greataxe")!;
    const adorner = greataxe.adorners()[0]!;
    expect(getAttr(adorner, "name")).toBe("Vicious Weapon");
    expect(getAttr(adorner, "id")).toBe("ID_WOTC_DMG_MAGIC_ITEM_VICIOUS_WEAPON");
  });

  it("exposes sum element-count and the flat ordered element list", () => {
    const doc = parseDnd5e(readFixture(TST));
    const sum = doc.root.build.sum!;
    expect(sum.elementCount()).toBe(17);
    const elements = sum.elements();
    expect(elements).toHaveLength(17);
    expect(elements[0]!.type).toBe("Level");
    expect(elements[0]!.id).toBe("ID_LEVEL_1");
    expect(elements[16]!.type).toBe("Proficiency");
    expect(elements[16]!.id).toBe("ID_PROFICIENCY_TOOL_PROFICIENCY_TINKERS_TOOLS");
  });

  it("exposes magic as a self-closing node", () => {
    const doc = parseDnd5e(readFixture(TST));
    expect(doc.root.build.magic?.selfClosing).toBe(true);
    expect(doc.root.build.magic?.raw).toBe("<magic />");
  });

  it("exposes spellcasting, slots, cantrips, and spells", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const casting = doc.root.build.spellcasting[0]!;
    expect(casting.name()).toBe("Paladin");
    expect(casting.ability()).toBe("Charisma");
    expect(casting.attack()).toBe("6");
    expect(casting.dc()).toBe("14");
    expect(casting.source()).toBe("ID_WOTC_PHB_CLASS_FEATURE_PALADIN_SPELLCASTING");
    expect(casting.slots()).toEqual({ s1: "4", s2: "2", s3: "0", s4: "0", s5: "0", s6: "0", s7: "0", s8: "0", s9: "0" });
    expect(casting.cantrips()).toHaveLength(0);

    const spells = casting.spells();
    expect(spells[0]!.name).toBe("Bless");
    expect(spells[0]!.level).toBe("1");
    expect(spells[0]!.id).toBe("ID_PHB_SPELL_BLESS");
    expect(spells[0]!.prepared).toBe("true");
    expect(spells[0]!.alwaysPrepared).toBeNull();
    expect(spells[4]!.alwaysPrepared).toBe("true");
    expect(spells[4]!.known).toBe("true");
    expect(spells[9]!.name).toBe("Ceremony");
    expect(spells[9]!.prepared).toBeNull();
  });

  it("exposes restricted sources with decoded names and element ids", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const restricted = doc.root.sources.restricted()!;
    const deepMagic = restricted.sources().find((s) => s.id !== null && s.id.startsWith("ID_KBP_DMBM_SOURCE_DEEP_MAGIC_BATTLE_MAGIC"))!;
    expect(deepMagic.id).toBe("ID_KBP_DMBM_SOURCE_DEEP_MAGIC_BATTLE_MAGIC");
    expect(deepMagic.name).toBe("Deep Magic: Battle Magic");
    expect(restricted.sources().length).toBeGreaterThan(30);
    expect(restricted.sources().some((s) => s.name === "Deep Magic: Blood & Doom")).toBe(true);
    expect(restricted.elements().some((e) => textContent(e) === "ID_MHP_ARCHETYPE_FEATURE_THE_SHADOW_CABAL_WRAITH_FORM")).toBe(true);
  });

  it("exposes restricted as a self-closing node when empty", () => {
    const doc = parseDnd5e(readFixture(TST));
    const restricted = doc.root.sources.restricted()!;
    expect(restricted.node.selfClosing).toBe(true);
    expect(restricted.node.raw).toBe("<restricted />");
    expect(restricted.sources()).toHaveLength(0);
  });

  it("decodes entities in accessors but preserves raw bytes", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const restricted = doc.root.sources.restricted()!;
    const source = restricted.sources().find((s) => s.id === "ID_KBP_DMBD_SOURCE_DEEP_MAGIC_BLOOD_AND_DOOM")!;
    expect(source.name).toBe("Deep Magic: Blood & Doom");
    expect(source.node.raw).toContain("Deep Magic: Blood &amp; Doom");

    const synthetic = parseDnd5e(
      '<?xml version="1.0" encoding="utf-8"?>\r\n<character version="1.0.3" preview="false">\r\n</character>\r\n',
    );
    const root = synthetic.root.node;
    expect(root.raw).toContain('preview="false"');
  });

  it("decodes attribute entities in accessors while attrs keep raw values", () => {
    const synthetic = parseDnd5e(
      '<character version="1.0.3" preview="Tom &amp; Jerry &quot;test&quot;">\r\n</character>\r\n',
    );
    const root = synthetic.root.node;
    expect(getAttr(root, "preview")).toBe('Tom & Jerry "test"');
    const raw = root.attrs.find(([n]) => n === "preview")![1];
    expect(raw).toBe('Tom &amp; Jerry &quot;test&quot;');
  });

  it("keeps CDATA content literal and unmangled", () => {
    const doc = parseDnd5e(readFixture(MEEPO));
    const input = doc.root.build.input!;
    const backstory = input.backstory()!;
    expect(backstory).toContain("You lived in seclusion");
    expect(backstory).not.toContain("<![CDATA[");
    const rawInput = child(doc.root.node, "build")!.children.find((c) => c.name === "input")!;
    const backstoryNode = child(rawInput, "backstory")!;
    expect(backstoryNode.raw).toContain("<![CDATA[");
  });

  it("exposes comment banner lines", () => {
    const doc = parseDnd5e(readFixture(TST));
    expect(comments(doc.root.node)).toEqual([
      "Aurora - https://www.aurorabuilder.com",
      "information",
      "display data",
      "build data",
      "restricted sources",
    ]);
  });

  it("exposes generic traversal: children, descendants, attribute order", () => {
    const doc = parseDnd5e(readFixture(TST));
    const descendants = collectDescendants(doc.root.node);
    expect(descendants.some((n) => n.name === "element" && getAttr(n, "id") === "ID_VISION_DARKVISION")).toBe(true);
    expect(descendants.some((n) => n.name === "item")).toBe(true);
    const sum = child(doc.root.node, "build")!.children.find((c) => c.name === "sum")!;
    const first = childElements(sum, "element")[0]!;
    expect(first.attrs.map(([n]) => n)).toEqual(["type", "id"]);
  });

  it("handles empty input text without loss", () => {
    const doc = parseDnd5e(readFixture(TST));
    expect(doc.serialize()).toBe(doc.raw);
    expect(doc.root.build.input!.organization()?.allies()).toBe("");
  });
});

function collectDescendants(node: Dnd5eNode): Dnd5eNode[] {
  const out: Dnd5eNode[] = [];
  const stack = [...node.children];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    stack.push(...n.children);
  }
  return out;
}
