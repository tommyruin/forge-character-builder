import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

// The Homebrewery description card is deliberately parchment-locked: its palette
// is part of the rendered sheet, not the app chrome, so it stays literal.
const PARCHMENT_START = css.indexOf('.fcb-content-renderer {');
const PARCHMENT_END = css.indexOf('.fcb-ability-grid');
const chrome =
  css.slice(0, PARCHMENT_START) + css.slice(PARCHMENT_END);

const jsxFiles = [
  '../MigrationDrawer.jsx',
  '../SelectionRuleCard.jsx',
  '../CharacterWorkspace.jsx',
  '../tabs/BuildTab.jsx',
  '../ContentManager.jsx',
  '../tabs/EquipmentTab.jsx',
  '../LevelUpHitPoints.jsx',
  '../Modal.jsx',
  '../LevelUpFlyout.jsx',
  '../ContentImportControls.jsx',
];

describe('semantic status tokens', () => {
  it('defines a status palette that follows the active theme', () => {
    for (const token of [
      '--fcb-danger-bg',
      '--fcb-danger-border',
      '--fcb-danger-text',
      '--fcb-success-bg',
      '--fcb-success-border',
      '--fcb-success-text',
      '--fcb-warning-bg',
      '--fcb-warning-border',
      '--fcb-warning-text',
      '--fcb-scrim',
    ]) {
      expect(css, token).toMatch(
        new RegExp(`${token}:\\s*[^;]*var\\(--dmf-`, 's'),
      );
    }
  });

  it('styles the danger button and status badges from those tokens', () => {
    expect(css).toMatch(
      /\.fcb-button-danger\s*\{[^}]*var\(--fcb-danger-/s,
    );
    expect(css).toMatch(
      /\.fcb-status-complete\s*\{[^}]*var\(--fcb-success-/s,
    );
    expect(css).toMatch(
      /\.fcb-status-needed\s*\{[^}]*var\(--fcb-warning-/s,
    );
  });

  it('leaves no hardcoded status colours in the app chrome', () => {
    for (const literal of [
      '#fecaca',
      'rgba(239, 68, 68',
      '#86efac',
      '#fbbf24',
      '#82b366',
    ]) {
      expect(chrome, literal).not.toContain(literal);
    }
  });
});

describe('warning colour', () => {
  // `--fcb-amber` is the gold primary, so a warning drawn with it reads as a selected state.
  const rule = (selector) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('draws warnings and errors in the warning colour, not the primary gold', () => {
    expect(rule('.fcb-homebrew-status-dot.is-error')).toContain('background: var(--dmf-warning);');
    for (const selector of ['.fcb-boot-sub.fcb-boot-error', '.fcb-boot-pill.is-warn', '.fcb-sheet-preview-status.is-stale']) {
      expect(rule(selector), selector).toContain('color: var(--dmf-warning-text, var(--dmf-warning));');
    }
  });

  it('falls back to --dmf-warning, which the standalone builder shell defines', () => {
    const shell = readFileSync(new URL('../../shell/default/styles.css', import.meta.url), 'utf8');
    expect(shell).toMatch(/--dmf-warning:/);
  });
});

describe('theme-safe JSX', () => {
  it('uses no Tailwind colour literals in themed components', () => {
    for (const file of jsxFiles) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(
        /(?:bg|text|border|ring|shadow|hover:bg|hover:border)-(?:red|amber|emerald|green|yellow|sky|blue|violet|black|white)[-/\s"']/,
      );
      expect(source, file).not.toMatch(/bg-\[rgba\(/);
    }
  });
});
