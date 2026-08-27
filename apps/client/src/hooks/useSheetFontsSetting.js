import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  SHEET_FONTS_STORAGE_KEY,
  SHEET_FONT_FACES,
  SHEET_FONT_FACE_NAMES,
  SHEET_FONT_ROLES,
  sheetFontsKey,
  sheetFontsSettingStore,
} from '../sheetFontsSetting.js';

export default function useSheetFontsSetting() {
  const fonts = useSyncExternalStore(
    sheetFontsSettingStore.subscribe,
    sheetFontsSettingStore.getSnapshot,
    sheetFontsSettingStore.getSnapshot,
  );
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === SHEET_FONTS_STORAGE_KEY) sheetFontsSettingStore.syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const setFonts = useCallback((value) => sheetFontsSettingStore.set(value), []);
  return {
    fonts,
    fontsKey: sheetFontsKey(fonts),
    setFonts,
    faces: SHEET_FONT_FACES,
    faceNames: SHEET_FONT_FACE_NAMES,
    roles: SHEET_FONT_ROLES,
  };
}
