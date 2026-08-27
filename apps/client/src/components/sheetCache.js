// Module-level cache of recently generated character-sheet PDF bytes, keyed by
// character + renderer/template revision + content revision + workspace mutation tick +
// variant (lite vs full). mutationTick is bumped on every successful engine mutation
// (CharacterWorkspace), while contentRevision changes when the loaded content library changes.
// SHEET_RENDERER_REVISION must be bumped when the PDF renderer or sheet template/layout changes.
//
// Purpose: SheetPreviewPanel (Split View) and SheetTab unmount/remount as the user toggles
// Split View or switches tabs — without this, each remount fires a fresh full generation
// (300 ms–3 s of serialized worker time) even when nothing changed. The cache lets a remount
// show the existing sheet instantly. It is cleared per-character when the workspace switches
// characters (see CharacterWorkspace), because tick resets to 0 on a fresh workspace mount.

const cache = new Map(); // key -> Uint8Array
let order = [];
const MAX_ENTRIES = 4;
export const SHEET_RENDERER_REVISION = 'pdf-canvas-v2';

export function sheetCacheKey(id, tick, lite, contentRevision = 0, templateSet = '2014', colours = 'crimson/gold/ink', fonts = 'cinzelDecorative/spectral/helvetica/helvetica') {
  return `${id}#${SHEET_RENDERER_REVISION}#${contentRevision}#${tick}#${templateSet}#${colours}#${fonts}#${lite ? 'lite' : 'full'}`;
}

export function getCachedSheet(key) {
  return cache.get(key) || null;
}

export function putCachedSheet(key, bytes) {
  if (!cache.has(key)) order.push(key);
  cache.set(key, bytes);
  while (order.length > MAX_ENTRIES) {
    const evicted = order.shift();
    cache.delete(evicted);
  }
}

// Drop cached sheets for one character (id omitted = all). Called when the workspace's
// engine state may have changed out from under the tick counter (content re-ingest,
// character switch/delete).
export function clearSheetCache(id) {
  for (const key of [...cache.keys()]) {
    if (!id || key.startsWith(`${id}#`)) cache.delete(key);
  }
  order = order.filter((key) => cache.has(key));
}

// In-flight sheet generations keyed by cache key. Lets concurrent callers for the same
// (character, tick, variant) — notably React StrictMode's doubled dev mount — share ONE
// generation instead of racing: the second caller awaits the same promise rather than
// starting a duplicate or (worse) skipping generation and stranding the first result.
const inFlight = new Map();

export function sharedSheetGeneration(key, start) {
  let promise = inFlight.get(key);
  if (!promise) {
    promise = Promise.resolve().then(start).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }
  return promise;
}
