import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOURCE_PREFERENCE_KEY,
  normalizeRestrictedSourceIds,
  readDefaultRestrictedSourceIds,
  writeDefaultRestrictedSourceIds,
} from '../sourcePreferences.js';

describe('source preferences', () => {
  it('normalizes and de-duplicates source IDs', () => {
    expect(
      normalizeRestrictedSourceIds({
        version: 1,
        restrictedSourceIds: [' one ', '', 'one', null, 'two'],
      }),
    ).toEqual(['one', 'two']);
  });

  it('treats missing or malformed defaults as all sources enabled', async () => {
    const store = { getMeta: vi.fn().mockResolvedValue({ nope: true }) };
    await expect(readDefaultRestrictedSourceIds(store)).resolves.toEqual([]);
    expect(store.getMeta).toHaveBeenCalledWith(DEFAULT_SOURCE_PREFERENCE_KEY);
  });

  it('preserves dormant IDs when saving defaults', async () => {
    const store = { putMeta: vi.fn().mockResolvedValue(undefined) };
    await expect(
      writeDefaultRestrictedSourceIds(['missing-source', ' missing-source '], store),
    ).resolves.toEqual(['missing-source']);
    expect(store.putMeta).toHaveBeenCalledWith(
      DEFAULT_SOURCE_PREFERENCE_KEY,
      { version: 1, restrictedSourceIds: ['missing-source'] },
    );
  });
});
