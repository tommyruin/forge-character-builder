import { describe, expect, it, vi } from 'vitest';
import { applyLibraryRevision } from '../libraryLifecycle.js';

describe('library revision workspace effects', () => {
  it('invalidates unused picker caches without refreshing for a compatible Homebrew change', () => {
    const invalidateCache = vi.fn();
    const invalidateSheet = vi.fn();
    const refresh = vi.fn();

    applyLibraryRevision({
      characterReloadRequired: false,
      invalidateCache,
      invalidateSheet,
      active: false,
      refresh,
    });

    expect(invalidateCache).toHaveBeenCalledOnce();
    expect(invalidateSheet).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
