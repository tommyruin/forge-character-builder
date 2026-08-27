import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareOpenCharacterForLibraryChange } from '../libraryLifecycle.js';

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

describe('Homebrew fast-path lifecycle contract', () => {
  it('keeps an open character loaded when changed Homebrew ids are unused', async () => {
    const characters = {
      invalidateLoadedCharacter: vi.fn(),
      get: vi.fn(),
    };
    const mutation = {
      updateMode: 'incremental',
      changedElementIds: ['ID_HB_TEST_LANGUAGE_NEW_LANGUAGE'],
      characterReloadRequired: false,
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, 'hero', mutation),
    ).resolves.toBeNull();

    expect(characters.invalidateLoadedCharacter).not.toHaveBeenCalled();
    expect(characters.get).not.toHaveBeenCalled();
  });

  it('replays an open character when the engine reports an affected id', async () => {
    const calls = [];
    const characters = {
      invalidateLoadedCharacter: vi.fn(() => calls.push('invalidate')),
      get: vi.fn(async (id) => {
        calls.push(`get:${id}`);
        return { id };
      }),
    };
    const mutation = {
      updateMode: 'incremental',
      changedElementIds: ['ID_HB_TEST_FEAT_USED_FEAT'],
      characterReloadRequired: true,
    };

    await expect(
      prepareOpenCharacterForLibraryChange(characters, 'hero', mutation),
    ).resolves.toBeNull();

    expect(calls).toEqual(['invalidate', 'get:hero']);
  });

  it('fails safe for legacy and full-rebuild mutation results', async () => {
    const characters = {
      invalidateLoadedCharacter: vi.fn(),
      get: vi.fn(async (id) => ({ id })),
    };

    await prepareOpenCharacterForLibraryChange(characters, 'hero', {
      updateMode: 'full-rebuild',
      fallbackReason: 'advanced-xml',
    });

    expect(characters.invalidateLoadedCharacter).toHaveBeenCalledOnce();
    expect(characters.get).toHaveBeenCalledWith('hero');
  });
});
