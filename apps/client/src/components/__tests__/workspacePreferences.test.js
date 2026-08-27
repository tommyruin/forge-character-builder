import { describe, expect, it } from 'vitest';
import { splitViewPreference } from '../workspacePreferences.js';

describe('splitViewPreference', () => {
  it('keeps live PDF generation opt-in for a responsive default', () => {
    expect(splitViewPreference(null)).toBe(false);
    expect(splitViewPreference('0')).toBe(false);
  });

  it('preserves an explicit stored opt-in', () => {
    expect(splitViewPreference('1')).toBe(true);
  });
});
