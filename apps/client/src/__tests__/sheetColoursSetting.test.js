import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_COLOURS,
  SHEET_COLOURS_STORAGE_KEY,
  createSheetColoursSettingStore,
  sheetThemeOf,
} from '../sheetColoursSetting.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

describe('sheet colours setting', () => {
  it('defaults every part and ignores unknown or malformed stored values', () => {
    const malformed = createSheetColoursSettingStore({ storage: memoryStorage({ [SHEET_COLOURS_STORAGE_KEY]: '{not json' }) });
    expect(malformed.getSnapshot()).toEqual(DEFAULT_SHEET_COLOURS);
    const partial = createSheetColoursSettingStore({
      storage: memoryStorage({ [SHEET_COLOURS_STORAGE_KEY]: JSON.stringify({ accent: 'ocean', lines: 'neon' }) }),
    });
    expect(partial.getSnapshot()).toEqual({ ...DEFAULT_SHEET_COLOURS, accent: 'ocean' });
  });

  it('persists part changes and themes, notifying once per real change', () => {
    const storage = memoryStorage();
    const store = createSheetColoursSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.set({ accent: 'forest' });
    store.set({ accent: 'forest' });
    store.set({ accent: 'not-a-colour' });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_COLOURS, accent: 'forest' });
    expect(notified).toBe(1);
    store.setTheme('ocean');
    expect(store.getSnapshot()).toEqual({ accent: 'ocean', lines: 'silver', text: 'navy' });
    expect(sheetThemeOf(store.getSnapshot())).toBe('ocean');
    expect(JSON.parse(storage.map.get(SHEET_COLOURS_STORAGE_KEY))).toEqual({ accent: 'ocean', lines: 'silver', text: 'navy' });
    expect(notified).toBe(2);
  });
});
