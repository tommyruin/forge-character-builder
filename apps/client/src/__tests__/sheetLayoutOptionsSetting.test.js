import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_LAYOUT_OPTIONS,
  SHEET_LAYOUT_OPTIONS_STORAGE_KEY,
  createSheetLayoutOptionsSettingStore,
  effectiveSheetLayout,
  newItemCardOptions,
  readStoredSheetLayoutOptions,
  resolveSheetLayoutOptions,
} from '../sheetLayoutOptionsSetting.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('sheet layout options setting', () => {
  it('persists under its own key with every option off by default', () => {
    expect(SHEET_LAYOUT_OPTIONS_STORAGE_KEY).toBe('fcb-sheet-layout-options');
    expect(DEFAULT_SHEET_LAYOUT_OPTIONS).toEqual({
      top: false,
      split: null,
      readable: false,
      inventoryNotes: false,
      smartCards: false,
    });
  });

  it('reads any stored shape without throwing, keeping only valid known options', () => {
    for (const raw of [null, '', '{not json', 'null', '42', '"text"', '[]']) {
      const storage = memoryStorage(raw === null ? {} : { [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: raw });
      expect(readStoredSheetLayoutOptions(storage), String(raw)).toEqual(DEFAULT_SHEET_LAYOUT_OPTIONS);
    }
    expect(readStoredSheetLayoutOptions(throwingStorage)).toEqual(DEFAULT_SHEET_LAYOUT_OPTIONS);
    expect(readStoredSheetLayoutOptions(undefined)).toEqual(DEFAULT_SHEET_LAYOUT_OPTIONS);

    const partial = memoryStorage({
      [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({
        smartCards: true,
        readable: 'yes',
        top: 1,
        futureOption: true,
      }),
    });
    expect(readStoredSheetLayoutOptions(partial)).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, smartCards: true });
  });

  it('keeps split as an explicit on or off, else the layout default', () => {
    expect(resolveSheetLayoutOptions({ split: true }).split).toBe(true);
    expect(resolveSheetLayoutOptions({ split: false }).split).toBe(false);
    for (const split of [undefined, null, Number.NaN, Infinity, '', {}, 0.6, 'wide', 'true']) {
      expect(resolveSheetLayoutOptions({ split }).split).toBeNull();
    }
  });

  it('stores a split override and returns to the layout default', () => {
    const storage = memoryStorage();
    const store = createSheetLayoutOptionsSettingStore({ storage });
    store.set({ split: false });
    expect(store.getSnapshot().split).toBe(false);
    expect(JSON.parse(storage.map.get(SHEET_LAYOUT_OPTIONS_STORAGE_KEY)).split).toBe(false);
    store.set({ split: null });
    expect(store.getSnapshot().split).toBeNull();
  });

  it('splits the feature boxes by default only on the layout that always has', () => {
    expect(effectiveSheetLayout('2014', DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ top: false, split: false, readable: false });
    expect(effectiveSheetLayout('2024', DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ top: false, split: false, readable: false });
    expect(effectiveSheetLayout('2024-hybrid', DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ top: false, split: true, readable: false });
    expect(effectiveSheetLayout('2014', { ...DEFAULT_SHEET_LAYOUT_OPTIONS, split: true }).split).toBe(true);
    expect(effectiveSheetLayout('2024-hybrid', { ...DEFAULT_SHEET_LAYOUT_OPTIONS, split: false }).split).toBe(false);
    expect(effectiveSheetLayout('2014', undefined)).toEqual({ top: false, split: false, readable: false });
  });

  it('stores and reads the compact top row switch', () => {
    const storage = memoryStorage();
    const store = createSheetLayoutOptionsSettingStore({ storage });
    store.set({ top: true });
    expect(store.getSnapshot().top).toBe(true);
    expect(JSON.parse(storage.map.get(SHEET_LAYOUT_OPTIONS_STORAGE_KEY)).top).toBe(true);
    expect(readStoredSheetLayoutOptions(storage)).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, top: true });
    for (const set of ['2014', '2024', '2024-hybrid']) {
      expect(effectiveSheetLayout(set, store.getSnapshot()).top, set).toBe(true);
      expect(effectiveSheetLayout(set, DEFAULT_SHEET_LAYOUT_OPTIONS).top, set).toBe(false);
    }
    expect(effectiveSheetLayout('2024-hybrid', store.getSnapshot())).toEqual({ top: true, split: true, readable: false });
    store.set({ top: false });
    expect(readStoredSheetLayoutOptions(storage).top).toBe(false);
  });

  it('stores valid changes, notifying once per real change', () => {
    const storage = memoryStorage();
    const store = createSheetLayoutOptionsSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.set({ smartCards: true });
    store.set({ smartCards: true });
    store.set({ smartCards: 'on', unknown: true });
    expect(store.getSnapshot()).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, smartCards: true });
    expect(notified).toBe(1);
    expect(JSON.parse(storage.map.get(SHEET_LAYOUT_OPTIONS_STORAGE_KEY))).toEqual({
      ...DEFAULT_SHEET_LAYOUT_OPTIONS,
      smartCards: true,
    });

    store.set({ smartCards: false });
    expect(store.getSnapshot().smartCards).toBe(false);
    expect(notified).toBe(2);
  });

  it('keeps working for the session when storage is unavailable', () => {
    const store = createSheetLayoutOptionsSettingStore({ storage: throwingStorage });
    expect(() => store.set({ smartCards: true })).not.toThrow();
    expect(store.getSnapshot().smartCards).toBe(true);
  });

  it('picks up a change made in another tab', () => {
    const storage = memoryStorage();
    const store = createSheetLayoutOptionsSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    storage.setItem(SHEET_LAYOUT_OPTIONS_STORAGE_KEY, JSON.stringify({ smartCards: true }));
    store.syncFromStorage();
    store.syncFromStorage();
    expect(store.getSnapshot().smartCards).toBe(true);
    expect(notified).toBe(1);
  });

  it('asks for significant-only cards on new items only when smart cards is on', () => {
    expect(newItemCardOptions(DEFAULT_SHEET_LAYOUT_OPTIONS)).toBeNull();
    expect(newItemCardOptions({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, smartCards: true })).toEqual({
      cardPolicy: 'significant',
    });
    expect(newItemCardOptions(undefined)).toBeNull();
  });
});
