// @vitest-environment happy-dom
// Magic with custom spells: a spell's own name and note, the Custom badge and Edit on a spell made
// on the character, creating a spell the library lacks from Add a spell, and fixing a spell a
// pack grants that nothing defines. The real tab runs against a stand-in engine API.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { characters, content } = vi.hoisted(() => ({
  characters: {
    spellcasting: vi.fn(),
    dmGrants: vi.fn(),
    setSpellAlias: vi.fn(),
    customContent: vi.fn(),
    saveCustomDraft: vi.fn(),
    deleteCustomDraft: vi.fn(),
    previewCustomSpell: vi.fn(),
    missingGrants: vi.fn(),
    addSpell: vi.fn(),
    removeSpell: vi.fn(),
    setPrepared: vi.fn(),
  },
  content: { elements: vi.fn(), clearCache: vi.fn() },
}));

vi.mock("../../../api", () => ({ api: { characters, content }, MAGIC_RULE_TYPES: ["Spell"] }));
vi.mock("../../../transport/localStore", () => ({ localStore: { listHomebrew: vi.fn(async () => []), putHomebrew: vi.fn(async () => {}) } }));

import MagicTab from "../MagicTab.jsx";
import { WorkspaceContext } from "../../WorkspaceContext";

function spell(overrides) {
  return {
    id: "ID_BARKSKIN",
    name: "Barkskin",
    source: "Test Book",
    isPrepared: false,
    isChosen: true,
    level: 2,
    school: "Transmutation",
    isRitual: false,
    isConcentration: true,
    isAlwaysPrepared: true,
    castingTime: "1 action",
    components: "V, S",
    range: "Touch",
    duration: "1 hour",
    description: "",
    ...overrides,
  };
}

const caster = (knownSpells) => ({
  identifier: "wiz",
  name: "Wizard",
  kind: "class",
  ability: "Intelligence",
  attackModifier: 5,
  saveDc: 13,
  requiresPreparation: true,
  allowReplace: false,
  prepareCount: 4,
  currentPreparedCount: 0,
  slotsPerLevel: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  knownSpells,
  maxSpellLevel: 2,
  resource: { mode: "slots", canUseSpellPoints: false },
});

const FROST_LANCE = {
  kind: "spell",
  elementId: "ID_CUSTOM_FROSTLANCE000000",
  granted: true,
  installed: true,
  draft: {
    schemaVersion: 1,
    id: "ID_CUSTOM_FROSTLANCE000000",
    template: "spell",
    name: "Frost Lance",
    description: "A lance of ice.",
    level: 1,
    school: "Evocation",
    castingTime: "1 action",
    range: "120 feet",
    duration: "Instantaneous",
    components: { verbal: true },
    mechanics: { roll: "none" },
  },
};

const workspace = {
  id: "Ada",
  busy: false,
  active: true,
  detail: { rulesetMode: "2014", name: "Ada", selectionRules: [] },
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
  characters.spellcasting.mockResolvedValue([caster([spell({})])]);
  characters.dmGrants.mockResolvedValue([]);
  characters.customContent.mockResolvedValue({ entries: [], problems: [] });
  characters.missingGrants.mockResolvedValue([]);
  characters.previewCustomSpell.mockResolvedValue({ attack: null });
  content.elements.mockResolvedValue({ items: [] });
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
        <MagicTab />
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
const dialog = () => document.querySelector('[role="dialog"]');

async function typeInto(element, value) {
  const proto = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

const pause = (ms = 300) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

describe("a spell's own name", () => {
  it("shows the real name beside an alias, with the note, and nothing extra on an unrenamed spell", async () => {
    characters.spellcasting.mockResolvedValue([
      caster([
        spell({ alias: { name: "Moonlit Ward", note: "Silver light, not bark." } }),
        spell({ id: "ID_SHIELD", name: "Shield", level: 1 }),
      ]),
    ]);
    await render();
    const rows = [...document.querySelectorAll(".fcb-table tbody tr")];
    // Level 1 is the first tab: the unrenamed spell.
    expect(rows[0].textContent).toContain("Shield");
    expect(rows[0].querySelector('[data-testid="spell-real-name"]')).toBeNull();
    await act(async () => buttons().find((entry) => entry.textContent.trim().startsWith("2nd"))?.click());
    const renamed = document.querySelector(".fcb-table tbody tr");
    expect(renamed.textContent).toContain("Moonlit Ward");
    expect(renamed.querySelector('[data-testid="spell-real-name"]').textContent).toBe("(Barkskin)");
    expect(renamed.querySelector('[data-testid="spell-alias-note"]').textContent).toBe("Silver light, not bark.");
  });

  it("renames a spell through the dialog and shows the new name", async () => {
    characters.setSpellAlias.mockResolvedValue([caster([spell({ alias: { name: "Moonlit Ward", note: "" } })])]);
    characters.spellcasting.mockResolvedValue([caster([spell({})])]);
    await render();
    await act(async () => byLabel("Rename or add notes to Barkskin").click());
    expect(dialog().getAttribute("aria-label")).toBe("Rename or add notes to Barkskin");
    await typeInto(byLabel("Name"), "Moonlit Ward");
    await act(async () => byText("Save changes").click());
    expect(characters.setSpellAlias).toHaveBeenCalledWith("Ada", "ID_BARKSKIN", { name: "Moonlit Ward", note: "" });
    expect(dialog()).toBeNull();
    expect(document.querySelector(".fcb-table tbody tr").textContent).toContain("Moonlit Ward");
  });
});

describe("a spell made on the character", () => {
  it("carries a Custom badge and an Edit that opens its own form", async () => {
    characters.spellcasting.mockResolvedValue([
      caster([spell({}), spell({ id: FROST_LANCE.elementId, name: "Frost Lance", level: 2, source: "Custom" })]),
    ]);
    characters.customContent.mockResolvedValue({ entries: [FROST_LANCE], problems: [] });
    await render();
    const rows = [...document.querySelectorAll(".fcb-table tbody tr")];
    const lance = rows.find((row) => row.textContent.includes("Frost Lance"));
    const barkskin = rows.find((row) => row.textContent.includes("Barkskin"));
    expect(lance.querySelector(".fcb-custom-badge").textContent).toBe("Custom");
    expect(barkskin.querySelector(".fcb-custom-badge")).toBeNull();
    expect(byLabel("Edit Barkskin")).toBeNull();
    await act(async () => byLabel("Edit Frost Lance").click());
    expect(dialog().getAttribute("aria-label")).toBe("Edit custom spell");
    expect(byLabel("Name").value).toBe("Frost Lance");
  });
});

describe("creating a spell from Add a spell", () => {
  it("offers Create it? when the search finds nothing, and saves the spell for the chosen caster", async () => {
    characters.saveCustomDraft.mockImplementation(async (_id, draft) => ({ character: { id: "Ada" }, entry: { draft, elementId: draft.id }, diagnostics: [] }));
    await render();
    await act(async () => byText("Spell").click());
    expect(dialog().getAttribute("aria-label")).toBe("Add a spell");
    await typeInto(document.querySelector('input[placeholder="Search all spells…"]'), "Frost Lance");
    await pause();
    expect(document.body.textContent).toContain("Frost Lance isn't in your library. Create it?");
    await act(async () => byText("Create spell").click());
    expect(dialog().getAttribute("aria-label")).toBe("Create spell");
    expect(byLabel("Name").value).toBe("Frost Lance");
    await act(async () => byText("Add spell").click());
    expect(characters.saveCustomDraft).toHaveBeenCalledTimes(1);
    const [, draft, options] = characters.saveCustomDraft.mock.calls[0];
    expect(draft).toMatchObject({ template: "spell", name: "Frost Lance" });
    expect(options).toEqual({ caster: "Wizard" });
  });
});

describe("a spell a pack grants that nothing defines", () => {
  const MISSING = {
    elementId: "ID_HB_MC_FEAT_MOONWELL_PACT",
    elementName: "Moonwell Pact",
    missingId: "ID_HB_MC_SPELL_FROST_LANCE",
    missingType: "Spell",
    message: "Moonwell Pact grants ID_HB_MC_SPELL_FROST_LANCE, which no loaded content defines",
  };

  it("is listed with the pack's element, and Create spell starts the form under the missing id", async () => {
    characters.missingGrants.mockResolvedValue([MISSING, { ...MISSING, missingId: "ID_HB_MC_PROF_X", missingType: "Proficiency" }]);
    characters.saveCustomDraft.mockImplementation(async (_id, draft) => ({ character: { id: "Ada" }, entry: { draft, elementId: draft.id }, diagnostics: [] }));
    await render();
    const panel = document.querySelector('[data-testid="missing-spells"]');
    expect(panel.textContent).toContain("Frost Lance");
    expect(panel.textContent).toContain("granted by Moonwell Pact");
    // Only spells are this tab's to fix.
    expect(panel.querySelectorAll("li")).toHaveLength(1);
    await act(async () => [...panel.querySelectorAll("button")].find((entry) => entry.textContent === "Create spell").click());
    expect(byLabel("Name").value).toBe("Frost Lance");
    await act(async () => byText("Add spell").click());
    expect(characters.saveCustomDraft.mock.calls[0][1].id).toBe("ID_HB_MC_SPELL_FROST_LANCE");
  });

  it("is not shown when nothing is missing", async () => {
    await render();
    expect(document.querySelector('[data-testid="missing-spells"]')).toBeNull();
  });
});
