import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../EquipmentTab.jsx", import.meta.url),
  "utf8",
);
const transport = readFileSync(
  new URL("../../../transport/engineTransport.ts", import.meta.url),
  "utf8",
);

// The Qty column is the player's stack control: minus stops at 1 so the
// Delete action keeps sole ownership of removing a record, and plus is capped
// by the tab's guardrail rather than the engine (which accepts any positive
// integer). Stowing a stack is the same control's sibling: move any number of
// units, the engine splits them off.
describe("inventory quantity control", () => {
  it("renders a stepper in the Qty cell wired to setItemAmount", () => {
    expect(source).toMatch(/<td data-label="Qty">\s*<QuantityStepper/s);
    expect(source).toMatch(/api\.characters\.setItemAmount\(/);
    expect(source).toMatch(/onSetItemAmount\(item\.identifier, item\.amount - 1\)/);
    expect(source).toMatch(/onSetItemAmount\(item\.identifier, item\.amount \+ 1\)/);
  });

  it("disables minus at 1 and plus at the cap", () => {
    expect(source).toMatch(/disabled=\{busy \|\| amount <= 1\}/);
    expect(source).toMatch(/disabled=\{busy \|\| amount >= MAX_ITEM_AMOUNT\}/);
  });

  it("routes a multi-unit stack through the stow quantity modal", () => {
    expect(source).toMatch(/onSetStorage=\{\(item, storage\) => \{/);
    expect(source).toMatch(/if \(item\.amount > 1\) \{\s*setStowing\(\{ item, storage \}\)/s);
    expect(source).toMatch(/onSetStorage\(item, e\.target\.value \|\| null\)/);
    expect(source).toMatch(/api\.characters\.setItemStorage\(id, item\.identifier, storage, amount\)/);
  });

  it("deletes a whole record, leaving decrementing to the stepper", () => {
    expect(source).toMatch(/api\.characters\.removeItem\(id, identifier\)/);
    expect(source).not.toMatch(/api\.characters\.removeItem\(id, identifier, 1\)/);
    // The transport forwards an explicit amount and omits it for a full removal.
    expect(transport).toMatch(/removeItem: \(id: string, identifier: string, amount\?: number\)/);
    expect(transport).toMatch(/mutateDetail\(id, "removeItem", amount === undefined \? \[id, identifier\] : \[id, identifier, amount\]\)/);
  });
});
