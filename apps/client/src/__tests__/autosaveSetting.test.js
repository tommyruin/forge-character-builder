import { describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_STORAGE_KEY,
  createAutosaveSettingStore,
  readStoredAutosave,
  storeAutosave,
} from '../autosaveSetting.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

describe('autosave setting', () => {
  it('defaults to autosave on when nothing is stored', () => {
    expect(readStoredAutosave(fakeStorage())).toBe(true);
    expect(readStoredAutosave(undefined)).toBe(true);
  });

  it('round-trips the preference under the fcb-autosave key', () => {
    const storage = fakeStorage();
    storeAutosave(false, storage);
    expect(storage.values.get(AUTOSAVE_STORAGE_KEY)).toBe('0');
    expect(readStoredAutosave(storage)).toBe(false);
    storeAutosave(true, storage);
    expect(readStoredAutosave(storage)).toBe(true);
  });

  it('falls back to on when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredAutosave(broken)).toBe(true);
    expect(() => storeAutosave(false, broken)).not.toThrow();
  });

  it('forwards the setting to the character api and notifies subscribers', () => {
    const characters = { setAutosaveEnabled: vi.fn(async () => undefined) };
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: '0' });
    const store = createAutosaveSettingStore({ storage, characters });
    // The stored preference reaches the transport before any mutation.
    expect(characters.setAutosaveEnabled).toHaveBeenLastCalledWith(false);
    expect(store.getSnapshot()).toBe(false);

    const listener = vi.fn();
    store.subscribe(listener);
    store.toggle();
    expect(store.getSnapshot()).toBe(true);
    expect(storage.values.get(AUTOSAVE_STORAGE_KEY)).toBe('1');
    expect(characters.setAutosaveEnabled).toHaveBeenLastCalledWith(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Setting the same value again is a no-op.
    store.set(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Another tab wrote the key.
    storage.setItem(AUTOSAVE_STORAGE_KEY, '0');
    store.syncFromStorage();
    expect(store.getSnapshot()).toBe(false);
    expect(characters.setAutosaveEnabled).toHaveBeenLastCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
