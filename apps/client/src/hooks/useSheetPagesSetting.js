import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  SHEET_PAGES_STORAGE_KEY,
  SHEET_PAGE_LABELS,
  SHEET_PAGE_NAMES,
  SHEET_PAGE_TIPS,
  sheetPagesKey,
  sheetPagesSettingStore,
} from '../sheetPagesSetting.js';

export default function useSheetPagesSetting() {
  const pages = useSyncExternalStore(
    sheetPagesSettingStore.subscribe,
    sheetPagesSettingStore.getSnapshot,
    sheetPagesSettingStore.getSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_PAGES_STORAGE_KEY) sheetPagesSettingStore.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setPages = useCallback((value) => sheetPagesSettingStore.set(value), []);
  const togglePage = useCallback((name) => sheetPagesSettingStore.toggle(name), []);
  return {
    pages,
    pagesKey: sheetPagesKey(pages),
    setPages,
    togglePage,
    pageNames: SHEET_PAGE_NAMES,
    pageLabels: SHEET_PAGE_LABELS,
    pageTips: SHEET_PAGE_TIPS,
  };
}
