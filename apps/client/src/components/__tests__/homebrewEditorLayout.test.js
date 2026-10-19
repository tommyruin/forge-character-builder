import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorSource = readFileSync(
  new URL('../homebrew/HomebrewEditor.jsx', import.meta.url),
  'utf8',
);
const source = (name) => readFileSync(new URL(`../homebrew/${name}`, import.meta.url), 'utf8');
const elementEditorSource = source('ElementEditor.jsx');
const packDetailsSource = source('PackDetails.jsx');
const newElementSource = source('NewElementDialog.jsx');
const xmlBuilderSource = readFileSync(
  new URL('../homebrew/xmlBuilder.js', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8',
);

const existingTestIds = [
  'hb-new-pack',
  'hb-pack-name',
  'hb-pack-ruleset',
  'hb-save-ingest',
  'hb-download',
  'hb-ingest-result',
  'hb-add-element',
  'hb-element-list',
  'hb-element-ruleset',
];

describe('Homebrew Editor workspace layout', () => {
  it('uses three named regions inside a dedicated workspace', () => {
    expect(editorSource).toContain('fcb-homebrew-workspace');
    expect(editorSource).not.toContain('className="fcb-content-grid"');

    for (const region of ['library', 'editor', 'inspector']) {
      expect(editorSource).toContain(
        `fcb-homebrew-${region}`,
      );
    }
  });

  it('keeps the inspector top-aligned and sticky on desktop', () => {
    expect(styles).toMatch(
      /\.fcb-homebrew-workspace\s*\{[^}]*align-items:\s*start;/s,
    );
    expect(styles).toMatch(
      /\.fcb-homebrew-inspector\s*\{[^}]*align-self:\s*start;/s,
    );

    expect(styles).toMatch(
      /@media \(min-width:\s*1101px\)[\s\S]*?\.fcb-homebrew-inspector\s*\{[^}]*position:\s*sticky;/s,
    );
  });

  it('defines medium and mobile workspace flows', () => {
    expect(styles).toMatch(
      /@media \(max-width:\s*1100px\)[\s\S]*?\.fcb-homebrew-workspace\s*\{[^}]*grid-template-columns:/s,
    );

    expect(styles).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.fcb-homebrew-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.fcb-homebrew-inspector\s*\{[^}]*position:\s*static;/s,
    );
  });

  it('keeps pack actions on one row at the reported medium viewport', () => {
    const mediumStyles = styles.match(
      /@media \(max-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(mediumStyles).toBeTruthy();
    expect(mediumStyles).not.toMatch(
      /\.fcb-homebrew-toolbar-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
    expect(mediumStyles).toMatch(
      /\.fcb-homebrew-toolbar\s*\{[^}]*grid-template-columns:[^}]*auto;/s,
    );
    const baseToolbarStyles = styles.match(
      /\.fcb-homebrew-toolbar\s*\{([^}]*)\}/,
    )?.[1];
    expect(baseToolbarStyles).toContain('align-items: center;');
    const statusStyles = styles.match(
      /\.fcb-homebrew-status\s*\{([^}]*)\}/,
    )?.[1];
    expect(statusStyles).toContain('display: flex;');
    expect(statusStyles).toContain('white-space: nowrap;');
  });

  it('uses compact accessible toolbar controls below 1000px', () => {
    expect(editorSource).toContain('aria-label="Pack"');
    expect(editorSource).toContain('aria-label="Create new pack"');
    expect(editorSource).toContain('aria-label="Download pack XML"');
    expect(editorSource).toContain('aria-label="Delete pack"');
    expect(editorSource).not.toContain('aria-label="More pack actions"');
    expect(editorSource).toContain('fcb-homebrew-download-label');

    const compactStyles = styles.match(
      /@media \(max-width:\s*1000px\) and \(min-width:\s*701px\)\s*\{([\s\S]*?)@media \(max-width:\s*700px\)/,
    )?.[1];

    expect(compactStyles).toBeTruthy();
    expect(compactStyles).toMatch(
      /\.fcb-homebrew-collection-label[\s\S]*display:\s*none;/s,
    );
    expect(compactStyles).toMatch(
      /\.fcb-homebrew-save-label[\s\S]*display:\s*none;/s,
    );
    expect(compactStyles).toMatch(
      /\.fcb-homebrew-download-label[\s\S]*display:\s*none;/s,
    );
  });

  it('exposes element deletion as a direct accessible icon action', () => {
    expect(editorSource).toContain(
      'aria-label={`Delete ${element.name || element.type}`}',
    );
    expect(editorSource).not.toContain(
      'aria-label={`Actions for ${element.name || element.type}`}',
    );
    expect(editorSource).not.toContain(
      'className="fcb-homebrew-element-overflow"',
    );
  });

  it('uses a single-pane mobile navigation state with a back control', () => {
    expect(editorSource).toContain('data-testid="hb-mobile-back"');
    expect(editorSource).toContain('is-mobile-${mobilePane}');
    expect(styles).toMatch(
      /\.fcb-homebrew-workspace\.is-mobile-library\s+\.fcb-homebrew-editor[\s\S]*display:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.fcb-homebrew-workspace\.is-mobile-editor\s+\.fcb-homebrew-library\s*\{[^}]*display:\s*none;/s,
    );
  });

  it('makes pack navigation and search-oriented fields explicit', () => {
    expect(editorSource).toContain('Pack details and health');
    expect(editorSource).toContain('Search pack elements');
    expect(elementEditorSource).toContain('made with the earlier editor');
    expect(newElementSource).toContain('Find a book element');
  });

  it('calls the editor a pack, not a collection, wherever the author reads it', () => {
    for (const text of [editorSource, packDetailsSource, elementEditorSource, newElementSource]) {
      expect(text).not.toMatch(/>\s*[^<{]*\bcollection\b[^<{]*</i);
    }
    expect(xmlBuilderSource).not.toContain('Use collection setting');
  });

  it('exposes pack defaults and advanced entry ruleset overrides', () => {
    expect(packDetailsSource).toContain('Rules version');
    expect(packDetailsSource).toContain('RULESET_OPTIONS');
    expect(xmlBuilderSource).toContain('Both 2014 and 2024');
    expect(elementEditorSource).toContain('Rules version');
    expect(elementEditorSource).toContain('ELEMENT_RULESET_OPTIONS');
  });

  it('renders a live draft preview without waiting for ingestion', () => {
    expect(editorSource).toContain('ContentRenderer');
    expect(editorSource).toContain('buildHomebrewPreviewElement');
    expect(editorSource).not.toContain(
      'Preview is available after this element is loaded into the builder.',
    );
  });

  it('passes mutation results to the library lifecycle for update and removal', () => {
    expect(editorSource).toContain('await saveCollection(api, draft)');
    expect(editorSource).toContain('result = await removeCollection(api, draft)');
    expect(editorSource.match(/onLibraryChanged\?\.\(\{ source: "homebrew", result \}\);/g)).toHaveLength(2);
  });

  it('uses the current library phase while an update is in flight', () => {
    expect(editorSource).toContain('libraryPhase = "content"');
    expect(editorSource).toContain('phase={libraryPhase}');
  });

  it('preserves the existing Homebrew Editor test IDs', () => {
    const homebrewSources = `${editorSource}\n${packDetailsSource}\n${elementEditorSource}`;

    for (const testId of existingTestIds) {
      expect(homebrewSources).toContain(`data-testid="${testId}"`);
    }
  });
});
