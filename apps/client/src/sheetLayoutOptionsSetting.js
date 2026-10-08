// Browser-wide sheet layout options, kept together in one JSON object so new
// options can join without a new storage key each. Persisted per browser
// alongside the template set, colours and pages; renaming the key silently
// resets the choices for everyone who made them.
//
//  - top: reserved for a later layout step.
//  - split: separate boxes for class features, subclass features and feats
//    on the character page. null means "the layout's own default" (off for
//    2014 and 2024, on for 2024 Hybrid); true or false overrides it.
//  - readable: reserved for a later layout step.
//  - inventoryNotes: the equipment page's notes column also describes the
//    other magic items in full and the tools and useful gear in brief.
//  - smartCards: new items (added, or unpacked from a pack) get an item card
//    only when they are magic items, tools or useful gear. Items already in
//    the inventory never change.
//
// Every option defaults to off (or, for split, to the layout's own default),
// so a browser that has never touched this setting keeps the sheet and the
// item cards it has always had.

import { resolveSheetLayout, sheetLayoutKey } from '@forge-cb/engine/sheet-contract';

export const SHEET_LAYOUT_OPTIONS_STORAGE_KEY = 'fcb-sheet-layout-options';

const BOOLEAN_OPTIONS = ['top', 'readable', 'inventoryNotes', 'smartCards'];

export const DEFAULT_SHEET_LAYOUT_OPTIONS = Object.freeze({
  top: false,
  split: null,
  readable: false,
  inventoryNotes: false,
  smartCards: false,
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
  if ('split' in source) {
    resolved.split = typeof source.split === 'boolean' ? source.split : null;
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

export function readStoredSheetLayoutOptions(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SHEET_LAYOUT_OPTIONS_STORAGE_KEY);
    return resolveSheetLayoutOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SHEET_LAYOUT_OPTIONS };
  }
}

export function storeSheetLayoutOptions(
  value,
  storage = globalThis.localStorage,
) {
  try {
    storage?.setItem(SHEET_LAYOUT_OPTIONS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

/**
 * The character page layout `options` print on `templateSet`: every switch
 * decided, a split left at null taking the layout's own default. This is what
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
