// Which optional pages the character sheet prints: the appearance/portrait
// page, the dedicated notes page, the spell cards and the item cards. Persisted
// per browser alongside the template set and the colours; renaming the key
// silently resets the preference for everyone who set it.
//
// Every page defaults to on, so a browser that has never touched this setting
// keeps the sheet it has always had.

export const SHEET_PAGES_STORAGE_KEY = 'fcb-sheet-pages';

export const SHEET_PAGE_NAMES = ['background', 'notes', 'attackNotes', 'spellCards', 'itemCards'];

export const SHEET_PAGE_LABELS = {
  background: 'Appearance & portrait',
  notes: 'Notes',
  attackNotes: 'Attack notes',
  spellCards: 'Spell cards',
  itemCards: 'Item cards',
};

export const SHEET_PAGE_TIPS = {
  background: 'The portrait, appearance, backstory and background feature page.',
  notes: 'The dedicated page for notes that outgrow the appearance page.',
  attackNotes: 'Extra pages for long attack notes. Unticking leaves a short omission label; your notes stay saved.',
  spellCards: 'One card per known spell, with its full description.',
  itemCards: 'One card per carried item that carries a description.',
};

export const DEFAULT_SHEET_PAGES = Object.freeze(
  Object.fromEntries(SHEET_PAGE_NAMES.map((name) => [name, true])),
);

export function isSheetPageName(value) {
  return typeof value === 'string' && SHEET_PAGE_NAMES.includes(value);
}

/** Any stored shape resolves to a complete selection; unknown keys are dropped. */
export function resolveSheetPages(value) {
  const wanted = typeof value === 'object' && value !== null ? value : {};
  const resolved = { ...DEFAULT_SHEET_PAGES };
  for (const name of SHEET_PAGE_NAMES) {
    if (typeof wanted[name] === 'boolean') resolved[name] = wanted[name];
  }
  return resolved;
}

/** A stable cache-key segment: the pages that are ON, in a fixed order. */
export function sheetPagesKey(pages) {
  const resolved = resolveSheetPages(pages);
  return SHEET_PAGE_NAMES.map((name) => (resolved[name] ? name : `-${name}`)).join('+');
}

export function readStoredSheetPages(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SHEET_PAGES_STORAGE_KEY);
    return resolveSheetPages(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SHEET_PAGES };
  }
}

export function storeSheetPages(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_PAGES_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

// One store shared by every sheet render, so the preview, the sheet tab and
// the export agree on the pages.
export function createSheetPagesSettingStore({ storage = globalThis.localStorage } = {}) {
  let current = readStoredSheetPages(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Each page toggles only to a boolean; anything else keeps the current choice.
  const set = (next) => {
    const wanted = typeof next === 'object' && next !== null ? next : {};
    const resolved = { ...current };
    for (const name of SHEET_PAGE_NAMES) {
      if (typeof wanted[name] === 'boolean') resolved[name] = wanted[name];
    }
    if (sheetPagesKey(resolved) === sheetPagesKey(current)) return;
    current = resolved;
    storeSheetPages(current, storage);
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    set,
    toggle(name) {
      if (isSheetPageName(name)) set({ [name]: !current[name] });
    },
    syncFromStorage() {
      const value = readStoredSheetPages(storage);
      if (sheetPagesKey(value) === sheetPagesKey(current)) return;
      current = value;
      notify();
    },
  };
}

export const sheetPagesSettingStore = createSheetPagesSettingStore();
