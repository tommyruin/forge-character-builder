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

// Extracting a 2024 pack adds what its note says it omits: fixed items and
// gold appear automatically, and each choice becomes a select whose pick
// travels with the extraction request (an unset choice stays manual).
describe("pack extract extras", () => {
  it("lists the automatic extras and offers a select per choice", () => {
    expect(source).toMatch(/const extras = item\?\.extractableExtras \?\? \{ gold: 0, items: \[\], choices: \[\] \};/);
    expect(source).toMatch(/Also added automatically:/);
    expect(source).toMatch(/\+\{extras\.gold\} GP/);
    expect(source).toMatch(/extras\.choices\.map\(\(choice\) =>/);
    expect(source).toMatch(/<option value="">Choose later \(add manually\)<\/option>/);
  });

  it("forwards the chosen candidates and resets them per pack", () => {
    expect(source).toMatch(/onConfirm\(item, chosen\)/);
    expect(source).toMatch(/api\.characters\.extractItem\(id, item\.identifier, selections\)/);
    expect(source).toMatch(/setSelections\(\{\}\);/);
  });

  it("forwards optional selections over the transport", () => {
    expect(transport).toMatch(
      /extractItem: \(id: string, identifier: string, selections\?: Record<string, string>\)/,
    );
    expect(transport).toMatch(
      /selections === undefined \? \[id, identifier\] : \[id, identifier, selections\]/,
    );
  });
});
