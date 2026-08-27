import { describe, expect, it, vi } from "vitest";
import {
  createLatestRequestGate,
  loadMutationWorkspaceData,
  loadWorkspaceData,
  shouldRefreshWorkspaceOnActivation,
  storeResourceIfCurrent,
} from "../workspaceData.js";

function charactersApi() {
  return {
    get: vi.fn(async () => ({ id: "hero", selectionRules: [] })),
    statistics: vi.fn(async () => ({ values: { hp: 10 } })),
  };
}

describe("workspace data orchestration", () => {
  it("loads detail before exactly one statistics request", async () => {
    const characters = charactersApi();

    await expect(loadWorkspaceData(characters, "hero")).resolves.toEqual({
      detail: { id: "hero", selectionRules: [] },
      stats: { values: { hp: 10 } },
    });

    expect(characters.get).toHaveBeenCalledOnce();
    expect(characters.statistics).toHaveBeenCalledOnce();
    expect(characters.get.mock.invocationCallOrder[0]).toBeLessThan(
      characters.statistics.mock.invocationCallOrder[0],
    );
  });

  it("does not duplicate statistics after a non-detail mutation result", async () => {
    const characters = charactersApi();

    const snapshot = await loadMutationWorkspaceData(
      characters,
      "hero",
      { items: [] },
      { refreshDetail: true },
    );

    expect(snapshot.detail.id).toBe("hero");
    expect(characters.get).toHaveBeenCalledOnce();
    expect(characters.statistics).toHaveBeenCalledOnce();
  });

  it("reuses a returned character detail and only refreshes statistics", async () => {
    const characters = charactersApi();
    const detail = { id: "hero", selectionRules: [{ identifier: "race" }] };

    await expect(
      loadMutationWorkspaceData(characters, "hero", detail),
    ).resolves.toEqual({ detail, stats: { values: { hp: 10 } } });

    expect(characters.get).not.toHaveBeenCalled();
    expect(characters.statistics).toHaveBeenCalledOnce();
  });

  it("reuses any complete character detail, not only selection-rule results", async () => {
    const characters = charactersApi();
    const detail = { id: "hero", name: "Hero", level: 1 };

    await expect(
      loadMutationWorkspaceData(characters, "hero", detail),
    ).resolves.toEqual({ detail, stats: { values: { hp: 10 } } });

    expect(characters.get).not.toHaveBeenCalled();
    expect(characters.statistics).toHaveBeenCalledOnce();
  });

  it("refreshes retained character content only when returning to the workspace", () => {
    expect(shouldRefreshWorkspaceOnActivation(true, false)).toBe(false);
    expect(shouldRefreshWorkspaceOnActivation(false, false)).toBe(false);
    expect(shouldRefreshWorkspaceOnActivation(true, true)).toBe(false);
    expect(shouldRefreshWorkspaceOnActivation(false, true)).toBe(true);
  });

  it("lets only the latest workspace refresh publish its result", () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("does not let an invalidated resource request repopulate the cache", () => {
    const cache = new Map();
    const stalePromise = Promise.resolve("stale");
    const currentPromise = Promise.resolve("current");

    cache.set("spells", { promise: stalePromise });
    cache.delete("spells");
    cache.set("spells", { promise: currentPromise });

    expect(
      storeResourceIfCurrent(cache, "spells", stalePromise, "old spells"),
    ).toBe(false);
    expect(cache.get("spells")).toEqual({ promise: currentPromise });
    expect(
      storeResourceIfCurrent(cache, "spells", currentPromise, "new spells"),
    ).toBe(true);
    expect(cache.get("spells")).toEqual({ data: "new spells" });
  });
});
