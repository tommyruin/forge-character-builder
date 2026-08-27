import { describe, expect, it } from 'vitest';
import { contentStoragePath } from '../contentStorage.js';

describe('contentStoragePath', () => {
  it('uses an internal source namespace instead of a user category', () => {
    expect(contentStoragePath('legacy-elements', 'core/races.xml')).toBe(
      'imports/legacy-elements/core/races.xml'
    );
  });

  it('keeps identical relative paths separate for different import batches', () => {
    expect(contentStoragePath('first', 'rules.xml')).not.toBe(
      contentStoragePath('second', 'rules.xml')
    );
  });
});
