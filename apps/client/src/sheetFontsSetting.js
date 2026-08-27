// The character sheet typefaces: titles, captions, body text and the large
// numbers. Persisted per browser alongside the template set and colours;
// renaming the key silently resets the preference for everyone who set it.
import {
  DEFAULT_SHEET_FONTS,
  SHEET_FONT_FACES,
  SHEET_FONT_FACE_NAMES,
  SHEET_FONT_ROLES,
  resolveSheetFonts,
  sheetFontsKey,
} from '@forge-cb/engine/sheet-contract';

export const SHEET_FONTS_STORAGE_KEY = 'fcb-sheet-fonts';
export { DEFAULT_SHEET_FONTS, SHEET_FONT_FACES, SHEET_FONT_FACE_NAMES, SHEET_FONT_ROLES, sheetFontsKey };

export function readStoredSheetFonts(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SHEET_FONTS_STORAGE_KEY);
    return resolveSheetFonts(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SHEET_FONTS };
  }
}

export function storeSheetFonts(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_FONTS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

export function createSheetFontsSettingStore({ storage = globalThis.localStorage } = {}) {
  let current = readStoredSheetFonts(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Each role changes only to a face that suits it; anything else keeps the current choice.
  const set = (next) => {
    const wanted = typeof next === 'object' && next !== null ? next : {};
    const resolved = resolveSheetFonts({ ...current, ...wanted });
    for (const role of SHEET_FONT_ROLES) {
      if (wanted[role] !== undefined && resolved[role] !== wanted[role]) resolved[role] = current[role];
    }
    if (sheetFontsKey(resolved) === sheetFontsKey(current)) return;
    current = resolved;
    storeSheetFonts(current, storage);
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
      const value = readStoredSheetFonts(storage);
      if (sheetFontsKey(value) === sheetFontsKey(current)) return;
      current = value;
      notify();
    },
  };
}

export const sheetFontsSettingStore = createSheetFontsSettingStore();
