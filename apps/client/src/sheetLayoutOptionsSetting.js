// Browser-wide sheet layout options, kept together in one JSON object so new
// options can join without a new storage key each. Persisted per browser
// alongside the template set, colours and pages; renaming the key silently
// resets the choices for everyone who made them.
//
//  - top: a compact top row on the character page. On the 2024 layouts,
//    armor class shares a box with the armor and resistances beside hit
//    points and hit dice, over smaller vitals with the death saves, and the
//    identity is separate species, class and level fields; on the 2014
//    layout, initiative sits beside the proficiency bonus and the hit dice
//    split into maximum and spent. null means "the layout's own default" (on
//    for 2024 and 2024 Hybrid, off for 2014); true or false overrides it.
//  - split: class features, subclass features and feats apart on the
//    character page. null means "the layout's own default" (off for 2014 and
//    2024, on for 2024 Hybrid); true or false overrides it.
//  - readable: a more readable character page. On the 2024 layouts the
//    captions are larger and the attack notes print at 7pt; on the 2014
//    layout the captions are larger, the skills roomier and there are six
//    attack rows.
//  - inventoryNotes: the equipment page's notes column also describes the
//    other magic items in full and the tools and useful gear in brief.
//  - resourceTrackers: uses print next to each feature, as the Resources tab
//    left them (a filled circle per use spent, an open one per use left), each
//    closing the text of the first printed feature that spends it
//    ("[Uses: ○ ○]"). On by default; off leaves them out of the features.
//  - resourceTrackersList: the sheet also prints a Resources box of every
//    tracker (those a feature shows, an item's, those kept by hand). Off by
//    default and independent of resourceTrackers, so the box can print alone.
//    The render request spells that case resourceTrackersInline: false; that
//    field is derived and never stored, so a stored value of it is dropped on
//    reading, like any unknown key.
//  - resourceTrackersEmpty: whatever trackers print, print as a fresh sheet,
//    ignoring uses already spent (an open circle per use, a blank for a large
//    count). Only offered while resourceTrackers or resourceTrackersList is on.
//  - smartCards: new items (added, or unpacked from a pack) get an item card
//    only when they are magic items, tools or useful gear. Items already in
//    the inventory never change.
//
// Every option defaults to off (except resourceTrackers, which is on; and top
// and split, which take the layout's own default), so a browser that has never
// touched this setting gets each layout's own sheet and the item cards it has
// always had.

import { resolveSheetLayout, sheetLayoutKey } from '@forge-cb/engine/sheet-contract';

export const SHEET_LAYOUT_OPTIONS_STORAGE_KEY = 'fcb-sheet-layout-options';

const BOOLEAN_OPTIONS = ['readable', 'inventoryNotes', 'smartCards', 'resourceTrackers', 'resourceTrackersEmpty', 'resourceTrackersList'];
/** Options that may also be null, for the layout's own default. */
const DEFAULTABLE_OPTIONS = ['top', 'split'];

export const DEFAULT_SHEET_LAYOUT_OPTIONS = Object.freeze({
  top: null,
  split: null,
  readable: false,
  inventoryNotes: false,
  smartCards: false,
  resourceTrackers: true,
  resourceTrackersEmpty: false,
  resourceTrackersList: false,
});


/** Applies the valid options of `wanted` over `base`; anything else keeps the base value. */
function mergeOptions(base, wanted) {
  const source =
    typeof wanted === 'object' && wanted !== null && !Array.isArray(wanted)
      ? wanted
      : {};
  const resolved = { ...base };
  for (const name of BOOLEAN_OPTIONS) {
    if (typeof source[name] === 'boolean') resolved[name] = source[name];
  }
  for (const name of DEFAULTABLE_OPTIONS) {
    if (name in source) resolved[name] = typeof source[name] === 'boolean' ? source[name] : null;
  }
  return resolved;
}

/** Any stored shape resolves to a complete set of options; unknown keys are dropped. */
export function resolveSheetLayoutOptions(value) {
  return mergeOptions(DEFAULT_SHEET_LAYOUT_OPTIONS, value);
}

function optionsKey(options) {
  return JSON.stringify(resolveSheetLayoutOptions(options));
}

// Stored options carry this version.
//  - Before 2, top was a plain boolean that was saved as false with any other
//    choice, so an older false only ever meant "the default" and reads as null.
//  - Before 3, the Resources list was hidden and ignored while resourceTrackers
//    was off, so that pair meant "no trackers at all" and must not start
//    printing a box now that the two switches are independent.
const STORED_VERSION = 3;

export function readStoredSheetLayoutOptions(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SHEET_LAYOUT_OPTIONS_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    const version = typeof stored?.version === 'number' ? stored.version : 0;
    if (version < 2 && stored?.top === false) delete stored.top;
    if (version < 3 && stored?.resourceTrackers === false) stored.resourceTrackersList = false;
    return resolveSheetLayoutOptions(stored);
  } catch {
    return { ...DEFAULT_SHEET_LAYOUT_OPTIONS };
  }
}

export function storeSheetLayoutOptions(
  value,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(SHEET_LAYOUT_OPTIONS_STORAGE_KEY, JSON.stringify({ ...value, version: STORED_VERSION }));
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

/**
 * The character page layout `options` print on `templateSet`: every switch
 * decided, a top or split left at null taking the layout's own default. This is what
 * the renders ask for and what the settings switch shows.
 */
export function effectiveSheetLayout(templateSet, options) {
  const resolved = resolveSheetLayoutOptions(options);
  return resolveSheetLayout(templateSet, {
    top: resolved.top,
    split: resolved.split,
    readable: resolved.readable,
  });
}

/** A stable identity for an effective layout, for sheet cache keys. */
export function sheetLayoutCacheKey(layout) {
  return `layout-${sheetLayoutKey(layout)}`;
}

/**
 * What the resource tracker options print, as a suffix for the sheet cache
 * keys: nothing for the default (trackers as the Resources tab left them,
 * next to their features, no Resources box), so the default keeps the keys
 * it has always had. Each of the four next-to-features and box combinations
 * has its own key.
 */
export function resourceTrackersCacheKey(options) {
  const { resourceTrackers: inline, resourceTrackersList: list, resourceTrackersEmpty: empty } = resolveSheetLayoutOptions(options);
  if (!inline && !list) return '#no-trackers';
  const placement = !inline ? '#resource-list-only' : list ? '#resource-list' : '';
  return (empty ? '#empty-trackers' : '') + placement;
}

/**
 * The sheet request fields the resource tracker options send. To the engine,
 * resourceTrackers: false prints no trackers at all, so a box without the uses
 * beside features keeps it true and sends resourceTrackersInline: false.
 */
export function resourceTrackerSheetOptions(options) {
  const { resourceTrackers: inline, resourceTrackersList: list, resourceTrackersEmpty: empty } = resolveSheetLayoutOptions(options);
  const anyPrinted = inline || list;
  return {
    resourceTrackers: anyPrinted,
    resourceTrackersEmpty: anyPrinted && empty,
    resourceTrackersList: list,
    ...(list && !inline ? { resourceTrackersInline: false } : {}),
  };
}

/**
 * The extra add-item options the smart-cards choice asks for: significant-only
 * cards when it is on, nothing at all when it is off, so an add then sends
 * exactly the request it always has.
 */
export function newItemCardOptions(options) {
  return options?.smartCards === true ? { cardPolicy: 'significant' } : null;
}

// One store shared by every reader, so the sheet settings, the equipment tab
// and the sheet renders agree on the options.
export function createSheetLayoutOptionsSettingStore({
  storage = globalThis.localStorage,
} = {}) {
  let current = readStoredSheetLayoutOptions(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    set(next) {
      const resolved = mergeOptions(current, next);
      if (optionsKey(resolved) === optionsKey(current)) return;
      current = resolved;
      storeSheetLayoutOptions(current, storage);
      notify();
    },
    syncFromStorage() {
      const value = readStoredSheetLayoutOptions(storage);
      if (optionsKey(value) === optionsKey(current)) return;
      current = value;
      notify();
    },
  };
}

export const sheetLayoutOptionsSettingStore =
  createSheetLayoutOptionsSettingStore();
