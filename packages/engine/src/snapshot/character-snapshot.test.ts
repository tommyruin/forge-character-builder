import { describe, expect, it, beforeAll, vi } from "vitest";
import { CharacterService, type CharacterImportEvent } from "../character/service.js";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { buildLoadIssues } from "../character/options.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { computeStatistics } from "../statistics/calculator.js";
import { emptyCharacterState, type CharacterState } from "../character/state.js";
import {
  canonicalStringify,
  canonicalParse,
  gzipToBuffer,
  gunzipBounded,
  sha256Hex,
  CHARACTER_COMPRESSED_LIMIT,
  CHARACTER_DECOMPRESSED_LIMIT,
  PARSER_VERSION,
} from "./codec.js";
import { createCharacterSnapshotController, type CharacterSnapshotController } from "./character-snapshot.js";
import { createFastStartController } from "./fast-start.js";
import { FAST_START_MANIFEST } from "./identities.js";
import { ENGINE_VERSION } from "../index.js";
import {
  CORPUS_ROOT,
  ID,
  buildCharacter,
  buildFighter3,
  buildMulticlassCaster,
  buildPaladin3,
  buildRangerRogue8,
  buildRogue5,
  buildWizard4,
  syntheticPortrait,
  type BuiltCharacter,
} from "../testing/character-factory.js";

/**
 * Characters are built through the engine API and exported to `.dnd5e` XML.
 * Each name below is a role the snapshot tests need (a caster, a multiclass, a
 * plain level-1, a portrait-heavy character), not a stored file.
 */
const ARCHETYPES: Record<string, (lib: ElementLibrary, id: string) => BuiltCharacter> = {
  Donyo: buildWizard4,
  Meepo: buildPaladin3,
  Valerian: buildRogue5,
  Samurai: buildRangerRogue8,
  Samurai2: buildMulticlassCaster,
  Roggen: buildFighter3,
  tst: (lib, id) => buildCharacter(lib, { id, classId: ID.CLASS_FIGHTER }),
};

/** A character whose embedded portrait pushes it past the compressed limit. */
const buildPortraitHeavy = (lib: ElementLibrary, id: string): BuiltCharacter => {
  const built = buildFighter3(lib, id);
  built.service.setPortrait(id, syntheticPortrait(12 * 1024 * 1024));
  return { ...built, state: built.service.getCharacter(id) };
};

/**
 * A character carrying an item flagged for both the card and the sidebar.
 * `addItem` always writes `card="true"`; `sidebar` is a file-level attribute,
 * so it is stamped onto the exported XML.
 */
const inventoryXmlWithSidebar = (id: string): string => {
  const { service } = buildFighter3(library, id);
  service.addItem(id, { itemId: "ID_WOTC_PHB_WEAPON_LONGSWORD", amount: 1, baseElementId: null });
  return service.exportCharacterXml(id).replace("<item ", '<item sidebar="true" ');
};

const xmlCache = new Map<string, string>();

/** The exported `.dnd5e` XML for a named archetype, built once per process. */
const readFixture = (name: string): string => {
  const key = name.endsWith(".dnd5e") ? name.slice(0, -".dnd5e".length) : name;
  const cached = xmlCache.get(key);
  if (cached !== undefined) return cached;
  const build = ARCHETYPES[key] ?? (key.startsWith("Grung") ? buildPortraitHeavy : buildFighter3);
  const built = build(library, key);
  const xml = built.service.exportCharacterXml(built.id);
  xmlCache.set(key, xml);
  return xml;
};

/** Repoints a registered element at content no library provides. */
const withMissingContent = (xml: string): string =>
  xml.replace(/id="ID_INTERNAL_GRANTS_CHARACTER_BASE"/, 'id="ID_HOMEBREW_MISSING_ELEMENT"');

const IDENTITY = { client: "dm-forge-character-load", schema: 1, codec: "gzip-json" } as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
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

/** Deep structural view: Maps/Sets become sorted arrays so order is irrelevant. */
function toCanonical(value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [key, toCanonical(entry)] as const)
      .sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  }
  if (value instanceof Set) {
    return [...value]
      .map((member) => toCanonical(member))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (Array.isArray(value)) return value.map(toCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toCanonical(entry)]));
  }
  return value;
}

function expectStateEqual(actual: CharacterState, expected: CharacterState): void {
  expect(toCanonical(actual)).toEqual(toCanonical(expected));
}

/** Wires the service's onImport hook to the controller's plain-xml recorder. */
function wiredService(
  xmlText: string,
): { service: CharacterService; controller: CharacterSnapshotController; onImport: (event: CharacterImportEvent) => void } {
  let onImport: ((event: CharacterImportEvent) => void) | undefined;
  const service = new CharacterService(undefined, library, { onImport: (event) => onImport?.(event) });
  const controller = createCharacterSnapshotController(service, library);
  onImport = (event) => {
    void controller.recordXmlImport(event.id, xmlText, { parseMs: event.parseMs, hydrationMs: event.hydrationMs });
  };
  return { service, controller, onImport };
}

/** Decodes a prepared buffer back into the payload record. */
async function decodePayload(buffer: ArrayBuffer): Promise<Record<string, unknown>> {
  const decompressed = await gunzipBounded(
    new Uint8Array(buffer),
    CHARACTER_COMPRESSED_LIMIT,
    CHARACTER_DECOMPRESSED_LIMIT,
  );
  return canonicalParse(decoder.decode(decompressed)) as Record<string, unknown>;
}

/** Re-encodes a payload after a tamper mutation. */
async function tamper(
  buffer: ArrayBuffer,
  mutate: (payload: Record<string, unknown>) => void,
): Promise<ArrayBuffer> {
  const payload = await decodePayload(buffer);
  mutate(payload);
  const gz = await gzipToBuffer(encoder.encode(canonicalStringify(payload)), CHARACTER_COMPRESSED_LIMIT);
  return gz.bytes;
}

describe("character snapshot controller", () => {
  it("round-trips a complex fixture with full projection equality", async () => {
    const id = "Donyo";
    const xmlText = readFixture("Donyo.dnd5e");
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml(id, xmlText);
    sourceService.getSpellcasting(id);
    const controller = createCharacterSnapshotController(sourceService, library);

    const expectedPending = pendingSelectionRules(sourceService.getCharacter(id)).length;
    const prepared = await controller.prepare(id, IDENTITY);
    expect(prepared).toMatchObject({
      client: "dm-forge-character-load",
      schema: 1,
      codec: "gzip-json",
      libraryKind: "tcb-character-load",
      schemaVersion: 1,
      characterId: id,
      engineVersion: ENGINE_VERSION,
      parserVersion: PARSER_VERSION,
    });
    expect(prepared.xmlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.libraryDigest).toMatch(/^[0-9a-f]{64}$/);
    const sourceState = sourceService.getCharacter(id);
    expect(prepared.selectionCount).toBe(expectedPending);
    expect(prepared.elementCount).toBe(sourceState.registeredCount);
    expect(prepared.inventoryCount).toBe(sourceState.items.length);
    expect(prepared.attackCount).toBe(sourceState.attacks.length);
    expect(prepared.serializedBytes).toBeGreaterThan(0);
    expect(prepared.compressedBytes).toBeGreaterThan(0);
    expect(prepared.compressedBytes).toBeLessThanOrEqual(prepared.serializedBytes);
    expect(prepared.serializationMs).toBeGreaterThanOrEqual(0);
    expect(prepared.compressionMs).toBeGreaterThanOrEqual(0);
    expect(sourceState.selectionRuleIds.size).toBeGreaterThan(0);
    expect(sourceState.magicCasterIds.size).toBeGreaterThan(0);
    expect(prepared.finalStateDigest).toBe(
      await sha256Hex(
        canonicalStringify({ ...sourceState, selectionRuleIds: new Map(), magicCasterIds: new Map() }),
      ),
    );

    const buffer = controller.takeBuffer();
    const payload = await decodePayload(buffer);
    expect(payload.state).toBeDefined();

    const targetService = new CharacterService(undefined, library);
    const targetController = createCharacterSnapshotController(targetService, library);
    const restored = await targetController.importWithSnapshot(
      id,
      Buffer.from(xmlText, "utf8").toString("base64"),
      IDENTITY,
      buffer,
    );
    expect(restored.id).toBe(id);
    expect(targetService.exportCharacterXml(id)).toBe(sourceService.exportCharacterXml(id));
    expect(targetService.getCharacterDetail(id)).toEqual(sourceService.getCharacterDetail(id));
    expect({ values: computeStatistics(targetService.getCharacter(id), library) }).toEqual({
      values: computeStatistics(sourceService.getCharacter(id), library),
    });
    expect(targetService.getProgression(id)).toEqual(sourceService.getProgression(id));
    expect(targetService.getInventory(id)).toEqual(sourceService.getInventory(id));
    expect(targetService.getAttacks(id)).toEqual(sourceService.getAttacks(id));
    expect(targetService.getSpellcasting(id)).toEqual(sourceService.getSpellcasting(id));
    expect(targetService.getCompanion(id)).toEqual(sourceService.getCompanion(id));
    expect(targetService.getDmGrants(id)).toEqual(sourceService.getDmGrants(id));
    expectStateEqual(targetService.getCharacter(id), sourceService.getCharacter(id));
  });

  it("restores from base64 in a browser worker without the Node Buffer global", async () => {
    const id = "Donyo";
    const xmlText = readFixture("Donyo.dnd5e");
    const base64 = Buffer.from(xmlText, "utf8").toString("base64");
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml(id, xmlText);
    const sourceController = createCharacterSnapshotController(sourceService, library);
    await sourceController.prepare(id, IDENTITY);
    const body = sourceController.takeBuffer();

    const targetService = new CharacterService(undefined, library);
    const targetController = createCharacterSnapshotController(targetService, library);
    vi.stubGlobal("Buffer", undefined);
    try {
      await expect(targetController.importWithSnapshot(id, base64, IDENTITY, body)).resolves.toMatchObject({ id });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(targetController.diagnostics()).toMatchObject({ restoreMode: "snapshot", snapshotAccepted: true });
    expect(targetService.exportCharacterXml(id)).toBe(xmlText);
  });

  it("preserves Maps, Sets and optional state through the canonical codec", () => {
    const state: CharacterState = {
      ...emptyCharacterState("S1"),
      name: "S1",
      group: "party",
      generationOption: 2,
      race: "Human",
      level: 3,
      options: new Set(["ID_INTERNAL_OPTION_ALLOW_FEATS", "ID_OPTION_A"]),
      controls: new Map([
        ["option:ID_INTERNAL_OPTION_ALLOW_FEATS", true],
        ["item:ID_ITEM_1", false],
      ]),
      selectionRuleIds: new Map([
        ["0.1", "11111111-1111-1111-1111-111111111111"],
        ["2.0", "22222222-2222-2222-2222-222222222222"],
      ]),
      magicCasterIds: new Map([["Paladin", "33333333-3333-3333-3333-333333333333"]]),
      magic: null,
      delevelSnapshot: {
        documentRaw: '<character version="1.0.3"><build /></character>',
        levelRegistrations: [
          {
            totalLevel: 2,
            classId: "ID_PHB_CLASS_FIGHTER",
            classLevel: 2,
            isMulticlass: false,
            isClassStart: false,
            addedElementIds: ["ID_LEVEL_2"],
            addedNodes: [{ kind: "wrapper", type: "Feat", name: "Feat", requiredLevel: 2 }],
          },
        ],
        removedLevel: 2,
        invalidatedWrappers: [{ type: "Feat", name: "Feat", id: "", requiredLevel: 2, children: [] }],
      },
      items: [
        {
          identifier: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          itemId: "ID_PHB_ITEM_LONGSWORD",
          name: "Longsword",
          amount: 1,
          equipped: true,
          location: "primary",
          attuned: false,
          adorners: [],
          detailsName: "Longsword",
          notes: "",
        },
      ],
      spellcasting: [
        {
          name: "Paladin",
          ability: "cha",
          attack: "",
          dc: "",
          source: "Class",
          slots: { s1: "2" },
          cantrips: [],
          spells: [
            { name: "Bless", level: "1", id: "ID_PHB_SPELL_BLESS", prepared: true, alwaysPrepared: false, known: true },
          ],
        },
      ],
    };

    const restored = canonicalParse(canonicalStringify(state)) as CharacterState;
    expect(restored.options).toBeInstanceOf(Set);
    expect(restored.controls).toBeInstanceOf(Map);
    expect(restored.selectionRuleIds).toBeInstanceOf(Map);
    expect(restored.magicCasterIds).toBeInstanceOf(Map);
    expect(restored.delevelSnapshot).not.toBeNull();
    expect(restored.magic).toBeNull();
    expectStateEqual(restored, state);
  });

  const cases: Array<{
    name: string;
    expectedReason: string;
    mutate?: (payload: Record<string, unknown>) => void;
    targetId: string;
    xml?: string;
    identity?: { client: string; schema: number; codec: string };
    rawBody?: boolean;
    rawJson?: string;
  }> = [
    { name: "mismatched characterId", expectedReason: "identity-mismatch", mutate: () => undefined, targetId: "Other" },
    {
      name: "wrong xmlHash",
      expectedReason: "identity-mismatch",
      mutate: () => undefined,
      targetId: "Donyo",
      xml: "Meepo.dnd5e",
    },
    {
      name: "wrong libraryDigest",
      expectedReason: "schema-mismatch",
      mutate: (payload: Record<string, unknown>) => {
        payload.libraryDigest = "0".repeat(64);
      },
      targetId: "Donyo",
    },
    {
      name: "wrong client identity",
      expectedReason: "identity-mismatch",
      mutate: () => undefined,
      targetId: "Donyo",
      identity: { client: "other-client", schema: 1, codec: "gzip-json" },
    },
    {
      name: "wrong schema identity",
      expectedReason: "identity-mismatch",
      mutate: () => undefined,
      targetId: "Donyo",
      identity: { client: "dm-forge-character-load", schema: 2, codec: "gzip-json" },
    },
    {
      name: "wrong codec identity",
      expectedReason: "identity-mismatch",
      mutate: () => undefined,
      targetId: "Donyo",
      identity: { client: "dm-forge-character-load", schema: 1, codec: "zstd" },
    },
    {
      name: "noncanonical caller identity even when the payload matches it",
      expectedReason: "identity-mismatch",
      mutate: (payload: Record<string, unknown>) => {
        payload.client = "other-client";
        payload.schema = 99;
        payload.codec = "other-codec";
      },
      targetId: "Donyo",
      identity: { client: "other-client", schema: 99, codec: "other-codec" },
    },
    {
      name: "corrupt gzip bytes",
      expectedReason: "corrupt",
      mutate: undefined,
      targetId: "Donyo",
      rawBody: true,
    },
    {
      name: "invalid json",
      expectedReason: "invalid-json",
      mutate: undefined,
      targetId: "Donyo",
      rawJson: "this is not json",
    },
    {
      name: "structurally invalid state",
      expectedReason: "invalid-structure",
      mutate: (payload: Record<string, unknown>) => {
        (payload.state as Record<string, unknown>).registeredCount = "many";
      },
      targetId: "Donyo",
    },
    {
      name: "missing required payload key",
      expectedReason: "schema-mismatch",
      mutate: (payload: Record<string, unknown>) => {
        delete payload.libraryKind;
      },
      targetId: "Donyo",
    },
  ];
  it.each(cases)("falls back to xml import when $name", async ({ expectedReason, mutate, targetId, xml, identity, rawBody, rawJson }) => {
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml("Donyo", readFixture("Donyo.dnd5e"));
    const controller = createCharacterSnapshotController(sourceService, library);
    await controller.prepare("Donyo", IDENTITY);
    const buffer = controller.takeBuffer();

    const { service, controller: targetController } = wiredService(readFixture("Donyo.dnd5e"));
    service.importCharacterXml("tst", readFixture("tst.dnd5e"));
    const tstExportBefore = service.exportCharacterXml("tst");
    const tstDetailBefore = service.getCharacterDetail("tst");

    let body = buffer;
    let xmlForCase = xml ?? "Donyo.dnd5e";
    if (rawBody) {
      body = crypto.getRandomValues(new Uint8Array(32)).buffer;
    } else if (rawJson !== undefined) {
      body = (await gzipToBuffer(encoder.encode(rawJson), CHARACTER_COMPRESSED_LIMIT)).bytes;
    } else {
      body = await tamper(buffer, mutate!);
    }
    const base64 = Buffer.from(readFixture(xmlForCase), "utf8").toString("base64");

    const restored = await targetController.importWithSnapshot(targetId, base64, identity ?? IDENTITY, body);
    expect(restored.id).toBe(targetId);
    expect(service.exportCharacterXml(targetId)).toBe(readFixture(xmlForCase));

    const diagnostics = targetController.diagnostics();
    expect(diagnostics.characterId).toBe(targetId);
    expect(diagnostics.restoreMode).toBe("xml-fallback");
    expect(diagnostics.snapshotAccepted).toBe(false);
    expect(diagnostics.warning).toContain("snapshot rejected:");
    expect(diagnostics.warning).toContain(expectedReason);
    expect(diagnostics.parseMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.validationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.hydrationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.totalMs).toBeGreaterThanOrEqual(0);

    expect(service.exportCharacterXml("tst")).toBe(tstExportBefore);
    expect(service.getCharacterDetail("tst")).toEqual(tstDetailBefore);
  });

  it("never installs a rejected snapshot over the fallback import", async () => {
    const id = "Donyo";
    const xmlText = readFixture("Donyo.dnd5e");
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml(id, xmlText);
    const controller = createCharacterSnapshotController(sourceService, library);
    await controller.prepare(id, IDENTITY);
    const buffer = await tamper(controller.takeBuffer(), (payload) => {
      (payload.state as Record<string, unknown>).registeredCount = "many";
    });

    const freshImport = new CharacterService(undefined, library);
    freshImport.importCharacterXml("restored", xmlText);

    const { service, controller: targetController } = wiredService(xmlText);
    service.importCharacterXml("tst", readFixture("tst.dnd5e"));
    const tstExportBefore = service.exportCharacterXml("tst");
    const tstDetailBefore = service.getCharacterDetail("tst");

    const restored = await targetController.importWithSnapshot(
      "restored",
      Buffer.from(xmlText, "utf8").toString("base64"),
      IDENTITY,
      buffer,
    );
    expect(restored.id).toBe("restored");
    const installed = service.getCharacter("restored");
    expect(installed.registeredCount).toBe(freshImport.getCharacter("restored").registeredCount);
    expect(installed.registeredCount).not.toBe("many");
    expect(service.exportCharacterXml("restored")).toBe(freshImport.exportCharacterXml("restored"));
    expect({ values: computeStatistics(installed, library) }).toEqual({
      values: computeStatistics(freshImport.getCharacter("restored"), library),
    });
    expect(targetController.diagnostics().restoreMode).toBe("xml-fallback");
    expect(service.exportCharacterXml("tst")).toBe(tstExportBefore);
    expect(service.getCharacterDetail("tst")).toEqual(tstDetailBefore);
  });

  it("rejects a stale character snapshot after Fast Start replaces the shared library", async () => {
    const activeLibrary = emptyLibrary();
    const initialFastStart = createFastStartController(library);
    await initialFastStart.prepare();
    await createFastStartController(activeLibrary).boot({
      manifest: FAST_START_MANIFEST,
      expectedIdentity: FAST_START_MANIFEST,
      body: initialFastStart.takeBuffer(),
    });

    const id = "Donyo";
    const xmlText = readFixture("Donyo.dnd5e");
    const service = new CharacterService(undefined, activeLibrary);
    service.importCharacterXml(id, xmlText);
    const controller = createCharacterSnapshotController(service, activeLibrary);
    const prepared = await controller.prepare(id, IDENTITY);
    const staleBuffer = controller.takeBuffer();

    const replacementLibrary: ElementLibrary = {
      ...library,
      fileOrder: [...library.fileOrder, "p6-digest-change.xml"],
    };
    const replacementFastStart = createFastStartController(replacementLibrary);
    await replacementFastStart.prepare();
    await createFastStartController(activeLibrary).boot({
      manifest: FAST_START_MANIFEST,
      expectedIdentity: FAST_START_MANIFEST,
      body: replacementFastStart.takeBuffer(),
    });
    expect(activeLibrary.fileOrder.at(-1)).toBe("p6-digest-change.xml");

    await controller.importWithSnapshot(
      id,
      Buffer.from(xmlText, "utf8").toString("base64"),
      IDENTITY,
      staleBuffer,
    );
    expect(controller.diagnostics()).toMatchObject({
      restoreMode: "xml-fallback",
      snapshotAccepted: false,
      warning: expect.stringContaining("snapshot rejected: schema-mismatch:"),
    });
    expect(prepared.libraryDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("does not install or record anything when the xml itself is invalid", async () => {
    const { service, controller: targetController } = wiredService(readFixture("Donyo.dnd5e"));
    service.importCharacterXml("tst", readFixture("tst.dnd5e"));
    const tstExportBefore = service.exportCharacterXml("tst");
    const tstDetailBefore = service.getCharacterDetail("tst");
    const diagnosticsBefore = targetController.diagnostics();

    await expect(
      targetController.importWithSnapshot(
        "bad",
        Buffer.from("this is definitely not xml", "utf8").toString("base64"),
        IDENTITY,
        crypto.getRandomValues(new Uint8Array(32)).buffer,
      ),
    ).rejects.toMatchObject({ code: "content-invalid" });
    expect(() => service.getCharacter("bad")).toThrowError(expect.objectContaining({ code: "not-found" }));
    expect(() => service.exportCharacterXml("bad")).toThrowError(expect.objectContaining({ code: "not-found" }));
    expect(service.exportCharacterXml("tst")).toBe(tstExportBefore);
    expect(service.getCharacterDetail("tst")).toEqual(tstDetailBefore);
    expect(targetController.diagnostics()).toEqual(diagnosticsBefore);
  });

  it("records plain xml import diagnostics through the service hook", () => {
    const xmlText = readFixture("Donyo.dnd5e");
    const { service, controller } = wiredService(xmlText);
    const imported = service.importCharacterXml("Donyo", xmlText);
    const diagnostics = controller.diagnostics();
    expect(diagnostics.characterId).toBe("Donyo");
    expect(diagnostics.restoreMode).toBe("xml");
    expect(diagnostics.snapshotAccepted).toBe(false);
    expect(diagnostics.warning).toBeNull();
    expect(diagnostics.loadIssueCount).toBe(0);
    expect(diagnostics.issueKindCounts).toEqual({});
    expect(diagnostics.selectionCount).toBe(pendingSelectionRules(imported).length);
    expect(diagnostics.elementCount).toBe(imported.registeredCount);
    expect(diagnostics.inventoryCount).toBe(imported.items.length);
    expect(diagnostics.attackCount).toBe(imported.attacks.length);
    expect(diagnostics.finalStateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.parseMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.validationMs).toBe(0);
    expect(diagnostics.hydrationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.totalMs).toBeGreaterThanOrEqual(0);
    expect(service.getCharacter("Donyo")).toBeDefined();
  });

  it("records identical semantic diagnostics across xml, snapshot and xml-fallback restores", async () => {
    const id = "Donyo";
    const xmlText = readFixture("Donyo.dnd5e");
    const base64 = Buffer.from(xmlText, "utf8").toString("base64");
    const { service: xmlService, controller: xmlController } = wiredService(xmlText);
    xmlService.importCharacterXml(id, xmlText);
    const xmlDiagnostics = xmlController.diagnostics();
    expect(xmlDiagnostics.restoreMode).toBe("xml");

    const sourceService = new CharacterService(undefined, library);
    const sourceController = createCharacterSnapshotController(sourceService, library);
    sourceService.importCharacterXml(id, xmlText);
    await sourceController.prepare(id, IDENTITY);
    const snapshotBuffer = sourceController.takeBuffer();
    const { controller: snapshotController } = wiredService(xmlText);
    await snapshotController.importWithSnapshot(id, base64, IDENTITY, snapshotBuffer);
    const snapshotDiagnostics = snapshotController.diagnostics();
    expect(snapshotDiagnostics.restoreMode).toBe("snapshot");

    await sourceController.prepare(id, IDENTITY);
    const poison = await tamper(sourceController.takeBuffer(), (payload) => {
      payload.libraryDigest = "f".repeat(64);
    });
    const { service: fallbackService, controller: fallbackController } = wiredService(xmlText);
    fallbackService.importCharacterXml("tst", readFixture("tst.dnd5e"));
    await fallbackController.importWithSnapshot(id, base64, IDENTITY, poison);
    const fallbackDiagnostics = fallbackController.diagnostics();
    expect(fallbackDiagnostics.restoreMode).toBe("xml-fallback");

    for (const diagnostics of [xmlDiagnostics, snapshotDiagnostics, fallbackDiagnostics]) {
      expect(diagnostics.characterId).toBe(id);
      expect(diagnostics.loadIssueCount).toBe(0);
      expect(diagnostics.issueKindCounts).toEqual({});
    }
    const semantic = (d: { selectionCount: number; elementCount: number; inventoryCount: number; attackCount: number; finalStateDigest: string }): unknown =>
      [d.selectionCount, d.elementCount, d.inventoryCount, d.attackCount, d.finalStateDigest];
    expect(semantic(xmlDiagnostics)).toEqual(semantic(snapshotDiagnostics));
    expect(semantic(xmlDiagnostics)).toEqual(semantic(fallbackDiagnostics));
    expect(xmlDiagnostics.snapshotAccepted).toBe(false);
    expect(snapshotDiagnostics.snapshotAccepted).toBe(true);
    expect(fallbackDiagnostics.snapshotAccepted).toBe(false);
    expect(xmlDiagnostics.warning).toBeNull();
    expect(snapshotDiagnostics.warning).toBeNull();
    expect(fallbackDiagnostics.warning).toContain("snapshot rejected:");
  }, 120_000);

  it("refuses to prepare issue-bearing characters and leaves load issues untouched", async () => {
    for (const file of ["Roggen.dnd5e", "Valerian.dnd5e", "Samurai2.dnd5e", "Meepo.dnd5e"]) {
      const id = file.slice(0, -".dnd5e".length);
      const service = new CharacterService(undefined, library);
      const controller = createCharacterSnapshotController(service, library);
      // A character referencing content this library does not have carries
      // load issues, which must block snapshotting.
      service.importCharacterXml(id, withMissingContent(readFixture(file)));
      const issuesBefore = buildLoadIssues(service.getCharacter(id), library);
      expect(issuesBefore.length).toBeGreaterThan(0);

      await expect(controller.prepare(id, IDENTITY)).rejects.toMatchObject({ code: "conflict" });
      expect(buildLoadIssues(service.getCharacter(id), library)).toEqual(issuesBefore);
      expect(controller.diagnostics().restoreMode).toBe("none");
    }
  }, 120_000);

  it("holds a single pending snapshot buffer with one-shot consumption", async () => {
    const service = new CharacterService(undefined, library);
    const controller = createCharacterSnapshotController(service, library);
    service.importCharacterXml("Donyo", readFixture("Donyo.dnd5e"));
    service.importCharacterXml("Samurai", readFixture("Samurai.dnd5e"));

    expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));

    await controller.prepare("Donyo", IDENTITY);
    await controller.prepare("Samurai", IDENTITY);
    const buffer = controller.takeBuffer();
    expect((await decodePayload(buffer)).characterId).toBe("Samurai");
    expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));

    await controller.prepare("Donyo", IDENTITY);
    const donyoBuffer = controller.takeBuffer();
    const restoredService = new CharacterService(undefined, library);
    const restoredController = createCharacterSnapshotController(restoredService, library);
    await restoredController.importWithSnapshot(
      "Donyo",
      Buffer.from(readFixture("Donyo.dnd5e"), "utf8").toString("base64"),
      IDENTITY,
      donyoBuffer,
    );
    expect(restoredService.exportCharacterXml("Donyo")).toBe(readFixture("Donyo.dnd5e"));
  }, 120_000);

  it("clears an older pending buffer when the next prepare fails", async () => {
    const service = new CharacterService(undefined, library);
    const controller = createCharacterSnapshotController(service, library);
    service.importCharacterXml("Donyo", readFixture("Donyo.dnd5e"));

    await controller.prepare("Donyo", IDENTITY);
    await expect(
      controller.prepare("Donyo", { client: "wrong-client", schema: 1, codec: "gzip-json" }),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));
  });

  it("prepares and round-trips a fresh createCharacter", async () => {
    const service = new CharacterService(undefined, library);
    const controller = createCharacterSnapshotController(service, library);
    service.createCharacter("Ada");
    expect(buildLoadIssues(service.getCharacter("Ada"), library)).toEqual([]);

    const prepared = await controller.prepare("Ada", IDENTITY);
    expect(prepared.selectionCount).toBeGreaterThanOrEqual(0);
    const buffer = controller.takeBuffer();

    const restoredService = new CharacterService(undefined, library);
    const restoredController = createCharacterSnapshotController(restoredService, library);
    await restoredController.importWithSnapshot(
      "Ada",
      Buffer.from(service.exportCharacterXml("Ada"), "utf8").toString("base64"),
      IDENTITY,
      buffer,
    );
    expect(restoredService.exportCharacterXml("Ada")).toBe(service.exportCharacterXml("Ada"));
    expect(restoredService.getCharacterDetail("Ada")).toEqual(service.getCharacterDetail("Ada"));
    expect({ values: computeStatistics(restoredService.getCharacter("Ada"), library) }).toEqual({
      values: computeStatistics(service.getCharacter("Ada"), library),
    });
  });

  it("round-trips optional inventory card and sidebar flags", async () => {
    const id = "CardSidebar";
    const xmlText = inventoryXmlWithSidebar(id);
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml(id, xmlText);
    const sourceItems = sourceService.getCharacter(id).items;
    expect(sourceItems.some((item) => item.card)).toBe(true);
    expect(sourceItems.some((item) => item.sidebar)).toBe(true);

    const sourceController = createCharacterSnapshotController(sourceService, library);
    await sourceController.prepare(id, IDENTITY);
    const targetService = new CharacterService(undefined, library);
    const targetController = createCharacterSnapshotController(targetService, library);
    await targetController.importWithSnapshot(
      id,
      Buffer.from(xmlText, "utf8").toString("base64"),
      IDENTITY,
      sourceController.takeBuffer(),
    );

    expect(targetController.diagnostics()).toMatchObject({ restoreMode: "snapshot", snapshotAccepted: true });
    expect(targetService.getCharacter(id).items.map(({ identifier, card, sidebar }) => ({ identifier, card, sidebar }))).toEqual(
      sourceItems.map(({ identifier, card, sidebar }) => ({ identifier, card, sidebar })),
    );
  }, 120_000);

  it("accepts legacy character snapshots without inventory presentation flags", async () => {
    const id = "LegacyFlags";
    const xmlText = inventoryXmlWithSidebar(id);
    const sourceService = new CharacterService(undefined, library);
    sourceService.importCharacterXml(id, xmlText);
    const sourceController = createCharacterSnapshotController(sourceService, library);
    await sourceController.prepare(id, IDENTITY);
    const legacyBody = await tamper(sourceController.takeBuffer(), (payload) => {
      const items = (payload.state as { items: Array<Record<string, unknown>> }).items;
      for (const item of items) {
        delete item.card;
        delete item.sidebar;
      }
    });

    const targetService = new CharacterService(undefined, library);
    const targetController = createCharacterSnapshotController(targetService, library);
    const restored = await targetController.importWithSnapshot(
      id,
      Buffer.from(xmlText, "utf8").toString("base64"),
      IDENTITY,
      legacyBody,
    );

    expect(restored.items.every((item) => item.card === false && item.sidebar === false)).toBe(true);
    expect(targetController.diagnostics()).toMatchObject({ restoreMode: "snapshot", snapshotAccepted: true });
  }, 120_000);

  it("reports the none diagnostics before any load", () => {
    const controller = createCharacterSnapshotController(new CharacterService(undefined, library), library);
    expect(controller.diagnostics()).toEqual({
      characterId: "",
      restoreMode: "none",
      snapshotAccepted: false,
      warning: null,
      loadIssueCount: 0,
      issueKindCounts: {},
      selectionCount: 0,
      elementCount: 0,
      inventoryCount: 0,
      attackCount: 0,
      finalStateDigest: "",
      parseMs: 0,
      validationMs: 0,
      hydrationMs: 0,
      totalMs: 0,
    });
  });

  it(
    "round-trips every issue-free fixture",
    { timeout: 120_000 },
    async () => {
      const eligible: string[] = [];
      for (const file of ["Big Barb", "Billy", "Captain Billiam Burgess", "Donyo", "Elyndor", "Grung Assasin", "Grung Barbarian", "Grung Blowgun", "Grung Thrown", "Jindo", "Meepo", "Merlin", "Ribbit", "Roggen", "Samurai", "Samurai2", "Stars Druid", "Troll Guard", "Valerian", "billy-captured", "test", "tst"].map((id) => `${id}.dnd5e`)) {
        const probe = new CharacterService(undefined, library);
        probe.importCharacterXml(file.slice(0, -".dnd5e".length), readFixture(file));
        if (buildLoadIssues(probe.getCharacter(file.slice(0, -".dnd5e".length)), library).length === 0) {
          eligible.push(file);
        }
      }
      expect(eligible.length).toBeGreaterThan(0);

      let roundTripped = 0;
      for (const file of eligible) {
        const id = file.slice(0, -".dnd5e".length);
        const xmlText = readFixture(file);
        const sourceService = new CharacterService(undefined, library);
        const controller = createCharacterSnapshotController(sourceService, library);
        sourceService.importCharacterXml(id, xmlText);
        let prepared;
        try {
          prepared = await controller.prepare(id, IDENTITY);
        } catch (error) {
          // Portrait-heavy characters (multi-megabyte incompressible base64)
          // exceed CHARACTER_COMPRESSED_LIMIT and cannot be snapshotted.
          expect(error).toMatchObject({ code: "conflict" });
          continue;
        }
        const buffer = controller.takeBuffer();

        const targetService = new CharacterService(undefined, library);
        const targetController = createCharacterSnapshotController(targetService, library);
        await targetController.importWithSnapshot(id, Buffer.from(xmlText, "utf8").toString("base64"), IDENTITY, buffer);
        expect(targetService.exportCharacterXml(id)).toBe(sourceService.exportCharacterXml(id));
        expect(targetService.getCharacterDetail(id)).toEqual(sourceService.getCharacterDetail(id));
        expect({ values: computeStatistics(targetService.getCharacter(id), library) }).toEqual({
          values: computeStatistics(sourceService.getCharacter(id), library),
        });
        expect(targetController.diagnostics().restoreMode).toBe("snapshot");
        expect(prepared.selectionCount).toBeGreaterThanOrEqual(0);
        roundTripped += 1;
      }
      expect(roundTripped).toBeGreaterThan(0);
    },
  );

  it("refuses to prepare characters whose snapshots exceed the compressed limit", async () => {
    for (const file of ["Grung Assasin.dnd5e", "Grung Barbarian.dnd5e"]) {
      const id = file.slice(0, -".dnd5e".length);
      const service = new CharacterService(undefined, library);
      const controller = createCharacterSnapshotController(service, library);
      service.importCharacterXml(id, readFixture(file));
      expect(buildLoadIssues(service.getCharacter(id), library)).toEqual([]);
      await expect(controller.prepare(id, IDENTITY)).rejects.toMatchObject({ code: "conflict" });
      expect(() => controller.takeBuffer()).toThrowError(expect.objectContaining({ code: "conflict" }));
    }
  });

  it("rejects snapshot bodies beyond the compressed and decompressed limits", async () => {
    const compressed = await gzipToBuffer(crypto.getRandomValues(new Uint8Array(4096)), CHARACTER_COMPRESSED_LIMIT);
    await expect(
      gunzipBounded(new Uint8Array(compressed.bytes), 64, CHARACTER_DECOMPRESSED_LIMIT),
    ).rejects.toMatchObject({ reason: "oversized" });
    await expect(
      gunzipBounded(new Uint8Array(compressed.bytes), CHARACTER_COMPRESSED_LIMIT, 64),
    ).rejects.toMatchObject({ reason: "oversized" });
    await expect(
      gunzipBounded(crypto.getRandomValues(new Uint8Array(32)), CHARACTER_COMPRESSED_LIMIT, CHARACTER_DECOMPRESSED_LIMIT),
    ).rejects.toMatchObject({ reason: "corrupt" });

    const big = new Uint8Array(33 * 1024 * 1024);
    const gz = await gzipToBuffer(big, CHARACTER_COMPRESSED_LIMIT);
    expect(gz.compressedBytes).toBeLessThan(CHARACTER_COMPRESSED_LIMIT);

    const { service, controller } = wiredService(readFixture("Donyo.dnd5e"));
    const restored = await controller.importWithSnapshot(
      "Donyo",
      Buffer.from(readFixture("Donyo.dnd5e"), "utf8").toString("base64"),
      IDENTITY,
      gz.bytes,
    );
    expect(restored.id).toBe("Donyo");
    const diagnostics = controller.diagnostics();
    expect(diagnostics.restoreMode).toBe("xml-fallback");
    expect(diagnostics.warning).toContain("oversized");
    expect(service.exportCharacterXml("Donyo")).toBe(readFixture("Donyo.dnd5e"));
  });
});
