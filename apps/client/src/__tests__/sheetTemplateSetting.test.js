import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHEET_TEMPLATE_SET,
  SHEET_TEMPLATE_STORAGE_KEY,
  createSheetTemplateSettingStore,
  hasStoredSheetTemplateSet,
} from '../sheetTemplateSetting.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

describe('sheet template setting', () => {
  it('reports whether a set was ever chosen, ignoring unknown stored values', () => {
    expect(hasStoredSheetTemplateSet(memoryStorage())).toBe(false);
    expect(hasStoredSheetTemplateSet(memoryStorage({ [SHEET_TEMPLATE_STORAGE_KEY]: '2077' }))).toBe(false);
    expect(hasStoredSheetTemplateSet(memoryStorage({ [SHEET_TEMPLATE_STORAGE_KEY]: '2024' }))).toBe(true);
  });

  it('follows a ruleset without persisting, so the next character follows its own', () => {
    const storage = memoryStorage();
    const store = createSheetTemplateSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    expect(store.getSnapshot()).toBe(DEFAULT_SHEET_TEMPLATE_SET);
    expect(store.getExplicitSnapshot()).toBe(false);
    store.follow('2024');
    expect(store.getSnapshot()).toBe('2024');
    expect(store.getExplicitSnapshot()).toBe(false);
    expect(storage.map.has(SHEET_TEMPLATE_STORAGE_KEY)).toBe(false);
    expect(notified).toBe(1);
    store.follow('2024');
    store.follow('2077');
    expect(notified).toBe(1);
    store.follow('2014');
    expect(store.getSnapshot()).toBe('2014');
    expect(notified).toBe(2);
  });

  it('persists a chosen set and stops following, even when it names the current set', () => {
    const storage = memoryStorage();
    const store = createSheetTemplateSettingStore({ storage });
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.set(DEFAULT_SHEET_TEMPLATE_SET);
    expect(store.getExplicitSnapshot()).toBe(true);
    expect(storage.map.get(SHEET_TEMPLATE_STORAGE_KEY)).toBe(DEFAULT_SHEET_TEMPLATE_SET);
    expect(notified).toBe(1);
    store.follow('2024');
    expect(store.getSnapshot()).toBe(DEFAULT_SHEET_TEMPLATE_SET);
    expect(notified).toBe(1);
    store.set('2024');
    expect(store.getSnapshot()).toBe('2024');
    expect(storage.map.get(SHEET_TEMPLATE_STORAGE_KEY)).toBe('2024');
    expect(notified).toBe(2);
  });

  it('starts explicit when a set is already stored, and re-reads both on a storage sync', () => {
    const storage = memoryStorage({ [SHEET_TEMPLATE_STORAGE_KEY]: '2024' });
    const store = createSheetTemplateSettingStore({ storage });
    expect(store.getSnapshot()).toBe('2024');
    expect(store.getExplicitSnapshot()).toBe(true);
    storage.map.delete(SHEET_TEMPLATE_STORAGE_KEY);
    store.syncFromStorage();
    expect(store.getSnapshot()).toBe(DEFAULT_SHEET_TEMPLATE_SET);
    expect(store.getExplicitSnapshot()).toBe(false);
  });
});
