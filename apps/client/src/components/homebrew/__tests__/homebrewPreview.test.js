import { describe, expect, it } from 'vitest';
import { buildHomebrewPreviewElement } from '../homebrewPreview.js';

describe('homebrew draft preview', () => {
  it('builds renderer-ready content before an element is loaded', () => {
    expect(
      buildHomebrewPreviewElement(
        {
          type: 'Feat',
          name: 'Moonlit Student',
          description: 'First paragraph.\n\nSecond paragraph.',
          prerequisite: 'Intelligence 13',
          sheetText: 'Once per long rest.',
          rawXml: null,
        },
        { name: 'Moon & Mire' },
      ),
    ).toEqual({
      name: 'Moonlit Student',
      type: 'Feat',
      source: 'Moon & Mire',
      description: '<p>First paragraph.</p>\n<p>Second paragraph.</p>',
      prerequisite: 'Intelligence 13',
      sheetDescription: {
        entries: [
          {
            level: 1,
            description: 'Once per long rest.',
          },
        ],
      },
    });
  });

  it('keeps an empty new element useful and marks raw XML previews as approximate', () => {
    expect(
      buildHomebrewPreviewElement(
        {
          type: 'Spell',
          name: '',
          description: '',
          prerequisite: '',
          sheetText: '',
          rawXml: '<element name="Raw spell" />',
        },
        { name: 'Draft Collection' },
      ),
    ).toEqual({
      name: 'New Spell',
      type: 'Spell',
      source: 'Draft Collection',
      description: '<p></p>',
      prerequisite: null,
      sheetDescription: null,
      previewNote:
        'Raw XML is shown using the last structured form values until it is loaded.',
    });
  });
});
