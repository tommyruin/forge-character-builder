import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_FONTS,
  SHEET_FONTS_STORAGE_KEY,
  createSheetFontsSettingStore,
} from '../sheetFontsSetting.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

describe('sheet fonts setting', () => {
  it('defaults every role and ignores unknown or unsuited stored faces', () => {
    const store = createSheetFontsSettingStore({
      storage: memoryStorage({ [SHEET_FONTS_STORAGE_KEY]: JSON.stringify({ titles: 'pirataOne', body: 'pirataOne', numbers: 'nope' }) }),
    });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_FONTS, titles: 'pirataOne' });
  });

  it('persists role changes and keeps the current face for an unsuited one', () => {
    const storage = memoryStorage();
    const store = createSheetFontsSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.set({ body: 'spectral' });
    store.set({ body: 'spectral' });
    store.set({ body: 'pirataOne' });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_FONTS, body: 'spectral' });
    expect(notified).toBe(1);
    expect(JSON.parse(storage.map.get(SHEET_FONTS_STORAGE_KEY))).toEqual({ ...DEFAULT_SHEET_FONTS, body: 'spectral' });
  });
});
