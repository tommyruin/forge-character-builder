import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_CHARACTER_PACKAGE_TOKENS,
  CHARACTER_PACKAGE_TOKEN,
  DEFAULT_STORAGE_NAMES,
  STORAGE_DATABASE,
  resolveStorageNames,
} from '../storageNames.js';

describe('storage names', () => {
  it('defaults to the builder\'s own names when the shell sets nothing', () => {
    expect(resolveStorageNames(undefined)).toMatchObject({ ...DEFAULT_STORAGE_NAMES, acceptedPackageTokens: ['fcb-character-package'] });
    expect(STORAGE_DATABASE).toBe('fcb-local');
    expect(CHARACTER_PACKAGE_TOKEN).toBe('fcb-character-package');
    expect([...ACCEPTED_CHARACTER_PACKAGE_TOKENS]).toEqual(['fcb-character-package']);
  });

  it('takes a host\'s names and keeps its legacy package tokens readable', () => {
    const names = resolveStorageNames({
      database: 'host-local',
      keys: { autosave: 'host-autosave', activeCharacter: 'host-active', splitView: 'host-split' },
      packageToken: 'host-package',
      legacyPackageTokens: ['older-package', 42, 'host-package'],
    });
    expect(names).toMatchObject({
      database: 'host-local',
      autosaveKey: 'host-autosave',
      activeCharacterKey: 'host-active',
      splitViewKey: 'host-split',
      packageToken: 'host-package',
    });
    expect([...names.acceptedPackageTokens]).toEqual(['host-package', 'fcb-character-package', 'older-package']);
  });

  it('ignores blank or malformed values part by part', () => {
    const names = resolveStorageNames({ database: '  ', keys: 'nope', packageToken: 7 });
    expect(names).toMatchObject(DEFAULT_STORAGE_NAMES);
  });
});
