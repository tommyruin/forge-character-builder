// The character sheet colours: the accent of the templates' frames and
// ribbons, the inner lines and ornaments, and the text. Persisted per browser
// alongside the template set; renaming the key silently resets the preference
// for everyone who set it.
import {
  DEFAULT_SHEET_COLOURS,
  SHEET_PALETTE,
  SHEET_THEMES,
  SHEET_THEME_NAMES,
  isSheetColourName,
  resolveSheetColours,
  sheetColoursKey,
  sheetThemeOf,
} from '@forge-cb/engine/sheet-contract';

export const SHEET_COLOURS_STORAGE_KEY = 'fcb-sheet-colours';
export { DEFAULT_SHEET_COLOURS, SHEET_PALETTE, SHEET_THEMES, SHEET_THEME_NAMES, sheetColoursKey, sheetThemeOf };

export function readStoredSheetColours(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SHEET_COLOURS_STORAGE_KEY);
    return resolveSheetColours(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SHEET_COLOURS };
  }
}

export function storeSheetColours(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_COLOURS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

// One store shared by every sheet render, so the preview, the sheet tab and
// the export agree on the colours.
export function createSheetColoursSettingStore({ storage = globalThis.localStorage } = {}) {
  let current = readStoredSheetColours(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Each part changes only to a known name; an unknown one keeps the current choice.
  const set = (next) => {
    const wanted = typeof next === 'object' && next !== null ? next : {};
    const resolved = { ...current };
    for (const part of Object.keys(resolved)) {
      if (isSheetColourName(wanted[part])) resolved[part] = wanted[part];
    }
    if (sheetColoursKey(resolved) === sheetColoursKey(current)) return;
    current = resolved;
    storeSheetColours(current, storage);
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    set,
    setTheme(name) {
      const theme = SHEET_THEMES[name];
      if (theme) set({ accent: theme.accent, lines: theme.lines, text: theme.text });
    },
    syncFromStorage() {
      const value = readStoredSheetColours(storage);
      if (sheetColoursKey(value) === sheetColoursKey(current)) return;
      current = value;
      notify();
    },
  };
}

export const sheetColoursSettingStore = createSheetColoursSettingStore();
