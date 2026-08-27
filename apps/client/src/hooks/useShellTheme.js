import { useCallback, useEffect, useState } from 'react';
import { shell } from '@shell';

const { theme: themeApi } = shell;

export default function useShellTheme() {
  const [theme, setTheme] = useState(() => themeApi.readStoredTheme() || themeApi.DEFAULT_THEME);

  useEffect(() => {
    themeApi.applyTheme(theme);
    themeApi.storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === 'theme') setTheme(themeApi.readStoredTheme());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => themeApi.getNextTheme(current));
  }, []);

  return { theme, toggleTheme };
}
