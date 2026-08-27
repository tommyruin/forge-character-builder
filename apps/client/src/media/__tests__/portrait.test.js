import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PORTRAIT_INPUT_BYTES,
  PORTRAIT_MAX_DIMENSION,
  normalizePortraitUpload,
} from '../portrait.js';

describe('portrait normalization', () => {
  it('accepts supported images and returns a bounded PNG', async () => {
    const file = new File([new Uint8Array(128)], 'hero.webp', {
      type: 'image/webp',
    });
    const renderer = vi.fn(async (_file, options) => ({
      blob: new Blob([new Uint8Array(64)], { type: 'image/png' }),
      width: 768,
      height: 1024,
      ...options,
    }));

    const result = await normalizePortraitUpload(file, { renderer });

    expect(renderer).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ maxDimension: PORTRAIT_MAX_DIMENSION })
    );
    expect(result.blob.type).toBe('image/png');
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      PORTRAIT_MAX_DIMENSION
    );
  });

  it('rejects unsupported, oversized, and corrupt images', async () => {
    await expect(
      normalizePortraitUpload(
        new File(['text'], 'notes.txt', { type: 'text/plain' })
      )
    ).rejects.toThrow(/supported image/i);
    await expect(
      normalizePortraitUpload(
        new File([new Uint8Array(MAX_PORTRAIT_INPUT_BYTES + 1)], 'huge.png', {
          type: 'image/png',
        })
      )
    ).rejects.toThrow(/10 MiB/i);
    await expect(
      normalizePortraitUpload(
        new File(['broken'], 'broken.png', { type: 'image/png' }),
        {
          renderer: async () => {
            throw new Error('decode failed');
          },
        }
      )
    ).rejects.toThrow(/could not be read/i);
  });
});
