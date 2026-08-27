// The character sheet template set: which rules edition's layout the PDF
// renders against. Persisted per browser; renaming the key silently resets the
// preference for everyone who set it.
export const SHEET_TEMPLATE_STORAGE_KEY = 'fcb-sheet-template';
export const SHEET_TEMPLATE_SETS = ['2014', '2024'];
export const DEFAULT_SHEET_TEMPLATE_SET = '2014';

export function readStoredSheetTemplateSet(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(SHEET_TEMPLATE_STORAGE_KEY);
    return SHEET_TEMPLATE_SETS.includes(value) ? value : DEFAULT_SHEET_TEMPLATE_SET;
  } catch {
    return DEFAULT_SHEET_TEMPLATE_SET;
  }
}

export function storeSheetTemplateSet(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_TEMPLATE_STORAGE_KEY, value);
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

// One store shared by the sheet tab, the split-view preview and the export
// menu, so every render agrees on the set.
export function createSheetTemplateSettingStore({ storage = globalThis.localStorage } = {}) {
  let current = readStoredSheetTemplateSet(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const set = (next) => {
    if (!SHEET_TEMPLATE_SETS.includes(next) || next === current) return;
    current = next;
    storeSheetTemplateSet(current, storage);
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    set,
    syncFromStorage() {
      const value = readStoredSheetTemplateSet(storage);
      if (value === current) return;
      current = value;
      notify();
    },
  };
}

export const sheetTemplateSettingStore = createSheetTemplateSettingStore();
