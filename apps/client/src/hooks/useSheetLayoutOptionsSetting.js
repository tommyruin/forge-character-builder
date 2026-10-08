import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  SHEET_LAYOUT_OPTIONS_STORAGE_KEY,
  sheetLayoutOptionsSettingStore,
} from '../sheetLayoutOptionsSetting.js';

/** The browser-wide sheet layout options, kept in step across tabs. */
export default function useSheetLayoutOptionsSetting() {
  const options = useSyncExternalStore(
    sheetLayoutOptionsSettingStore.subscribe,
    sheetLayoutOptionsSettingStore.getSnapshot,
    sheetLayoutOptionsSettingStore.getSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_LAYOUT_OPTIONS_STORAGE_KEY) {
        sheetLayoutOptionsSettingStore.syncFromStorage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setOptions = useCallback(
    (value) => sheetLayoutOptionsSettingStore.set(value),
    [],
  );
  return { options, setOptions };
}
