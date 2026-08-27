import { describe, expect, it } from "vitest";
import { parseElementsFile } from "./parser.js";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<elements>
	<element name="Rogue" type="Class" source="Player’s Handbook" id="ID_CLASS_ROGUE">
		<multiclass id="ID_MULTICLASS_ROGUE">
			<prerequisite>Dexterity 13</prerequisite>
			<requirements>([dex:13],!(ID_PHB24_CLASS_ROGUE||ID_PHB24_MULTICLASS_ROGUE))||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER</requirements>
			<setters>
				<set name="multiclass proficiencies">Light armor, one skill, thieves’ tools</set>
			</setters>
			<rules>
				<grant type="Grants" id="ID_INTERNAL_GRANT_MULTICLASS" />
				<select type="Proficiency" name="Skill Proficiency (Rogue)" number="1" />
			</rules>
		</multiclass>
	</element>
</elements>
`;

describe("element parser multiclass block", () => {
  const elements = parseElementsFile(SAMPLE, "sample.xml");

  it("captures the multiclass id, prerequisite and requirements", () => {
    const multiclass = elements[0]!.multiclass;
    expect(multiclass).toBeDefined();
    expect(multiclass!.id).toBe("ID_MULTICLASS_ROGUE");
    expect(multiclass!.prerequisite).toBe("Dexterity 13");
    expect(multiclass!.requirements).toBe(
      "([dex:13],!(ID_PHB24_CLASS_ROGUE||ID_PHB24_MULTICLASS_ROGUE))||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER",
    );
  });

  it("captures the multiclass setters and rules", () => {
    const multiclass = elements[0]!.multiclass!;
    expect(multiclass.setters).toContainEqual({
      name: "multiclass proficiencies",
      value: "Light armor, one skill, thieves’ tools",
    });
    expect(multiclass.rules).toContainEqual({ kind: "grant", type: "Grants", id: "ID_INTERNAL_GRANT_MULTICLASS" });
    expect(multiclass.rules).toContainEqual({
      kind: "select",
      type: "Proficiency",
      name: "Skill Proficiency (Rogue)",
      number: 1,
    });
  });

  it("leaves multiclass undefined for elements without a block", () => {
    const without = parseElementsFile('<elements><element name="X" type="X" id="ID_X" /></elements>', "x.xml");
    expect(without[0]!.multiclass).toBeUndefined();
  });
});
