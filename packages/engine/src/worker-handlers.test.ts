import { ENGINE_VERSION } from "@forge-cb/api";
import { describe, expect, it, beforeAll, vi } from "vitest";
import {
  ENGINE_METHOD_NAMES,
  METHOD_SUPPORT,
  createEngineDispatcher,
  type EngineWorkerMessage,
  type WorkerScope,
} from "@forge-cb/api";
import { CharacterService } from "./character/service.js";
import { type ElementLibrary } from "./content/library.js";
import { createEngineMethodHandlers, startCharacterEngineWorker } from "./worker-handlers.js";
import { resolveCharacterSheetTemplateUrl } from "./sheet/templates.js";
import { CHARACTER_LOAD_MANIFEST, FAST_START_MANIFEST } from "./snapshot/identities.js";
import { buildCorpusLibrary } from "./testing/corpus.js";
import {
  buildFighter3,
  buildFullSheetCharacter,
  buildPaladin3,
  buildRogue5,
  buildWizard4,
  type BuiltCharacter,
} from "./testing/character-factory.js";

/** Installs a factory-built character into `service` under `id`. */
const importBuilt = (service: CharacterService, id: string, built: BuiltCharacter): void => {
  service.importCharacterXml(id, built.service.exportCharacterXml(built.id));
};

const SHEET_BASE = "https://example.test/tools/character-builder/";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function emptyLibrary(): ElementLibrary {
  return {
    byId: new Map(),
    byType: new Map(),
    typeCounts: {},
    sources: new Map(),
    elementCount: 0,
    fileOrder: [],
    ruleset: new Map(),
    rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 },
  };
}

describe("engine worker handlers", () => {
  it("normalizes relative and absolute configured sheet bases before resolving assets", () => {
    expect(resolveCharacterSheetTemplateUrl(
      "sheets/2014/details.pdf",
      "/tools/character-builder",
      "https://example.test",
    )).toBe(`${SHEET_BASE}sheets/2014/details.pdf`);
    expect(resolveCharacterSheetTemplateUrl(
      "sheets/2014/details.pdf",
      "/tools/character-builder/",
      "https://example.test",
    )).toBe(`${SHEET_BASE}sheets/2014/details.pdf`);
    expect(resolveCharacterSheetTemplateUrl(
      "sheets/2014/details.pdf",
      "https://example.test/tools/character-builder",
      "https://other.example",
    )).toBe(`${SHEET_BASE}sheets/2014/details.pdf`);
    expect(resolveCharacterSheetTemplateUrl(
      "sheets/2014/details.pdf",
      SHEET_BASE,
      "https://other.example",
    )).toBe(`${SHEET_BASE}sheets/2014/details.pdf`);
  });

  it("returns a grouped source catalogue with publication metadata", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("source-catalogue");
    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.getCharacterSources!("source-catalogue") as {
      groups: Array<{
        name: string;
        canToggle: boolean;
        sources: Array<Record<string, unknown>>;
      }>;
      restrictedSourceIds: string[];
      unavailableRestrictedSourceIds: string[];
    };

    expect(response.restrictedSourceIds).toEqual([]);
    expect(response.unavailableRestrictedSourceIds).toEqual([]);
    expect(response.groups.length).toBeGreaterThan(0);

    const wizards = response.groups.find((group) => group.name === "Wizards of the Coast");
    expect(wizards).toBeDefined();
    expect(wizards?.canToggle).toBe(true);
    expect(wizards?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "ID_WOTC_SOURCE_PLAYERS_HANDBOOK",
        name: "Player’s Handbook",
        author: "Wizards of the Coast",
        releaseDate: "20140714",
        isPlaytest: false,
        hasElements: true,
        canToggle: true,
      }),
      expect.objectContaining({
        id: "ID_WOTC_SOURCE_PLAYERS_HANDBOOK_2024",
        name: "Player’s Handbook (2024)",
        author: "Wizards of the Coast",
        releaseDate: "20240917",
        isPlaytest: false,
        hasElements: true,
        canToggle: true,
      }),
    ]));
  });

  // Van Richten's Guide To Ravenloft names itself "Guide To", but its
  // Wereraven traits say "Guide to"; the book still has rules loaded.
  it("counts a book's elements whose source name is spelled differently", async () => {
    const ravenloft = await buildCorpusLibrary((path) =>
      path.includes("van-richtens-guide-to-ravenloft/")
      && (path.endsWith("/source.xml") || path.endsWith("/lycanthropy-wereraven.xml")));
    const service = new CharacterService(undefined, ravenloft);
    service.createCharacter("source-spelling");
    const handlers = createEngineMethodHandlers(service, ravenloft);
    const response = handlers.getCharacterSources!("source-spelling") as {
      groups: Array<{ sources: Array<Record<string, unknown>> }>;
    };
    const sources = response.groups.flatMap((group) => group.sources);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ID_WOTC_SOURCE_VAN_RICHTENS_GUIDE_TO_RAVENLOFT", hasElements: true }),
    ]));
  }, 120_000);

  it("collects the non-toggleable sources into a leading Core group", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("source-core-group");
    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.getCharacterSources!("source-core-group") as {
      groups: Array<{
        name: string;
        canToggle: boolean;
        sources: Array<Record<string, unknown>>;
      }>;
    };

    const core = response.groups[0];
    expect(core?.name).toBe("Core");
    expect(core?.canToggle).toBe(false);
    expect(core?.sources.length).toBeGreaterThan(0);
    expect(core?.sources.every((source) => source.canToggle === false)).toBe(true);
    expect(core?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ID_WOTC_SOURCE_DUNGEON_MASTERS_GUIDE" }),
      expect.objectContaining({ id: "ID_WOTC_SOURCE_MONSTER_MANUAL" }),
      expect.objectContaining({ id: "ID_SOURCE_AURORA_LEGACY_ESSENTIALS" }),
    ]));

    // Every other group holds only toggleable sources — required books no
    // longer hide inside their publisher's group.
    for (const group of response.groups.slice(1)) {
      expect(group.name).not.toBe("Core");
      expect(group.sources.every((source) => source.canToggle === true)).toBe(true);
    }
  });

  it("preserves requested restrictions and reports source IDs missing from the loaded corpus", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("source-restrictions");
    const handlers = createEngineMethodHandlers(service, library);
    const response = handlers.setCharacterSources!("source-restrictions", {
      restrictedSourceIds: [" ID_WOTC_SOURCE_PLAYERS_HANDBOOK ", "missing-source"],
    }) as {
      groups: Array<{ sources: Array<Record<string, unknown>> }>;
      restrictedSourceIds: string[];
      unavailableRestrictedSourceIds: string[];
    };

    expect(response.restrictedSourceIds).toEqual([
      "ID_WOTC_SOURCE_PLAYERS_HANDBOOK",
      "missing-source",
    ]);
    expect(response.unavailableRestrictedSourceIds).toEqual(["missing-source"]);
    expect(response.groups.flatMap((group) => group.sources)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ID_WOTC_SOURCE_PLAYERS_HANDBOOK" }),
      ]),
    );
  });

  it("boots a JSON content manifest and ingests all referenced files", async () => {
    const target = emptyLibrary();
    const service = new CharacterService(undefined, target);
    const manifest = JSON.stringify({ files: [{ path: "bundle.xml", url: "bundle.xml" }] });
    const xml = `<elements><element id="ID_MANIFEST_ITEM" name="Manifest Item" type="Item" source="Homebrew" /></elements>`;
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("manifest.json") ? manifest : xml;
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, target));
      await expect(dispatcher.dispatch({ id: 1, method: "boot", args: [{ contentUrl: "https://example.test/manifest.json" }] })).resolves.toMatchObject({
        id: 1,
        ok: true,
        result: { elementCount: 1, fileCount: 1 },
      });
      expect(target.byId.get("ID_MANIFEST_ITEM")?.identity.name).toBe("Manifest Item");
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("boots a manifest plus uploaded files in one authoritative rebuild", async () => {
    const target = emptyLibrary();
    const service = new CharacterService(undefined, target);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, target));
    const element = (id: string): string =>
      `<elements><element id="${id}" name="${id}" type="Item" source="Homebrew" /></elements>`;
    const b64 = (xml: string): string => Buffer.from(xml, "utf8").toString("base64");
    // A stale upload that the boot set no longer contains must not survive.
    await dispatcher.dispatch({
      id: 1,
      method: "ingestUploaded",
      args: [{ files: [{ path: "imports/stale.xml", base64: b64(element("ID_STALE")) }] }],
    });
    const revisionBefore = target.revision ?? 0;
    const manifest = JSON.stringify({ files: [{ path: "bundle.xml", url: "bundle.xml" }] });
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("manifest.json") ? manifest : element("ID_BUNDLED");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      const response = await dispatcher.dispatch({
        id: 2,
        method: "boot",
        args: [{
          contentUrl: "https://example.test/manifest.json",
          files: [{ path: "imports/current.xml", base64: b64(element("ID_UPLOADED")) }],
        }],
      });
      expect(response).toMatchObject({ id: 2, ok: true, result: { elementCount: 2, fileCount: 2 } });
      expect(target.byId.has("ID_BUNDLED")).toBe(true);
      expect(target.byId.has("ID_UPLOADED")).toBe(true);
      expect(target.byId.has("ID_STALE")).toBe(false);
      expect(target.revision).toBe(revisionBefore + 1);
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("fetches manifest files with bounded concurrency", async () => {
    const target = emptyLibrary();
    const service = new CharacterService(undefined, target);
    const fileCount = 24;
    const manifest = JSON.stringify({
      files: Array.from({ length: fileCount }, (_, index) => ({ path: `f${index}.xml`, url: `f${index}.xml` })),
    });
    let inFlight = 0;
    let peak = 0;
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) {
        return new Response(manifest, { status: 200, headers: { "content-type": "application/json" } });
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const name = String(url).split("/").pop()?.replace(/\.xml$/, "") ?? "item";
      return new Response(
        `<elements><element id="ID_${name}" name="${name}" type="Item" source="Homebrew" /></elements>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }));
    try {
      const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, target));
      await expect(dispatcher.dispatch({ id: 1, method: "boot", args: [{ contentUrl: "https://example.test/manifest.json" }] })).resolves.toMatchObject({
        id: 1,
        ok: true,
        result: { fileCount },
      });
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(target.fileOrder).toHaveLength(fileCount);
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("binds every method classified as implemented", async () => {
    const library = emptyLibrary();
    const service = new CharacterService(undefined, library);
    const handlers = createEngineMethodHandlers(service, library);
    const dispatcher = createEngineDispatcher(handlers);
    service.createCharacter("Ada");
    const xmlBase64 = Buffer.from(service.exportCharacterXml("Ada"), "utf8").toString("base64");

    // Pre-build the snapshot buffers the dispatch loop needs: bootFromSnapshot
    // (index 1) dispatches before prepareFastStartSnapshot (6), and
    // importCharacterXmlWithSnapshot (34) dispatches before
    // prepareCharacterLoadSnapshot (36). A fresh character on an empty library
    // cannot be snapshotted (8 load issues -> conflict), so the character
    // import argument uses an empty body and exercises the xml-fallback path.
    const fastStartPrepared = await dispatcher.dispatch({ id: 1, method: "prepareFastStartSnapshot", args: [] });
    expect(fastStartPrepared).toMatchObject({ id: 1, ok: true, result: { elementCount: 0 } });
    const fastStartBuffer = await dispatcher.dispatch({ id: 2, method: "getFastStartSnapshotBuffer", args: [] });
    expect(fastStartBuffer.ok).toBe(true);
    const charPrepared = await dispatcher.dispatch({ id: 3, method: "prepareCharacterLoadSnapshot", args: ["Ada", CHARACTER_LOAD_MANIFEST] });
    expect(charPrepared).toMatchObject({ id: 3, ok: false, error: { code: "conflict" } });
    const charBuffer = new ArrayBuffer(0);

    const args: Partial<Record<(typeof ENGINE_METHOD_NAMES)[number], unknown[]>> = {
      contentStatus: [],
      contentSources: [],
      contentElement: ["missing"],
      createCharacter: ["Grace"],
      getCharacter: ["Ada"],
      setPortrait: ["Ada", "cG9ydHJhaXQ="],
      removePortrait: ["Ada"],
      updateDetails: ["Ada", { playerName: "Player" }],
      setAbilities: ["Ada", { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }],
      getSelectionOptions: ["Ada", "missing"],
      setSelection: ["Ada", "missing", { selectionId: "missing" }],
      clearSelection: ["Ada", "missing", {}],
      getOptionalRules: ["Ada"],
      setCharacterOption: ["Ada", { optionId: "missing", enabled: true }],
      getRulesetMode: ["Ada"],
      setRulesetMode: ["Ada", { mode: "all" }],
      getCharacterAdjustments: ["Ada"],
      setCharacterControl: ["Ada", { key: "invalid", enabled: true }],
      getStatistics: ["Ada"],
      exportCharacterXml: ["Ada"],
      importCharacterXml: ["copy", xmlBase64],
      levelUp: ["Ada", { mode: "main" }],
      levelUpTo: ["Ada", { level: 2 }],
      levelDown: ["Ada"],
      delevel: ["Ada", { mode: "last" }],
      undoDelevel: ["Ada"],
      setHitPointRoll: ["Ada", { classId: "missing", classLevel: 1, value: 1 }],
      getProgression: ["Ada"],
      getInventory: ["Ada"],
      getItemBaseOptions: ["Ada", "missing"],
      addItem: ["Ada", { itemId: "missing" }],
      removeItem: ["Ada", "missing"],
      extractItem: ["Ada", "missing"],
      equipItem: ["Ada", "missing", { location: "none" }],
      setItemStorage: ["Ada", "missing", { storage: null }],
      attuneItem: ["Ada", "missing", { attuned: true }],
      setCoins: ["Ada", { copper: 1, silver: 2, electrum: 3, gold: 4, platinum: 5 }],
      getAttacks: ["Ada"],
      getAttackOptions: ["Ada"],
      createAttack: ["Ada", { mode: "manual", name: "Improvised", range: "5 ft", bonus: "+0", damage: "1", description: "" }],
      updateAttack: ["Ada", "missing", {}],
      setAttackVisibility: ["Ada", "missing", { isDisplayed: false }],
      moveAttack: ["Ada", "missing", { direction: "up" }],
      deleteAttack: ["Ada", "missing"],
      deleteCharacter: ["Grace"],
      bootFromSnapshot: [{ manifest: FAST_START_MANIFEST, expectedIdentity: FAST_START_MANIFEST, body: (fastStartBuffer as { result: ArrayBuffer }).result }],
      prepareFastStartSnapshot: [],
      getFastStartSnapshotBuffer: [],
      importCharacterXmlWithSnapshot: ["Ada", xmlBase64, CHARACTER_LOAD_MANIFEST, charBuffer],
      getCharacterLoadDiagnostics: [],
      prepareCharacterLoadSnapshot: ["Ada", CHARACTER_LOAD_MANIFEST],
      getCharacterLoadSnapshotBuffer: [],
    };
    const implemented = ENGINE_METHOD_NAMES.filter((method) => METHOD_SUPPORT[method].status === "implemented");

    expect(Object.keys(handlers).sort()).toEqual([...implemented].sort());
    for (const [index, method] of implemented.entries()) {
      const response = await dispatcher.dispatch({ id: 100 + index, method, args: args[method] });
      if (!response.ok) expect(response.error.code).not.toBe("unsupported");
    }
  });

  it("routes implemented character, inventory, attack, and content methods", async () => {
    const library = emptyLibrary();
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    const created = await dispatcher.dispatch({ id: 1, method: "createCharacter", args: ["Ada"] });
    expect(created).toMatchObject({ id: 1, ok: true, result: { name: "Ada" } });
    await expect(dispatcher.dispatch({ id: 2, method: "getInventory", args: ["Ada"] })).resolves.toMatchObject({
      id: 2,
      ok: true,
      result: { items: [], attunedItemCount: 0 },
    });
    await expect(dispatcher.dispatch({ id: 3, method: "getAttacks", args: ["Ada"] })).resolves.toEqual({
      id: 3,
      ok: true,
      result: [],
    });
    await expect(dispatcher.dispatch({ id: 4, method: "contentStatus", args: [] })).resolves.toMatchObject({
      id: 4,
      ok: true,
      result: { elementCount: 0, sourceCount: 0 },
    });
  });

  it("scopes contentElements typeCounts to every filter except the type filter", async () => {
    const service = new CharacterService(undefined, library);
    const handlers = createEngineMethodHandlers(service, library);
    const query = (args: Record<string, unknown>) =>
      handlers.contentElements!(args) as {
        total: number;
        typeCounts: Record<string, number>;
      };

    // Unfiltered: the counts describe the whole library, one bucket per type.
    const unfiltered = query({ take: 1 });
    const librarySum = Object.values(unfiltered.typeCounts).reduce((sum, count) => sum + count, 0);
    expect(librarySum).toBe(unfiltered.total);

    // Source-filtered: counts shrink to that source's elements only.
    const phb = query({ source: "Player’s Handbook", take: 1 });
    const phbSum = Object.values(phb.typeCounts).reduce((sum, count) => sum + count, 0);
    expect(phbSum).toBe(phb.total);
    expect(phbSum).toBeLessThan(librarySum);
    expect(phb.typeCounts["Spell"]).toBeGreaterThan(0);

    // The type filter itself must not perturb the counts: picking a type
    // narrows the rows but the dropdown still describes all types in scope.
    const phbSpells = query({ source: "Player’s Handbook", type: "Spell", take: 1 });
    expect(phbSpells.typeCounts).toEqual(phb.typeCounts);
    expect(phbSpells.total).toBe(phb.typeCounts["Spell"]);
  });

  it("scopes contentElements by ruleset the way a character is scoped: shared content stays", () => {
    // A character in 2014 or 2024 mode loses the OTHER edition only — the same
    // rule isRestrictedForCharacter applies. Most third-party supplements
    // classify as "shared", so an exact-match filter emptied these lists.
    const service = new CharacterService(undefined, library);
    const handlers = createEngineMethodHandlers(service, library);
    const ids = (args: Record<string, unknown>) =>
      new Set((handlers.contentElements!(args) as { items: Array<{ id: string }> }).items.map((item) => item.id));

    const feats = { type: "Feat", take: 5000 };
    const all = ids(feats);
    const in2014 = ids({ ...feats, ruleset: "2014" });
    const in2024 = ids({ ...feats, ruleset: "2024" });

    const tagged = (tag: string, from: Set<string>): string[] =>
      [...from].filter((id) => library.ruleset.get(id) === tag);
    expect(tagged("shared", all).length).toBeGreaterThan(0);
    expect(tagged("2014", all).length).toBeGreaterThan(0);
    expect(tagged("2024", all).length).toBeGreaterThan(0);

    // Shared feats survive both modes; each mode drops only its opposite.
    for (const id of tagged("shared", all)) {
      expect(in2014.has(id)).toBe(true);
      expect(in2024.has(id)).toBe(true);
    }
    expect(tagged("2024", in2014)).toEqual([]);
    expect(tagged("2014", in2024)).toEqual([]);
    for (const id of tagged("2014", all)) expect(in2014.has(id)).toBe(true);
    for (const id of tagged("2024", all)) expect(in2024.has(id)).toBe(true);
  });

  it("builds the sheet model on the engine worker without touching templates", async () => {
    const target = emptyLibrary();
    const service = new CharacterService(undefined, target);
    service.createCharacter("sheet-model");
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, target));
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await dispatcher.dispatch({
        id: 1,
        method: "generateSheet",
        args: ["sheet-model", { lite: true }],
      });
      expect(response).toMatchObject({ id: 1, ok: true });
      if (response.ok) {
        const model = response.result as { characterId: string; mode: string; pageCount: number; formValues: Record<string, string> };
        expect(model.characterId).toBe("sheet-model");
        expect(model.mode).toBe("lite");
        expect(model.pageCount).toBeGreaterThan(0);
        expect(model.formValues).toMatchObject({ details_character_name: "sheet-model" });
      }
      // Templates are the render worker's job; the engine worker must not fetch.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("builds the full sheet model when requested", async () => {
    const target = emptyLibrary();
    const service = new CharacterService(undefined, target);
    service.createCharacter("full-model");
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, target));
    const response = await dispatcher.dispatch({
      id: 1,
      method: "generateSheet",
      args: ["full-model", { lite: false }],
    });
    expect(response).toMatchObject({ id: 1, ok: true });
    if (response.ok) {
      const model = response.result as { mode: string; pageCount: number };
      expect(model.mode).toBe("full");
      expect(model.pageCount).toBeGreaterThan(0);
    }
  });

  it("leaves out the sheet pages the request excludes, renumbering the rest", async () => {
    const service = new CharacterService(undefined, library);
    importBuilt(service, "page-picks", buildFullSheetCharacter(library, "page-picks"));
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    const pagesOf = async (request: Record<string, unknown>): Promise<{ kinds: string[]; numbers: number[]; count: number }> => {
      const response = await dispatcher.dispatch({ id: 1, method: "generateSheet", args: ["page-picks", request] });
      expect(response).toMatchObject({ ok: true });
      const model = (response as unknown as { result: { pageCount: number; pages: { page: number; templateKind: string }[] } }).result;
      return {
        kinds: model.pages.map((page) => page.templateKind),
        numbers: model.pages.map((page) => page.page),
        count: model.pageCount,
      };
    };

    const all = await pagesOf({ lite: false });
    expect(all.kinds).toContain("spell-cards");
    expect(all.kinds).toContain("background");

    const withoutCards = await pagesOf({ lite: false, include: { spellCards: false } });
    expect(withoutCards.kinds).not.toContain("spell-cards");
    expect(withoutCards.count).toBeLessThan(all.count);
    // No gap where the cards were: the survivors number 1..n in order.
    expect(withoutCards.numbers).toEqual(withoutCards.kinds.map((_, index) => index + 1));

    const withoutBackground = await pagesOf({ lite: false, include: { background: false } });
    expect(withoutBackground.kinds).not.toContain("background");
    expect(withoutBackground.numbers).toEqual(withoutBackground.kinds.map((_, index) => index + 1));
  });

  it("decodes imports and encodes exports at the wire boundary", async () => {
    const library = emptyLibrary();
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
    service.createCharacter("source");
    const base64 = Buffer.from(service.exportCharacterXml("source"), "utf8").toString("base64");

    await expect(dispatcher.dispatch({ id: 5, method: "importCharacterXml", args: ["copy", base64] })).resolves.toMatchObject({
      id: 5,
      ok: true,
      result: { name: "source" },
    });
    await expect(dispatcher.dispatch({ id: 6, method: "exportCharacterXml", args: ["copy"] })).resolves.toEqual({
      id: 6,
      ok: true,
      result: { base64 },
    });
  });

  it("returns progression directly after a hit-point mutation", async () => {
    const service = new CharacterService(undefined, library);
    importBuilt(service, "hp-response", buildRogue5(library, "hp-response"));
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    await expect(dispatcher.dispatch({
      id: 7,
      method: "setHitPointRoll",
      args: ["hp-response", {
        classId: "ID_WOTC_PHB_CLASS_ROGUE",
        classLevel: 2,
        value: 7,
      }],
    })).resolves.toMatchObject({
      id: 7,
      ok: true,
      result: {
        classes: [
          {
            classId: "ID_WOTC_PHB_CLASS_ROGUE",
            // Five rolled levels; the mutation lands on class level 2 only.
            hitPointValues: expect.arrayContaining([7]),
          },
        ],
        levelHistory: expect.any(Array),
      },
    });

    const progression = await dispatcher.dispatch({ id: 8, method: "getProgression", args: ["hp-response"] });
    const rogue = (progression as { result: { classes: { classId: string; hitPointValues: number[] }[] } })
      .result.classes.find((entry) => entry.classId === "ID_WOTC_PHB_CLASS_ROGUE")!;
    expect(rogue.hitPointValues).toHaveLength(5);
    expect(rogue.hitPointValues[1]).toBe(7);
  });

  it("starts the concrete character worker and emits ready", () => {
    const messages: EngineWorkerMessage[] = [];
    const scope: WorkerScope = {
      addEventListener: () => undefined,
      postMessage: (message) => messages.push(message),
    };

    startCharacterEngineWorker(scope, new CharacterService(undefined, emptyLibrary()), emptyLibrary());

    // 75: added setItemStorage (item-storage assignment).
    // 77: added setCompanionPortrait / removeCompanionPortrait.
    // 78: added levelUpTo (level straight to a target level).
    // 79: added setItemAmount (stack quantity changes).
    expect(messages).toEqual([{ type: "ready", metrics: { methodCount: 79, engineVersion: ENGINE_VERSION } }]);
  });
});

describe("character worker handlers against the real corpus", () => {
  it("exposes public equipment descriptions and metadata through content detail", () => {
    const service = new CharacterService(undefined, library);
    const handlers = createEngineMethodHandlers(service, library);

    const longsword = handlers.contentElement!("ID_WOTC_PHB_WEAPON_LONGSWORD") as Record<string, unknown>;
    const staff = handlers.contentElement!("ID_WOTC_DMG_MAGIC_ITEM_STAFF_OF_POWER") as Record<string, unknown>;

    expect(longsword.description).toContain("1d8 slashing");
    expect(longsword.description).toContain("Versatile (1d10)");
    expect(staff.description).toContain("Armor Class");
    expect(staff.rarity).toBe("Very Rare");
    expect(staff.attunement).toEqual({
      required: true,
      addition: "by a sorcerer, warlock, or wizard",
    });
  });

  it("exposes options for filled rules and clears them through the worker contract", async () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("FilledOptions");
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
    const fresh = await dispatcher.dispatch({ id: 1, method: "getCharacter", args: ["FilledOptions"] });
    const raceRule = (fresh.ok ? (fresh.result as { selectionRules: { type: string; identifier: string }[] }).selectionRules : [])
      .find((rule) => rule.type === "Race")!;

    await expect(dispatcher.dispatch({
      id: 2,
      method: "setSelection",
      args: ["FilledOptions", raceRule.identifier, { selectionId: "ID_RACE_DRAGONBORN" }],
    })).resolves.toMatchObject({ ok: true });

    const options = await dispatcher.dispatch({ id: 3, method: "getSelectionOptions", args: ["FilledOptions", raceRule.identifier] });
    expect(options).toMatchObject({ ok: true });
    expect((options as unknown as { ok: true; result: { id: string }[] }).result.map((option) => option.id)).toContain("ID_SRD_RACE_DWARF");

    await expect(dispatcher.dispatch({
      id: 4,
      method: "clearSelection",
      args: ["FilledOptions", raceRule.identifier, {}],
    })).resolves.toMatchObject({ ok: true, result: { race: "" } });
  });

  it("dispatches all 13 character methods with valid arguments and pins the results", async () => {
    const service = new CharacterService(undefined, library);
    importBuilt(service, "Meepo", buildPaladin3(library, "Meepo"));
    importBuilt(service, "Valerian", buildFighter3(library, "Valerian"));
    importBuilt(service, "Donyo", buildWizard4(library, "Donyo"));
    service.createCharacter("Ada");
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    const result = async (id: number, method: (typeof ENGINE_METHOD_NAMES)[number], args: unknown[]): Promise<unknown> => {
      const response = await dispatcher.dispatch({ id, method, args });
      return response.ok ? response.result : null;
    };

    const casting = (await result(10, "getSpellcasting", ["Meepo"])) as {
      name: string; identifier: string; currentPreparedCount: number;
      knownSpells: { id: string; isPrepared: boolean; isAlwaysPrepared: boolean }[];
    }[];
    expect(casting).toHaveLength(1);
    expect(casting[0]!.name).toBe("Paladin");
    const casterId = casting[0]!.identifier;
    expect(casting[0]!.knownSpells.length).toBeGreaterThan(0);

    // Prepare a spell, then unprepare it: the count moves by one each way.
    const candidate = casting[0]!.knownSpells.find((spell) => !spell.isPrepared && !spell.isAlwaysPrepared)!;
    const afterPrepare = (await result(11, "setPrepared", ["Meepo", casterId, { spellId: candidate.id, prepared: true }])) as { identifier: string; currentPreparedCount: number }[];
    expect(afterPrepare).toHaveLength(1);
    expect(afterPrepare[0]!.identifier).toBe(casterId);
    expect(afterPrepare[0]!.currentPreparedCount).toBe(casting[0]!.currentPreparedCount + 1);
    const afterPrepared = (await result(12, "setPrepared", ["Meepo", casterId, { spellId: candidate.id, prepared: false }])) as { currentPreparedCount: number }[];
    expect(afterPrepared[0]!.currentPreparedCount).toBe(casting[0]!.currentPreparedCount);

    const donyoDetail = (await result(20, "getCharacter", ["Donyo"])) as { selectionRules: { identifier: string; type: string; name: string }[] };
    const cantripRule = donyoDetail.selectionRules.find((rule) => rule.type === "Spell" && rule.name.startsWith("Cantrip"))!;
    const browse = (await result(21, "getSpellBrowse", ["Donyo", cantripRule.identifier])) as { spells: unknown[]; slots: unknown[] };
    expect(browse.slots).toHaveLength(3);
    expect(browse.spells).toHaveLength(66);

    await result(30, "addGrantedSpell", ["Valerian", { spellId: "ID_PHB_SPELL_BLESS" }]);
    const dmGrants = (await result(31, "getDmGrants", ["Valerian"])) as { kind: string; id: string }[];
    expect(dmGrants.some((entry) => entry.kind === "spell" && entry.id === "ID_PHB_SPELL_BLESS")).toBe(true);
    await expect(
      dispatcher.dispatch({ id: 32, method: "addGrantedSpell", args: ["Valerian", { spellId: "ID_PHB_SPELL_BLESS" }] }),
    ).resolves.toMatchObject({ ok: false, error: { code: "conflict" } });
    await result(33, "removeGrantedSpell", ["Valerian", { spellId: "ID_PHB_SPELL_BLESS" }]);
    const grantsAfterRemove = (await result(34, "getDmGrants", ["Valerian"])) as { kind: string; id: string }[];
    expect(grantsAfterRemove.some((entry) => entry.kind === "spell" && entry.id === "ID_PHB_SPELL_BLESS")).toBe(false);

    const featGranted = (await result(40, "addGrantedFeat", ["Ada", { featId: "ID_PHB_FEAT_ALERT" }])) as { registeredElements: { id: string }[] };
    expect(featGranted.registeredElements.some((entry) => entry.id === "ID_PHB_FEAT_ALERT")).toBe(true);
    const grantsAfterFeat = (await result(41, "getDmGrants", ["Ada"])) as { kind: string; id: string }[];
    expect(grantsAfterFeat.some((entry) => entry.kind === "feat" && entry.id === "ID_PHB_FEAT_ALERT")).toBe(true);
    const featRemoved = (await result(42, "removeGrantedFeat", ["Ada", { featId: "ID_PHB_FEAT_ALERT" }])) as { registeredElements: { id: string }[] };
    expect(featRemoved.registeredElements.some((entry) => entry.id === "ID_PHB_FEAT_ALERT")).toBe(false);

    const asiGranted = (await result(50, "addGrantedAbilityScore", ["Ada", { abilityElementIds: ["ID_INTERNAL_ASI_STRENGTH"] }])) as { registeredElements: { id: string }[] };
    expect(asiGranted.registeredElements.some((entry) => entry.id === "ID_INTERNAL_ASI_STRENGTH")).toBe(true);
    const asiRemoved = (await result(51, "removeGrantedAbilityScore", ["Ada", { abilityElementId: "ID_INTERNAL_ASI_STRENGTH" }])) as { registeredElements: { id: string }[] };
    expect(asiRemoved.registeredElements.some((entry) => entry.id === "ID_INTERNAL_ASI_STRENGTH")).toBe(false);

    // A character without a companion projects null across the wire.
    await expect(dispatcher.dispatch({ id: 60, method: "getCompanion", args: ["Ada"] })).resolves.toEqual({
      id: 60,
      ok: true,
      result: null,
    });
    await expect(
      dispatcher.dispatch({ id: 61, method: "setCompanionName", args: ["Ada", { name: "Rusty" }] }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
    const appearance = (await result(70, "getAppearanceSuggestions", ["Ada", 0])) as { name: string; height: string | null };
    expect(typeof appearance.name).toBe("string");
    expect("height" in appearance).toBe(true);
  });

  it("dispatches representative error arguments for the character methods", async () => {
    const service = new CharacterService(undefined, library);
    importBuilt(service, "Meepo", buildPaladin3(library, "Meepo"));
    service.createCharacter("Ada");
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    const expectError = async (id: number, method: (typeof ENGINE_METHOD_NAMES)[number], args: unknown[], code: string): Promise<void> => {
      await expect(dispatcher.dispatch({ id, method, args })).resolves.toMatchObject({
        id,
        ok: false,
        error: { code },
      });
    };

    await expectError(1, "getSpellcasting", ["missing"], "not-found");
    await expectError(2, "setPrepared", ["Meepo", "00000000-0000-0000-0000-000000000000", { spellId: "ID_PHB_SPELL_BLESS", prepared: true }], "not-found");
    await expectError(3, "getSpellBrowse", ["Meepo", "00000000-0000-0000-0000-000000000000"], "not-found");
    await expectError(4, "removeGrantedSpell", ["Meepo", { spellId: "ID_PHB_SPELL_BLESS" }], "not-found");
    await expectError(5, "addGrantedFeat", ["Ada", { featId: "ID_NOT_A_FEAT" }], "not-found");
    await expectError(6, "removeGrantedFeat", ["Ada", { featId: "ID_PHB_FEAT_ALERT" }], "not-found");
    await expectError(7, "addGrantedAbilityScore", ["Ada", { abilityElementIds: ["ID_NOT_AN_ASI"] }], "not-found");
    await expectError(8, "removeGrantedAbilityScore", ["Ada", { abilityElementId: "ID_INTERNAL_ASI_STRENGTH" }], "not-found");
    await expectError(9, "getDmGrants", ["missing"], "not-found");
    await expectError(10, "getCompanion", ["missing"], "not-found");
    await expectError(11, "setCompanionName", ["missing", { name: "Rusty" }], "not-found");
    await expectError(12, "getAppearanceSuggestions", ["Ada", 99999999999], "invalid-argument");
  });
});

describe("snapshot worker handlers against the real corpus", () => {
  it("boots a fast start snapshot into a fresh library and serves content from it", async () => {
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));

    await expect(
      dispatcher.dispatch({ id: 1, method: "prepareFastStartSnapshot", args: [] }),
    ).resolves.toMatchObject({ id: 1, ok: true, result: { elementCount: 25960, sourceCount: 136, fileCount: 742 } });
    const prepared = await dispatcher.dispatch({ id: 2, method: "getFastStartSnapshotBuffer", args: [] });
    expect(prepared.ok).toBe(true);
    const body = (prepared as { result: ArrayBuffer }).result;
    expect(body.byteLength).toBeGreaterThan(0);

    const bootTarget = emptyLibrary();
    const bootService = new CharacterService(undefined, bootTarget);
    const bootDispatcher = createEngineDispatcher(createEngineMethodHandlers(bootService, bootTarget));
    await expect(
      bootDispatcher.dispatch({
        id: 3,
        method: "bootFromSnapshot",
        args: [{ manifest: FAST_START_MANIFEST, expectedIdentity: FAST_START_MANIFEST, body }],
      }),
    ).resolves.toMatchObject({
      id: 3,
      ok: true,
      result: { elementCount: 25960, sourceCount: 136, fileCount: 742 },
    });
    await expect(bootDispatcher.dispatch({ id: 4, method: "contentStatus", args: [] })).resolves.toMatchObject({
      id: 4,
      ok: true,
      result: { elementCount: 25960, sourceCount: 136, fileCount: 742 },
    });
    expect(bootTarget.byId.size).toBe(25960);
  }, 120_000);

  it("round-trips a character through prepare and importWithSnapshot", async () => {
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
    const xmlBase64 = Buffer.from(buildFighter3(library, "snapshot-source").service.exportCharacterXml("snapshot-source"), "utf8").toString("base64");

    await expect(
      dispatcher.dispatch({ id: 10, method: "importCharacterXml", args: ["test", xmlBase64] }),
    ).resolves.toMatchObject({ id: 10, ok: true });
    const plainDetail = await dispatcher.dispatch({ id: 11, method: "getCharacter", args: ["test"] });
    expect(plainDetail.ok).toBe(true);
    const plainExport = await dispatcher.dispatch({ id: 12, method: "exportCharacterXml", args: ["test"] });
    expect(plainExport.ok).toBe(true);
    await expect(dispatcher.dispatch({ id: 13, method: "getCharacterLoadDiagnostics", args: [] })).resolves.toMatchObject({
      id: 13,
      ok: true,
      result: { characterId: "test", restoreMode: "xml", snapshotAccepted: false, warning: null },
    });

    await expect(
      dispatcher.dispatch({ id: 14, method: "prepareCharacterLoadSnapshot", args: ["test", CHARACTER_LOAD_MANIFEST] }),
    ).resolves.toMatchObject({ id: 14, ok: true });
    const bufferResponse = await dispatcher.dispatch({ id: 15, method: "getCharacterLoadSnapshotBuffer", args: [] });
    expect(bufferResponse.ok).toBe(true);
    const charBuffer = (bufferResponse as { result: ArrayBuffer }).result;

    const restored = new CharacterService(undefined, library);
    const restoredDispatcher = createEngineDispatcher(createEngineMethodHandlers(restored, library));
    await expect(
      restoredDispatcher.dispatch({
        id: 20,
        method: "importCharacterXmlWithSnapshot",
        args: ["test", xmlBase64, CHARACTER_LOAD_MANIFEST, charBuffer],
      }),
    ).resolves.toMatchObject({ id: 20, ok: true });
    const snapshotExport = await restoredDispatcher.dispatch({ id: 21, method: "exportCharacterXml", args: ["test"] });
    expect(snapshotExport.ok).toBe(true);
    expect((snapshotExport as { result: unknown }).result).toEqual((plainExport as { result: unknown }).result);
    const snapshotDetail = await restoredDispatcher.dispatch({ id: 22, method: "getCharacter", args: ["test"] });
    expect(snapshotDetail.ok).toBe(true);
    expect((snapshotDetail as { result: unknown }).result).toEqual((plainDetail as { result: unknown }).result);
    await expect(
      restoredDispatcher.dispatch({ id: 23, method: "getCharacterLoadDiagnostics", args: [] }),
    ).resolves.toMatchObject({
      id: 23,
      ok: true,
      result: { characterId: "test", restoreMode: "snapshot", snapshotAccepted: true, warning: null },
    });
  }, 120_000);

  it("falls back to xml when a snapshot buffer is rejected and records the warning", async () => {
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
    const xmlBase64 = Buffer.from(buildFighter3(library, "snapshot-source").service.exportCharacterXml("snapshot-source"), "utf8").toString("base64");
    const poisoned = crypto.getRandomValues(new Uint8Array(8)).buffer;

    await expect(
      dispatcher.dispatch({
        id: 30,
        method: "importCharacterXmlWithSnapshot",
        args: ["test", xmlBase64, CHARACTER_LOAD_MANIFEST, poisoned],
      }),
    ).resolves.toMatchObject({ id: 30, ok: true });
    const diagnostics = await dispatcher.dispatch({ id: 31, method: "getCharacterLoadDiagnostics", args: [] });
    expect(diagnostics.ok).toBe(true);
    expect((diagnostics as { result: unknown }).result).toMatchObject({
      characterId: "test",
      restoreMode: "xml-fallback",
      snapshotAccepted: false,
    });
    const warning = ((diagnostics as { result: { warning: string | null } }).result).warning;
    expect(warning).toMatch(/^snapshot rejected: corrupt:/);
  });

  it("reports restoreMode none before any load", async () => {
    const service = new CharacterService(undefined, library);
    const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
    await expect(dispatcher.dispatch({ id: 40, method: "getCharacterLoadDiagnostics", args: [] })).resolves.toMatchObject({
      id: 40,
      ok: true,
      result: { characterId: "", restoreMode: "none", snapshotAccepted: false, warning: null },
    });
  });
});
