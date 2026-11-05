// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ItemSortSelect } from "../EquipmentTab.jsx";

it("offers Name and Source as a native select beside the other filters, and reports the pick", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const picks = [];
  function Harness() {
    const [value, setValue] = useState("name");
    return <ItemSortSelect value={value} onChange={(next) => { picks.push(next); setValue(next); }} />;
  }
  await act(() => root.render(<Harness />));
  const select = host.querySelector('select[data-testid="item-sort"]');
  expect(host.textContent).toContain("Sort by");
  expect(select.className).toContain("fcb-input");
  expect([...select.options].map((option) => option.textContent)).toEqual(["Name", "Source"]);
  expect(select.value).toBe("name");
  await act(() => {
    select.value = "source";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(picks).toEqual(["source"]);
  expect(select.value).toBe("source");
  await act(() => root.unmount());
  host.remove();
});
