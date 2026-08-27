import { describe, expect, it } from 'vitest';
import { shouldSplitContentIngest } from '../bootPolicy.js';

describe('shouldSplitContentIngest', () => {
  it('uses one complete ingest by default so ready means responsive', () => {
    expect(shouldSplitContentIngest(undefined)).toBe(false);
    expect(shouldSplitContentIngest('0')).toBe(false);
  });

  it('keeps split ingest available as an explicit diagnostic opt-in', () => {
    expect(shouldSplitContentIngest('1')).toBe(true);
  });
});
