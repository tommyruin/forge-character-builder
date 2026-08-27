import { api } from './api.js';

// A persisted localStorage key: renaming it silently resets the preference for
// everyone who already set it. Missing means autosave is on.
export const AUTOSAVE_STORAGE_KEY = 'tcb-autosave';

export function readStoredAutosave(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(AUTOSAVE_STORAGE_KEY) !== '0';
  } catch {
    // Browsers may block storage in private or locked-down contexts.
    return true;
  }
}

export function storeAutosave(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem(AUTOSAVE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Best effort only; the running session still honours the choice.
  }
}

// One store for the header toggle and the workspace Save button, so both see
// the same value, and the transport learns of every change (including one
// made in another tab) before the next mutation runs.
export function createAutosaveSettingStore({
  storage = globalThis.localStorage,
  characters,
} = {}) {
  let enabled = readStoredAutosave(storage);
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const push = () => {
    void characters?.setAutosaveEnabled?.(enabled);
  };
  push();

  const set = (next) => {
    const value = Boolean(next);
    if (value === enabled) return;
    enabled = value;
    storeAutosave(enabled, storage);
    push();
    notify();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => enabled,
    set,
    toggle: () => set(!enabled),
    // Another tab wrote the key; the storage event never fires in the writer.
    syncFromStorage() {
      const value = readStoredAutosave(storage);
      if (value === enabled) return;
      enabled = value;
      push();
      notify();
    },
  };
}

export const autosaveSettingStore = createAutosaveSettingStore({
  characters: api.characters,
});
