import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  SHEET_TEMPLATE_SETS,
  SHEET_TEMPLATE_STORAGE_KEY,
  sheetTemplateSettingStore,
} from '../sheetTemplateSetting.js';

export default function useSheetTemplateSetting() {
  const templateSet = useSyncExternalStore(
    sheetTemplateSettingStore.subscribe,
    sheetTemplateSettingStore.getSnapshot,
    sheetTemplateSettingStore.getSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_TEMPLATE_STORAGE_KEY) sheetTemplateSettingStore.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setTemplateSet = useCallback((value) => sheetTemplateSettingStore.set(value), []);
  return { templateSet, setTemplateSet, templateSets: SHEET_TEMPLATE_SETS };
}
