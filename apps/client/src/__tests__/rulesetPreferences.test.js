import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RULESET_PREFERENCE_KEY,
  normalizeRulesetMode,
  readDefaultRulesetMode,
  writeDefaultRulesetMode,
} from '../rulesetPreferences.js';

describe('ruleset preferences', () => {
  it('accepts the three engine modes, from a bare string or a record', () => {
    expect(normalizeRulesetMode('2024')).toBe('2024');
    expect(normalizeRulesetMode({ version: 1, mode: ' 2014 ' })).toBe('2014');
    expect(normalizeRulesetMode({ version: 1, mode: 'all' })).toBe('all');
  });

  it('treats a missing or unrecognised mode as no saved default', () => {
    expect(normalizeRulesetMode(undefined)).toBeNull();
    expect(normalizeRulesetMode({ nope: true })).toBeNull();
    expect(normalizeRulesetMode({ version: 1, mode: '2025' })).toBeNull();
    expect(normalizeRulesetMode([])).toBeNull();
  });

  it('reads the stored default from the character meta store', async () => {
    const store = {
      getMeta: vi.fn().mockResolvedValue({ version: 1, mode: '2024' }),
    };
    await expect(readDefaultRulesetMode(store)).resolves.toBe('2024');
    expect(store.getMeta).toHaveBeenCalledWith(DEFAULT_RULESET_PREFERENCE_KEY);
  });

  it('reports no default when the browser cannot read one', async () => {
    await expect(readDefaultRulesetMode({})).resolves.toBeNull();
    await expect(
      readDefaultRulesetMode({ getMeta: vi.fn().mockResolvedValue({ nope: true }) }),
    ).resolves.toBeNull();
  });

  it('saves a versioned record for a valid mode', async () => {
    const store = { putMeta: vi.fn().mockResolvedValue(undefined) };
    await expect(writeDefaultRulesetMode('2024', store)).resolves.toBe('2024');
    expect(store.putMeta).toHaveBeenCalledWith(DEFAULT_RULESET_PREFERENCE_KEY, {
      version: 1,
      mode: '2024',
    });
  });

  it('refuses an unknown mode and a store that cannot write', async () => {
    const store = { putMeta: vi.fn().mockResolvedValue(undefined) };
    await expect(writeDefaultRulesetMode('2025', store)).rejects.toThrow(
      'Choose a rules version before saving it as the default.',
    );
    expect(store.putMeta).not.toHaveBeenCalled();
    await expect(writeDefaultRulesetMode('2014', {})).rejects.toThrow(
      'This browser cannot save rules version defaults.',
    );
  });
});
