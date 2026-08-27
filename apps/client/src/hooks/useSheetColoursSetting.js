import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  SHEET_COLOURS_STORAGE_KEY,
  SHEET_PALETTE,
  SHEET_THEMES,
  SHEET_THEME_NAMES,
  sheetColoursKey,
  sheetColoursSettingStore,
  sheetThemeOf,
} from '../sheetColoursSetting.js';

export default function useSheetColoursSetting() {
  const colours = useSyncExternalStore(
    sheetColoursSettingStore.subscribe,
    sheetColoursSettingStore.getSnapshot,
    sheetColoursSettingStore.getSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_COLOURS_STORAGE_KEY) sheetColoursSettingStore.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setColours = useCallback((value) => sheetColoursSettingStore.set(value), []);
  const setTheme = useCallback((name) => sheetColoursSettingStore.setTheme(name), []);
  return {
    colours,
    coloursKey: sheetColoursKey(colours),
    theme: sheetThemeOf(colours),
    setColours,
    setTheme,
    palette: SHEET_PALETTE,
    themes: SHEET_THEMES,
    themeNames: SHEET_THEME_NAMES,
  };
}
