import { describe, expect, it, vi } from "vitest";
import type { EngineClient } from "@forge-cb/api";
import { createEngineApi, type EngineTransportOptions } from "../engineTransport.js";

type TestStore = NonNullable<EngineTransportOptions["store"]>;

function fakeStore() {
  const characters = new Map<string, Record<string, unknown>>();
  return {
    listCharacters: vi.fn(async () => [...characters.values()]),
    getCharacter: vi.fn(async (id: string) => characters.get(id)),
    putCharacter: vi.fn(async (record: Record<string, unknown>) => characters.set(String(record.id), record)),
    deleteCharacter: vi.fn(async (id: string) => characters.delete(id)),
    listContent: vi.fn(async () => []),
    putContentBatch: vi.fn(async () => undefined),
    deleteContentBatch: vi.fn(async () => []),
    listContentSources: vi.fn(async () => []),
    replaceContentSource: vi.fn(async () => []),
    removeContentSource: vi.fn(async () => []),
    removeContentSources: vi.fn(async () => []),
    clearFastStartData: vi.fn(async () => undefined),
    getMeta: vi.fn(async () => []),
  } as unknown as TestStore;
}

function fakeClient() {
  const calls: Array<[string, ...unknown[]]> = [];
  let detail = { id: "Ada", name: "Ada", race: "", class: "", background: "", level: 1 };
  const methods = [
    "boot", "createCharacter", "getCharacter", "deleteCharacter", "setCharacterSources",
    "getCharacterSources", "exportCharacterXml", "importCharacterXml", "contentStatus",
    "contentSources", "equipmentCategories", "contentElements", "contentElement", "ingestUploaded", "removeUploaded", "patchHomebrew",
    "setPortrait", "removePortrait", "updateDetails", "setAbilities", "getSelectionOptions",
    "setSelection", "clearSelection", "getOptionalRules", "getRulesetMode", "setRulesetMode", "getCharacterAdjustments",
    "setCharacterControl", "getStatistics", "levelUp", "levelDown", "delevel", "undoDelevel",
    "setHitPointRoll", "getProgression", "getSpellcasting", "setPrepared", "getSpellBrowse",
    "addGrantedSpell", "removeGrantedSpell", "addGrantedFeat", "removeGrantedFeat",
    "addGrantedAbilityScore", "removeGrantedAbilityScore", "getCompanion", "setCompanionName",
    "setCompanionPortrait", "removeCompanionPortrait",
    "getDmGrants",
    "getInventory", "getItemBaseOptions", "addItem", "removeItem", "extractItem", "equipItem",
    "setItemStorage", "attuneItem", "setCoins", "getAttacks", "getAttackOptions", "createAttack", "updateAttack",
    "setAttackVisibility", "moveAttack", "deleteAttack", "generateSheet",
    "getAppearanceSuggestions",
  ];
  const client: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of methods) {
    client[method] = vi.fn(async (...args: unknown[]) => {
      calls.push([method, ...args]);
      if (method === "createCharacter") {
        detail = { ...detail, id: String(args[0]), name: String(args[0]) };
        return detail;
      }
      if (method === "boot") return { elementCount: 1, sourceCount: 1, fileCount: 1, typeCounts: { Race: 1 } };
      if (method === "removeUploaded") return { elementCount: 1 };
      if (method === "getCharacter") return detail;
      if (method === "exportCharacterXml") return { base64: "PGNoYXJhY3Rlcj48L2NoYXJhY3Rlcj4=" };
      if (method === "contentStatus") return { elementCount: 1, sourceCount: 1, fileCount: 1, typeCounts: { Race: 1 } };
      if (method === "contentSources") return [{ id: "core", name: "Core", source: "Core" }];
      if (method === "equipmentCategories") {
        return [{
          key: "magic-weapons",
          label: "Magic Weapons",
          elementType: "Magic Item",
          itemCategory: null,
          equipSetter: "weapon",
        }];
      }
      if (method === "setCharacterSources") {
        return {
          groups: [{ name: "Wizards of the Coast", canToggle: true, sources: [] }],
          restrictedSourceIds: ["supplement"],
          unavailableRestrictedSourceIds: [],
        };
      }
      if (method === "getStatistics") return { values: {} };
      if (method === "getDmGrants") return [];
      if (method === "generateSheet") return { characterId: "Ada", mode: "lite", pageCount: 1, pages: [], formValues: {} };
      if (method === "getSelectionOptions" || method === "getOptionalRules" || method === "getCharacterAdjustments" || method === "getSpellcasting" || method === "getAttacks") return [];
      if (method === "getCompanion") return null;
      return detail;
    });
  }
  return { client: client as unknown as EngineClient, calls };
}

function contentFile(name: string, body = `<elements id="${name}" />`) {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

function statefulContentHarness() {
  const { client } = fakeClient();
  const engine = client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const store = fakeStore();
  let records: Array<Record<string, unknown>> = [];
  let failNextReplace = false;
  const liveFiles = new Map<string, string>();

  engine.ingestUploaded = vi.fn(async (request: { files: Array<{ path: string; base64: string }> }) => {
    for (const file of request.files) liveFiles.set(file.path, file.base64);
    return { elementCount: liveFiles.size };
  });
  engine.removeUploaded = vi.fn(async (request: { paths: string[] }) => {
    for (const path of request.paths) liveFiles.delete(path);
    return { elementCount: liveFiles.size };
  });
  // The authoritative boot pass replaces the installed set with bundled +
  // the request's uploaded files (single rebuild).
  engine.boot = vi.fn(async (request?: { contentUrl?: string; files?: Array<{ path: string; base64: string }> }) => {
    if (typeof request?.contentUrl === "string" && Array.isArray(request.files)) {
      liveFiles.clear();
      for (const file of request.files) liveFiles.set(file.path, file.base64);
    }
    return { elementCount: Math.max(1, liveFiles.size), sourceCount: 1, fileCount: liveFiles.size, typeCounts: { Race: 1 } };
  });

  let sources: Array<Record<string, unknown>> = [];

  store.listContent = vi.fn(async () => records.map((record) => ({ ...record })));
  store.listContentSources = vi.fn(async () => sources.map((source) => ({ ...source })));
  store.putContentBatch = vi.fn(async (next: Array<Record<string, unknown>>) => {
    records = [...records, ...next.map((record) => ({ ...record }))];
  });
  store.deleteContentBatch = vi.fn(async (paths: string[]) => {
    const pathSet = new Set(paths);
    const removed = records.filter((record) => pathSet.has(String(record.path)));
    records = records.filter((record) => !pathSet.has(String(record.path)));
    return removed;
  });
  store.replaceContentSource = vi.fn(async (source: Record<string, unknown>, next: Array<Record<string, unknown>>) => {
    if (failNextReplace) {
      failNextReplace = false;
      throw new Error("persistence failed");
    }
    const previous = records.filter((record) => record.sourceId === source.id);
    records = [
      ...records.filter((record) => record.sourceId !== source.id),
      ...next.map((record) => ({ ...record, sourceId: source.id })),
    ];
    sources = [...sources.filter((tracked) => tracked.id !== source.id), { ...source }];
    return previous;
  });
  store.removeContentSource = vi.fn(async (sourceId: string) => {
    const removed = records.filter((record) => record.sourceId === sourceId);
    records = records.filter((record) => record.sourceId !== sourceId);
    sources = sources.filter((tracked) => tracked.id !== sourceId);
    return removed;
  });
  store.removeContentSources = vi.fn(async (sourceIds: string[]) => {
    const ids = new Set(sourceIds);
    const removed = records.filter((record) => ids.has(String(record.sourceId)));
    records = records.filter((record) => !ids.has(String(record.sourceId)));
    sources = sources.filter((tracked) => !ids.has(String(tracked.id)));
    return removed;
  });

  return {
    client,
    store,
    liveFiles,
    failNextPersistence() {
      failNextReplace = true;
    },
  };
}

describe("typed FCB nested adapter", () => {
  it("replays persisted uploaded content after the bundled baseline boots", async () => {
    const { client, calls } = fakeClient();
    const store = fakeStore();
    store.listContent = vi.fn(async () => [
      { path: "imports/uploaded/rules.xml", base64: "PGVsZW1lbnRzIC8+" },
    ]);
    const api = createEngineApi({ client, store });

    await api.content.status();

    expect(store.listContent).toHaveBeenCalled();
    const bootWithFiles = calls.find(
      ([method, request]) =>
        method === "boot" && typeof request === "object" && request !== null && Array.isArray((request as { files?: unknown[] }).files),
    );
    expect(bootWithFiles).toBeDefined();
    expect((bootWithFiles![1] as { files: unknown[] }).files).toContainEqual({
      path: "imports/uploaded/rules.xml",
      base64: "PGVsZW1lbnRzIC8+",
    });
  });

  it("waits for the bundled content before querying selection options", async () => {
    const { client, calls } = fakeClient();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ files: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const api = createEngineApi({ client, store: fakeStore() });
      await api.characters.create("Ada");
      await api.characters.selectionOptions("Ada", "race-rule");

      const contentBootIndex = calls.findIndex(
        ([method, request]) => method === "boot" && typeof request === "object" && request !== null && "contentUrl" in request,
      );
      const selectionIndex = calls.findIndex(([method]) => method === "getSelectionOptions");
      expect(contentBootIndex).toBeGreaterThanOrEqual(0);
      expect(selectionIndex).toBeGreaterThan(contentBootIndex);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for bundled and persisted content before restoring a saved character", async () => {
    const { client, calls } = fakeClient();
    const store = fakeStore();
    store.getCharacter = vi.fn(async () => ({
      id: "Ada",
      xml: "<character><display-properties><name>Ada</name></display-properties></character>",
      summary: { id: "Ada", name: "Ada" },
    }));
    store.listContent = vi.fn(async () => [
      { path: "imports/uploaded/rules.xml", base64: "PGVsZW1lbnRzIC8+" },
    ]);
    const api = createEngineApi({ client, store });

    await api.characters.get("Ada");

    const persistedContentIndex = calls.findIndex(
      ([method, request]) =>
        method === "boot" && typeof request === "object" && request !== null && Array.isArray((request as { files?: unknown[] }).files),
    );
    const restoreIndex = calls.findIndex(([method]) => method === "importCharacterXml");
    expect(persistedContentIndex).toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeGreaterThan(persistedContentIndex);
  });

  it("reconstructs the same character canonically through ten invalidation cycles", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    store.getCharacter = vi.fn(async () => ({
      id: "Ada",
      xml: "<character><display-properties><name>Ada</name></display-properties></character>",
      summary: { id: "Ada", name: "Ada" },
    }));
    const api = createEngineApi({ client, store });
    const snapshots = [];

    for (let cycle = 0; cycle < 10; cycle += 1) {
      api.characters.invalidateLoadedCharacter();
      snapshots.push(await api.characters.get("Ada"));
    }

    expect(snapshots).toHaveLength(10);
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  });

  it("persists a direct progression DTO that has no character id", async () => {
    const { client } = fakeClient();
    client.setHitPointRoll = vi.fn(async () => ({ classes: [], levelHistory: [] }));
    const store = fakeStore();
    store.getCharacter = vi.fn(async () => ({
      id: "Ada",
      xml: "<character />",
      summary: { id: "Ada", name: "Ada" },
    }));
    const api = createEngineApi({ client, store });

    await expect(api.characters.setHitPointRoll("Ada", "fighter", 2, 8)).resolves.toEqual({
      classes: [],
      levelHistory: [],
    });
    // Mutations return before the debounced IndexedDB write lands; the flush
    // drains it deterministically.
    await api.characters.flushPendingSaves();
    expect(store.putCharacter).toHaveBeenCalled();
  });

  describe("manual save", () => {
    const putCalls = (store: TestStore): number => (store.putCharacter as ReturnType<typeof vi.fn>).mock.calls.length;

    async function manualSaveApi() {
      const { client } = fakeClient();
      const store = fakeStore();
      const api = createEngineApi({ client, store });
      await api.characters.create("Ada");
      (store.putCharacter as ReturnType<typeof vi.fn>).mockClear();
      await api.characters.setAutosaveEnabled(false);
      return { api, client, store };
    }

    it("holds a mutation in memory while autosave is off and writes it on saveCharacter", async () => {
      vi.useFakeTimers();
      try {
        const { api, store } = await manualSaveApi();
        await api.characters.updateDetails("Ada", { name: "Ada" });
        await vi.advanceTimersByTimeAsync(2000);
        expect(putCalls(store)).toBe(0);
        expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
        expect(api.characters.hasUnsavedChanges()).toBe(true);

        await api.characters.saveCharacter("Ada");
        expect(putCalls(store)).toBe(1);
        expect(api.characters.hasUnsavedChanges("Ada")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("defers durability-critical mutations too while autosave is off", async () => {
      const { api, store } = await manualSaveApi();
      await api.characters.setPortrait("Ada", "AA==");
      expect(putCalls(store)).toBe(0);
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
    });

    it("flushPendingSaves still writes dirty characters while autosave is off", async () => {
      const { api, store } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      await api.characters.flushPendingSaves();
      expect(putCalls(store)).toBe(1);
      expect(api.characters.hasUnsavedChanges()).toBe(false);
    });

    it("re-enabling autosave writes every dirty character", async () => {
      const { api, store } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      await api.characters.setAutosaveEnabled(true);
      expect(putCalls(store)).toBe(1);
      expect(api.characters.hasUnsavedChanges()).toBe(false);
      expect(api.characters.getAutosaveEnabled()).toBe(true);
    });

    it("notifies unsaved-change subscribers on the dirty and clean transitions", async () => {
      const { api } = await manualSaveApi();
      const seen: string[][] = [];
      const unsubscribe = api.characters.onUnsavedChange((ids: string[]) => seen.push(ids));
      // The undo history publishes too, so compare the distinct unsaved sets.
      const transitions = (): string[][] =>
        seen.filter((ids, index) => index === 0 || JSON.stringify(ids) !== JSON.stringify(seen[index - 1]));
      expect(transitions()).toEqual([[]]);
      await api.characters.updateDetails("Ada", { name: "Ada" });
      await api.characters.updateDetails("Ada", { name: "Ada" });
      expect(transitions()).toEqual([[], ["Ada"]]);
      await api.characters.saveCharacter("Ada");
      expect(transitions()).toEqual([[], ["Ada"], []]);
      unsubscribe();
    });

    it("keeps a character dirty when it is edited while a save is in flight", async () => {
      const { api, client, store } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      (client.exportCharacterXml as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await gate;
        return { base64: "PGNoYXJhY3Rlcj48L2NoYXJhY3Rlcj4=" };
      });
      const saving = api.characters.saveCharacter("Ada");
      await Promise.resolve();
      await api.characters.updateDetails("Ada", { name: "Ada Two" });
      release();
      await saving;
      expect(putCalls(store)).toBe(1);
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
    });

    it("discardUnsavedChanges clears the flag and reloads the stored copy on the next get", async () => {
      const { api, client } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      (client.importCharacterXml as unknown as ReturnType<typeof vi.fn>).mockClear();
      api.characters.discardUnsavedChanges("Ada");
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(false);
      await api.characters.get("Ada");
      expect(client.importCharacterXml).toHaveBeenCalledTimes(1);
    });

    it("remove and invalidateLoadedCharacter drop the dirty flags", async () => {
      const { api } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      api.characters.invalidateLoadedCharacter();
      expect(api.characters.hasUnsavedChanges()).toBe(false);
      await api.characters.updateDetails("Ada", { name: "Ada" });
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
      await api.characters.remove("Ada");
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(false);
    });

    const decodeArg = (value: unknown): string => Buffer.from(String(value), "base64").toString("utf8");

    it("keeps an undo history while autosave is off and restores the previous state", async () => {
      const { api, client } = await manualSaveApi();
      let version = 0;
      (client.exportCharacterXml as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
        base64: Buffer.from(`<character>${++version}</character>`, "utf8").toString("base64"),
      }));
      expect(api.characters.canUndo("Ada")).toBe(false);
      await api.characters.updateDetails("Ada", { name: "One" });
      await api.characters.updateDetails("Ada", { name: "Two" });
      expect(api.characters.canUndo("Ada")).toBe(true);

      const importMock = client.importCharacterXml as unknown as ReturnType<typeof vi.fn>;
      importMock.mockClear();
      expect(await api.characters.undoLastChange("Ada")).toMatchObject({ id: "Ada" });
      expect(decodeArg(importMock.mock.calls.at(-1)![1])).toBe("<character>2</character>");
      await api.characters.undoLastChange("Ada");
      expect(decodeArg(importMock.mock.calls.at(-1)![1])).toBe("<character>1</character>");
      expect(api.characters.canUndo("Ada")).toBe(false);
      expect(await api.characters.undoLastChange("Ada")).toBeNull();
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
    });

    it("keeps the undo history under autosave and writes the restored state", async () => {
      const { client } = fakeClient();
      const store = fakeStore();
      const api = createEngineApi({ client, store });
      await api.characters.create("Ada");
      await api.characters.updateDetails("Ada", { name: "Ada" });
      expect(api.characters.canUndo("Ada")).toBe(true);
      (store.putCharacter as ReturnType<typeof vi.fn>).mockClear();

      expect(await api.characters.undoLastChange("Ada")).toMatchObject({ id: "Ada" });
      expect(api.characters.canUndo("Ada")).toBe(false);
      await api.characters.flushPendingSaves();
      expect(putCalls(store)).toBe(1);
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(false);
    });

    it("keeps the undo history when autosave is switched on", async () => {
      const { api } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      await api.characters.setAutosaveEnabled(true);
      expect(api.characters.canUndo("Ada")).toBe(true);
    });

    it("does not record an undo entry for a mutation that failed", async () => {
      const { api, client } = await manualSaveApi();
      (client.updateDetails as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
      await expect(api.characters.updateDetails("Ada", { name: "Ada" })).rejects.toThrow("nope");
      expect(api.characters.canUndo("Ada")).toBe(false);
    });

    it("discarding unsaved changes drops the undo history", async () => {
      const { api } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      expect(api.characters.canUndo("Ada")).toBe(true);
      api.characters.discardUnsavedChanges("Ada");
      expect(api.characters.canUndo("Ada")).toBe(false);
    });

    it("surfaces a failed manual save to the caller", async () => {
      const { api, store } = await manualSaveApi();
      await api.characters.updateDetails("Ada", { name: "Ada" });
      (store.putCharacter as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("quota exceeded"));
      await expect(api.characters.saveCharacter("Ada")).rejects.toThrow("quota exceeded");
      expect(api.characters.hasUnsavedChanges("Ada")).toBe(true);
    });
  });

  it("maps the public nested surface to typed method names and tuples", async () => {
    const { client, calls } = fakeClient();
    const store = fakeStore();
    const api = createEngineApi({ client, store });

    await api.characters.create("Ada");
    await api.characters.get("Ada");
    await api.characters.selectionOptions("Ada", "race-rule", 2);
    await api.characters.setSelection("Ada", "race-rule", "elf", 2);
    await api.characters.clearSelection("Ada", "race-rule", 2);
    await api.characters.setPortrait("Ada", "data:image/png;base64,AA==");
    await api.content.status();

    expect(calls).toContainEqual(["createCharacter", "Ada"]);
    expect(calls).toContainEqual(["setCharacterSources", "Ada", { restrictedSourceIds: [] }]);
    expect(calls).toContainEqual(["getSelectionOptions", "Ada", "race-rule", { number: 2 }]);
    expect(calls).toContainEqual(["setSelection", "Ada", "race-rule", { selectionId: "elf", number: 2 }]);
    expect(calls).toContainEqual(["clearSelection", "Ada", "race-rule", { number: 2 }]);
    expect(calls).toContainEqual(["setPortrait", "Ada", "data:image/png;base64,AA=="]);
    expect(calls).toContainEqual(["contentStatus"]);
  });

  it("persists a portrait change before resolving so the grid refresh sees it", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    const api = createEngineApi({ client, store });
    await api.characters.create("Ada");
    (store.putCharacter as ReturnType<typeof vi.fn>).mockClear();

    await api.characters.setPortrait("Ada", "AA==");

    expect(store.putCharacter).toHaveBeenCalled();
    const record = (store.putCharacter as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect((record.summary as Record<string, unknown>).portraitBase64).toBe("AA==");
  });

  it("strips the CDATA wrapper when re-reading a stored portrait from xml", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    store.getCharacter = vi.fn(async () => ({
      id: "Ada",
      xml: "<character><display-properties><name>Ada</name><portrait><base64><![CDATA[AA==]]></base64></portrait></display-properties></character>",
      summary: { id: "Ada", name: "Ada" },
    }));
    const api = createEngineApi({ client, store });

    const detail = await api.characters.get("Ada");

    expect(detail.portraitBase64).toBe("AA==");
  });

  it("falls back to the authoritative rebuild when incremental ingest requires a full rebuild", async () => {
    const harness = statefulContentHarness();
    const engine = harness.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // A snapshot-booted engine rejects incremental ingest with a typed
    // engine error (a plain object, not an Error instance).
    engine.ingestUploaded = vi.fn(async () => {
      throw {
        code: "conflict",
        message: "the installed content has no raw files (snapshot boot); a full content rebuild is required before incremental changes",
      };
    });
    const api = createEngineApi({ client: harness.client, store: harness.store });

    const result = await api.content.upload([contentFile("custom-spell.xml")]);

    expect(result.status).toBe("succeeded");
    expect([...harness.liveFiles.keys()].some((path) => path.endsWith("custom-spell.xml"))).toBe(true);
  });

  it("uses the dedicated equipment-categories method instead of content status", async () => {
    const { client, calls } = fakeClient();
    const api = createEngineApi({ client, store: fakeStore() });

    await expect(api.content.equipmentCategories()).resolves.toEqual([
      {
        key: "magic-weapons",
        label: "Magic Weapons",
        elementType: "Magic Item",
        itemCategory: null,
        equipSetter: "weapon",
      },
    ]);
    expect(calls).toContainEqual(["equipmentCategories"]);
    expect(calls).not.toContainEqual(["contentStatus"]);
  });

  it("forwards structured category filters to the content query", async () => {
    const { client, calls } = fakeClient();
    const api = createEngineApi({ client, store: fakeStore() });

    await api.content.elements({
      type: "Magic Item",
      equipSetter: "weapon",
      itemCategory: "Magic Weapons",
    });

    expect(calls).toContainEqual([
      "contentElements",
      {
        type: "Magic Item",
        source: null,
        search: null,
        skip: 0,
        take: 100,
        equipSetter: "weapon",
        itemCategory: "Magic Weapons",
        ruleset: null,
        equipmentOnly: false,
      },
    ]);
  });

  it("fails loudly for malformed files and unavailable methods", async () => {
    const { client } = fakeClient();
    const api = createEngineApi({ client, store: fakeStore() });
    await expect(api.content.upload([{ name: "rules.xml" }])).rejects.toThrow(/Unsupported content upload input/);
    await expect(api.content.upload([{ bytes: new TextEncoder().encode("<elements />") }]))
      .rejects.toThrow(/missing a file name/);
    expect(api.content.noSuchMethod).toBeUndefined();
  });

  it("returns the source mutation response instead of refetching character detail", async () => {
    const { client } = fakeClient();
    const api = createEngineApi({ client, store: fakeStore() });

    await api.characters.create("Ada");
    await expect(api.characters.setSources("Ada", ["supplement"])).resolves.toEqual({
      groups: [{ name: "Wizards of the Coast", canToggle: true, sources: [] }],
      restrictedSourceIds: ["supplement"],
      unavailableRestrictedSourceIds: [],
    });
  });

  it("preserves atomic homebrew staging and maps the sheet handoff", async () => {
    const { client, calls } = fakeClient();
    const store = fakeStore();
    const api = createEngineApi({ client, store });
    const file = {
      name: "rules.xml",
      arrayBuffer: async () => new TextEncoder().encode("<elements />").buffer,
    };

    const upload = await api.content.upload([file], "homebrew", { sourceId: "homebrew-test" });
    expect(store.putContentBatch).toHaveBeenCalledWith([
      expect.objectContaining({ path: "imports/homebrew-test/rules.xml", sourceId: "homebrew-test" }),
    ]);
    expect(calls).toContainEqual([
      "patchHomebrew",
      expect.objectContaining({ path: "imports/homebrew-test/rules.xml" }),
    ]);
    expect(upload.status).toBe("succeeded");

    await api.content.remove("imports/homebrew-test/rules.xml");
    expect(store.deleteContentBatch).toHaveBeenCalledWith(["imports/homebrew-test/rules.xml"]);

    await api.characters.create("Ada");
    const sheetRenderer = vi.fn(async (_model: unknown, _base: string) =>
      new Uint8Array([37, 80, 68, 70]),
    );
    const renderedApi = createEngineApi({ client, store, sheetRenderer });
    const bytes = await renderedApi.characters.sheetBytes("Ada", { lite: true });
    expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(calls).toContainEqual(["generateSheet", "Ada", { lite: true }]);
    expect(sheetRenderer).toHaveBeenCalledOnce();
    const sheetUrl = await renderedApi.characters.sheet("Ada", { lite: true });
    expect(sheetUrl).toMatch(/^blob:/);
    URL.revokeObjectURL(sheetUrl);
  });

  it("reports accepted filenames, tracks an XML source, and reports removal counts", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    const api = createEngineApi({ client, store });
    const file = {
      name: "fighter.xml",
      arrayBuffer: async () => new TextEncoder().encode("<elements />").buffer,
    };

    const upload = await api.content.upload([file]);
    expect(upload.files).toEqual([
      expect.objectContaining({
        accepted: true,
        fileName: "fighter.xml",
        relativePath: "fighter.xml",
      }),
    ]);
    expect(store.replaceContentSource).toHaveBeenCalledWith(
      expect.objectContaining({ fileCount: 1 }),
      [expect.objectContaining({ relativePath: "fighter.xml" })],
    );

    const removal = await api.content.remove("imports/source/fighter.xml");
    expect(removal).toMatchObject({ status: "succeeded", elementCountAfterReload: 1 });
  });

  it("removes an uploaded path from the live engine when the persisted file is removed", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });

    await api.content.upload([contentFile("fighter.xml")], null, { sourceId: "fighter" });
    expect([...liveFiles.keys()]).toEqual(["imports/fighter/fighter.xml"]);

    await api.content.remove("imports/fighter/fighter.xml");
    expect([...liveFiles.keys()]).toEqual([]);
  });

  it("removes every returned source path from the live engine", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });

    await api.content.upload([
      contentFile("first.xml"),
      contentFile("second.xml"),
    ], null, { sourceId: "remove-me" });
    await api.content.upload([contentFile("keep.xml")], null, { sourceId: "keep" });
    await api.content.removeSource("remove-me");
    expect([...liveFiles.keys()]).toEqual(["imports/keep/keep.xml"]);

    await api.content.resolveDuplicates({ action: "remove", removeSourceIds: ["keep"] });
    expect([...liveFiles.keys()]).toEqual([]);
  });

  it("removes stale prior paths when replacing a tracked source", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const replacementBody = "<elements><element id=\"replacement\" /></elements>";

    await api.content.upload([
      contentFile("old-one.xml"),
      contentFile("old-two.xml"),
    ], null, { sourceId: "replace-me" });
    await api.content.replaceSource(
      [{ file: contentFile("old-one.xml", replacementBody), relativePath: "old-one.xml" }],
      { id: "replace-me", kind: "files", label: "Replacement" },
    );

    expect([...liveFiles]).toEqual([[
      "imports/replace-me/old-one.xml",
      btoa(replacementBody),
    ]]);
  });

  it("ingests the byte candidates produced by folder and web imports", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const spells = "<elements><element id=\"spell\" /></elements>";
    const races = "<elements><element id=\"race\" /></elements>";
    // resolveFolderSource / resolveWebSource read every file up front and hand
    // over decoded bytes, not File handles.
    const candidates = [
      {
        name: "spells.xml",
        relativePath: "core/spells.xml",
        bytes: new TextEncoder().encode(spells),
        originUrl: null,
      },
      {
        name: "races.xml",
        relativePath: "core/races.xml",
        bytes: new TextEncoder().encode(races),
        originUrl: "https://raw.githubusercontent.test/owner/repo/main/core/races.xml",
      },
    ];

    const result = await api.content.replaceSource(candidates, {
      id: "elements",
      kind: "folder",
      label: "elements-master",
    });

    expect(result).toMatchObject({ status: "succeeded" });
    expect(result.source).toMatchObject({ id: "elements", fileCount: 2 });
    expect([...liveFiles]).toEqual([
      ["imports/elements/core/spells.xml", btoa(spells)],
      ["imports/elements/core/races.xml", btoa(races)],
    ]);
    expect(store.replaceContentSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: "elements", fileCount: 2 }),
      [
        expect.objectContaining({ relativePath: "core/spells.xml" }),
        expect.objectContaining({ relativePath: "core/races.xml" }),
      ],
    );
  });

  it("accepts byte candidates, text, and base64 through the untracked upload route", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const bytesBody = "<elements><element id=\"bytes\" /></elements>";
    const textBody = "<elements><element id=\"text\" /></elements>";
    const base64Body = "<elements><element id=\"base64\" /></elements>";

    await api.content.upload([
      { relativePath: "bytes.xml", bytes: new TextEncoder().encode(bytesBody) },
      { relativePath: "text.xml", text: textBody },
      { relativePath: "base64.xml", base64: btoa(base64Body) },
    ], null, { sourceId: "mixed" });

    expect([...liveFiles]).toEqual([
      ["imports/mixed/bytes.xml", btoa(bytesBody)],
      ["imports/mixed/text.xml", btoa(textBody)],
      ["imports/mixed/base64.xml", btoa(base64Body)],
    ]);
  });

  it("keeps the bytes on disk rather than a re-encoded copy", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    // A BOM plus non-ASCII characters round-trips byte-for-byte; the engine
    // strips the BOM when it decodes, so the client must not pre-mangle it.
    const body = "﻿<elements><element name=\"Dæmon — ½\" /></elements>";
    const bytes = new TextEncoder().encode(body);

    await api.content.upload([
      { relativePath: "bom.xml", bytes },
    ], null, { sourceId: "bom" });

    expect(liveFiles.get("imports/bom/bom.xml")).toBe(
      btoa(String.fromCharCode(...bytes)),
    );
  });

  it("reports a duplicate import instead of storing a second identical copy", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const candidates = [
      { relativePath: "core/spells.xml", bytes: new TextEncoder().encode("<elements><element id=\"spell\" /></elements>") },
    ];

    await api.content.replaceSource(candidates, { id: "first", kind: "folder", label: "elements" });
    const live = new Map(liveFiles);

    const repeat = await api.content.replaceSource(candidates, { id: "second", kind: "folder", label: "elements copy" });

    expect(repeat).toMatchObject({ status: "duplicate" });
    expect(repeat.duplicate.matches.map((source: Record<string, unknown>) => source.id)).toEqual(["first"]);
    expect(repeat.duplicate.relativePaths).toEqual(["core/spells.xml"]);
    // Nothing was stored or ingested while the prompt is pending.
    expect(liveFiles).toEqual(live);
    expect(await store.listContentSources()).toHaveLength(1);

    const allowed = await api.content.replaceSource(
      candidates,
      { id: "second", kind: "folder", label: "elements copy" },
      { allowDuplicate: true },
    );
    expect(allowed.status).toBe("succeeded");
    expect(await store.listContentSources()).toHaveLength(2);
  });

  it("never reports a refreshed source as a duplicate of itself", async () => {
    const { client, store } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const candidates = [
      { relativePath: "core/spells.xml", bytes: new TextEncoder().encode("<elements><element id=\"spell\" /></elements>") },
    ];
    const source = { id: "tracked", kind: "folder", label: "elements" };

    await api.content.replaceSource(candidates, source);
    const refreshed = await api.content.replaceSource(candidates, source);

    // A byte-identical refresh reports unchanged (and skips the rebuild)
    // instead of succeeded or duplicate.
    expect(refreshed.status).toBe("unchanged");
    expect(await store.listContentSources()).toHaveLength(1);
  });

  it("reports duplicates for repeated file picks but never for homebrew saves", async () => {
    const { client, store } = statefulContentHarness();
    const api = createEngineApi({ client, store });

    await api.content.upload([contentFile("feats.xml")], null, { sourceId: "picked-once" });
    const repeat = await api.content.upload([contentFile("feats.xml")], null, { sourceId: "picked-again" });
    expect(repeat).toMatchObject({ status: "duplicate" });
    expect(repeat.duplicate.matches.map((source: Record<string, unknown>) => source.id)).toEqual(["picked-once"]);

    const forced = await api.content.upload([contentFile("feats.xml")], null, {
      sourceId: "picked-again",
      allowDuplicate: true,
    });
    expect(forced.status).toBe("succeeded");

    // Saving the same homebrew collection twice is a replacement, not a duplicate.
    await api.content.upload([contentFile("homebrew/collection.xml")], "homebrew");
    const resaved = await api.content.upload([contentFile("homebrew/collection.xml")], "homebrew");
    expect(resaved.status).toBe("succeeded");
  });

  it("imports normally when duplicate comparison is unavailable", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    await api.content.upload([contentFile("feats.xml")], null, { sourceId: "first" });
    const crypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      const repeat = await api.content.upload([contentFile("feats.xml")], null, { sourceId: "second" });
      expect(repeat.status).toBe("succeeded");
      expect([...liveFiles.keys()]).toEqual(["imports/first/feats.xml", "imports/second/feats.xml"]);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
    }
  });

  it("restores the exact pre-operation live files when persistence fails after staging", async () => {
    const { client, store, liveFiles, failNextPersistence } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const originalBody = "<elements><element id=\"original\" /></elements>";

    await api.content.upload([contentFile("rules.xml", originalBody)], null, { sourceId: "atomic" });
    const before = new Map(liveFiles);
    failNextPersistence();

    await expect(api.content.upload([
      contentFile("rules.xml", "<elements><element id=\"replacement\" /></elements>"),
      contentFile("staged-only.xml"),
    ], null, { sourceId: "atomic" })).rejects.toThrow("persistence failed");

    expect(liveFiles).toEqual(before);
  });

  it("exports a packaged character bundling stored custom content", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    await store.putCharacter({ id: "Ada", xml: "<character />", summary: { id: "Ada", name: "Ada" } });
    (store as unknown as Record<string, unknown>).listContent = vi.fn(async () => [
      { path: "imports/src1/feats.xml", base64: "PGZlYXRzLz4=", uploadedAt: 1 },
    ]);
    const api = createEngineApi({ client, store });

    const { filename, blob } = await api.characters.exportPackage("Ada");
    expect(filename).toBe("Ada.dnd5e-pkg");
    const parsed = JSON.parse(await blob.text());
    expect(parsed.format).toBe("tcb-character-package");
    expect(parsed.version).toBe(1);
    expect(parsed.character).toEqual({ id: "Ada", xml: "<character></character>" });
    expect(parsed.content).toEqual([
      { path: "imports/src1/feats.xml", base64: "PGZlYXRzLz4=" },
    ]);
  });

  it("imports a .dnd5e-pkg envelope: bundled content first, then the embedded XML", async () => {
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const xml = "<character><display-properties><name>Donyo</name></display-properties></character>";
    const pkg = JSON.stringify({
      format: "tcb-character-package",
      version: 1,
      character: { id: "Donyo", xml },
      content: [{ path: "custom/homebrew.xml", base64: "PGVsZW1lbnRzIC8+" }],
    });
    const file = { name: "Donyo.dnd5e-pkg", text: async () => pkg };

    await expect(api.characters.import(file as unknown as File)).resolves.toMatchObject({
      id: "Donyo",
      bundledContent: true,
    });
    // The engine received the embedded character document, not the JSON envelope.
    const engine = client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const imported = engine.importCharacterXml.mock.calls.at(-1);
    expect(atob(String(imported?.[1]))).toBe(xml);
    // The bundled file was ingested as uploaded content before the import.
    expect([...liveFiles.keys()].some((path) => path.endsWith("custom/homebrew.xml"))).toBe(true);
  });

  it("imports a package written under the previous format name", async () => {
    // Packages exported before the format was renamed are already on users'
    // disks and in shared folders; the reader accepts both spellings.
    const { client, store, liveFiles } = statefulContentHarness();
    const api = createEngineApi({ client, store });
    const xml = "<character><display-properties><name>Legacy</name></display-properties></character>";
    const pkg = JSON.stringify({
      format: "aurora-character-package",
      version: 1,
      character: { id: "Legacy", xml },
      content: [{ path: "custom/homebrew.xml", base64: "PGVsZW1lbnRzIC8+" }],
    });
    const file = { name: "Legacy.dnd5e-pkg", text: async () => pkg };

    await expect(api.characters.import(file as unknown as File)).resolves.toMatchObject({
      id: "Legacy",
      bundledContent: true,
    });
    const engine = client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const imported = engine.importCharacterXml.mock.calls.at(-1);
    expect(atob(String(imported?.[1]))).toBe(xml);
    expect([...liveFiles.keys()].some((path) => path.endsWith("custom/homebrew.xml"))).toBe(true);
  });

  it("treats a non-package file as plain character XML", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    const api = createEngineApi({ client, store });
    const xml = "<character><display-properties><name>Plain</name></display-properties></character>";
    const file = { name: "Plain.dnd5e", text: async () => xml };
    await expect(api.characters.import(file as unknown as File)).resolves.toMatchObject({
      id: "Plain",
      bundledContent: false,
    });
  });

  it("uses the XML display name, allocates deterministic suffixes, and leaves storage unchanged on failure", async () => {
    const { client } = fakeClient();
    const store = fakeStore();
    const existing = {
      id: "Name",
      xml: "<character />",
      summary: { id: "Name", name: "Name" },
    };
    store.listCharacters = vi.fn(async () => [existing, {
      id: "Name (3)",
      xml: "<character />",
      summary: { id: "Name (3)", name: "Name (3)" },
    }]);
    const api = createEngineApi({ client, store });
    const xml = "<character><display-properties><name>Name</name></display-properties></character>";
    const file = { name: "wrong-filename.dnd5e", text: async () => xml };

    await expect(api.characters.import(file as unknown as File)).resolves.toMatchObject({ id: "Name (2)" });
    expect(store.putCharacter).toHaveBeenCalledWith(expect.objectContaining({ id: "Name (2)" }));

    const before = [...(await store.listCharacters())];
    client.importCharacterXml = vi.fn(async () => { throw new Error("invalid XML"); });
    await expect(api.characters.import({ name: "broken.dnd5e", text: async () => xml } as unknown as File)).rejects.toThrow("invalid XML");
    expect(await store.listCharacters()).toEqual(before);
  });
});
