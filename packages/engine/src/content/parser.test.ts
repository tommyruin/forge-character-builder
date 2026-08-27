import { describe, expect, it } from "vitest";
import { parseXml, childElements, serializeXml } from "./xml.js";
import { parseElementsFile, type ParsedElement } from "./parser.js";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<info>
		<name>Sample</name>
	</info>
	<!-- a comment -->
	<element name="Test Element" type="Test" source="Sample Source" id="ID_SAMPLE_1">
		<description>
			<p class="indent">Some <b>bold</b> text &amp; more.</p>
			<![CDATA[<raw>stuff</raw>]]>
		</description>
		<setters>
			<set name="category">Adventuring Gear</set>
			<set name="slot">misc</set>
		</setters>
		<rules>
			<grant type="Proficiency" name="Test Prof" />
			<stat name="innate speed" value="30" bonus="base" />
			<select type="Feat" number="1" />
			<select type="List" name="Ideal">
				<item id="1">Tradition &amp; service.</item>
				<item id="2">Change. <em>For the better.</em></item>
			</select>
		</rules>
		<supports>
			<support type="Tool" />
		</supports>
		<requirements>ID_SAMPLE_0</requirements>
		<compendium display="false" />
		<element type="Size" name="Small" id="ID_SIZE_SMALL" />
	</element>
	<element name="Empty" type="Test" source="Sample Source" id="ID_SAMPLE_2" />
</elements>
`;

describe("xml tokenizer", () => {
  it("parses structure with comments, CDATA, and entities", () => {
    const doc = parseXml(SAMPLE);
    const root = childElements(doc, "elements")[0]!;
    const elements = childElements(root, "element");
    expect(elements).toHaveLength(2);
    expect(elements[0]!.attrs.id).toBe("ID_SAMPLE_1");
    expect(elements[0]!.attrs.name).toBe("Test Element");
  });

  it("decodes attribute entities", () => {
    const doc = parseXml('<x a="1 &amp;&amp; 2" b="&#x41;" />');
    const x = childElements(doc, "x")[0]!;
    expect(x.attrs.a).toBe("1 && 2");
    expect(x.attrs.b).toBe("A");
  });

  it("round-trips through the serializer", () => {
    const doc = parseXml(SAMPLE);
    const out = serializeXml(doc);
    const reparsed = parseXml(out);
    const root = childElements(reparsed, "elements")[0]!;
    expect(childElements(root, "element")).toHaveLength(2);
  });

  it("keeps the whitespace separating inline sibling elements", () => {
    const doc = parseXml("<p><em>gains</em> <em>advantage</em></p>");
    const p = childElements(doc, "p")[0]!;
    // Without the separator, "gains" and "advantage" fuse on re-serialization.
    expect(serializeXml(p)).toBe("<p><em>gains</em> <em>advantage</em></p>");
  });

  it("serializes empty non-void elements as paired tags for HTML consumers", () => {
    const doc = parseXml('<p><div element="ID_REF" /><span>after</span></p>');
    const p = childElements(doc, "p")[0]!;
    // "<div/>" fed to an HTML parser is an OPEN tag that swallows following
    // siblings; the serializer must emit an explicit close instead.
    expect(serializeXml(p)).toBe('<p><div element="ID_REF"></div><span>after</span></p>');
  });

  it("treats <source> as a paired element instead of truncating its parent", () => {
    const doc = parseXml(
      '<element id="ID_X" name="X" type="Spell" source="S"><source name="Book"><page>10</page></source><set name="level">1</set></element>',
    );
    const element = childElements(doc, "element")[0]!;
    // A voided <source> made its close tag terminate <element> early, dropping
    // every sibling after it (here the <set>).
    expect(childElements(element).map((child) => child.name)).toEqual(["source", "set"]);
  });
});

describe("element parser", () => {
  const elements = parseElementsFile(SAMPLE, "sample.xml");

  it("captures identity", () => {
    expect(elements[0]!.identity).toEqual({
      id: "ID_SAMPLE_1",
      name: "Test Element",
      type: "Test",
      source: "Sample Source",
    });
  });

  it("captures setters", () => {
    const setters = elements[0]!.setters;
    expect(setters).toContainEqual({ name: "category", value: "Adventuring Gear" });
    expect(setters).toContainEqual({ name: "slot", value: "misc" });
  });

  it("captures typed rules", () => {
    const rules = elements[0]!.rules;
    expect(rules).toContainEqual({ kind: "grant", type: "Proficiency", name: "Test Prof" });
    expect(rules).toContainEqual({ kind: "stat", name: "innate speed", value: "30", bonus: "base" });
    expect(rules).toContainEqual({ kind: "select", type: "Feat", number: 1 });
  });

  it("captures inline list choices on list selection rules", () => {
    const listRule = elements[0]!.rules.find((rule) => rule.kind === "select" && rule.type === "List");
    expect(listRule).toMatchObject({
      kind: "select",
      type: "List",
      name: "Ideal",
      items: [
        { id: "1", text: "Tradition & service." },
        { id: "2", text: "Change. For the better." },
      ],
    });
  });

  it("captures supports and flags", () => {
    const element = elements[0]!;
    expect(element.supports).toEqual(["Tool"]);
    expect(element.requirements).toBe("ID_SAMPLE_0");
    expect(element.compendiumHidden).toBe(true);
  });

  it("captures nested elements", () => {
    const element = elements[0]!;
    expect(element.children).toHaveLength(1);
    expect(element.children[0]!.identity.id).toBe("ID_SIZE_SMALL");
  });

  it("keeps description content", () => {
    const description = elements[0]!.descriptionXml!;
    expect(description).toContain("Some");
    expect(description).toContain("<b>bold</b>");
  });

  it("parses empty elements", () => {
    expect(elements[1]!.identity.id).toBe("ID_SAMPLE_2");
    expect(elements[1]!.setters).toEqual([]);
    expect(elements[1]!.rules).toEqual([]);
  });

  it("parses boolean attributes case-insensitively with surrounding whitespace", () => {
    const xml = `<elements>
      <element name="Bools" type="Test" source="S" id="ID_BOOL_1">
        <rules>
          <stat name="x" value="1" inline="True" />
          <stat name="y" value="1" inline=" TRUE " />
          <stat name="z" value="1" inline="1" />
          <select type="Feat" optional="FALSE" expand="True" />
        </rules>
      </element>
    </elements>`;
    const parsed = parseElementsFile(xml, "bools.xml")[0]!;
    const stats = parsed.rules.filter((rule) => rule.kind === "stat");
    expect(stats.map((rule) => rule.inline)).toEqual([true, true, false]);
    const select = parsed.rules.find((rule) => rule.kind === "select")!;
    expect(select.optional).toBe(false);
    expect(select.expand).toBe(true);
  });
});

export type { ParsedElement };
