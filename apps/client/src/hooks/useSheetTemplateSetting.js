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
  // Whether the reader picked the set themselves; until they do, the workspace
  // follows the open character's ruleset.
  const hasExplicitChoice = useSyncExternalStore(
    sheetTemplateSettingStore.subscribe,
    sheetTemplateSettingStore.getExplicitSnapshot,
    sheetTemplateSettingStore.getExplicitSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_TEMPLATE_STORAGE_KEY) sheetTemplateSettingStore.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setTemplateSet = useCallback((value) => sheetTemplateSettingStore.set(value), []);
  const followTemplateSet = useCallback((value) => sheetTemplateSettingStore.follow(value), []);
  return { templateSet, setTemplateSet, followTemplateSet, hasExplicitChoice, templateSets: SHEET_TEMPLATE_SETS };
}
