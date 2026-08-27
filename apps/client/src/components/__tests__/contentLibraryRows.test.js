import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../ContentManager.jsx', import.meta.url),
  'utf8',
);

describe('content library browse rows', () => {
  it('opens element info from a dedicated info button, not the row text', () => {
    // The name is plain text; a per-row "i" button selects the element for the
    // description panel. Row text does not double as the inspect trigger.
    const tableBody = source.slice(
      source.indexOf('page?.items.map'),
      source.indexOf('No elements match these filters.'),
    );
    expect(tableBody).toContain('<InformationButton');
    expect(tableBody).toContain('onInspect={setSelectedElementId}');
    expect(tableBody).not.toContain('InspectableItemButton');
  });
});
