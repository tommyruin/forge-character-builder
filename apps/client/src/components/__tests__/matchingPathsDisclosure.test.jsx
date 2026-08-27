import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MatchingPathsDisclosure from '../MatchingPathsDisclosure';

describe('MatchingPathsDisclosure', () => {
  it('keeps very large duplicate sources collapsed and bounded', () => {
    const paths = Array.from(
      { length: 1_000 },
      (_, index) => `folder/file-${index}.xml`,
    );

    const markup = renderToStaticMarkup(
      <MatchingPathsDisclosure paths={paths} />,
    );

    expect(markup).toContain('Review 1,000 matching filenames');
    expect(markup).toContain('900 more matching filenames not shown');
    expect(markup.match(/<li/g)).toHaveLength(100);
    expect(markup).not.toMatch(/<details[^>]*\sopen/);
  });
});
