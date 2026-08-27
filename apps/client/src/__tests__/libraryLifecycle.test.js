import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareOpenCharacterForLibraryChange } from '../libraryLifecycle.js';

const originalDocument = globalThis.document;

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  globalThis.document = originalDocument;
});

describe('library change lifecycle', () => {
  it('reconciles an open character before a content update finishes', async () => {
    const calls = [];
    const characters = {
      invalidateLoadedCharacter: vi.fn(() => calls.push('invalidate')),
      get: vi.fn(async (id) => {
        calls.push(`get:${id}`);
        return { id };
      }),
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, 'hero'),
    ).resolves.toBeNull();

    expect(calls).toEqual(['invalidate', 'get:hero']);
  });

  it('keeps the editable character state for a known compatible library update', async () => {
    const characters = {
      invalidateLoadedCharacter: vi.fn(),
      get: vi.fn(),
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, 'hero', {
        characterReloadRequired: false,
      }),
    ).resolves.toBeNull();

    expect(characters.invalidateLoadedCharacter).not.toHaveBeenCalled();
    expect(characters.get).not.toHaveBeenCalled();
  });

  it('replays the open character when reload metadata is required or unknown', async () => {
    const cases = [
      { characterReloadRequired: true },
      {},
    ];

    for (const metadata of cases) {
      const characters = {
        invalidateLoadedCharacter: vi.fn(),
        get: vi.fn().mockResolvedValue({ id: 'hero' }),
      };

      await expect(
        prepareOpenCharacterForLibraryChange(characters, 'hero', metadata),
      ).resolves.toBeNull();

      expect(characters.invalidateLoadedCharacter).toHaveBeenCalledOnce();
      expect(characters.get).toHaveBeenCalledOnce();
    }
  });

  it('does not load a character when only the collection view is open', async () => {
    const characters = {
      invalidateLoadedCharacter: vi.fn(),
      get: vi.fn(),
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, null),
    ).resolves.toBeNull();

    expect(characters.invalidateLoadedCharacter).toHaveBeenCalledOnce();
    expect(characters.get).not.toHaveBeenCalled();
  });

  it('reports a reconciliation error without hiding a successful library update', async () => {
    const characters = {
      invalidateLoadedCharacter: vi.fn(),
      get: vi.fn(async () => {
        throw new Error('Character restore failed');
      }),
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, 'hero'),
    ).resolves.toEqual(new Error('Character restore failed'));
  });

});
