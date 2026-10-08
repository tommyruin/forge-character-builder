// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { characters } = vi.hoisted(() => ({
  characters: {
    inventory: vi.fn(),
    setItemPresentation: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  api: {
    characters,
    content: { equipmentCategories: vi.fn(async () => []), clearCache: vi.fn() },
  },
}));

import EquipmentTab from "../EquipmentTab.jsx";
import { WorkspaceContext } from "../../WorkspaceContext";

function inventoryItem(overrides) {
  return {
    identifier: "sword-1",
    itemId: "ID_LONGSWORD",
    displayElementId: "ID_LONGSWORD",
    name: "Longsword",
    type: "Weapon",
    amount: 1,
    notes: "",
    card: true,
    sidebar: false,
    isEquippable: false,
    isEquipped: false,
    equippedLocation: null,
    equipLocations: [],
    storage: null,
    isAttunable: false,
    isAttuned: false,
    isExtractable: false,
    hasAttackRow: true,
    isPhysicalEquipment: true,
    displayPrice: "15 gp",
    category: "Weapons",
    ...overrides,
  };
}

function inventoryWith(items) {
  return {
    items,
    coins: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 },
    equipmentWeight: 0,
    attunedItemCount: 0,
    maxAttunedItemCount: 3,
    storages: ["#1", "#2"],
  };
}

const workspace = {
  id: "Ada",
  busy: false,
  active: false,
  detail: { rulesetMode: "2014" },
  libraryRevision: 0,
  run: (operation) => operation(),
  notify: vi.fn(),
  getCachedResource: (_key, loader) => Promise.resolve().then(loader),
  setCachedResource: vi.fn(),
  resetPrimaryScroll: vi.fn(),
  registerPrimaryScroll: vi.fn(),
  registerDetailsScroll: vi.fn(),
  createLibraryPickerRefreshController: () => ({ request: () => null, cancel: () => {} }),
  ensureLibraryRevisionReady: () => Promise.resolve(),
};

let host;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function openInventory() {
  await act(() =>
    root.render(
      <WorkspaceContext.Provider value={workspace}>
        <EquipmentTab />
      </WorkspaceContext.Provider>,
    ),
  );
  const tab = [...host.querySelectorAll("button")].find((button) =>
    button.textContent.startsWith("Inventory"),
  );
  await act(async () => tab.click());
}

const button = (label) => host.querySelector(`[aria-label="${label}"]`);

describe("item presentation toggles", () => {
  it("shows each record's card and sheet-notes choice as a pressed state", async () => {
    characters.inventory.mockResolvedValue(
      inventoryWith([
        inventoryItem({}),
        inventoryItem({ identifier: "rope-1", itemId: "ID_ROPE", displayElementId: "ID_ROPE", name: "Rope", type: "Item", card: false, sidebar: true }),
      ]),
    );
    await openInventory();

    expect(button("Print a card for Longsword").getAttribute("aria-pressed")).toBe("true");
    expect(button("Print notes for Longsword on the sheet").getAttribute("aria-pressed")).toBe("false");
    expect(button("Print a card for Rope").getAttribute("aria-pressed")).toBe("false");
    expect(button("Print notes for Rope on the sheet").getAttribute("aria-pressed")).toBe("true");
    // One pair in the desktop Actions cell, one in the narrow layout's own row.
    expect(host.querySelectorAll('[aria-label="Print a card for Longsword"]')).toHaveLength(2);
    expect(host.querySelector(".fcb-inventory-presentation--narrow [aria-label=\"Print a card for Longsword\"]")).not.toBeNull();
    expect(host.querySelector(".fcb-inventory-actions--desktop [aria-label=\"Print a card for Longsword\"]")).not.toBeNull();
    expect(button("Print a card for Longsword").textContent).toContain("Card");
    expect(button("Print notes for Longsword on the sheet").textContent).toContain("Sheet notes");
  });

  it("switches a record's card and sheet notes through the inventory API", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([inventoryItem({})]));
    characters.setItemPresentation.mockImplementation(async (_id, identifier, presentation) =>
      inventoryWith([inventoryItem({ identifier, ...presentation })]),
    );
    await openInventory();

    await act(async () => button("Print a card for Longsword").click());
    expect(characters.setItemPresentation).toHaveBeenLastCalledWith("Ada", "sword-1", { card: false });
    expect(button("Print a card for Longsword").getAttribute("aria-pressed")).toBe("false");

    await act(async () => button("Print notes for Longsword on the sheet").click());
    expect(characters.setItemPresentation).toHaveBeenLastCalledWith("Ada", "sword-1", { sidebar: true });
    expect(button("Print notes for Longsword on the sheet").getAttribute("aria-pressed")).toBe("true");
  });
});
