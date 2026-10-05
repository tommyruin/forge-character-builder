// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { GlobalEquipmentSearchResults } from "../EquipmentTab.jsx";

it("shows shopping details and identifies proficiency without disabling Add", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const items = [
    { id: "club", name: "Club", source: "PHB", displayPrice: "0.1 gp", equipmentKind: "Simple melee weapon", isProficient: true, proficiencyStatus: "proficient" },
    { id: "magic", name: "Magic armor", source: "DMG", displayPrice: "Not listed", equipmentKind: "Magic Armor", rarity: "Rare", isProficient: null, proficiencyStatus: "base-dependent" },
  ];
  await act(() => root.render(<GlobalEquipmentSearchResults page={{ items, total: 2 }} loading={false} ownedCounts={new Map()} />));
  expect(host.textContent).toContain("0.1 gp");
  expect(host.textContent).toContain("Simple melee weapon");
  expect(host.textContent).toContain("Rare");
  expect(host.textContent).toContain("Not listed");
  expect(host.textContent).toContain("Depends on base item");
  expect(host.querySelector("strong em").textContent).toBe("Club");
  expect(host.querySelector('[aria-label="Add Club"]').disabled).toBe(false);
  expect(host.querySelector('[aria-label="Add Magic armor"]').disabled).toBe(false);
  await act(() => root.unmount());
});
