import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_PAGES,
  SHEET_PAGES_STORAGE_KEY,
  createSheetPagesSettingStore,
  resolveSheetPages,
  sheetPagesKey,
} from '../sheetPagesSetting.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

describe('sheet pages setting', () => {
  it('prints every page by default and ignores unknown or malformed stored values', () => {
    expect(DEFAULT_SHEET_PAGES).toEqual({ background: true, notes: true, spellCards: true, itemCards: true });
    const malformed = createSheetPagesSettingStore({ storage: memoryStorage({ [SHEET_PAGES_STORAGE_KEY]: '{not json' }) });
    expect(malformed.getSnapshot()).toEqual(DEFAULT_SHEET_PAGES);
    const partial = createSheetPagesSettingStore({
      storage: memoryStorage({
        [SHEET_PAGES_STORAGE_KEY]: JSON.stringify({ spellCards: false, notes: 'no', unknownPage: false }),
      }),
    });
    expect(partial.getSnapshot()).toEqual({ ...DEFAULT_SHEET_PAGES, spellCards: false });
    expect(resolveSheetPages(null)).toEqual(DEFAULT_SHEET_PAGES);
  });

  it('persists toggles, notifying once per real change', () => {
    const storage = memoryStorage();
    const store = createSheetPagesSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.set({ itemCards: false });
    store.set({ itemCards: false });
    store.set({ itemCards: 'off' });
    store.set({ notAPage: false });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_PAGES, itemCards: false });
    expect(notified).toBe(1);
    store.toggle('background');
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_PAGES, itemCards: false, background: false });
    expect(JSON.parse(storage.map.get(SHEET_PAGES_STORAGE_KEY)))
      .toEqual({ background: false, notes: true, spellCards: true, itemCards: false });
    expect(notified).toBe(2);
    store.toggle('background');
    expect(store.getSnapshot().background).toBe(true);
    expect(notified).toBe(3);
  });

  it('keys the cache on the selection, distinguishing every combination', () => {
    expect(sheetPagesKey(DEFAULT_SHEET_PAGES)).toBe('background+notes+spellCards+itemCards');
    expect(sheetPagesKey({ ...DEFAULT_SHEET_PAGES, spellCards: false }))
      .toBe('background+notes+-spellCards+itemCards');
    expect(sheetPagesKey({ ...DEFAULT_SHEET_PAGES, spellCards: false }))
      .not.toBe(sheetPagesKey({ ...DEFAULT_SHEET_PAGES, itemCards: false }));
    // An unknown or missing flag resolves to the default, so the key is stable.
    expect(sheetPagesKey({ spellCards: false })).toBe(sheetPagesKey({ ...DEFAULT_SHEET_PAGES, spellCards: false }));
  });

  it('syncs a change made in another tab', () => {
    const storage = memoryStorage();
    const store = createSheetPagesSettingStore({ storage });
    storage.map.set(SHEET_PAGES_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SHEET_PAGES, notes: false }));
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.syncFromStorage();
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_PAGES, notes: false });
    expect(notified).toBe(1);
    store.syncFromStorage();
    expect(notified).toBe(1);
  });
});
