import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('busy cursor while a choice is writing', () => {
  it('toggles a document-level busy class for the full mutation lock window', () => {
    expect(workspaceSource).toContain('fcb-busy-cursor');
    expect(workspaceSource).toMatch(
      /classList\.toggle\(\s*"fcb-busy-cursor",\s*busy \|\| libraryBusy\s*\)/,
    );
    expect(workspaceSource).toMatch(
      /classList\.remove\(\s*"fcb-busy-cursor"\s*\)/,
    );
  });

  it('renders a progress cursor across the document while locked', () => {
    expect(css).toMatch(
      /html\.fcb-busy-cursor\s*,\s*html\.fcb-busy-cursor \*\s*\{[^}]*cursor:\s*progress\s*!important;[^}]*\}/s,
    );
  });
});
