import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsxFiles(path));
    else if (entry.endsWith('.jsx')) out.push(path);
  }
  return out;
}

const files = jsxFiles(root).map((path) => ({
  path: path.slice(root.length),
  source: readFileSync(path, 'utf8'),
}));

// The UI copy conventions: American spelling, sentence case for headings and
// buttons below the top-level tab bar, and one verb per action.
describe('microcopy conventions', () => {
  it('uses American spelling in visible copy', () => {
    for (const { path, source } of files) {
      // `organisationName` is an engine DTO field, not copy — match words only
      // where they read as prose.
      expect(source, path).not.toMatch(/Randomise/);
      expect(source, path).not.toMatch(/>Organisation/);
      expect(source, path).not.toMatch(/Minimise/);
    }
  });

  it('uses one verb per action', () => {
    for (const { path, source } of files) {
      expect(source, path).not.toMatch(/>\s*Try again\s*</);
      expect(source, path).not.toMatch(/Retry equipment/);
    }
  });

  it('writes headings and buttons in sentence case', () => {
    const titleCase = [
      'Your Characters',
      'Content Library',
      'Character Details',
      'Campaign Choices',
      'Additional Features',
      'Homebrew Content',
      'Manage Coins',
      'Content Changes',
      'Live Sheet',
      'Character Sheet',
      'Companion Choices',
      'Save Details',
      'Apply &amp; Save',
      'Generate Scores',
      'Apply Scores',
      'Create &amp; Open',
      'Character Name',
      'Player Name',
      'More Notes',
    ];
    for (const { path, source } of files) {
      for (const phrase of titleCase) {
        expect(source, `${path}: ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it('writes ampersands literally in JSX text', () => {
    for (const { path, source } of files) {
      // Escaping helpers legitimately produce the entity; only rendered copy
      // between tags must use a literal ampersand.
      expect(source, path).not.toMatch(/>[^<>\n]*&amp;[^<>\n]*</);
    }
  });
});
