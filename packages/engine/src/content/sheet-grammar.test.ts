import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "./library.js";
import { parseElement } from "./parser.js";
import { parseXml } from "./xml.js";
import { createFastStartController } from "../snapshot/fast-start.js";
import { FAST_START_MANIFEST, FAST_START_SCHEMA_VERSION } from "../snapshot/identities.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

let lib: ElementLibrary;

beforeAll(async () => {
  lib = await buildCorpusLibrary();
}, 120_000);


function parseFirstElement(xml: string) {
  const node = parseXml(xml);
  const element = node.children.find((child) => child.kind === "element" && child.node.name === "element");
  if (element === undefined || element.kind !== "element") throw new Error("no element in fixture xml");
  return parseElement(element.node, "test.xml");
}

describe("content sheet grammar", () => {
  it("preserves multiple ordered <sheet> entries on one element", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet action="Action"><description>First sheet.</description></sheet>
        <sheet usage="1/Long Rest"><description>Second sheet.</description></sheet>
      </element>`);
    expect(element.sheets).toHaveLength(2);
    expect(element.sheets[0]!.action).toBe("Action");
    expect(element.sheets[0]!.usage).toBeUndefined();
    expect(element.sheets[1]!.usage).toBe("1/Long Rest");
    expect(element.sheets[1]!.action).toBeUndefined();
  });

  it("keeps sheet declaration order even with non-sheet blocks between them", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet><description>First.</description></sheet>
        <setters><set name="x">1</set></setters>
        <sheet><description>Second.</description></sheet>
      </element>`);
    expect(element.sheets.map((s) => s.descriptions[0]!.text)).toEqual(["First.", "Second."]);
  });

  it("distinguishes missing display from explicit false and true", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet><description>A</description></sheet>
        <sheet display="false" />
        <sheet display="true"><description>B</description></sheet>
      </element>`);
    expect(element.sheets[0]!.display).toBeUndefined();
    expect(element.sheets[1]!.display).toBe(false);
    expect(element.sheets[2]!.display).toBe(true);
  });

  it("parses action, usage, alt and name attributes", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet action="Bonus Action" usage="{{proficiency}}/Long Rest" alt="Alternate Name" name="Display">
          <description>Text.</description>
        </sheet>
      </element>`);
    expect(element.sheets[0]!.action).toBe("Bonus Action");
    expect(element.sheets[0]!.usage).toBe("{{proficiency}}/Long Rest");
    expect(element.sheets[0]!.alt).toBe("Alternate Name");
    expect(element.sheets[0]!.name).toBe("Display");
  });

  it("parses level-gated descriptions with usage and action attributes", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet action="Bonus Action">
          <description usage="{{rage:count}}/Long Rest">Base text.</description>
          <description usage="Unlimited" level="20">Level 20 text.</description>
          <description action="Reaction" level="10">Level 10 text.</description>
        </sheet>
      </element>`);
    const descs = element.sheets[0]!.descriptions;
    expect(descs).toHaveLength(3);
    expect(descs[0]!.level).toBeUndefined();
    expect(descs[0]!.usage).toBe("{{rage:count}}/Long Rest");
    expect(descs[1]!.level).toBe(20);
    expect(descs[1]!.usage).toBe("Unlimited");
    expect(descs[2]!.level).toBe(10);
    expect(descs[2]!.action).toBe("Reaction");
  });

  it("preserves description text with paragraphs, lists, entities and line breaks", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet>
          <description>First line with &amp; entities &quot;quoted&quot;.
            <i>Italic bit</i> after.
            Second paragraph.</description>
        </sheet>
      </element>`);
    const text = element.sheets[0]!.descriptions[0]!.text;
    expect(text).toContain("First line with & entities \"quoted\".");
    expect(text).toContain("Italic bit");
    expect(text).toContain("Second paragraph.");
    expect(text).toContain("\n");
    const xml = element.sheets[0]!.descriptions[0]!.descriptionXml;
    expect(xml).toContain("<i>Italic bit</i>");
  });

  it("keeps multiple {{stat}} substitutions verbatim in description text", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet><description>A +{{barbarian rage:damage}} to damage; {{sneak-attack:count}}d{{sneak-attack:die}} dice.</description></sheet>
      </element>`);
    expect(element.sheets[0]!.descriptions[0]!.text).toBe(
      "A +{{barbarian rage:damage}} to damage; {{sneak-attack:count}}d{{sneak-attack:die}} dice.",
    );
  });

  it("keeps self-closing and empty sheets with no descriptions", () => {
    const element = parseFirstElement(`
      <element name="Test" type="Feature" source="S" id="ID_TEST">
        <sheet display="false" />
        <sheet />
        <sheet alt="X" />
      </element>`);
    expect(element.sheets).toHaveLength(3);
    for (const sheet of element.sheets) expect(sheet.descriptions).toHaveLength(0);
  });

  it("round-trips sheets through the fast-start snapshot payload", async () => {
    const controller = createFastStartController(lib);
    await controller.prepare();
    const body = controller.takeBuffer();
    const hydrated: typeof lib = {
      byId: new Map(),
      byType: new Map(),
      typeCounts: {},
      sources: new Map(),
      elementCount: 0,
      fileOrder: [],
      ruleset: new Map(),
      rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 },
    };
    const restored = createFastStartController(hydrated);
    await restored.boot({ manifest: FAST_START_MANIFEST, expectedIdentity: FAST_START_MANIFEST, body });
    const barbarian = hydrated.byId.get("ID_WOTC_PHB_CLASS_FEATURE_BARBARIAN_RAGE")!;
    expect(barbarian.sheets).toHaveLength(1);
    expect(barbarian.sheets[0]!.action).toBe("Bonus Action");
    expect(barbarian.sheets[0]!.descriptions).toHaveLength(2);
    expect(barbarian.sheets[0]!.descriptions[0]!.usage).toBe("{{barbarian rage:count}}/Long Rest");
  }, 120_000);

  it("bumps the fast-start payload schema for the sheets field", () => {
    expect(FAST_START_SCHEMA_VERSION).toBe(2);
  });
});

describe("corpus sheet grammar pins", () => {
  it("pins the corpus sheet inventory", async () => {
    let elementsWithSheets = 0;
    let sheets = 0;
    let displayFalse = 0;
    let displayTrue = 0;
    let withDescription = 0;
    let multiDescription = 0;
    let multipleSheets = 0;
    const alt = new Set<string>();
    for (const element of lib.byId.values()) {
      if (element.sheets.length > 0) elementsWithSheets++;
      if (element.sheets.length > 1) multipleSheets++;
      for (const sheet of element.sheets) {
        sheets++;
        if (sheet.display === false) displayFalse++;
        if (sheet.display === true) displayTrue++;
        if (sheet.alt !== undefined) alt.add(sheet.alt);
        if (sheet.descriptions.length > 0) withDescription++;
        if (sheet.descriptions.length > 1) multiDescription++;
      }
    }
    expect(elementsWithSheets).toBe(5928);
    expect(multipleSheets).toBe(1);
    expect(sheets).toBe(5929);
    expect(displayFalse).toBe(1768);
    expect(displayTrue).toBe(3);
    expect(withDescription).toBe(4408);
    expect(multiDescription).toBe(220);
  });
});
