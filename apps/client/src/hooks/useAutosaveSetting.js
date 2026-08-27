import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  AUTOSAVE_STORAGE_KEY,
  autosaveSettingStore,
} from '../autosaveSetting.js';

export default function useAutosaveSetting(store = autosaveSettingStore) {
  const autosaveEnabled = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === AUTOSAVE_STORAGE_KEY) store.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [store]);

  const setAutosaveEnabled = useCallback((value) => store.set(value), [store]);
  const toggleAutosave = useCallback(() => store.toggle(), [store]);

  return { autosaveEnabled, setAutosaveEnabled, toggleAutosave };
}
