import {
  startEngineWorker,
  type EngineMethodHandlers,
  type EngineWorkerRuntime,
  type WireList,
  type WireObject,
  type WorkerScope,
} from "@forge-cb/api";
import type { AbilityScores, CharacterState } from "./character/state.js";
import { CharacterService, type CharacterDetails } from "./character/service.js";
import { createEmptyLibrary, type ElementLibrary } from "./content/library.js";
import { contentStatus as getContentStatus, ingestContentFiles, patchContentFile, removeContentFiles, replaceContentSet } from "./content/ingestion.js";
import {
  buildEquipmentCategories,
  equipmentMetadata,
  isPhysicalEquipment,
  matchesEquipSetter,
  matchesItemCategory,
  publicEquipmentDescription,
} from "./content/equipment/categories.js";
import type { ParsedElement } from "./content/parser.js";
import { isContentAllowedForCharacter } from "./content/access.js";
import { expandDescriptionReferences } from "./content/description.js";
import { selectionOptions, selectionRuleForSlot } from "./selection/selection.js";
import { computeStatistics } from "./statistics/calculator.js";
import { createCharacterSnapshotController } from "./snapshot/character-snapshot.js";
import { createFastStartController } from "./snapshot/fast-start.js";
import { buildCharacterSheetModel } from "./sheet/model.js";
import { decodeBase64, encodeBase64 } from "./platform.js";
import { engineError } from "./errors.js";
import { ENGINE_VERSION } from "./index.js";

const objectResult = (value: object): WireObject => value as WireObject;
const listResult = (value: readonly object[]): WireList => value as WireList;

function sourceSetter(source: Pick<ParsedElement, "setters"> | undefined, name: string): string {
  return source?.setters.find((setter) => setter.name === name)?.value ?? "";
}

function sourceDto(source: ParsedElement, library: ElementLibrary): WireObject {
  const name = source.identity.name;
  const hasElements = [...library.byId.values()].some(
    (element) => element.identity.type !== "Source" && element.identity.source === name,
  );
  return {
    id: source.identity.id,
    name,
    source: source.identity.source,
    author: sourceSetter(source, "author"),
    releaseDate: sourceSetter(source, "release"),
    isPlaytest: sourceSetter(source, "playtest").toLocaleLowerCase() === "true",
    // A built-in stub of a book: only the System Reference Document part of it
    // ships, and an uploaded copy of the book replaces it in place.
    isIncomplete: sourceSetter(source, "incomplete").toLocaleLowerCase() === "true",
    // An uploaded book replaced the bundled core stub of this source.
    overridesBundledCore: source.overridesBundledCore === true,
    information: sourceSetter(source, "information"),
    hasElements,
    canToggle: sourceSetter(source, "core").toLocaleLowerCase() !== "true",
  };
}

function unknownSourceDto(id: string): WireObject {
  return {
    id,
    name: id,
    source: "",
    author: "",
    releaseDate: "",
    isPlaytest: false,
    isIncomplete: false,
    information: "",
    hasElements: false,
    canToggle: true,
  };
}

function sourceRecords(library: ElementLibrary): WireObject[] {
  return [...library.sources.values()]
    .map((source) => sourceDto(source, library))
    .sort((left, right) => {
      const name = String(left.name).localeCompare(String(right.name), "en", { sensitivity: "base" });
      return name !== 0 ? name : String(left.id).localeCompare(String(right.id));
    });
}

function sourceGroups(records: readonly WireObject[]): WireObject[] {
  // Required (core) sources form their own leading "Core" group rather than
  // hiding among their publisher's toggleable books.
  const core: WireObject[] = [];
  const grouped = new Map<string, { name: string; sources: WireObject[] }>();
  for (const record of records) {
    if (record.canToggle === false) {
      core.push(record);
      continue;
    }
    const author = typeof record.author === "string" ? record.author : "";
    const fallback = typeof record.source === "string" ? record.source : "Other";
    const name = author || fallback || "Other";
    const group = grouped.get(name) ?? { name, sources: [] };
    group.sources.push(record);
    grouped.set(name, group);
  }
  const authorGroups = [...grouped.values()]
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }))
    .map((group) => ({
      name: group.name,
      canToggle: group.sources.some((source) => source.canToggle === true),
      sources: group.sources,
    }));
  return core.length === 0
    ? authorGroups
    : [{ name: "Core", canToggle: false, sources: core }, ...authorGroups];
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  return [...new Set(sourceIds.map((sourceId) => sourceId.trim()).filter((sourceId) => sourceId !== ""))];
}

/** The character named by a query's `characterId`, when present. */
function characterFromQuery(service: CharacterService, query: WireObject): CharacterState | undefined {
  const characterId = query.characterId;
  if (typeof characterId !== "string" || characterId === "") return undefined;
  return service.getCharacter(characterId);
}

/** Library elements visible to a character, else the whole library. */
function allowedElements(library: ElementLibrary, state?: CharacterState): readonly ParsedElement[] {
  if (state === undefined) return [...library.byId.values()];
  const out: ParsedElement[] = [];
  for (const element of library.byId.values()) {
    if (isContentAllowedForCharacter(state, library, element)) out.push(element);
  }
  return out;
}

function characterSourcesResponse(service: CharacterService, library: ElementLibrary, id: string): WireObject {
  const state = service.getCharacter(id);
  const restrictedSourceIds = normalizeSourceIds(state.restrictedSources);
  const records = sourceRecords(library);
  const unavailableRestrictedSourceIds = restrictedSourceIds.filter((sourceId) => !library.sources.has(sourceId));
  return {
    groups: sourceGroups(records),
    restrictedSourceIds,
    unavailableRestrictedSourceIds,
    // Keep the original flat field for clients that have not adopted groups yet.
    sources: restrictedSourceIds.map((sourceId) =>
      library.sources.has(sourceId)
        ? sourceDto(library.sources.get(sourceId)!, library)
        : unknownSourceDto(sourceId),
    ),
  };
}

function contentElementDto(library: ElementLibrary, element: ParsedElement): WireObject {
  const resolve = (id: string): ParsedElement | undefined => library.byId.get(id);
  const metadata = equipmentMetadata(element, resolve);
  // Reference-only descriptions (`<div element="ID_X"/>`) strip to empty
  // before the emptiness test, so expand first and hand the expanded prose to
  // the composer — which prefixes the weapon/armour stat block to it.
  const expanded = expandDescriptionReferences(library, element.descriptionXml);
  const description = expandDescriptionReferences(
    library,
    publicEquipmentDescription(element, resolve, expanded),
  );
  return {
    id: element.identity.id,
    name: element.identity.name,
    type: element.identity.type,
    source: element.identity.source,
    description: description || null,
    rarity: metadata.rarity,
    attunement: metadata.attunement,
    rules: element.rulesXml ?? null,
    compendiumHidden: element.compendiumHidden,
    declaredBy: element.declaredBy,
  };
}

function contentQuery(library: ElementLibrary, query: WireObject, character?: CharacterState): WireObject {
  const text = typeof query.search === "string" ? query.search.trim().toLocaleLowerCase() : "";
  const type = typeof query.type === "string" && query.type !== "" ? query.type : undefined;
  const source = typeof query.source === "string" ? query.source : typeof query.sourceId === "string" ? query.sourceId : undefined;
  const ruleset = query.ruleset === "2014" || query.ruleset === "2024" || query.ruleset === "shared" ? query.ruleset : undefined;
  const offsetValue = typeof query.offset === "number" ? query.offset : typeof query.skip === "number" ? query.skip : 0;
  const limitValue = typeof query.limit === "number" ? query.limit : typeof query.take === "number" ? query.take : 100;
  const offset = Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const requestedLimit = Number.isInteger(limitValue) && limitValue >= 0 ? limitValue : 100;
  const itemCategory = typeof query.itemCategory === "string" && query.itemCategory !== "" ? query.itemCategory : undefined;
  const equipSetter = typeof query.equipSetter === "string" && query.equipSetter !== "" ? query.equipSetter : undefined;
  const equipmentOnly = query.equipmentOnly === true;
  // Ruleset scoping matches isRestrictedForCharacter: a character in 2014 or
  // 2024 mode loses the OTHER edition, never the shared content that most
  // supplements classify as. An explicit "shared" query is not a character mode
  // and stays an exact match.
  const rulesetAllows = (elementId: string): boolean => {
    if (ruleset === undefined) return true;
    const tag = library.ruleset.get(elementId);
    if (ruleset === "2014") return tag !== "2024";
    if (ruleset === "2024") return tag !== "2014";
    return tag === ruleset;
  };
  // Elements matching every filter except the type filter: the type dropdown's
  // per-type counts must describe what each type would show under the current
  // source/search scope, so the type pick itself cannot narrow them.
  const scoped = [...library.byId.values()].filter((element) => {
    if (character !== undefined && !isContentAllowedForCharacter(character, library, element)) return false;
    if (source !== undefined && element.identity.source !== source) return false;
    if (!rulesetAllows(element.identity.id)) return false;
    if (text !== "" && !`${element.identity.name} ${element.identity.id}`.toLocaleLowerCase().includes(text)) return false;
    if (equipmentOnly && !isPhysicalEquipment(element)) return false;
    if (itemCategory !== undefined && (!isPhysicalEquipment(element) || !matchesItemCategory(element, itemCategory))) return false;
    if (equipSetter !== undefined && (!isPhysicalEquipment(element) || !matchesEquipSetter(element, equipSetter))) return false;
    return true;
  });
  const typeCounts: Record<string, number> = {};
  for (const element of scoped) {
    typeCounts[element.identity.type] = (typeCounts[element.identity.type] ?? 0) + 1;
  }
  const all = type === undefined ? scoped : scoped.filter((element) => element.identity.type === type);
  const elements = all.slice(offset, offset + requestedLimit).map((element) => contentElementDto(library, element));
  return { elements, items: elements, total: all.length, offset, limit: requestedLimit, typeCounts };
}

function restrictedSourceEdits(service: CharacterService, id: string, sourceIds: readonly string[]): { start: number; end: number; replacement: string }[] {
  const document = service.documentOf(id);
  const body = sourceIds.map((sourceId) => `<source id="${sourceId.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" />`).join("");
  const sources = document.root.sources;
  const restricted = sources.restricted();
  if (restricted === null) {
    // Imported files predating the region (or a bare <sources />) get one:
    // replace the existing <sources> element, else insert before </character>.
    const replacement = `<sources><restricted>${body}</restricted></sources>`;
    const node = sources.node;
    if (node !== null) {
      return [{ start: node.start, end: node.end, replacement }];
    }
    const root = document.root.node;
    const close = root.closeStart ?? root.end;
    return [{ start: close, end: close, replacement: `\t${replacement}\r\n` }];
  }
  return [{ start: restricted.node.start, end: restricted.node.end, replacement: `<restricted>${body}</restricted>` }];
}

export function createEngineMethodHandlers(
  service: CharacterService,
  library: ElementLibrary,
): EngineMethodHandlers {
  const fastStart = createFastStartController(library);
  const character = createCharacterSnapshotController(service, library);
  const fetchContentUrl = async (contentUrl: string, directPath = "supplement.xml", extraFiles?: Array<{ path: string; base64: string }>): Promise<WireObject> => {
    const response = await fetch(contentUrl);
    if (!response.ok) throw engineError("content-invalid", `content bundle request failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = new TextDecoder().decode(bytes);
    // Bundled deployments publish a small JSON manifest so the corpus can be
    // split into cacheable files. Resolve each URL relative to that manifest,
    // then ingest the complete batch atomically.
    if (decoded.trimStart().startsWith("{")) {
      try {
        const manifest = JSON.parse(decoded) as { files?: unknown };
        if (Array.isArray(manifest.files)) {
          const entries = manifest.files;
          const files: Array<{ path: string; base64: string }> = new Array(entries.length);
          let next = 0;
          // Bounded parallel fetch: manifest files are independent cacheable
          // assets, but unlimited concurrency would flood the connection pool.
          const CONCURRENT_FETCHES = 8;
          const fetchWorker = async (): Promise<void> => {
            while (true) {
              const index = next;
              next += 1;
              if (index >= entries.length) return;
              const entry = entries[index];
              if (entry === null || typeof entry !== "object") throw new Error("manifest file entry must be an object");
              const record = entry as { path?: unknown; url?: unknown; base64?: unknown };
              if (typeof record.path !== "string") throw new Error("manifest file entry requires path");
              if (typeof record.base64 === "string") {
                files[index] = { path: record.path, base64: record.base64 };
                continue;
              }
              if (typeof record.url !== "string") throw new Error(`manifest entry '${record.path}' requires url or base64`);
              const url = new URL(record.url, response.url || contentUrl).toString();
              const fileResponse = await fetch(url);
              if (!fileResponse.ok) throw new Error(`manifest file request failed (${fileResponse.status})`);
              files[index] = { path: record.path, base64: encodeBase64(new Uint8Array(await fileResponse.arrayBuffer())) };
            }
          };
          await Promise.all(Array.from(
            { length: Math.min(CONCURRENT_FETCHES, entries.length) },
            () => fetchWorker(),
          ));
          // With an accompanying upload set the boot is authoritative: the
          // installed content becomes exactly bundled + uploads in one
          // rebuild. Without one, manifest ingestion merges as before.
          return extraFiles !== undefined
            ? replaceContentSet(library, [...files, ...extraFiles])
            : ingestContentFiles(library, files);
        }
      } catch (cause) {
        if (cause instanceof SyntaxError) {
          // This was an XML/other direct payload beginning with a brace; let
          // the normal decoder report its content error below.
        } else {
          throw engineError("content-invalid", `invalid content manifest: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    }
    const direct = { path: directPath, base64: encodeBase64(bytes) };
    return extraFiles !== undefined
      ? replaceContentSet(library, [direct, ...extraFiles])
      : ingestContentFiles(library, [direct]);
  };
  const bootContent = async (request: WireObject): Promise<WireObject> => {
    if (typeof request.contentUrl === "string") {
      return fetchContentUrl(
        request.contentUrl,
        typeof request.path === "string" ? request.path : "supplement.xml",
        Array.isArray(request.files) ? (request.files as Array<{ path: string; base64: string }>) : undefined,
      );
    }
    if (Array.isArray(request.files)) {
      return ingestContentFiles(library, request.files as Array<{ path: string; base64: string }>);
    }
    if (request.body instanceof ArrayBuffer && request.manifest !== undefined && request.expectedIdentity !== undefined) {
      return (await fastStart.boot(request as never)) as unknown as WireObject;
    }
    return getContentStatus(library);
  };
  return {
    boot: (request) => bootContent(request),
    ingestSupplementBundle: ({ contentUrl }) => fetchContentUrl(contentUrl),
    ingestUploaded: ({ files }) => ingestContentFiles(library, files),
    removeUploaded: ({ paths }) => removeContentFiles(library, paths),
    patchHomebrew: ({ path, base64 }) => patchContentFile(library, path, base64),
    contentStatus: () => ({
      elementCount: library.elementCount,
      sourceCount: library.sources.size,
      fileCount: library.fileOrder.length,
      revision: library.revision ?? 0,
      typeCounts: library.typeCounts,
      equipmentCategories: buildEquipmentCategories(library.byId.values()) as unknown as WireList,
    }),
    contentSources: () => sourceRecords(library),
    contentElement: (id) => {
      const element = library.byId.get(id);
      return element === undefined
        ? null
        : contentElementDto(library, element);
    },
    equipmentCategories: (characterId) => {
      const state = typeof characterId === "string" && characterId !== "" ? service.getCharacter(characterId) : undefined;
      return buildEquipmentCategories(allowedElements(library, state)) as unknown as WireList;
    },
    contentElements: (query) => contentQuery(library, query, characterFromQuery(service, query)),
    createCharacter: (name) => objectResult(service.getCharacterDetail(service.createCharacter(name).id)),
    getCharacter: (id) => objectResult(service.getCharacterDetail(id)),
    deleteCharacter: (id) => service.deleteCharacter(id),
    setPortrait: (id, base64) => objectResult(service.getCharacterDetail(service.setPortrait(id, base64).id)),
    removePortrait: (id) => objectResult(service.getCharacterDetail(service.removePortrait(id).id)),
    updateDetails: (id, details) =>
      objectResult(service.getCharacterDetail(service.updateDetails(id, details as CharacterDetails).id)),
    setAbilities: (id, abilities) =>
      objectResult(service.getCharacterDetail(
        service.setAbilities(id, abilities as unknown as AbilityScores, abilities.generationOption).id,
      )),
    setCharacterSources: (id, request) => {
      const sourceIds = normalizeSourceIds(request.restrictedSourceIds);
      service.applyRegionEdits(id, restrictedSourceEdits(service, id, sourceIds));
      return characterSourcesResponse(service, library, id);
    },
    getCharacterSources: (id) => characterSourcesResponse(service, library, id),
    getSelectionOptions: (id, ruleId, request) => {
      const state = service.getCharacter(id);
      const rule = selectionRuleForSlot(state, ruleId, request?.number, library);
      if (rule === null) return [];
      return selectionOptions(state, library, rule).map((option) => ({
        id: option.id,
        name: option.name,
        source: option.source,
        kind: "element",
        canInspect: option.canInspect,
        detail: null,
      }));
    },
    setSelection: (id, ruleId, request) =>
      objectResult(service.getCharacterDetail(service.setSelection(id, ruleId, request.selectionId, request.number).id)),
    clearSelection: (id, ruleId, request) =>
      objectResult(service.getCharacterDetail(service.clearSelection(id, ruleId, request.number).id)),
    getOptionalRules: (id) => listResult(service.getOptionalRules(id)),
    setCharacterOption: (id, request) =>
      objectResult(service.getCharacterDetail(service.setCharacterOption(id, request).id)),
    getRulesetMode: (id) => objectResult(service.getRulesetMode(id)),
    setRulesetMode: (id, request) => objectResult(service.setRulesetMode(id, request.mode)),
    getCharacterAdjustments: (id) => listResult(service.getCharacterAdjustments(id)),
    setCharacterControl: (id, request) =>
      objectResult(service.getCharacterDetail(service.setCharacterControl(id, request).id)),
    getStatistics: (id) => ({ values: computeStatistics(service.getCharacter(id), library) }),
    exportCharacterXml: (id) => ({ base64: encodeBase64(new TextEncoder().encode(service.exportCharacterXml(id))) }),
    importCharacterXml: async (id, base64) => {
      const xmlText = new TextDecoder().decode(decodeBase64(base64));
      const parseStart = performance.now();
      const state = service.importCharacterXml(id, xmlText);
      const parseMs = Math.max(0, performance.now() - parseStart);
      await character.recordXmlImport(id, xmlText, { parseMs, hydrationMs: 0 });
      return objectResult(service.getCharacterDetail(state.id));
    },
    prepareFastStartSnapshot: () => fastStart.prepare(),
    getFastStartSnapshotBuffer: () => fastStart.takeBuffer(),
    bootFromSnapshot: (request) => fastStart.boot(request),
    prepareCharacterLoadSnapshot: (id, identity) => character.prepare(id, identity),
    getCharacterLoadSnapshotBuffer: () => character.takeBuffer(),
    importCharacterXmlWithSnapshot: async (id, base64, identity, body) => {
      const state = await character.importWithSnapshot(id, base64, identity, body);
      return objectResult(service.getCharacterDetail(state.id));
    },
    getCharacterLoadDiagnostics: () => character.diagnostics(),
    levelUp: (id, request) =>
      objectResult(service.getCharacterDetail(service.levelUpMode(id, request).id)),
    levelUpTo: (id, request) =>
      objectResult(service.getCharacterDetail(service.levelUpTo(id, request).id)),
    levelDown: (id) => objectResult(service.levelDown(id)),
    delevel: (id, request) => objectResult(service.delevel(id, request)),
    undoDelevel: (id) => objectResult(service.undoDelevel(id)),
    setHitPointRoll: (id, request) =>
      service.getProgression(service.setHitPointRoll(id, request).id),
    getProgression: (id) => service.getProgression(id),
    getInventory: (id) => objectResult(service.getInventory(id)),
    getItemBaseOptions: (id, itemId) => objectResult(service.getItemBaseOptions(id, itemId)),
    addItem: (id, request) => objectResult(service.addItem(id, request)),
    removeItem: (id, identifier, amount) => objectResult(service.removeItem(id, identifier, amount)),
    setItemAmount: (id, identifier, request) => objectResult(service.setItemAmount(id, identifier, request.amount)),
    extractItem: (id, identifier, selections) => objectResult(service.extractItem(id, identifier, selections)),
    equipItem: (id, identifier, request) => objectResult(service.equipItem(id, identifier, request.location)),
    setItemStorage: (id, identifier, request) => objectResult(service.setItemStorage(id, identifier, request.storage, request.amount)),
    attuneItem: (id, identifier, request) => objectResult(service.attuneItem(id, identifier, request.attuned)),
    setCoins: (id, coins) => objectResult(service.setCoins(id, coins)),
    getAttacks: (id) => listResult(service.getAttacks(id)),
    getAttackOptions: (id) => objectResult(service.getAttackOptions(id)),
    createAttack: (id, request) => listResult(service.createAttack(id, request)),
    updateAttack: (id, attackId, request) => listResult(service.updateAttack(id, attackId, request)),
    setAttackVisibility: (id, attackId, request) =>
      listResult(service.setAttackVisibility(id, attackId, request.isDisplayed)),
    moveAttack: (id, attackId, request) => listResult(service.moveAttack(id, attackId, request.direction)),
    deleteAttack: (id, attackId) => listResult(service.deleteAttack(id, attackId)),
    generateSheet: (id, request) => {
      // The engine worker only builds the (cheap, serializable) sheet model;
      // the dedicated render worker owns template fetching and pdf-lib work on
      // its own thread, so choices and reads never queue behind a render.
      return objectResult(buildCharacterSheetModel(service.getCharacter(id), library, {
        mode: request.lite ? "lite" : "full",
        ...(request.include ? { include: request.include } : {}),
      }));
    },
    getSpellcasting: (id) => service.getSpellcasting(id),
    setPrepared: (id, casterId, request) => service.setPrepared(id, casterId, request),
    getSpellBrowse: (id, ruleId) => objectResult(service.getSpellBrowse(id, ruleId)),
    addGrantedSpell: (id, request) => objectResult(service.getCharacterDetail(service.addGrantedSpell(id, request).id)),
    removeGrantedSpell: (id, request) => objectResult(service.getCharacterDetail(service.removeGrantedSpell(id, request).id)),
    getCompanion: (id) => service.getCompanion(id) as WireObject | null,
    setCompanionName: (id, request) => objectResult(service.setCompanionName(id, request)),
    setCompanionPortrait: (id, base64) =>
      objectResult(service.getCharacterDetail(service.setCompanionPortrait(id, base64).id)),
    removeCompanionPortrait: (id) =>
      objectResult(service.getCharacterDetail(service.removeCompanionPortrait(id).id)),
    addGrantedFeat: (id, request) => objectResult(service.getCharacterDetail(service.addGrantedFeat(id, request).id)),
    removeGrantedFeat: (id, request) => objectResult(service.getCharacterDetail(service.removeGrantedFeat(id, request).id)),
    addGrantedAbilityScore: (id, request) =>
      objectResult(service.getCharacterDetail(service.addGrantedAbilityScore(id, request).id)),
    removeGrantedAbilityScore: (id, request) =>
      objectResult(service.getCharacterDetail(service.removeGrantedAbilityScore(id, request).id)),
    getDmGrants: (id) => listResult(service.getDmGrants(id)),
    getAppearanceSuggestions: (id, seed) => objectResult(service.getAppearanceSuggestions(id, seed)),
  };
}

export function startCharacterEngineWorker(
  scope: WorkerScope,
  service: CharacterService,
  library: ElementLibrary,
): EngineWorkerRuntime {
  return startEngineWorker(scope, createEngineMethodHandlers(service, library), {
    readyMetrics: { engineVersion: ENGINE_VERSION },
  });
}

/** Browser entry point: creates the mutable library and service on the worker side. */
export function startBrowserCharacterEngineWorker(scope: WorkerScope): EngineWorkerRuntime {
  const library = createEmptyLibrary();
  const service = new CharacterService(undefined, library);
  return startCharacterEngineWorker(scope, service, library);
}
