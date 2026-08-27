import {
  createEngineClient,
  type ClientWorkerPort,
  type EngineClient,
  type EngineWorkerMessage,
} from "@forge-cb/api";
import { CHARACTER_LOAD_MANIFEST, FAST_START_MANIFEST } from "@forge-cb/api";
import { localStore as defaultStore } from "./localStore.js";
import { contentStoragePath, createContentSourceId } from "./contentStorage.js";
import { findMatchingContentSources, fingerprintContentSource } from "./contentDuplicates.js";
import {
  createFastStartIdentity,
  createFastStartRecord,
  resolveFastStartEngineVersion,
  validateFastStartRecord,
} from "./fastStartSnapshot.js";
import { stableHash } from "../cloud/librarySnapshot.js";
import {
  normalizeRestrictedSourceIds,
  readDefaultRestrictedSourceIds,
} from "../sourcePreferences.js";
import { ACCEPTED_CHARACTER_PACKAGE_TOKENS, CHARACTER_PACKAGE_TOKEN } from "../storageNames.js";

type AnyRecord = Record<string, unknown>;
type ApiFunction = (...args: unknown[]) => unknown;
type ApiGroup = Record<string, ApiFunction>;
type ContentFileRecord = {
  path: string;
  base64: string;
  sourceId?: string;
  relativePath?: string;
};

export interface EngineApi {
  content: ApiGroup;
  characters: ApiGroup;
  [key: string]: unknown;
}
type ProgressState = {
  active: boolean;
  percentage: number | null;
  message: string;
  error: string | null;
  phase?: string;
};

const FAST_START_IDENTITY = FAST_START_MANIFEST;
const CHARACTER_LOAD_IDENTITY = CHARACTER_LOAD_MANIFEST;

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/**
 * Content reaches the transport in three shapes: browser File handles from the
 * file picker, already-read byte candidates from the folder and web importer
 * (which reads, downloads, and resolves index references before handing files
 * over), and stored records that already carry base64. Every shape is reduced
 * to the file's own bytes so the engine decodes exactly what was on disk or on
 * the wire rather than a re-encoded copy.
 */
async function contentInputBase64(input: unknown): Promise<string> {
  const direct = asBytes(input);
  if (direct) return bytesToBase64(direct);
  const record = (input ?? {}) as AnyRecord;
  if (typeof record.base64 === "string") return record.base64;
  const bytes = asBytes(record.bytes);
  if (bytes) return bytesToBase64(bytes);
  if (typeof record.arrayBuffer === "function") {
    return bytesToBase64(new Uint8Array(await (input as Blob).arrayBuffer()));
  }
  if (typeof record.text === "function") {
    return utf8ToBase64(await (record.text as () => Promise<string>)());
  }
  if (typeof record.text === "string") return utf8ToBase64(record.text);
  throw new Error("Unsupported content upload input: expected a file, bytes, text, or base64 content.");
}

function contentInputPath(input: unknown, body: unknown): string {
  const wrapper = (input ?? {}) as AnyRecord;
  const source = (body ?? {}) as AnyRecord;
  for (const value of [
    wrapper.relativePath,
    source.relativePath,
    source.webkitRelativePath,
    source.name,
    wrapper.name,
  ]) {
    const path = typeof value === "string" ? value.trim() : "";
    if (path) return path;
  }
  throw new Error("Content upload input is missing a file name.");
}

/** Normalize any supported upload shape into `{ relativePath, base64 }` records. */
async function contentUploadRecords(inputs: unknown): Promise<Array<{ relativePath: string; base64: string }>> {
  const records: Array<{ relativePath: string; base64: string }> = [];
  for (const input of (Array.isArray(inputs) ? inputs : []) as unknown[]) {
    const body = (input as AnyRecord)?.file ?? input;
    records.push({
      relativePath: contentInputPath(input, body),
      base64: await contentInputBase64(body),
    });
  }
  return records;
}

function withPortrait(detail: AnyRecord, portraitBase64: string | null): AnyRecord {
  return { ...detail, portraitBase64: portraitBase64 ?? null };
}

function portraitFromXml(xml: string): string | null {
  const match = xml.match(/<portrait\b[^>]*>[\s\S]*?<base64\b[^>]*>([\s\S]*?)<\/base64>/i);
  // The engine writes the base64 region as CDATA; the wrapper must not leak
  // into the data URL handed to <img>.
  return (match?.[1] ? decodeXmlText(match[1]).trim() : "") || null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

// Packages are files users keep and share, so the reader accepts every format
// token the host lists as legacy as well as the current one; only the writer
// uses the current token.
const CHARACTER_PACKAGE_FORMATS = new Set<string>(ACCEPTED_CHARACTER_PACKAGE_TOKENS);

/**
 * The `.dnd5e-pkg` package format: a JSON envelope
 * `{format:"fcb-character-package",version:1,character:{id,xml},content:[{path,base64}]}`
 * bundling the character document with the custom-content files it depends on.
 * Returns null for anything that is not such an envelope so plain `.dnd5e`
 * XML (and misnamed files) fall through to the XML importer unchanged.
 */
function parseCharacterPackage(text: string): { id: string | null; xml: string; content: Array<{ path: string; base64: string }> } | null {
  if (!/^\uFEFF?\s*\{/.test(text)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  const envelope = (parsed ?? {}) as AnyRecord;
  if (typeof envelope.format !== "string" || !CHARACTER_PACKAGE_FORMATS.has(envelope.format)) return null;
  const character = (envelope.character ?? {}) as AnyRecord;
  if (typeof character.xml !== "string" || character.xml.trim() === "") {
    throw new Error("Character package is missing its character document.");
  }
  const content = (Array.isArray(envelope.content) ? envelope.content : [])
    .map((entry) => entry as AnyRecord)
    .filter((entry) => typeof entry.path === "string" && typeof entry.base64 === "string")
    .map((entry) => ({ path: String(entry.path), base64: String(entry.base64) }));
  return { id: typeof character.id === "string" ? character.id : null, xml: character.xml, content };
}

function characterNameFromXml(xml: string, fallback: string): string {
  const candidates = [
    /<character\b[^>]*\bname\s*=\s*["']([^"']+)["']/i,
    /<display-properties\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i,
    /<input\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>/i,
  ];
  for (const pattern of candidates) {
    const match = xml.match(pattern);
    const value = match?.[1] ? decodeXmlText(match[1]).trim() : "";
    if (value) return value;
  }
  return fallback.trim() || "Imported character";
}

function isUnavailable(error: unknown): boolean {
  return error instanceof Error && /unavailable|unsupported/i.test(error.message);
}

/**
 * A snapshot-booted engine holds no raw content files, so incremental
 * ingest/remove calls fail asking for a full rebuild; the callers below all
 * follow up with an authoritative rebuild from the store, so this error is
 * their signal to skip straight to it. Engine rejections arrive as typed
 * `{code, message}` objects rather than Error instances.
 */
function needsFullContentRebuild(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return /full content rebuild/i.test(message);
}

function uploadFileResult(record: AnyRecord, accepted = true, error?: string): AnyRecord {
  return {
    path: record.path,
    relativePath: record.relativePath ?? record.path,
    fileName: record.relativePath ?? record.path,
    accepted,
    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
    ...(error ? { error } : {}),
  };
}

function contentRecordPaths(records: unknown): string[] {
  if (!Array.isArray(records)) return [];
  return records
    .map((record) => typeof record === "string" ? record : record?.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}

function summaryOf(detail: AnyRecord, portraitBase64: string | null): AnyRecord {
  return {
    id: detail.id,
    name: detail.name,
    race: detail.race ?? "",
    class: detail.class ?? "",
    background: detail.background ?? "",
    level: String(detail.level ?? ""),
    portraitBase64: portraitBase64 ?? null,
  };
}

function unsupported(method: string): never {
  throw new Error(`FCB engine method '${method}' is unavailable in this worker.`);
}

function invoke<T = AnyRecord>(client: EngineClient, method: keyof EngineClient, ...args: unknown[]): Promise<T> {
  const operation = client[method] as unknown;
  if (typeof operation !== "function") unsupported(String(method));
  return (operation as (...values: unknown[]) => Promise<T>)(...args);
}

function workerPort(): ClientWorkerPort {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_FCB_WORKER_URL?.trim();
  const worker = configured
    ? new Worker(new URL(configured, document.baseURI), { type: "module" })
    : new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
  return worker as unknown as ClientWorkerPort;
}

/** Per-render choices passed through to the sheet worker. */
export interface SheetRenderOptions {
  templateSet?: "2014" | "2024";
  colours?: { accent?: string; lines?: string; text?: string };
  fonts?: { titles?: string; captions?: string; body?: string; numbers?: string };
  brandImage?: string;
  footerText?: string;
}

interface SheetRenderRequest extends SheetRenderOptions {
  id: number;
  model: AnyRecord;
  templateBase: string;
}

type SheetRenderResponse =
  | { id: number; ok: true; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };

export interface EngineTransportOptions {
  client?: EngineClient;
  worker?: ClientWorkerPort;
  store?: typeof defaultStore;
  onBootProgress?: (state: ProgressState) => void;
  /** Injectable sheet renderer (tests); defaults to the dedicated render worker. */
  sheetRenderer?: (model: AnyRecord, templateBase: string, render: SheetRenderOptions) => Promise<Uint8Array>;
}

export function createEngineApi(options: EngineTransportOptions = {}): EngineApi {
  const store = options.store ?? defaultStore;
  let client: EngineClient | null = options.client ?? null;
  let loadedId: string | null = null;
  let characterLoadPromise: Promise<AnyRecord> | null = null;
  let bootPromise: Promise<void> | null = null;
  let contentBootPromise: Promise<void> | null = null;
  let contentBootError: unknown = null;
  let liveUploadedFiles = new Map<string, string>();
  let portraitBase64: string | null = null;
  let engineVersion: string | null = null;
  let snapshotRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotBuildInFlight = false;
  let fastStartState: AnyRecord = {
    enabled: true,
    supported: true,
    readiness: "not-built",
    lastBuildAt: null,
    snapshotSizeBytes: 0,
    hasRawContentPack: false,
    usedSnapshot: false,
    bootMode: null,
    error: null,
  };
  const fastStartSubscribers = new Set<(state: AnyRecord) => void>();
  let bootState: AnyRecord = {
    phase: "idle",
    interactive: false,
    supplementsLoaded: false,
    bootMode: null,
    snapshotLoaded: false,
    snapshotError: null,
    cacheState: "ready",
    cacheError: null,
    metrics: {},
  };
  let contentState: ProgressState = {
    active: false,
    percentage: null,
    message: "Content library ready",
    error: null,
    phase: "ready",
  };
  let characterState: ProgressState = {
    active: false,
    percentage: null,
    message: "Preparing character…",
    error: null,
  };
  const bootSubscribers = new Set<(state: AnyRecord) => void>();
  const contentSubscribers = new Set<(state: ProgressState) => void>();
  const characterSubscribers = new Set<(state: ProgressState) => void>();

  const publish = <T>(subscribers: Set<(state: T) => void>, state: T) => {
    for (const subscriber of subscribers) {
      try {
        subscriber(state);
      } catch {
        // A UI listener must not break the worker transport.
      }
    }
  };
  const updateBoot = (patch: Partial<AnyRecord>) => {
    bootState = { ...bootState, ...patch };
    options.onBootProgress?.(bootState);
    publish(bootSubscribers, bootState);
  };
  const updateContent = (patch: Partial<ProgressState>) => {
    contentState = { ...contentState, ...patch };
    publish(contentSubscribers, contentState);
  };
  const updateCharacter = (patch: Partial<ProgressState>) => {
    characterState = { ...characterState, ...patch };
    publish(characterSubscribers, characterState);
  };
  const updateFastStart = (patch: Partial<AnyRecord>) => {
    fastStartState = { ...fastStartState, ...patch };
    publish(fastStartSubscribers, fastStartState);
  };

  const onEvent = (event: EngineWorkerMessage) => {
    if (event.type === "ready") {
      const version = (event.metrics as AnyRecord | undefined)?.engineVersion;
      if (typeof version === "string" && version !== "") engineVersion = version;
      updateBoot({ phase: "ready", interactive: true, metrics: event.metrics });
    } else if (event.type === "fatal") {
      updateBoot({ phase: "error", interactive: false, error: event.error });
      updateContent({ active: false, error: event.error });
      updateCharacter({ active: false, error: event.error });
    } else if (event.type === "progress") {
      const patch = {
        active: event.active,
        percentage: event.percentage,
        message: event.message,
        error: null,
      };
      if (event.scope === "content") updateContent(patch);
      else updateCharacter(patch);
    } else if (event.type === "queue") {
      if (event.queueKind === "homebrew" || event.queueKind === "content-write") {
        updateContent({
          active: event.phase !== "complete",
          phase: event.phase,
          message: event.phase === "waiting" ? "Waiting for the engine…" : "Updating content…",
        });
      }
    }
  };

  const getClient = (): EngineClient => {
    if (client) return client;
    client = createEngineClient(options.worker ?? workerPort(), { onEvent });
    return client;
  };

  const ensureBooted = async (): Promise<EngineClient> => {
    const engine = getClient();
    if (!bootPromise) {
      bootPromise = (async () => {
        updateBoot({ phase: "runtime", interactive: false, error: null });
        // The browser worker owns corpus loading. The request is deliberately small and
        // version-stable so deployments can provide a deterministic static content artifact.
        const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
        const contentUrl =
          env?.VITE_FCB_CONTENT_URL ??
          `${env?.BASE_URL ?? "/"}content/manifest.json`;
        try {
          // Keep runtime startup independent from content startup. Runtime callers may become
          // responsive early, but character restore and content queries use ensureContentReady.
          // Content boot starts immediately (no artificial delay): the worker is ready for
          // runtime calls on its own, and deferring content only delays the first library.
          await invoke(engine, "boot", { source: "bundled" });
          contentBootError = null;
          updateContent({ active: true, phase: "content", error: null, message: "Loading rules content…" });
          contentBootPromise = new Promise((resolve) => {
            void (async () => {
              try {
                // Snapshot-first boot: a valid Fast Start snapshot replaces the
                // fetch-and-parse pipeline entirely; any miss falls back to the
                // raw rebuild and schedules a background snapshot build.
                const snapshotUsed = await tryBootFromSnapshot(engine, contentUrl);
                if (!snapshotUsed) {
                  await rebuildContentFromStore(engine, contentUrl);
                }
                updateBoot({ phase: "complete", supplementsLoaded: true, error: null, percentage: 100 });
                updateContent({ active: false, phase: "ready", percentage: 100, message: "Content library ready", error: null });
              } catch (error) {
                contentBootError = error;
                updateBoot({ phase: "supplements-error", supplementsLoaded: false, error: error instanceof Error ? error.message : String(error) });
                updateContent({ active: false, phase: "error", error: error instanceof Error ? error.message : String(error), message: "Content library failed to load" });
              } finally {
                resolve();
              }
            })();
          });
        } catch (error) {
          // Older workers initialize their library during bootstrap and do not expose boot.
          // Preserve a useful error for malformed calls, while allowing those workers to run.
          if (!isUnavailable(error)) throw error;
          contentBootError = null;
          updateContent({ active: false, phase: "ready", percentage: 100, message: "Content library ready", error: null });
        }
        updateBoot({ phase: "runtime-ready", interactive: true, supplementsLoaded: contentBootPromise === null, percentage: null });
      })().catch((error) => {
        bootPromise = null;
        updateBoot({ phase: "error", interactive: false, error: error instanceof Error ? error.message : String(error) });
        throw error;
      });
    }
    await bootPromise;
    return engine;
  };

  const ensureContentReady = async (): Promise<EngineClient> => {
    const engine = await ensureBooted();
    if (contentBootPromise) await contentBootPromise;
    if (contentBootError) throw contentBootError;
    return engine;
  };

  const contentManifestUrl = (): string => {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.VITE_FCB_CONTENT_URL ?? `${env?.BASE_URL ?? "/"}content/manifest.json`;
  };

  /**
   * The Fast Start identity covers everything the built library depends on:
   * the bundled manifest's per-file digests plus a digest of every uploaded
   * record — so any content change simply misses the snapshot instead of
   * needing explicit invalidation.
   */
  const computeSnapshotIdentity = async (
    bundledUrl: string,
  ): Promise<{ identity: AnyRecord; records: ContentFileRecord[]; contentRevision: number } | null> => {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
    const identityVersion = resolveFastStartEngineVersion(
      {
        dev: env?.DEV === true,
        fingerprint: typeof env?.VITE_FCB_ENGINE_FINGERPRINT === "string" ? env.VITE_FCB_ENGINE_FINGERPRINT : undefined,
        override: typeof env?.VITE_FCB_FAST_START === "string" ? env.VITE_FCB_FAST_START : undefined,
      },
      engineVersion,
    );
    if (identityVersion === null) return null;
    if (typeof store.listContentWithRevision !== "function") return null;
    const response = await fetch(bundledUrl);
    if (!response.ok) return null;
    const manifest = (await response.json()) as { files?: Array<{ path?: string; sha256?: string }>; profile?: string; digest?: string };
    if (!Array.isArray(manifest.files)) return null;
    const bundledHashes: Array<{ path: string; hash: string }> = [];
    for (const file of manifest.files) {
      if (typeof file?.path !== "string" || !/^[a-f0-9]{64}$/.test(String(file?.sha256 ?? ""))) return null;
      bundledHashes.push({ path: `bundled/${file.path}`, hash: `sha256:${file.sha256}` });
    }
    const { records, revision } = (await store.listContentWithRevision()) as { records: AnyRecord[]; revision: number };
    const uploaded: ContentFileRecord[] = records.map((record) => ({
      path: String(record.path),
      base64: String(record.base64),
    }));
    const uploadedHashes = await Promise.all(
      [...uploaded]
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
        .map(async (file) => ({
          path: `uploads/${file.path}`,
          hash: await stableHash({ path: file.path, base64: file.base64 }),
        })),
    );
    const buildIdentity = createFastStartIdentity as unknown as (options: AnyRecord) => Promise<AnyRecord | null>;
    const identity = await buildIdentity({
      engineVersion: identityVersion,
      publicContentProfile: String(manifest.profile ?? "public-base"),
      orderedFileHashes: [...bundledHashes, ...uploadedHashes],
      sources: [{ kind: "bundled-manifest", location: bundledUrl, revision: String(manifest.digest ?? "") }],
    });
    if (!identity) return null;
    return { identity: identity as AnyRecord, records: uploaded, contentRevision: Number(revision) || 0 };
  };

  /** Boots the engine library from a stored snapshot; false on any miss. */
  const tryBootFromSnapshot = async (engine: EngineClient, bundledUrl: string): Promise<boolean> => {
    if (typeof store.getFastStartSnapshot !== "function") return false;
    let context: Awaited<ReturnType<typeof computeSnapshotIdentity>> = null;
    try {
      context = await computeSnapshotIdentity(bundledUrl);
    } catch {
      return false;
    }
    if (!context) return false;
    const key = String(context.identity.key);
    try {
      const record = await store.getFastStartSnapshot(key);
      if (!record) return false;
      const validation = await validateFastStartRecord(record, context.identity);
      if (!validation.valid || !validation.body) {
        await store.markFastStartSnapshotInvalid?.(key, validation.reason ?? "invalid snapshot");
        return false;
      }
      await invoke(engine, "boot", {
        body: validation.body.buffer,
        manifest: FAST_START_IDENTITY,
        expectedIdentity: FAST_START_IDENTITY,
      });
      liveUploadedFiles = new Map(context.records.map((record) => [record.path, record.base64]));
      updateFastStart({
        readiness: "ready",
        usedSnapshot: true,
        bootMode: "snapshot",
        lastBuildAt: (record as AnyRecord).createdAt ?? null,
        snapshotSizeBytes: Number((record as AnyRecord & { manifest?: AnyRecord }).manifest?.bodyBytes) || 0,
        error: null,
      });
      return true;
    } catch (error) {
      // A rejected or unreadable snapshot must never break boot: drop it and
      // fall back to the raw content pipeline.
      await store.markFastStartSnapshotInvalid?.(key, error instanceof Error ? error.message : String(error)).catch(() => undefined);
      return false;
    }
  };

  /** Prepares the engine snapshot and stores it, gated on the content revision. */
  const buildFastStartSnapshot = async (engine: EngineClient): Promise<void> => {
    if (snapshotBuildInFlight) return;
    snapshotBuildInFlight = true;
    try {
      const context = await computeSnapshotIdentity(contentManifestUrl());
      if (!context) return;
      const prepared = await invoke(engine, "prepareFastStartSnapshot");
      const buffer = await invoke(engine, "getFastStartSnapshotBuffer");
      const record = await createFastStartRecord({
        identity: context.identity,
        body: buffer,
        engineMetadata: {
          libraryKind: prepared.libraryKind,
          bodyCodec: "gzip-json",
          elementCount: prepared.elementCount,
          elementTypeCount: Object.keys(prepared.typeCounts ?? {}).length,
          orderedElementDigest: `sha256:${prepared.orderedLibraryDigest}`,
          diagnosticsDigest: `sha256:${prepared.diagnosticsDigest}`,
          snapshotBytes: prepared.serializedBytes,
          snapshotBodyBytes: prepared.compressedBytes,
          snapshotSerializeMs: prepared.serializationMs,
          snapshotCompressMs: prepared.compressionMs,
        },
      });
      if (typeof store.putFastStartSnapshotIfCurrent === "function") {
        await store.putFastStartSnapshotIfCurrent(record, context.contentRevision);
      } else {
        await store.putFastStartSnapshot?.(record);
      }
      updateFastStart({
        readiness: "ready",
        lastBuildAt: (record as AnyRecord).createdAt ?? Date.now(),
        snapshotSizeBytes: Number((record as AnyRecord & { manifest?: AnyRecord }).manifest?.bodyBytes) || 0,
        error: null,
      });
    } catch (error) {
      updateFastStart({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      snapshotBuildInFlight = false;
    }
  };

  const SNAPSHOT_IDLE_DELAY_MS = 750;
  const scheduleSnapshotRebuild = (engine: EngineClient): void => {
    if (snapshotRebuildTimer !== null) clearTimeout(snapshotRebuildTimer);
    snapshotRebuildTimer = setTimeout(() => {
      snapshotRebuildTimer = null;
      void buildFastStartSnapshot(engine);
    }, SNAPSHOT_IDLE_DELAY_MS);
  };

  // Unsaved-change bookkeeping. Every mutation marks its character dirty; the
  // write that lands afterwards clears the mark only if no further mutation
  // arrived while the export was running, so an edit made mid-save is never
  // reported as saved. The UI subscribes to show an unsaved indicator when
  // autosave is off.
  let autosaveEnabled = true;
  let mutationSequence = 0;
  const dirtyIds = new Set<string>();
  const dirtyGeneration = new Map<string, number>();
  const unsavedSubscribers = new Set<(ids: string[]) => void>();
  const publishUnsaved = (): void => {
    const ids = [...dirtyIds];
    for (const callback of unsavedSubscribers) callback(ids);
  };
  const markDirty = (id: string): void => {
    dirtyGeneration.set(id, ++mutationSequence);
    if (dirtyIds.has(id)) return;
    dirtyIds.add(id);
    publishUnsaved();
  };
  const markCleanIfCurrent = (id: string, generation: number | undefined): void => {
    if (dirtyGeneration.get(id) !== generation) return;
    dirtyGeneration.delete(id);
    if (dirtyIds.delete(id)) publishUnsaved();
  };
  const forgetDirty = (id: string): void => {
    dirtyGeneration.delete(id);
    if (dirtyIds.delete(id)) publishUnsaved();
  };

  // Undo history: the character's XML as it stood before each mutation,
  // newest last, in both autosave modes. Bounded so a long session cannot
  // grow without limit, and dropped whenever the engine copy is replaced
  // from storage.
  const UNDO_LIMIT = 50;
  const undoStacks = new Map<string, string[]>();
  const pushUndo = (id: string, xml: string): void => {
    const stack = undoStacks.get(id) ?? [];
    stack.push(xml);
    if (stack.length > UNDO_LIMIT) stack.shift();
    undoStacks.set(id, stack);
    publishUnsaved();
  };

  const persist = async (id: string, detail?: AnyRecord): Promise<AnyRecord> => {
    const generation = dirtyGeneration.get(id);
    const engine = await ensureBooted();
    const exported = await invoke(engine, "exportCharacterXml", id);
    const xml = base64ToUtf8(exported.base64);
    const resolved = detail ?? withPortrait(await invoke(engine, "getCharacter", id), portraitBase64);
    portraitBase64 = resolved.portraitBase64 ?? portraitBase64 ?? portraitFromXml(xml);
    await store.putCharacter({ id, xml, summary: summaryOf(resolved, portraitBase64) });
    markCleanIfCurrent(id, generation);
    return withPortrait(resolved, portraitBase64);
  };

  // Debounced persistence: the deployed app's mutations return before the IndexedDB
  // write lands, so a choice never waits on the export + store round trip. The
  // last write within the window wins; flushPendingSaves drains the queue at
  // content reloads, character switches, and cloud syncs.
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistInFlight = new Map<string, Promise<unknown>>();

  async function runPersist(id: string, detail?: AnyRecord): Promise<void> {
    const pending = (async () => {
      try {
        await persist(id, detail);
      } catch (error) {
        // Durability is best-effort on the hot path; the next mutation or a
        // flush retries the write.
        console.warn("debounced persist failed", error);
      }
    })();
    persistInFlight.set(id, pending);
    await pending.finally(() => {
      if (persistInFlight.get(id) === pending) persistInFlight.delete(id);
    });
  }

  // A user-requested save: same in-flight bookkeeping as runPersist, but a
  // failure reaches the caller so the Save button can report it.
  async function persistOrThrow(id: string): Promise<void> {
    const pending = persist(id).then(() => undefined);
    persistInFlight.set(id, pending);
    try {
      await pending;
    } finally {
      if (persistInFlight.get(id) === pending) persistInFlight.delete(id);
    }
  }

  function schedulePersist(id: string, detail?: AnyRecord): void {
    markDirty(id);
    // With autosave off the edit stays in the engine until the user saves;
    // timers already running were scheduled under autosave and still land.
    if (!autosaveEnabled) return;
    clearTimeout(debounceTimers.get(id));
    debounceTimers.set(id, setTimeout(() => {
      debounceTimers.delete(id);
      void runPersist(id, detail);
    }, 600));
  }

  // Writes every character with unsaved changes, whether or not autosave is
  // on. Callers are the durability boundaries — a content reload rebuilds the
  // engine and a Drive sync uploads the stored copy — where in-memory edits
  // cannot survive, so "manual save" only ever governs writes during editing.
  async function flushPendingSaves(): Promise<void> {
    const ids = new Set([...debounceTimers.keys(), ...dirtyIds]);
    for (const id of ids) {
      clearTimeout(debounceTimers.get(id));
      debounceTimers.delete(id);
    }
    await Promise.all([...persistInFlight.values()]);
    for (const id of ids) await runPersist(id);
  }

  async function saveCharacter(id?: string): Promise<void> {
    if (id === undefined) {
      await flushPendingSaves();
      return;
    }
    clearTimeout(debounceTimers.get(id));
    debounceTimers.delete(id);
    await persistInFlight.get(id);
    await persistOrThrow(id);
  }

  // Dedicated sheet-render worker: the engine worker returns the cheap sheet
  // model; this worker owns the pdf-lib work on its own thread, so choices and
  // reads never queue behind a PDF render.
  const envForBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const sheetTemplateBase = envForBase?.BASE_URL ?? "/";
  let sheetRenderWorker: Worker | null = null;
  let sheetRenderId = 0;
  const pendingSheetRenders = new Map<number, {
    resolve: (bytes: ArrayBuffer) => void;
    reject: (error: Error) => void;
  }>();

  const failAllPendingSheetRenders = (error: Error): void => {
    for (const pending of pendingSheetRenders.values()) pending.reject(error);
    pendingSheetRenders.clear();
  };

  const renderSheetBytes = (model: AnyRecord, render: SheetRenderOptions): Promise<Uint8Array> => {
    if (options.sheetRenderer) return options.sheetRenderer(model, sheetTemplateBase, render);
    if (sheetRenderWorker === null) {
      const worker = new Worker(new URL("./sheetRenderWorker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event) => {
        const response = event.data as SheetRenderResponse;
        if (response === null || typeof response !== "object" || typeof response.id !== "number") return;
        const pending = pendingSheetRenders.get(response.id);
        if (!pending) return;
        pendingSheetRenders.delete(response.id);
        if (response.ok) pending.resolve(response.bytes);
        else pending.reject(new Error(response.error));
      });
      worker.addEventListener("error", (event) => {
        sheetRenderWorker = null;
        failAllPendingSheetRenders(new Error(event.message ?? "sheet render worker failed"));
      });
      sheetRenderWorker = worker;
    }
    const id = ++sheetRenderId;
    return new Promise((resolve, reject) => {
      pendingSheetRenders.set(id, { resolve, reject });
      const request: SheetRenderRequest = {
        id,
        model,
        templateBase: sheetTemplateBase,
        templateSet: render.templateSet,
        colours: render.colours,
        fonts: render.fonts,
        brandImage: render.brandImage,
        footerText: render.footerText,
      };
      sheetRenderWorker!.postMessage(request);
    }).then((bytes) => new Uint8Array(bytes));
  };

  /**
   * Ensures the character is restored into the engine. When the caller only
   * needs the load guarantee (every mutation path), the already-loaded
   * fast path returns null instead of paying a full detail projection that
   * the caller would discard.
   */
  const ensureLoaded = async (id: string, opts: { detail?: boolean } = {}): Promise<AnyRecord | null> => {
    const wantDetail = opts.detail !== false;
    const engine = await ensureContentReady();
    if (loadedId === id) {
      return wantDetail ? withPortrait(await invoke(engine, "getCharacter", id), portraitBase64) : null;
    }
    if (characterLoadPromise) {
      await characterLoadPromise;
      if (loadedId === id) {
        return wantDetail ? withPortrait(await invoke(engine, "getCharacter", id), portraitBase64) : null;
      }
    }

    const operation = (async () => {
      const record = await store.getCharacter(id);
      if (!record?.xml) throw new Error(`Character '${id}' was not found on this device.`);
      updateCharacter({ active: true, percentage: null, message: "Loading character…", error: null });
      try {
        await invoke(engine, "createCharacter", id);
        await invoke(engine, "importCharacterXml", id, utf8ToBase64(record.xml));
        undoStacks.delete(id);
        loadedId = id;
        portraitBase64 = record.summary?.portraitBase64 ?? portraitFromXml(record.xml);
        const detail = withPortrait(await invoke(engine, "getCharacter", id), portraitBase64);
        updateCharacter({ active: false, percentage: 100, message: "Character ready", error: null });
        return detail;
      } catch (error) {
        loadedId = null;
        portraitBase64 = null;
        updateCharacter({ active: false, percentage: null, message: "Character could not be loaded", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    })();
    characterLoadPromise = operation;
    try {
      return await operation;
    } finally {
      if (characterLoadPromise === operation) characterLoadPromise = null;
    }
  };

  const mutateDetail = async (id: string, method: keyof EngineClient, args: unknown[]): Promise<AnyRecord> => {
    const engine = await ensureBooted();
    await ensureLoaded(id, { detail: false });
    // The pre-mutation export is posted ahead of the mutation and only awaited
    // afterwards, so the snapshot costs no extra round trip on the choice path.
    const before = invoke(engine, "exportCharacterXml", id).catch(() => null);
    const result = await invoke(engine, method, ...args);
    loadedId = id;
    const snapshot = await before;
    if (snapshot !== null) pushUndo(id, base64ToUtf8(snapshot.base64));
    if (result && typeof result === "object" && "id" in result) {
      const detail = withPortrait(result, portraitBase64);
      schedulePersist(id, detail);
      return detail;
    }
    schedulePersist(id);
    return result;
  };

  // Durability-critical mutations (delevels, attack edits, companion renames)
  // finish their IndexedDB write before resolving so the change cannot remain
  // only in worker memory when the flow immediately navigates or exports.
  const mutateDetailAndPersist = async (id: string, method: keyof EngineClient, args: unknown[]): Promise<AnyRecord> => {
    // Manual save covers these too: the user asked for nothing to be written
    // until they save, and the flows that navigate or export read the engine.
    if (!autosaveEnabled) return mutateDetail(id, method, args);
    const engine = await ensureBooted();
    await ensureLoaded(id, { detail: false });
    const result = await invoke(engine, method, ...args);
    loadedId = id;
    if (result && typeof result === "object" && "id" in result) {
      return persist(id, withPortrait(result, portraitBase64));
    }
    await persist(id);
    return result;
  };

  const loadContentRecords = async (): Promise<ContentFileRecord[]> => {
    const records = await store.listContent();
    return records.map((record: AnyRecord) => ({
      path: String(record.path),
      base64: String(record.base64),
      ...(typeof record.sourceId === "string" ? { sourceId: record.sourceId } : {}),
      ...(typeof record.relativePath === "string" ? { relativePath: record.relativePath } : {}),
    }));
  };

  const engineContentFiles = (records: ContentFileRecord[]) =>
    records.map(({ path, base64 }) => ({ path, base64 }));

  /**
   * Pre-import duplicate guard: the same filenames, folder paths, and exact file
   * contents are already tracked under a different source id. Returns null when
   * the import is new, and also when the source list or a content hash is
   * unavailable — a duplicate check that cannot run must never block an import.
   */
  const findDuplicateImport = async (
    records: ContentFileRecord[],
    sourceId: string,
    priorRecords: ContentFileRecord[],
  ): Promise<AnyRecord | null> => {
    if (typeof store.listContentSources !== "function") return null;
    try {
      const sources = await store.listContentSources();
      if (!Array.isArray(sources) || !sources.length) return null;
      const description = await findMatchingContentSources(sources, priorRecords, records, {
        excludeSourceId: sourceId,
      });
      return description.matches.length ? description : null;
    } catch {
      return null;
    }
  };

  const removeLiveUploadedFiles = async (engine: EngineClient, paths: Iterable<string>): Promise<AnyRecord | null> => {
    const uniquePaths = [...new Set(paths)].filter(Boolean).sort();
    if (!uniquePaths.length) return null;
    const result = await invoke(engine, "removeUploaded", { paths: uniquePaths });
    for (const path of uniquePaths) liveUploadedFiles.delete(path);
    return result;
  };

  const ingestLiveUploadedFiles = async (
    engine: EngineClient,
    files: Array<{ path: string; base64: string }>,
  ): Promise<AnyRecord | null> => {
    if (!files.length) return null;
    const result = await invoke(engine, "ingestUploaded", { files });
    for (const file of files) liveUploadedFiles.set(file.path, file.base64);
    return result;
  };

  const reconcileLiveUploadedFiles = async (
    engine: EngineClient,
    desiredRecords: ContentFileRecord[],
    knownStalePaths: Iterable<string> = [],
  ): Promise<AnyRecord | null> => {
    const desired = new Map(engineContentFiles(desiredRecords).map((file) => [file.path, file.base64]));
    const changedPaths = new Set(
      [...desired]
        .filter(([path, base64]) => liveUploadedFiles.get(path) !== base64)
        .map(([path]) => path),
    );
    const pathsToRemove = new Set(knownStalePaths);
    for (const path of liveUploadedFiles.keys()) {
      if (!desired.has(path)) pathsToRemove.add(path);
    }
    for (const path of changedPaths) {
      if (liveUploadedFiles.has(path)) pathsToRemove.add(path);
    }
    for (const path of pathsToRemove) {
      if (desired.has(path)) changedPaths.add(path);
    }

    let result = await removeLiveUploadedFiles(engine, pathsToRemove);
    const ingested = await ingestLiveUploadedFiles(
      engine,
      [...changedPaths].map((path) => ({ path, base64: desired.get(path)! })),
    );
    if (ingested) result = ingested;
    liveUploadedFiles = desired;
    return result;
  };

  const restoreLiveUploadedFiles = async (
    engine: EngineClient,
    priorRecords: ContentFileRecord[],
    stagedPaths: Iterable<string> = [],
  ): Promise<void> => {
    await removeLiveUploadedFiles(engine, new Set([...liveUploadedFiles.keys(), ...stagedPaths]));
    liveUploadedFiles = new Map();
    await ingestLiveUploadedFiles(engine, engineContentFiles(priorRecords));
  };

  const mergeContentRecords = (
    priorRecords: ContentFileRecord[],
    nextRecords: ContentFileRecord[],
  ): ContentFileRecord[] => {
    const merged = new Map(priorRecords.map((record) => [record.path, record]));
    for (const record of nextRecords) merged.set(record.path, record);
    return [...merged.values()];
  };

  const rebuildContentFromStore = async (
    engine: EngineClient,
    contentUrl?: string,
    knownStalePaths: Iterable<string> = [],
  ): Promise<AnyRecord> => {
    const bundledUrl = contentUrl ?? contentManifestUrl();
    const files = await loadContentRecords();
    let result: AnyRecord = {};
    try {
      // One authoritative pass: bundled content and stored uploads become the
      // installed set in a single engine rebuild, replacing whatever was
      // installed (including a snapshot-booted library).
      result = await invoke(engine, "boot", {
        source: "bundled",
        contentUrl: bundledUrl,
        files: engineContentFiles(files),
      } as never);
      liveUploadedFiles = new Map(files.map((file) => [file.path, file.base64]));
      scheduleSnapshotRebuild(engine);
      return result;
    } catch (error) {
      if (!isUnavailable(error)) throw error;
    }
    const reconciled = await reconcileLiveUploadedFiles(engine, files, knownStalePaths);
    if (reconciled) result = reconciled;
    return result;
  };

  const contentApi: AnyRecord = {
    onLoadProgress(callback: (state: ProgressState) => void) {
      contentSubscribers.add(callback);
      callback(contentState);
      return () => contentSubscribers.delete(callback);
    },
    getLoadState: () => contentState,
    status: async () => {
      const result = await invoke(await ensureContentReady(), "contentStatus");
      const typeCounts = result.typeCounts ?? result.elementTypes ?? {};
      return { ...result, elementTypes: typeCounts, typeCounts };
    },
    types: async () => Object.keys((await contentApi.status()).elementTypes ?? {}),
    sources: async () => invoke(await ensureContentReady(), "contentSources"),
    equipmentCategories: async () => invoke(await ensureContentReady(), "equipmentCategories"),
    elements: async (params: AnyRecord = {}) => {
      const result = await invoke(await ensureContentReady(), "contentElements", {
        type: params.type ?? null,
        source: params.source ?? null,
        search: params.search ?? null,
        skip: Number(params.skip ?? 0),
        take: Number(params.take ?? 100),
        equipSetter: params.equipSetter ?? null,
        itemCategory: params.itemCategory ?? null,
        ruleset: params.ruleset ?? null,
        equipmentOnly: Boolean(params.equipmentOnly),
      });
      return result;
    },
    element: async (id: string) => invoke(await ensureContentReady(), "contentElement", id),
    clearCache: () => undefined,
    importStatus: async () => ({ status: "succeeded" }),
    reload: async (knownStalePaths: string[] = []) => {
      updateContent({ active: true, phase: "waiting", error: null, message: "Reloading content…" });
      try {
        const result = await rebuildContentFromStore(await ensureContentReady(), undefined, knownStalePaths);
        updateContent({ active: false, phase: "ready", percentage: 100, message: "Content library ready", error: null });
        return { status: "succeeded", elementCountAfterReload: result?.elementCountAfterReload ?? result?.elementCount ?? 0 };
      } catch (error) {
        updateContent({ active: false, phase: "error", error: error instanceof Error ? error.message : String(error), message: "Content reload failed" });
        throw error;
      }
    },
    upload: async (inputs: unknown[], category?: string | null, uploadOptions: AnyRecord = {}) => {
      const files = await contentUploadRecords(inputs);
      if (!files.length) throw new Error("No content files were selected.");
      const sourceId = String(uploadOptions.sourceId ?? createContentSourceId());
      const records = files.map((file) => ({ ...file, path: contentStoragePath(sourceId, file.relativePath), sourceId }));
      updateContent({ active: true, phase: "waiting", error: null, message: "Updating content…" });
      try {
        const engine = await ensureContentReady();
        const priorRecords = await loadContentRecords();
        const method = category === "homebrew" ? "patchHomebrew" : "ingestUploaded";
        const replacesTrackedSource = category !== "homebrew" && typeof store.replaceContentSource === "function";
        // Homebrew collections are re-saved constantly and are expected to
        // replace themselves, so only tracked imports are duplicate-checked.
        if (replacesTrackedSource && !uploadOptions.allowDuplicate) {
          const duplicate = await findDuplicateImport(records, sourceId, priorRecords);
          if (duplicate) return { status: "duplicate", duplicate };
        }
        const desiredRecords = replacesTrackedSource
          ? [...priorRecords.filter((record) => record.sourceId !== sourceId), ...records]
          : mergeContentRecords(priorRecords, records);
        let previousRecords: unknown = [];
        // Non-fatal engine findings about the uploaded files (duplicate ids,
        // zero-element files, unresolved append targets) surface in the UI.
        const uploadDiagnostics: unknown[] = [];
        try {
          try {
            if (method === "patchHomebrew") {
              for (const file of records) {
                const patched = await invoke(engine, "patchHomebrew", { path: file.path, base64: file.base64 });
                if (Array.isArray(patched?.diagnostics)) uploadDiagnostics.push(...patched.diagnostics);
                liveUploadedFiles.set(file.path, file.base64);
              }
            } else {
              const ingested = await reconcileLiveUploadedFiles(engine, desiredRecords);
              if (Array.isArray(ingested?.diagnostics)) uploadDiagnostics.push(...ingested.diagnostics);
            }
          } catch (error) {
            if (!needsFullContentRebuild(error)) throw error;
          }
          if (!replacesTrackedSource) {
            await store.putContentBatch(records);
          } else {
            previousRecords = await store.replaceContentSource({
              id: sourceId,
              kind: "files",
              label: records.length === 1 ? records[0]!.relativePath : `${records.length} files`,
              location: null,
              importedAt: Date.now(),
              fileCount: records.length,
            }, records);
          }
        } catch (error) {
          await restoreLiveUploadedFiles(engine, priorRecords, records.map((record) => record.path)).catch(() => undefined);
          throw error;
        }
        const result = await rebuildContentFromStore(engine, undefined, contentRecordPaths(previousRecords));
        updateContent({ active: false, phase: "ready", percentage: 100, message: "Content library ready", error: null });
        return {
          status: "succeeded",
          files: records.map((record) => uploadFileResult(record)),
          elementCountAfterReload: result?.elementCountAfterReload ?? result?.elementCount ?? 0,
          diagnostics: uploadDiagnostics,
        };
      } catch (error) {
        updateContent({ active: false, phase: "error", error: error instanceof Error ? error.message : String(error), message: "Content update failed" });
        throw error;
      } finally {
        if (contentState.active) updateContent({ active: false, phase: "ready", percentage: 100, message: "Content library ready" });
      }
    },
    remove: async (paths: string[] | string) => {
      const list = Array.isArray(paths) ? paths : [paths];
      const removed = await store.deleteContentBatch(list);
      const stalePaths = contentRecordPaths(removed);
      const reloaded = await contentApi.reload(stalePaths.length ? stalePaths : list);
      return { status: "succeeded", removed: removed ?? list, elementCountAfterReload: reloaded.elementCountAfterReload, diagnostics: [] };
    },
    listSources: () => store.listContentSources(),
    replaceSource: async (inputs: unknown[], source: AnyRecord, replaceOptions: AnyRecord = {}) => {
      const sourceId = String(source?.id ?? createContentSourceId());
      const uploads = await contentUploadRecords(inputs);
      if (!uploads.length) throw new Error("No content files were selected.");
      const files = uploads.map((upload) => ({
        path: contentStoragePath(sourceId, upload.relativePath),
        relativePath: upload.relativePath,
        base64: upload.base64,
        sourceId,
      }));
      const descriptor = { ...source, id: sourceId, fileCount: files.length };
      const engine = await ensureContentReady();
      const priorRecords = await loadContentRecords();
      // A byte-identical refresh skips the engine rebuild entirely: only the
      // source descriptor's bookkeeping (importedAt, fileCount) is updated.
      const previousOwn = priorRecords.filter((record) => record.sourceId === sourceId);
      if (previousOwn.length) {
        try {
          const [before, after] = await Promise.all([
            fingerprintContentSource(previousOwn, sourceId),
            fingerprintContentSource(files, sourceId),
          ]);
          if (before !== null && before === after) {
            await store.replaceContentSource(descriptor, files);
            const status = await invoke(engine, "contentStatus").catch(() => ({}) as AnyRecord);
            return {
              status: "unchanged",
              source: descriptor,
              files: files.map((record) => uploadFileResult(record)),
              elementCountAfterReload: status.elementCount ?? 0,
              diagnostics: [],
            };
          }
        } catch {
          // An unavailable fingerprint must never block a refresh.
        }
      }
      // Refreshing a tracked source replaces its own files, so its previous copy
      // is excluded from the comparison rather than reported against itself.
      if (!replaceOptions.allowDuplicate) {
        const duplicate = await findDuplicateImport(files, sourceId, priorRecords);
        if (duplicate) return { status: "duplicate", duplicate };
      }
      const desiredRecords = [
        ...priorRecords.filter((record) => record.sourceId !== sourceId),
        ...files,
      ];
      let previousRecords: unknown;
      const replaceDiagnostics: unknown[] = [];
      try {
        try {
          const ingested = await reconcileLiveUploadedFiles(engine, desiredRecords);
          if (Array.isArray(ingested?.diagnostics)) replaceDiagnostics.push(...ingested.diagnostics);
        } catch (error) {
          if (!needsFullContentRebuild(error)) throw error;
        }
        previousRecords = await store.replaceContentSource(descriptor, files);
      } catch (error) {
        await restoreLiveUploadedFiles(engine, priorRecords, files.map((file) => file.path)).catch(() => undefined);
        throw error;
      }
      const reloaded = await contentApi.reload(contentRecordPaths(previousRecords));
      return { status: "succeeded", source: descriptor, files: files.map((record) => uploadFileResult(record)), elementCountAfterReload: reloaded.elementCountAfterReload, diagnostics: replaceDiagnostics };
    },
    removeSource: async (sourceId: string) => {
      const removed = await store.removeContentSource(sourceId);
      const reloaded = await contentApi.reload(contentRecordPaths(removed));
      return { status: "succeeded", removed, elementCountAfterReload: reloaded.elementCountAfterReload, diagnostics: [] };
    },
    acknowledgeDuplicates: (request: AnyRecord) => store.acknowledgeContentDuplicates(request.sourceIds, request.fingerprint),
    resolveDuplicates: async (request: AnyRecord) => {
      let removed = [];
      if (request.action === "remove" || request.removeSourceIds) removed = await store.removeContentSources(request.removeSourceIds ?? request.sourceIds ?? []);
      const reloaded = removed.length ? await contentApi.reload(contentRecordPaths(removed)) : null;
      return { status: "succeeded", removedSourceIds: request.removeSourceIds ?? request.sourceIds ?? [], elementCountAfterReload: reloaded?.elementCountAfterReload };
    },
  };

  const characterApi: AnyRecord = {
    flushPendingSaves,
    saveCharacter,
    getAutosaveEnabled: () => autosaveEnabled,
    setAutosaveEnabled: async (enabled: boolean) => {
      autosaveEnabled = enabled;
      if (enabled) await flushPendingSaves();
    },
    hasUnsavedChanges: (id?: string) => (id === undefined ? dirtyIds.size > 0 : dirtyIds.has(id)),
    canUndo: (id: string) => (undoStacks.get(id)?.length ?? 0) > 0,
    // Restores the character as it stood before its latest mutation; null
    // when there is nothing to undo. The result is the refreshed detail, and
    // under autosave the restored state is written like any other change.
    undoLastChange: async (id: string) => {
      const stack = undoStacks.get(id);
      const xml = stack?.pop();
      if (xml === undefined) return null;
      if (stack !== undefined && stack.length === 0) undoStacks.delete(id);
      const engine = await ensureBooted();
      await invoke(engine, "importCharacterXml", id, utf8ToBase64(xml));
      loadedId = id;
      const detail = withPortrait(await invoke(engine, "getCharacter", id), portraitBase64);
      schedulePersist(id, detail);
      publishUnsaved();
      return detail;
    },
    // Fires with the unsaved ids whenever the unsaved set or an undo history
    // changes; subscribers read canUndo/hasUnsavedChanges for the detail.
    onUnsavedChange(callback: (ids: string[]) => void) {
      unsavedSubscribers.add(callback);
      callback([...dirtyIds]);
      return () => unsavedSubscribers.delete(callback);
    },
    // Drops the in-memory edits: the next open re-imports the stored copy.
    discardUnsavedChanges: (id: string) => {
      undoStacks.delete(id);
      forgetDirty(id);
      publishUnsaved();
      if (loadedId === id) { loadedId = null; portraitBase64 = null; }
    },
    // The engine copy is about to be replaced from storage, so nothing unsaved
    // remains recoverable; callers flush first.
    invalidateLoadedCharacter: () => {
      loadedId = null;
      portraitBase64 = null;
      dirtyIds.clear();
      dirtyGeneration.clear();
      undoStacks.clear();
      publishUnsaved();
    },
    onLoadProgress(callback: (state: ProgressState) => void) { characterSubscribers.add(callback); callback(characterState); return () => characterSubscribers.delete(callback); },
    getLoadState: () => characterState,
    list: async () => (await store.listCharacters()).map((record: AnyRecord) => record.summary ?? { id: record.id, name: record.id, race: "", class: "", background: "", level: "", portraitBase64: null }),
    create: async (name: string) => {
      const engine = await ensureContentReady();
      const detail = await invoke(engine, "createCharacter", name);
      loadedId = detail.id;
      const restrictedSourceIds = await readDefaultRestrictedSourceIds(store);
      if (restrictedSourceIds.length || typeof engine.setCharacterSources === "function") {
        await invoke(engine, "setCharacterSources", detail.id, { restrictedSourceIds });
      }
      portraitBase64 = null;
      return persist(detail.id, withPortrait(await invoke(engine, "getCharacter", detail.id), null));
    },
    get: async (id: string) => ensureLoaded(id),
    sources: (id: string) => invoke(getClient(), "getCharacterSources", id),
    setSources: (id: string, sourceIds: string[]) => mutateDetail(id, "setCharacterSources", [id, { restrictedSourceIds: normalizeRestrictedSourceIds(sourceIds) }]),
    optionalRules: (id: string) => invoke(getClient(), "getOptionalRules", id),
    ruleset: (id: string) => invoke(getClient(), "getRulesetMode", id),
    setRuleset: (id: string, mode: string) => mutateDetail(id, "setRulesetMode", [id, { mode }]),
    adjustments: (id: string) => invoke(getClient(), "getCharacterAdjustments", id),
    setCharacterControl: (id: string, key: string, enabled: boolean) => mutateDetail(id, "setCharacterControl", [id, { key, enabled }]),
    remove: async (id: string) => { const engine = await ensureBooted(); if (loadedId === id) await invoke(engine, "deleteCharacter", id).catch(() => undefined); await store.deleteCharacter(id); undoStacks.delete(id); forgetDirty(id); if (loadedId === id) { loadedId = null; portraitBase64 = null; } return null; },
    // Portrait changes persist immediately: the character grid re-reads the
    // stored summary on the upload's completion callback, so a debounced
    // write would make a successful upload look like a silent no-op.
    setPortrait: async (id: string, value: string) => { portraitBase64 = value; return mutateDetailAndPersist(id, "setPortrait", [id, value]); },
    removePortrait: async (id: string) => { portraitBase64 = null; return mutateDetailAndPersist(id, "removePortrait", [id]); },
    updateDetails: (id: string, details: AnyRecord) => mutateDetail(id, "updateDetails", [id, details]),
    setAbilities: (id: string, values: AnyRecord) => mutateDetail(id, "setAbilities", [id, values]),
    selectionOptions: async (id: string, ruleId: string, number?: number) => {
      const engine = await ensureContentReady();
      await ensureLoaded(id);
      return number === undefined
        ? invoke(engine, "getSelectionOptions", id, ruleId)
        : invoke(engine, "getSelectionOptions", id, ruleId, { number });
    },
    setSelection: (id: string, ruleId: string, selectionId: string, number = 1) => mutateDetail(id, "setSelection", [id, ruleId, { selectionId, number }]),
    clearSelection: (id: string, ruleId: string, number = 1) => mutateDetail(id, "clearSelection", [id, ruleId, { number }]),
    levelUp: (id: string) => mutateDetail(id, "levelUp", [id, { mode: "main" }]),
    levelUpMode: (id: string, mode: string, classId?: string) => mutateDetail(id, "levelUp", [id, { mode, ...(classId ? { classId } : {}) }]),
    levelDown: (id: string) => mutateDetail(id, "levelDown", [id]),
    delevel: (id: string, mode: string, classId?: string) => mutateDetailAndPersist(id, "delevel", [id, { mode, ...(classId ? { classId } : {}) }]),
    undoDelevel: (id: string) => mutateDetailAndPersist(id, "undoDelevel", [id]),
    setHitPointRoll: (id: string, classId: string, classLevel: number, value: number) => mutateDetail(id, "setHitPointRoll", [id, { classId, classLevel, value }]),
    progression: (id: string) => invoke(getClient(), "getProgression", id),
    statistics: async (id: string) => invoke(getClient(), "getStatistics", id),
    spellcasting: (id: string) => invoke(getClient(), "getSpellcasting", id),
    setPrepared: async (id: string, casterId: string, spellId: string, prepared: boolean) => { await ensureLoaded(id); const result = await invoke(getClient(), "setPrepared", id, casterId, { spellId, prepared }); schedulePersist(id); return result; },
    spellBrowse: (id: string, ruleId: string) => invoke(getClient(), "getSpellBrowse", id, ruleId),
    addSpell: (id: string, spellId: string) => mutateDetail(id, "addGrantedSpell", [id, { spellId }]),
    removeSpell: (id: string, spellId: string) => mutateDetail(id, "removeGrantedSpell", [id, { spellId }]),
    addFeat: (id: string, featId: string) => mutateDetail(id, "addGrantedFeat", [id, { featId }]),
    removeFeat: (id: string, featId: string) => mutateDetail(id, "removeGrantedFeat", [id, { featId }]),
    addAbilityScore: (id: string, ids: string[]) => mutateDetail(id, "addGrantedAbilityScore", [id, { abilityElementIds: ids }]),
    removeAbilityScore: (id: string, idToRemove: string) => mutateDetail(id, "removeGrantedAbilityScore", [id, { abilityElementId: idToRemove }]),
    dmGrants: (id: string) => invoke(getClient(), "getDmGrants", id),
    companion: (id: string) => invoke(getClient(), "getCompanion", id),
    setCompanionName: (id: string, name: string) => mutateDetailAndPersist(id, "setCompanionName", [id, { name }]),
    setCompanionPortrait: (id: string, base64: string) =>
      mutateDetailAndPersist(id, "setCompanionPortrait", [id, base64]),
    removeCompanionPortrait: (id: string) => mutateDetailAndPersist(id, "removeCompanionPortrait", [id]),
    inventory: (id: string) => invoke(getClient(), "getInventory", id),
    itemOptions: (id: string, itemId: string) => invoke(getClient(), "getItemBaseOptions", id, itemId),
    addItem: (id: string, itemId: string, amount = 1, baseElementId: string | null = null) => mutateDetail(id, "addItem", [id, { itemId, amount, baseElementId }]),
    removeItem: (id: string, identifier: string, amount = 1) => mutateDetail(id, "removeItem", [id, identifier, amount]),
    extractItem: (id: string, identifier: string) => mutateDetail(id, "extractItem", [id, identifier]),
    equipItem: (id: string, identifier: string, location: string) => mutateDetail(id, "equipItem", [id, identifier, { location }]),
    setItemStorage: (id: string, identifier: string, storage: string | null) => mutateDetail(id, "setItemStorage", [id, identifier, { storage }]),
    attuneItem: (id: string, identifier: string, attuned: boolean) => mutateDetail(id, "attuneItem", [id, identifier, { attuned }]),
    setCoins: (id: string, coins: AnyRecord) => mutateDetail(id, "setCoins", [id, coins]),
    attacks: (id: string) => invoke(getClient(), "getAttacks", id),
    attackOptions: (id: string) => invoke(getClient(), "getAttackOptions", id),
    createAttack: (id: string, request: AnyRecord) => mutateDetailAndPersist(id, "createAttack", [id, request]),
    updateAttack: (id: string, attackId: string, request: AnyRecord) => mutateDetailAndPersist(id, "updateAttack", [id, attackId, request]),
    setAttackVisibility: (id: string, attackId: string, visible: boolean) => mutateDetailAndPersist(id, "setAttackVisibility", [id, attackId, { isDisplayed: visible }]),
    moveAttack: (id: string, attackId: string, direction: string) => mutateDetailAndPersist(id, "moveAttack", [id, attackId, { direction }]),
    deleteAttack: (id: string, attackId: string) => mutateDetailAndPersist(id, "deleteAttack", [id, attackId]),
    appearanceSuggestions: (id: string, seed?: number) => invoke(getClient(), "getAppearanceSuggestions", id, seed ?? 0),
    sheetBytes: async (id: string, opts: AnyRecord = {}) => {
      await ensureLoaded(id);
      const model = await invoke(getClient(), "generateSheet", id, { lite: Boolean(opts.lite) });
      return renderSheetBytes(model, {
        templateSet: typeof opts.templateSet === "string" ? (opts.templateSet as SheetRenderOptions["templateSet"]) : undefined,
        colours: typeof opts.colours === "object" && opts.colours !== null ? (opts.colours as SheetRenderOptions["colours"]) : undefined,
        fonts: typeof opts.fonts === "object" && opts.fonts !== null ? (opts.fonts as SheetRenderOptions["fonts"]) : undefined,
        brandImage: typeof opts.brandImage === "string" ? opts.brandImage : undefined,
        footerText: typeof opts.footerText === "string" ? opts.footerText : undefined,
      });
    },
    sheet: async (id: string, opts: AnyRecord = {}) => URL.createObjectURL(new Blob([await characterApi.sheetBytes(id, opts)], { type: "application/pdf" })),
    sheetUrl: () => undefined,
    export: async (id: string) => { await ensureLoaded(id); const xml = base64ToUtf8((await invoke(getClient(), "exportCharacterXml", id)).base64); return { filename: `${id}.dnd5e`, blob: new Blob([xml], { type: "application/xml" }) }; },
    exportPackage: async (id: string) => {
      await ensureLoaded(id);
      const xml = base64ToUtf8((await invoke(getClient(), "exportCharacterXml", id)).base64);
      // Bundle every stored custom-content file: the package must open on a
      // device that has none of this library, so over-including is the safe side.
      const records = typeof store.listContent === "function" ? ((await store.listContent()) as AnyRecord[] | null) ?? [] : [];
      const envelope = {
        format: CHARACTER_PACKAGE_TOKEN,
        version: 1,
        character: { id, xml },
        content: records
          .filter((record) => typeof record.path === "string" && typeof record.base64 === "string")
          .map((record) => ({ path: record.path, base64: record.base64 })),
      };
      return { filename: `${id}.dnd5e-pkg`, blob: new Blob([JSON.stringify(envelope)], { type: "application/json" }) };
    },
    import: async (file: File) => {
      const text = await file.text();
      const pkg = parseCharacterPackage(text);
      // A package carries its custom content; ingest it before the character
      // XML so the document's selections resolve against a complete library.
      // A duplicate verdict means this exact source is already stored — skip.
      if (pkg && pkg.content.length > 0) {
        await contentApi.upload(pkg.content.map((entry) => ({ relativePath: entry.path, base64: entry.base64 })));
      }
      const xml = pkg ? pkg.xml : text;
      const requestedName = characterNameFromXml(xml, file.name.replace(/\.dnd5e(?:-pkg)?$/i, ""));
      const existing = await store.listCharacters();
      const usedIds = new Set(existing.map((record: AnyRecord) => String(record.id)));
      let id = requestedName;
      let suffix = 2;
      while (usedIds.has(id)) id = `${requestedName} (${suffix++})`;

      const engine = await ensureContentReady();
      const previousPortrait = portraitBase64;
      updateCharacter({ active: true, percentage: null, message: "Importing character…", error: null });
      let committed = false;
      try {
        await invoke(engine, "createCharacter", id);
        await invoke(engine, "importCharacterXml", id, utf8ToBase64(xml));
        portraitBase64 = portraitFromXml(xml);
        const detail = withPortrait(await invoke(engine, "getCharacter", id), portraitBase64);
        await persist(id, detail);
        committed = true;
        loadedId = id;
        updateCharacter({ active: false, percentage: 100, message: "Character ready", error: null });
        return { id, bundledContent: Boolean(pkg && pkg.content.length > 0) };
      } catch (error) {
        loadedId = null;
        portraitBase64 = previousPortrait;
        updateCharacter({ active: false, percentage: null, message: "Character import failed", error: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        if (!committed) await invoke(engine, "deleteCharacter", id).catch(() => undefined);
      }
    },
  };

  const api: AnyRecord = {
    health: async () => { await ensureBooted(); return { status: "healthy", engine: "forge-character-builder" }; },
    content: contentApi,
    characters: characterApi,
    BUILD_SECTIONS: [],
    fastStart: {
      status: async () => {
        if (typeof store.getFastStartSummary === "function") {
          try {
            const summary = await store.getFastStartSummary();
            return {
              ...fastStartState,
              lastBuildAt: summary.lastBuildAt ?? fastStartState.lastBuildAt,
              snapshotSizeBytes: summary.snapshotSizeBytes || fastStartState.snapshotSizeBytes,
              hasRawContentPack: Boolean(summary.hasRawContentPack),
              readiness: summary.hasSnapshot ? "ready" : fastStartState.readiness,
            };
          } catch {
            return fastStartState;
          }
        }
        return fastStartState;
      },
      subscribe: (callback: (state: AnyRecord) => void) => {
        fastStartSubscribers.add(callback);
        callback(fastStartState);
        return () => fastStartSubscribers.delete(callback);
      },
      rebuild: async () => {
        const engine = await ensureContentReady();
        await buildFastStartSnapshot(engine);
        if (fastStartState.error) throw new Error(String(fastStartState.error));
        return fastStartState;
      },
      remove: async () => {
        if (snapshotRebuildTimer !== null) {
          clearTimeout(snapshotRebuildTimer);
          snapshotRebuildTimer = null;
        }
        await store.clearFastStartData?.();
        updateFastStart({ readiness: "not-built", lastBuildAt: null, snapshotSizeBytes: 0, usedSnapshot: false, error: null });
      },
    },
    onBootProgress(callback: (state: AnyRecord) => void) { bootSubscribers.add(callback); callback(bootState); return () => bootSubscribers.delete(callback); },
    getBootState: () => bootState,
    startBoot: () => { void ensureBooted(); },
    retryBoot: () => { bootPromise = null; contentBootPromise = null; contentBootError = null; void ensureBooted(); },
    getLoadState: () => bootState,
    onLoadProgress: (callback: (state: AnyRecord) => void) => { bootSubscribers.add(callback); callback(bootState); return () => bootSubscribers.delete(callback); },
  };
  return api as EngineApi;
}

export { CHARACTER_LOAD_IDENTITY, FAST_START_IDENTITY };
