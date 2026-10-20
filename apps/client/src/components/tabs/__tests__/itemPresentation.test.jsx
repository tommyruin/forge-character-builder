// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { characters } = vi.hoisted(() => ({
  characters: {
    inventory: vi.fn(),
    setItemPresentation: vi.fn(),
    setCoins: vi.fn(),
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

    expect(button("Card for Longsword").getAttribute("aria-pressed")).toBe("true");
    expect(button("Sheet notes for Longsword").getAttribute("aria-pressed")).toBe("false");
    expect(button("Card for Rope").getAttribute("aria-pressed")).toBe("false");
    expect(button("Sheet notes for Rope").getAttribute("aria-pressed")).toBe("true");
    // The pair sits in the desktop Actions cell; the narrow card keeps it in its overflow menu.
    expect(host.querySelectorAll('[aria-label="Card for Longsword"]')).toHaveLength(1);
    expect(host.querySelector(".fcb-inventory-actions--desktop [aria-label=\"Card for Longsword\"]")).not.toBeNull();
    expect(button("Card for Longsword").textContent).toContain("Card");
    expect(button("Sheet notes for Longsword").textContent).toContain("Sheet notes");
  });

  it("keeps the narrow card to one row of small actions, with the sheet choices in an overflow menu", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([inventoryItem({})]));
    characters.setItemPresentation.mockImplementation(async (_id, identifier, presentation) =>
      inventoryWith([inventoryItem({ identifier, ...presentation })]),
    );
    await openInventory();

    const narrow = host.querySelector(".fcb-inventory-mobile-actions");
    expect(narrow.querySelector('[aria-label="Card for Longsword"]')).toBeNull();
    expect(narrow.querySelector(".fcb-inventory-actions--mobile").children.length).toBeLessThanOrEqual(4);
    const more = narrow.querySelector('[aria-label="More actions for Longsword"]');
    await act(async () => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // A disclosure of plain buttons, not an application menu.
    expect(host.querySelector('[role="menu"], [role^="menuitem"]')).toBeNull();
    const panel = document.getElementById(more.getAttribute("aria-controls"));
    const card = panel.querySelector('[aria-label="Card for Longsword"]');
    // Opening it puts the keyboard on its first button.
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(panel.querySelector('[aria-label="Sheet notes for Longsword"]').getAttribute("aria-pressed")).toBe("false");
    await act(async () => card.click());
    expect(characters.setItemPresentation).toHaveBeenLastCalledWith("Ada", "sword-1", { card: false });
    // Escape closes it and gives focus back to More.
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
  });

  it("closes the narrow card's overflow when the inventory scrolls", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([inventoryItem({})]));
    await openInventory();
    const more = host.querySelector('.fcb-inventory-mobile-actions [aria-label="More actions for Longsword"]');
    await act(async () => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("drops the Equipped dash on a card that cannot be equipped", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([inventoryItem({})]));
    await openInventory();
    const cell = host.querySelector('td[data-label="Equipped"]');
    expect(cell.classList.contains("fcb-inventory-cannot-equip")).toBe(true);
  });

  it("switches a record's card and sheet notes through the inventory API", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([inventoryItem({})]));
    characters.setItemPresentation.mockImplementation(async (_id, identifier, presentation) =>
      inventoryWith([inventoryItem({ identifier, ...presentation })]),
    );
    await openInventory();

    await act(async () => button("Card for Longsword").click());
    expect(characters.setItemPresentation).toHaveBeenLastCalledWith("Ada", "sword-1", { card: false });
    expect(button("Card for Longsword").getAttribute("aria-pressed")).toBe("false");

    await act(async () => button("Sheet notes for Longsword").click());
    expect(characters.setItemPresentation).toHaveBeenLastCalledWith("Ada", "sword-1", { sidebar: true });
    expect(button("Sheet notes for Longsword").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("manage coins", () => {
  const withCoins = (coins) => ({ ...inventoryWith([inventoryItem({})]), coins: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0, ...coins } });
  const setValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("is one closed row that shows what the character carries", async () => {
    characters.inventory.mockResolvedValue(withCoins({ gold: 15, silver: 4 }));
    await openInventory();
    const coins = host.querySelector('[data-testid="inventory-coins"]');
    expect(coins.tagName).toBe("DETAILS");
    expect(coins.open).toBe(false);
    expect(coins.querySelector("summary").textContent).toContain("Manage coins");
    expect([...coins.querySelectorAll(".fcb-meta-pill")].map((pill) => pill.textContent)).toEqual(["4 SP", "15 GP"]);
  });

  it("says when there are no coins", async () => {
    characters.inventory.mockResolvedValue(withCoins({}));
    await openInventory();
    expect(host.querySelector('[data-testid="coin-totals"]').textContent).toBe("No coins");
  });

  it("applies all five amounts at once and clears what was typed", async () => {
    characters.inventory.mockResolvedValue(withCoins({ gold: 15 }));
    // The stored amounts come back from the character, so the field shows them once the typed draft clears.
    characters.setCoins.mockImplementation(async (_id, coins) => withCoins({ ...coins, gold: coins.gold + 1 }));
    await openInventory();
    const coins = host.querySelector('[data-testid="inventory-coins"]');
    const gold = coins.querySelector('[aria-label="Gold (GP)"]');
    const copper = coins.querySelector('[aria-label="Copper (CP)"]');
    await setValue(gold, "20");
    await setValue(copper, "7");
    const apply = [...coins.querySelectorAll("button")].find((button) => button.textContent === "Apply");
    expect(apply.type).toBe("submit");
    await act(async () => apply.click());
    expect(characters.setCoins).toHaveBeenLastCalledWith("Ada", { copper: 7, silver: 0, electrum: 0, gold: 20, platinum: 0 });
    expect(coins.querySelector('[aria-label="Gold (GP)"]').value).toBe("21");
    expect([...coins.querySelectorAll(".fcb-meta-pill")].map((pill) => pill.textContent)).toEqual(["7 CP", "21 GP"]);
  });
});
