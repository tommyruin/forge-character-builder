import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const characterListSource = readFileSync(
  new URL('../CharacterList.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('character collection card actions', () => {
  it('keeps desktop card actions on one compact row', () => {
    expect(characterListSource).toContain('fcb-character-card');
    expect(characterListSource).toContain('fcb-button-danger ml-auto');
    expect(css).toMatch(
      /@media \(min-width: 461px\)\s*\{[^}]*\.fcb-character-card \.fcb-toolbar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*8px;[^}]*\}[^}]*\.fcb-character-card \.fcb-toolbar \.fcb-button\s*\{[^}]*padding-inline:\s*8px;/s,
    );
  });

  it('keeps the existing three-column mobile action layout', () => {
    const mobileCss = css.slice(css.indexOf('@media (max-width: 460px)'));
    expect(mobileCss).toMatch(
      /\.fcb-character-card \.fcb-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
    );
    expect(mobileCss).toMatch(
      /\.fcb-character-card \.fcb-toolbar > \*,\s*\.fcb-character-card \.fcb-toolbar \.fcb-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*margin-left:\s*0;/s,
    );
  });
});
