// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ItemSortSelect } from "../EquipmentTab.jsx";

it("offers Name and Source and reports the pick", async () => {
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
  const trigger = host.querySelector('[data-testid="item-sort"]') ?? host.querySelector("button");
  expect(host.textContent).toContain("Sort by");
  expect(trigger.textContent).toContain("Name");
  await act(() => trigger.click());
  const options = [...document.querySelectorAll('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual(["Name", "Source"]);
  await act(() => options[1].click());
  expect(picks).toEqual(["source"]);
  expect(host.querySelector("button").textContent).toContain("Source");
  await act(() => root.unmount());
  host.remove();
});
