import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_LAYOUT_OPTIONS,
  SHEET_LAYOUT_OPTIONS_STORAGE_KEY,
  createSheetLayoutOptionsSettingStore,
  effectiveSheetLayout,
  newItemCardOptions,
  readStoredSheetLayoutOptions,
  resolveSheetLayoutOptions,
  resourceTrackerSheetOptions,
  resourceTrackersCacheKey,
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
  it('persists under its own key with every option off or at the layout default', () => {
    expect(SHEET_LAYOUT_OPTIONS_STORAGE_KEY).toBe('fcb-sheet-layout-options');
    expect(DEFAULT_SHEET_LAYOUT_OPTIONS).toEqual({
      top: null,
      split: null,
      readable: false,
      inventoryNotes: false,
      smartCards: false,
      resourceTrackers: true,
      resourceTrackersList: false,
    });
  });

  it('prints resource trackers next to features unless off, and no longer reads or sends a fresh-sheet choice', () => {
    expect(resourceTrackersCacheKey(DEFAULT_SHEET_LAYOUT_OPTIONS)).toBe('');
    expect(resourceTrackerSheetOptions(DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ resourceTrackers: true, resourceTrackersList: false });
    // Printed sheets always start fresh, so the retired switch changes neither the request nor the cache key.
    expect(resourceTrackersCacheKey({ resourceTrackersEmpty: true })).toBe('');
    expect(resourceTrackerSheetOptions({ resourceTrackersEmpty: true })).toEqual({ resourceTrackers: true, resourceTrackersList: false });
    expect(resourceTrackersCacheKey({ resourceTrackers: false })).toBe('#no-trackers');
    expect(resourceTrackerSheetOptions({ resourceTrackers: false })).toEqual({ resourceTrackers: false, resourceTrackersList: false });
    expect(resolveSheetLayoutOptions({ resourceTrackersEmpty: true })).not.toHaveProperty('resourceTrackersEmpty');

    // A stored choice from before still reads: the old key is dropped, the rest kept.
    const storage = memoryStorage({
      [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version: 3, resourceTrackers: true, resourceTrackersEmpty: true, resourceTrackersList: true, readable: true }),
    });
    const options = readStoredSheetLayoutOptions(storage);
    expect(options).not.toHaveProperty('resourceTrackersEmpty');
    expect(options).toMatchObject({ resourceTrackers: true, resourceTrackersList: true, readable: true });
    expect(resourceTrackerSheetOptions(options)).not.toHaveProperty('resourceTrackersEmpty');
  });

  it('prints a Resources box only when asked, with or without the uses next to features', () => {
    expect(DEFAULT_SHEET_LAYOUT_OPTIONS.resourceTrackersList).toBe(false);
    expect(resourceTrackersCacheKey({ resourceTrackersList: true })).toBe('#resource-list');
    expect(resourceTrackerSheetOptions({ resourceTrackersList: true })).toEqual({ resourceTrackers: true, resourceTrackersList: true });
    expect(resolveSheetLayoutOptions({ resourceTrackersList: 'yes' }).resourceTrackersList).toBe(false);

    const storage = memoryStorage();
    createSheetLayoutOptionsSettingStore({ storage }).set({ resourceTrackersList: true });
    expect(readStoredSheetLayoutOptions(storage).resourceTrackersList).toBe(true);
  });

  it('maps the two switches to the render request the engine expects', () => {
    const request = (resourceTrackers, resourceTrackersList) =>
      resourceTrackerSheetOptions({ resourceTrackers, resourceTrackersList });
    expect(request(true, false)).toEqual({ resourceTrackers: true, resourceTrackersList: false });
    expect(request(true, true)).toEqual({ resourceTrackers: true, resourceTrackersList: true });
    expect(request(false, true)).toEqual({ resourceTrackers: true, resourceTrackersList: true, resourceTrackersInline: false });
    expect(request(false, false)).toEqual({ resourceTrackers: false, resourceTrackersList: false });
    // Inline stays at the engine default unless the uses beside features are off with a box.
    expect(request(true, false)).not.toHaveProperty('resourceTrackersInline');
    expect(request(true, true)).not.toHaveProperty('resourceTrackersInline');
    expect(request(false, false)).not.toHaveProperty('resourceTrackersInline');
  });

  it('gives every printed combination its own cache key', () => {
    const key = (resourceTrackers, resourceTrackersList) => resourceTrackersCacheKey({ resourceTrackers, resourceTrackersList });
    const keys = [key(true, false), key(true, true), key(false, true), key(false, false)];
    expect(new Set(keys).size).toBe(keys.length);
    expect(key(true, false)).toBe('');
  });

  it('keeps an older "no trackers" choice from printing a Resources box', () => {
    for (const version of [undefined, 1, 2]) {
      const storage = memoryStorage({
        [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version, resourceTrackers: false, resourceTrackersList: true }),
      });
      const options = readStoredSheetLayoutOptions(storage);
      expect(options.resourceTrackersList, String(version)).toBe(false);
      expect(resourceTrackerSheetOptions(options).resourceTrackers, String(version)).toBe(false);
      expect(resourceTrackersCacheKey(options), String(version)).toBe('#no-trackers');
    }
    // An older box with the trackers on was printing, so it stays.
    const printing = memoryStorage({
      [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version: 2, resourceTrackers: true, resourceTrackersList: true }),
    });
    expect(readStoredSheetLayoutOptions(printing).resourceTrackersList).toBe(true);
    // From version 3 the same pair is a deliberate box without the uses beside features.
    const boxOnly = memoryStorage({
      [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version: 3, resourceTrackers: false, resourceTrackersList: true }),
    });
    expect(readStoredSheetLayoutOptions(boxOnly).resourceTrackersList).toBe(true);
    expect(resourceTrackerSheetOptions(readStoredSheetLayoutOptions(boxOnly)).resourceTrackersInline).toBe(false);
  });

  it('keeps a box-only choice across a save and a reload', () => {
    const storage = memoryStorage();
    createSheetLayoutOptionsSettingStore({ storage }).set({ resourceTrackers: false, resourceTrackersList: true });
    expect(JSON.parse(storage.map.get(SHEET_LAYOUT_OPTIONS_STORAGE_KEY)).version).toBe(3);
    const reloaded = createSheetLayoutOptionsSettingStore({ storage }).getSnapshot();
    expect(reloaded.resourceTrackers).toBe(false);
    expect(reloaded.resourceTrackersList).toBe(true);
  });

  it('reads a stored choice of the retired uses-next-to-features switch without breaking', () => {
    for (const inline of [true, false]) {
      const storage = memoryStorage({
        [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version: 2, readable: true, resourceTrackersInline: inline }),
      });
      const options = readStoredSheetLayoutOptions(storage);
      // The stored field is dropped: only the two switches decide it now. The other choices keep.
      expect(options).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, readable: true });
      expect(resourceTrackersCacheKey(options)).toBe('');
      expect(resourceTrackerSheetOptions(options)).not.toHaveProperty('resourceTrackersInline');
    }
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

  it('keeps top and split as an explicit on or off, else the layout default', () => {
    for (const name of ['top', 'split']) {
      expect(resolveSheetLayoutOptions({ [name]: true })[name], name).toBe(true);
      expect(resolveSheetLayoutOptions({ [name]: false })[name], name).toBe(false);
      for (const value of [undefined, null, Number.NaN, Infinity, '', {}, 0.6, 'wide', 'true']) {
        expect(resolveSheetLayoutOptions({ [name]: value })[name], `${name} ${String(value)}`).toBeNull();
      }
    }
  });

  // Before top followed the layout's default, every saved choice carried
  // top: false, so an unversioned false means "the default".
  it('reads an older saved top: false as the layout default', () => {
    const older = memoryStorage({ [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ top: false, smartCards: true }) });
    expect(readStoredSheetLayoutOptions(older)).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, smartCards: true });
    const olderOn = memoryStorage({ [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ top: true }) });
    expect(readStoredSheetLayoutOptions(olderOn).top).toBe(true);
    const storage = memoryStorage();
    createSheetLayoutOptionsSettingStore({ storage }).set({ top: false });
    expect(readStoredSheetLayoutOptions(storage).top).toBe(false);
  });

  it('applies the top migration only to values older than version 2', () => {
    const read = (version) => readStoredSheetLayoutOptions(memoryStorage({
      [SHEET_LAYOUT_OPTIONS_STORAGE_KEY]: JSON.stringify({ version, top: false }),
    })).top;
    expect(read(undefined)).toBeNull();
    expect(read(1)).toBeNull();
    // A version 2 or later false is a deliberate choice.
    expect(read(2)).toBe(false);
    expect(read(3)).toBe(false);
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
    expect(effectiveSheetLayout('2024', DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ top: true, split: false, readable: false });
    expect(effectiveSheetLayout('2024-hybrid', DEFAULT_SHEET_LAYOUT_OPTIONS)).toEqual({ top: true, split: true, readable: false });
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
    }
    // The compact top row is the 2024 layouts' own.
    expect(effectiveSheetLayout('2014', DEFAULT_SHEET_LAYOUT_OPTIONS).top).toBe(false);
    expect(effectiveSheetLayout('2024', DEFAULT_SHEET_LAYOUT_OPTIONS).top).toBe(true);
    expect(effectiveSheetLayout('2024-hybrid', store.getSnapshot())).toEqual({ top: true, split: true, readable: false });
    store.set({ top: false });
    expect(readStoredSheetLayoutOptions(storage).top).toBe(false);
    expect(effectiveSheetLayout('2024', store.getSnapshot()).top).toBe(false);
  });

  it('stores and reads the readable body switch', () => {
    const storage = memoryStorage();
    const store = createSheetLayoutOptionsSettingStore({ storage });
    store.set({ readable: true });
    expect(store.getSnapshot().readable).toBe(true);
    expect(JSON.parse(storage.map.get(SHEET_LAYOUT_OPTIONS_STORAGE_KEY)).readable).toBe(true);
    expect(readStoredSheetLayoutOptions(storage)).toEqual({ ...DEFAULT_SHEET_LAYOUT_OPTIONS, readable: true });
    for (const set of ['2014', '2024', '2024-hybrid']) {
      expect(effectiveSheetLayout(set, store.getSnapshot()).readable, set).toBe(true);
      expect(effectiveSheetLayout(set, DEFAULT_SHEET_LAYOUT_OPTIONS).readable, set).toBe(false);
    }
    expect(effectiveSheetLayout('2024-hybrid', store.getSnapshot())).toEqual({ top: true, split: true, readable: true });
    store.set({ readable: false });
    expect(readStoredSheetLayoutOptions(storage).readable).toBe(false);
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
      version: 3,
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
