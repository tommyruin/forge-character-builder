import { describe, expect, it } from 'vitest';
import { shell } from '@shell';

const {
  applyTheme,
  DEFAULT_THEME,
  getNextTheme,
  normalizeTheme,
  readStoredTheme,
  storeTheme,
} = shell.theme;

function createClassList() {
  const values = new Set();
  return {
    has: (value) => values.has(value),
    toggle: (value, enabled) => {
      if (enabled) values.add(value);
      else values.delete(value);
    },
  };
}

describe('shell theme', () => {
  it('cycles through the three themes', () => {
    expect(getNextTheme('dark')).toBe('light');
    expect(getNextTheme('light')).toBe('retro');
    expect(getNextTheme('retro')).toBe('dark');
    expect(normalizeTheme('unknown')).toBeNull();
  });

  it('persists a valid theme and safely falls back for invalid storage', () => {
    const values = new Map([['theme', 'invalid']]);
    const storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };

    expect(readStoredTheme(storage)).toBe(DEFAULT_THEME);
    expect(storeTheme('light', storage)).toBe('light');
    expect(readStoredTheme(storage)).toBe('light');
  });

  it('applies the data attribute and the compatibility classes together', () => {
    const classList = createClassList();
    const documentLike = { documentElement: { classList, dataset: {} } };

    applyTheme('retro', documentLike);
    expect(documentLike.documentElement.dataset.theme).toBe('retro');
    expect(classList.has('retro-mode')).toBe(true);
    expect(classList.has('light-mode')).toBe(false);
  });
});
