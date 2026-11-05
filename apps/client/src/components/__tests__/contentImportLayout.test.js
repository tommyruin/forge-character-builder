import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ContentImportControls from '../ContentImportControls.jsx';

const source = readFileSync(
  new URL('../ContentImportControls.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('ContentImportControls', () => {
  it('does not ask users to classify imported content', () => {
    expect(source).not.toMatch(/>\s*Category\s*</);
    expect(source).not.toContain('source.category');
  });

  it('explains index scope and repository imports', () => {
    // The distinction is detail, so it lives in the control's tooltip rather
    // than a paragraph under every import form.
    expect(source).toContain('A repository URL imports everything');
    expect(source).toContain('an index URL imports only that index');
    expect(source).toContain('Accepts XML, ZIP, GitHub, and GitLab locations.');
  });

  it('offers explicit duplicate review actions without silently removing content', () => {
    expect(source).toContain('Potential duplicate sources');
    expect(source).toContain('Keep selected source');
    expect(source).toContain('Keep all');
  });

  it('bounds long matching-file previews inside their own scroll area', () => {
    expect(css).toMatch(
      /\.fcb-matching-paths-list\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:\s*auto;/,
    );
  });

  it('keeps the import visibly active while Fast Start is being prepared', () => {
    const markup = renderToStaticMarkup(
      createElement(ContentImportControls, {
        fileInput: { current: null },
        folderInput: { current: null },
        upload: () => {},
        chooseFolder: () => {},
        importFolder: () => {},
        importWeb: () => {},
        webUrl: '',
        setWebUrl: () => {},
        uploading: true,
        importProgress: null,
        contentProgress: {
          active: true,
          phase: 'optimizing',
          message: 'Preparing Fast Start for the next launch…',
        },
        cancelImport: () => {},
        sources: [],
        refreshSource: () => {},
        removeSource: () => {},
        removingSourceId: null,
        duplicateGroups: [],
        resolvingDuplicateFingerprint: null,
        onKeepDuplicateSource: () => {},
        onKeepAllDuplicates: () => {},
      }),
    );

    expect(markup).toContain('Preparing Fast Start…');
    expect(markup).toContain('Preparing Fast Start for the next launch…');
  });
  it('flags a GitHub source with an update and offers Refresh as the main action', () => {
    const render = (updatableSourceIds) =>
      renderToStaticMarkup(
        createElement(ContentImportControls, {
          fileInput: { current: null },
          folderInput: { current: null },
          upload: () => {},
          chooseFolder: () => {},
          importFolder: () => {},
          importWeb: () => {},
          webUrl: '',
          setWebUrl: () => {},
          uploading: false,
          importProgress: null,
          contentProgress: null,
          cancelImport: () => {},
          sources: [
            { id: 'a', kind: 'github', label: 'example/rules', location: 'https://github.com/example/rules', fileCount: 2, importedAt: 1, branch: 'main', revision: 'old' },
            { id: 'b', kind: 'github', label: 'example/other', location: 'https://github.com/example/other', fileCount: 1, importedAt: 1 },
          ],
          updatableSourceIds,
          refreshSource: () => {},
          removeSource: () => {},
          removingSourceId: null,
          duplicateGroups: [],
          resolvingDuplicateFingerprint: null,
          onKeepDuplicateSource: () => {},
          onKeepAllDuplicates: () => {},
        }),
      );

    const flagged = render(['a']);
    expect(flagged.match(/Update available/g)).toHaveLength(1);
    expect(flagged).toContain('fcb-button fcb-button-primary">Refresh');
    const quiet = render([]);
    expect(quiet).not.toContain('Update available');
    expect(quiet).not.toContain('fcb-button fcb-button-primary">Refresh');
  });
});
