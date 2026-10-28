// @vitest-environment happy-dom
// Manage > Resources: tracker cards with pips for a few uses and a counter for many, the Custom
// badge, the Track switch and the Not tracked group, the switches row, the two rests, and a
// tracker kept by hand. The real panel runs against
// a stand-in engine API that keeps the counts the way the engine does.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { characters } = vi.hoisted(() => ({
  characters: {
    resources: vi.fn(),
    setTrackerUsed: vi.fn(),
    setTrackerTracked: vi.fn(),
    setResourceSwitch: vi.fn(),
    rest: vi.fn(),
    saveManualTracker: vi.fn(),
    deleteManualTracker: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({ api: { characters } }));

import ResourcesPanel from "../manage/ResourcesPanel.jsx";
import { WorkspaceContext } from "../../WorkspaceContext";
import { splitTrackers, trackerCardView, switchNote } from "../manage/resourcesModel.js";

const tracker = (extra) => ({
  id: "t",
  label: "Wild Shape",
  sources: [{ name: "Druid", kind: "book" }],
  isCustom: false,
  manual: false,
  max: 2,
  used: 1,
  remaining: 1,
  unit: "uses",
  recharge: "shortRest",
  rechargeLabel: "per Short Rest",
  tracked: true,
  ...extra,
});

const workspace = { id: "Ada", busy: false, run: (operation) => operation(), mutationTick: 0, notify: vi.fn() };

let host;
let root;
let resources;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  resources = {
    trackers: [
      tracker({ id: "ws", label: "Wild Shape" }),
      tracker({
        id: "moon", label: "Moonbeam, no slot", max: 1, used: 0, remaining: 1, recharge: "longRest", rechargeLabel: "per Long Rest", isCustom: true,
        sources: [{ name: "Blessing of the Moonwell", kind: "custom" }],
      }),
      tracker({
        id: "wand", label: "Wand of Embers", max: 7, used: 2, remaining: 5, unit: "charges", recharge: "dawn", rechargeLabel: "regained at dawn", isCustom: true,
        sources: [{ name: "Wand of Embers", kind: "custom" }],
      }),
    ],
    switches: [{ name: "Moonlit Form", on: false, sources: ["Blessing of the Moonwell"], spends: "Moonbeam, no slot" }],
  };
  characters.resources.mockImplementation(async () => structuredClone(resources));
  characters.setTrackerUsed.mockImplementation(async (_id, trackerId, used) => {
    const found = resources.trackers.find((entry) => entry.id === trackerId);
    found.used = used;
    found.remaining = found.max - used;
    return {};
  });
  characters.setTrackerTracked.mockImplementation(async (_id, trackerId, tracked) => {
    resources.trackers.find((entry) => entry.id === trackerId).tracked = tracked;
    return {};
  });
  characters.setResourceSwitch.mockImplementation(async (_id, name, on) => {
    resources.switches.find((entry) => entry.name === name).on = on;
    return {};
  });
  characters.rest.mockImplementation(async () => ({}));
  characters.saveManualTracker.mockImplementation(async () => ({}));
  characters.deleteManualTracker.mockImplementation(async () => ({}));
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function render(value = workspace) {
  await act(async () =>
    root.render(
      <WorkspaceContext.Provider value={value}>
        <ResourcesPanel />
      </WorkspaceContext.Provider>,
    ),
  );
  await settle();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await settle();
};
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
const byText = (text) => [...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === text);
const card = (label) => document.querySelector(`[data-testid="resource-card"][aria-label="${label}"]`);
const untrackedRow = (label) => document.querySelector(`[data-testid="untracked-resource"][aria-label="${label}"]`);

describe("the card view", () => {
  it("makes pips from a few uses, the spent ones counting from the right", () => {
    const view = trackerCardView(tracker({ max: 3, used: 1, remaining: 2 }));
    expect(view.asPips).toBe(true);
    expect(view.pips.map((pip) => pip.spent)).toEqual([false, false, true]);
    // Tapping an available pip spends it and the ones after it; tapping the spent one gives it back.
    expect(view.pips.map((pip) => pip.nextUsed)).toEqual([3, 2, 0]);
  });

  it("makes a counter from many, naming the unit", () => {
    const view = trackerCardView(tracker({ max: 7, used: 2, remaining: 5, unit: "charges" }));
    expect(view.asPips).toBe(false);
    expect(view.counterText).toBe("5 / 7 charges");
  });

  it("labels a book source by its name and a custom one with a badge", () => {
    expect(trackerCardView(tracker({})).source).toBe("Druid");
    expect(trackerCardView(tracker({})).badge).toBeNull();
    expect(trackerCardView(tracker({ isCustom: true, sources: [{ name: "Gift", kind: "custom" }] }))).toMatchObject({ badge: "custom", source: "Gift" });
    expect(trackerCardView(tracker({ manual: true, isCustom: true, sources: [{ name: "Boots", kind: "manual" }] })).source).toBe("Added by hand");
    expect(
      trackerCardView(tracker({ isCustom: true, pool: "Moon points", sources: [{ name: "A", kind: "custom" }, { name: "B", kind: "custom" }] })).source,
    ).toBe("Shared pool · A, B");
  });

  it("splits the trackers the player tracks from the ones turned off, and tracks one with no flag", () => {
    const { tracked, untracked } = splitTrackers([tracker({ id: "a" }), tracker({ id: "b", tracked: false }), tracker({ id: "c", tracked: undefined })]);
    expect(tracked.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(untracked.map((entry) => entry.id)).toEqual(["b"]);
    expect(trackerCardView(tracker({ tracked: false })).tracked).toBe(false);
  });

  it("says what a switch costs and applies", () => {
    expect(switchNote({ name: "Form", on: false, sources: ["Gift"], spends: "Uses" })).toBe("off · turning it on spends a use of Uses · applies the bonuses of Gift");
    expect(switchNote({ name: "Form", on: true, sources: [] })).toBe("on · applies its effects");
  });
});

describe("the Resources page", () => {
  it("shows a card per tracker with its source, a Custom badge for custom ones, pips and counters", async () => {
    await render();
    expect(document.querySelectorAll('[data-testid="resource-card"]')).toHaveLength(3);
    expect(card("Wild Shape").textContent).toContain("Druid");
    expect(card("Wild Shape").textContent).not.toContain("Custom");
    expect(card("Moonbeam, no slot").querySelector(".fcb-custom-badge")).not.toBeNull();
    expect(card("Wild Shape").querySelectorAll(".fcb-resource-pip")).toHaveLength(2);
    expect(card("Wand of Embers").querySelectorAll(".fcb-resource-pip")).toHaveLength(0);
    expect(byLabel("Wand of Embers remaining").textContent).toBe("5 / 7 charges");
  });

  it("spends a use when a pip is tapped, and regains it when a spent pip is tapped", async () => {
    await render();
    await click(byLabel("Wild Shape use 1, available"));
    expect(characters.setTrackerUsed).toHaveBeenLastCalledWith("Ada", "ws", 2);
    // The spent pips count from the right, so the leftmost spent pip is the next use to regain.
    expect(byLabel("Wild Shape use 1, spent")).not.toBeNull();
    await click(byLabel("Wild Shape use 1, spent"));
    expect(characters.setTrackerUsed).toHaveBeenLastCalledWith("Ada", "ws", 1);
  });

  it("steps a counter down and up", async () => {
    await render();
    await click(byLabel("Spend one Wand of Embers"));
    expect(characters.setTrackerUsed).toHaveBeenLastCalledWith("Ada", "wand", 3);
    expect(byLabel("Wand of Embers remaining").textContent).toBe("4 / 7 charges");
    await click(byLabel("Regain one Wand of Embers"));
    expect(characters.setTrackerUsed).toHaveBeenLastCalledWith("Ada", "wand", 2);
  });

  it("takes a short rest and a long rest", async () => {
    await render();
    await click(byText("Short rest"));
    expect(characters.rest).toHaveBeenLastCalledWith("Ada", "short");
    await click(byText("Long rest"));
    expect(characters.rest).toHaveBeenLastCalledWith("Ada", "long");
  });

  it("lists the switches and turns one on and off", async () => {
    await render();
    const toggle = byLabel("Moonlit Form");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain("turning it on spends a use of Moonbeam, no slot");
    await click(toggle);
    expect(characters.setResourceSwitch).toHaveBeenLastCalledWith("Ada", "Moonlit Form", true);
    expect(byLabel("Moonlit Form").getAttribute("aria-checked")).toBe("true");
    await click(byLabel("Moonlit Form"));
    expect(characters.setResourceSwitch).toHaveBeenLastCalledWith("Ada", "Moonlit Form", false);
  });

  it("says so when there is nothing to track", async () => {
    resources = { trackers: [], switches: [] };
    await render();
    expect(document.body.textContent).toContain("No limited uses yet");
  });

  it("adds a tracker kept by hand", async () => {
    await render();
    await click(byText("Add tracker"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const typeInto = async (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      await act(async () => {
        setter.call(element, value);
        element.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    await typeInto(dialog.querySelector('[aria-label="Limited use name"]'), "Winged Boots");
    await typeInto(dialog.querySelector('[aria-label="Uses"]'), "30");
    await act(async () => {
      const unit = dialog.querySelector('[aria-label="Unit"]');
      unit.value = "minutes";
      unit.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      const recharge = dialog.querySelector('[aria-label="Recharges on"]');
      recharge.value = "day";
      recharge.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await click([...dialog.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "Add tracker"));
    expect(characters.saveManualTracker).toHaveBeenCalledTimes(1);
    expect(characters.saveManualTracker.mock.calls[0][0]).toBe("Ada");
    expect(characters.saveManualTracker.mock.calls[0][1]).toMatchObject({
      label: "Winged Boots", max: { kind: "number", value: 30 }, unit: "minutes", recharge: "day",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("edits and removes a tracker kept by hand, and only those", async () => {
    const def = { id: "boots", label: "Winged Boots", max: { kind: "number", value: 30 }, unit: "minutes", recharge: "day" };
    resources.trackers.push(
      tracker({ id: "boots", label: "Winged Boots", max: 30, used: 0, remaining: 30, unit: "minutes", recharge: "day", rechargeLabel: "per day", manual: true, isCustom: true, sources: [{ name: "Winged Boots", kind: "manual" }], def }),
    );
    await render();
    expect(byLabel("Edit Wild Shape")).toBeNull();
    expect(byLabel("Remove Wild Shape")).toBeNull();
    await click(byLabel("Remove Winged Boots"));
    expect(characters.deleteManualTracker).toHaveBeenLastCalledWith("Ada", "boots");
    await click(byLabel("Edit Winged Boots"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.querySelector('[aria-label="Limited use name"]').value).toBe("Winged Boots");
  });

  it("gives every card a Track switch, on", async () => {
    await render();
    for (const label of ["Wild Shape", "Moonbeam, no slot", "Wand of Embers"]) {
      const toggle = card(label).querySelector(`[aria-label="Track ${label}"]`);
      expect(toggle.getAttribute("role")).toBe("switch");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      // A real button, so it takes focus and answers Enter and Space.
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.closest("label").textContent).toBe("Track");
    }
    expect(document.querySelector('[aria-label="Not tracked"]')).toBeNull();
  });

  it("moves a tracker turned off to the Not tracked group, and back when it is tracked again", async () => {
    await render();
    await click(byLabel("Track Wild Shape"));
    expect(characters.setTrackerTracked).toHaveBeenLastCalledWith("Ada", "ws", false);
    expect(workspace.notify).toHaveBeenLastCalledWith("Not tracking Wild Shape");
    expect(card("Wild Shape")).toBeNull();
    const group = document.querySelector('[aria-label="Not tracked"]');
    expect(group.textContent).toContain("Not tracked");
    expect(untrackedRow("Wild Shape")).not.toBeNull();
    expect(untrackedRow("Wild Shape").textContent).toContain("Druid");
    // No pips while it is not tracked.
    expect(untrackedRow("Wild Shape").querySelector(".fcb-resource-pip")).toBeNull();
    expect(byLabel("Track Wild Shape").getAttribute("aria-checked")).toBe("false");

    await click(byLabel("Track Wild Shape"));
    expect(characters.setTrackerTracked).toHaveBeenLastCalledWith("Ada", "ws", true);
    expect(workspace.notify).toHaveBeenLastCalledWith("Tracking Wild Shape");
    expect(card("Wild Shape")).not.toBeNull();
    expect(document.querySelector('[aria-label="Not tracked"]')).toBeNull();
  });

  it("lists what the engine says is not tracked below the cards, a tracker kept by hand with its Remove button", async () => {
    resources.trackers[0].tracked = false;
    resources.trackers.push(
      tracker({ id: "boots", label: "Winged Boots", max: 30, used: 0, remaining: 30, unit: "minutes", manual: true, isCustom: true, tracked: false, sources: [{ name: "Winged Boots", kind: "manual" }] }),
    );
    await render();
    expect(document.querySelectorAll('[data-testid="resource-card"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="untracked-resource"]')).toHaveLength(2);
    expect(byLabel("Remove Winged Boots")).not.toBeNull();
    expect(byLabel("Edit Winged Boots")).toBeNull();
    await click(byLabel("Remove Winged Boots"));
    expect(characters.deleteManualTracker).toHaveBeenLastCalledWith("Ada", "boots");
  });

  it("is read-only while the workspace is busy", async () => {
    await render({ ...workspace, busy: true });
    expect(byLabel("Track Wild Shape").disabled).toBe(true);
    expect(byLabel("Wild Shape use 1, available").disabled).toBe(true);
    expect(byText("Long rest").disabled).toBe(true);
    expect(byLabel("Moonlit Form").disabled).toBe(true);
  });
});
