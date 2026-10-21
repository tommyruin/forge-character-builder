// @vitest-environment happy-dom
// Equipment with custom items: the catalog button, the inventory's quick gear line, and the
// Rename / Notes / Edit actions, through the real tab with a stand-in engine API.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { characters, content } = vi.hoisted(() => ({
  characters: {
    inventory: vi.fn(),
    setItemDetails: vi.fn(),
    customContent: vi.fn(),
    saveCustomDraft: vi.fn(),
    deleteCustomDraft: vi.fn(),
    previewCustomItem: vi.fn(),
    spellcasting: vi.fn(),
    addItem: vi.fn(),
    itemOptions: vi.fn(),
    setItemPresentation: vi.fn(),
  },
  content: {
    equipmentCategories: vi.fn(),
    elements: vi.fn(),
    element: vi.fn(),
    clearCache: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({ api: { characters, content } }));
vi.mock("../../../transport/localStore", () => ({ localStore: { listHomebrew: vi.fn(async () => []), putHomebrew: vi.fn(async () => {}) } }));

import EquipmentTab from "../EquipmentTab.jsx";
import { WorkspaceContext } from "../../WorkspaceContext";

function record(overrides) {
  return {
    identifier: "rec-1",
    itemId: "ID_SCIMITAR",
    displayElementId: "ID_SCIMITAR",
    name: "Scimitar",
    customName: "",
    baseName: "Scimitar",
    defaultName: "Scimitar",
    isCustom: false,
    type: "Weapon",
    amount: 1,
    notes: "",
    card: false,
    sidebar: false,
    isEquippable: true,
    isEquipped: true,
    equippedLocation: "Primary Hand",
    equipLocations: ["primary", "secondary"],
    storage: null,
    isAttunable: false,
    isAttuned: false,
    isExtractable: false,
    hasAttackRow: true,
    isPhysicalEquipment: true,
    displayPrice: "25 gp",
    category: "Weapons",
    ...overrides,
  };
}

const inventoryWith = (items) => ({
  items,
  coins: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 },
  equipmentWeight: 0,
  attunedItemCount: 0,
  maxAttunedItemCount: 3,
  storages: ["#1", "#2"],
});

const FROSTBITE = {
  kind: "item",
  elementId: "ID_CUSTOM_FROSTBITE00000000",
  granted: true,
  installed: true,
  draft: {
    schemaVersion: 1,
    id: "ID_CUSTOM_FROSTBITE00000000",
    template: "weapon",
    name: "Frostbite",
    description: "",
    blocks: [],
    base: { id: "ID_LONGSWORD", name: "Longsword" },
    bonus: 1,
  },
};

const workspace = {
  id: "Ada",
  busy: false,
  active: true,
  detail: { rulesetMode: "2014", name: "Ada" },
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
  characters.customContent.mockResolvedValue({ entries: [], problems: [] });
  characters.spellcasting.mockResolvedValue([]);
  characters.previewCustomItem.mockResolvedValue({ attack: null });
  content.equipmentCategories.mockResolvedValue([
    { key: "weapons", label: "Weapons", elementType: "Weapon", itemCategory: null, equipSetter: null },
  ]);
  content.elements.mockResolvedValue({ items: [], total: 0 });
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function render() {
  await act(() =>
    root.render(
      <WorkspaceContext.Provider value={workspace}>
        <EquipmentTab />
      </WorkspaceContext.Provider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const buttons = () => [...document.querySelectorAll("button")];
const byText = (text) => buttons().find((entry) => entry.textContent.trim() === text);
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);

async function openInventory() {
  await render();
  await act(async () => buttons().find((entry) => entry.textContent.startsWith("Inventory")).click());
}

async function typeInto(element, value) {
  const proto = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

describe("the catalog", () => {
  it("has a Custom item button in the search band that opens the custom item dialog", async () => {
    await render();
    const band = document.querySelector(".fcb-equipment-search");
    const button = [...band.querySelectorAll("button")].find((entry) => entry.textContent.includes("Custom item"));
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(document.querySelector('[role="dialog"]').getAttribute("aria-label")).toBe("Custom item");
    expect(document.querySelector('[role="radiogroup"][aria-label="Start from"]')).not.toBeNull();
  });
});

describe("the inventory", () => {
  it("offers one Rename / notes action on every record and Edit only on a custom item, with a Custom badge", async () => {
    characters.inventory.mockResolvedValue(
      inventoryWith([
        record({}),
        record({ identifier: "rec-2", itemId: "ID_LONGSWORD", displayElementId: FROSTBITE.elementId, name: "Frostbite", defaultName: "Frostbite", baseName: "Longsword", isCustom: true }),
      ]),
    );
    characters.customContent.mockResolvedValue({ entries: [FROSTBITE], problems: [] });
    await openInventory();

    expect(byLabel("Rename / notes for Scimitar")).not.toBeNull();
    expect(byLabel("Notes for Scimitar")).toBeNull();
    expect(byLabel("Edit Scimitar")).toBeNull();
    expect(byLabel("Edit Frostbite")).not.toBeNull();
    expect(byLabel("Rename / notes for Frostbite")).not.toBeNull();
    // Rename / notes has its own icon, so it never reads as a second Edit pencil.
    const iconOf = (label) => byLabel(label).querySelector("svg").innerHTML;
    expect(iconOf("Rename / notes for Frostbite")).not.toBe(iconOf("Edit Frostbite"));
    const rows = [...document.querySelectorAll(".fcb-inventory-table tbody tr")];
    expect(rows[0].querySelector(".fcb-custom-badge")).toBeNull();
    expect(rows[1].querySelector(".fcb-custom-badge").textContent).toBe("Custom");
    // The base a magic layer sits on reads under its name.
    expect(rows[1].querySelector(".fcb-inventory-record-names").textContent).toBe("Longsword");
  });

  it("shows the item's own name under a record's custom one, and the notes", async () => {
    characters.inventory.mockResolvedValue(
      inventoryWith([record({ name: "Grandfather's Blade", customName: "Grandfather's Blade", notes: "Green leather." })]),
    );
    await openInventory();
    const row = document.querySelector(".fcb-inventory-table tbody tr");
    expect(row.querySelector(".fcb-inventory-record-names").textContent).toBe("Scimitar");
    expect(row.textContent).toContain("Green leather.");
  });

  it("describes a renamed record under its own name, with the item it is", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([record({ name: "Grandfather's Blade", customName: "Grandfather's Blade" })]));
    content.element.mockResolvedValue({ id: "ID_SCIMITAR", name: "Scimitar", type: "Weapon", description: "<p>A curved blade.</p>" });
    await openInventory();
    await act(async () => document.querySelector(".fcb-inventory-desktop-info [aria-label=\"About Grandfather's Blade\"]").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const panel = document.querySelector(".fcb-description-panel");
    expect(panel.textContent).toContain("Grandfather's Blade");
    expect(panel.textContent).toContain("Scimitar");
    expect(panel.textContent).toContain("A curved blade.");
  });

  it("describes a custom item with its own text, not No description available", async () => {
    const wand = { ...FROSTBITE, draft: { ...FROSTBITE.draft, description: "Rime clings to the blade." } };
    characters.inventory.mockResolvedValue(
      inventoryWith([record({ itemId: "ID_LONGSWORD", displayElementId: FROSTBITE.elementId, name: "Frostbite", defaultName: "Frostbite", baseName: "Longsword", isCustom: true })]),
    );
    characters.customContent.mockResolvedValue({ entries: [wand], problems: [] });
    content.element.mockResolvedValue({ id: FROSTBITE.elementId, name: "Frostbite", type: "Weapon", description: "" });
    await openInventory();
    await act(async () => document.querySelector('.fcb-inventory-desktop-info [aria-label="About Frostbite"]').click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const panel = document.querySelector(".fcb-description-panel");
    expect(panel.textContent).toContain("Rime clings to the blade.");
    expect(panel.textContent).not.toContain("No description available.");
  });

  it("puts where an equipped record is worn on its own line on a phone, and says nothing for one that is not", async () => {
    characters.inventory.mockResolvedValue(
      inventoryWith([record({}), record({ identifier: "rec-2", name: "Dagger", isEquipped: false, equippedLocation: null })]),
    );
    await openInventory();
    const cells = [...document.querySelectorAll('td[data-label="Equipped"]')];
    expect(cells[0].classList.contains("fcb-inventory-is-equipped")).toBe(true);
    expect(cells[1].classList.contains("fcb-inventory-unequipped")).toBe(true);
    const cssPath = ["src/index.css", "apps/client/src/index.css"].map((path) => resolve(process.cwd(), path)).find(existsSync);
    const css = readFileSync(cssPath, "utf8");
    const phone = css.slice(css.indexOf("@container fcb-inventory-primary (max-width: 560px)"));
    expect(phone).toMatch(/"item item"\s*"qty storage"\s*"equipped equipped"/);
    expect(phone).toMatch(/td\.fcb-inventory-unequipped \{\s*display: none;/);
  });

  it("renames a record through the dialog and refreshes the row", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([record({})]));
    characters.setItemDetails.mockResolvedValue(
      inventoryWith([record({ name: "Grandfather's Blade", customName: "Grandfather's Blade", notes: "Green leather." })]),
    );
    await openInventory();
    await act(async () => byLabel("Rename / notes for Scimitar").click());
    expect(document.querySelector('[role="dialog"]').getAttribute("aria-label")).toBe("Rename or add notes to Scimitar");
    await typeInto(byLabel("Name"), "Grandfather's Blade");
    await typeInto(byLabel("Notes"), "Green leather.");
    await act(async () => byText("Save changes").click());

    expect(characters.setItemDetails).toHaveBeenCalledWith("Ada", "rec-1", { name: "Grandfather's Blade", notes: "Green leather." });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const row = document.querySelector(".fcb-inventory-table tbody tr");
    expect(row.textContent).toContain("Grandfather's Blade");
    expect(row.querySelector(".fcb-inventory-record-names").textContent).toBe("Scimitar");
  });

  it("opens one dialog with both the name and the notes from Rename / notes", async () => {
    characters.inventory.mockResolvedValue(inventoryWith([record({})]));
    await openInventory();
    await act(async () => byLabel("Rename / notes for Scimitar").click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.getAttribute("aria-label")).toBe("Rename or add notes to Scimitar");
    expect(dialog.querySelector('[aria-label="Name"]')).not.toBeNull();
    expect(dialog.querySelector('[aria-label="Notes"]')).not.toBeNull();
  });

  it("opens the custom item dialog on Edit, with the item's own settings", async () => {
    characters.inventory.mockResolvedValue(
      inventoryWith([record({ itemId: "ID_LONGSWORD", displayElementId: FROSTBITE.elementId, name: "Frostbite", defaultName: "Frostbite", baseName: "Longsword", isCustom: true })]),
    );
    characters.customContent.mockResolvedValue({ entries: [FROSTBITE], problems: [] });
    await openInventory();
    await act(async () => byLabel("Edit Frostbite").click());
    expect(document.querySelector('[role="dialog"]').getAttribute("aria-label")).toBe("Edit custom item");
    expect(byLabel("Name").value).toBe("Frostbite");
    expect(byLabel("Bonus to hit and damage").value).toBe("1");
  });

  it("adds plain gear on one line as a stackable custom item, and reuses it by name next time", async () => {
    // The stand-in engine keeps what a save stores, as the character pack does.
    const stored = [];
    characters.customContent.mockImplementation(async () => ({ entries: [...stored], problems: [] }));
    characters.inventory.mockImplementation(async () => inventoryWith([]));
    characters.saveCustomDraft.mockImplementation(async (_id, draft) => {
      stored.push({ kind: "item", draft, elementId: draft.id, granted: true, installed: true });
      return { character: { id: "Ada" }, entry: { draft, elementId: draft.id } };
    });
    characters.addItem.mockResolvedValue(inventoryWith([]));
    await openInventory();
    const submit = async () =>
      act(async () => {
        document.querySelector('form[aria-label="Add custom gear"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      });

    await typeInto(byLabel("Gear name"), "Signal Whistle");
    await typeInto(byLabel("Gear quantity"), "3");
    await submit();
    expect(characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    const [id, draft, options] = characters.saveCustomDraft.mock.calls[0];
    expect(id).toBe("Ada");
    expect(draft).toMatchObject({ template: "gear", name: "Signal Whistle", stackable: true, blocks: [] });
    expect(options).toEqual({ amount: 3 });
    expect(byLabel("Gear name").value).toBe("");

    // The same name again adds to the item the character already has.
    await typeInto(byLabel("Gear name"), "signal whistle");
    await submit();
    expect(characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    expect(characters.addItem).toHaveBeenCalledWith("Ada", draft.id, 1, null);
  });
});
