import { describe, expect, it } from 'vitest';
import {
  describeContentRecord,
  describeContentPath,
  filterUploadedFiles,
  retainVisibleSelection,
} from '../contentBrowserState.js';

describe('retainVisibleSelection', () => {
  it('keeps a selection that remains on the new page', () => {
    expect(
      retainVisibleSelection('race-a', [{ id: 'race-a' }, { id: 'race-b' }])
    ).toBe('race-a');
  });

  it('clears a selection that is absent without making it a query dependency', () => {
    expect(retainVisibleSelection('race-a', [{ id: 'race-b' }])).toBeNull();
    expect(retainVisibleSelection(null, [{ id: 'race-b' }])).toBeNull();
  });
});

describe('filterUploadedFiles', () => {
  const paths = [
    'homebrew/probe-brews.xml',
    'user/monster-manual.index',
    'user/20150202.xml',
  ];

  it('matches file names and categories without case sensitivity', () => {
    expect(filterUploadedFiles(paths, 'MONSTER')).toEqual([
      'user/monster-manual.index',
    ]);
    expect(filterUploadedFiles(paths, ' homebrew ')).toEqual([
      'homebrew/probe-brews.xml',
    ]);
  });

  it('returns all files for an empty filter', () => {
    expect(filterUploadedFiles(paths, '  ')).toBe(paths);
  });
});

describe('describeContentPath', () => {
  it('separates the filename from its stored category path', () => {
    expect(describeContentPath('third-party/publisher/book.index')).toEqual({
      fileName: 'book.index',
      category: 'third-party/publisher',
    });
  });

  it('labels paths without a category', () => {
    expect(describeContentPath('rules.xml')).toEqual({
      fileName: 'rules.xml',
      category: 'Uncategorised',
    });
  });
});

describe('describeContentRecord', () => {
  it('shows a tracked source-relative core path without its storage prefix', () => {
    expect(
      describeContentRecord(
        {
          path: 'imports/legacy/core/races.xml',
          relativePath: 'core/races.xml',
          sourceId: 'legacy',
        },
        new Map([['legacy', { label: 'Community Elements' }]])
      )
    ).toEqual({
      path: 'imports/legacy/core/races.xml',
      fileName: 'races.xml',
      logicalPath: 'core/races.xml',
      sourceLabel: 'Community Elements',
    });
  });

  it('keeps legacy category-prefixed records accessible', () => {
    expect(
      describeContentRecord(
        { path: 'supplements/legacy/book.xml' },
        new Map()
      )
    ).toMatchObject({
      logicalPath: 'supplements/legacy/book.xml',
      sourceLabel: 'Previous uploads',
    });
  });
});
