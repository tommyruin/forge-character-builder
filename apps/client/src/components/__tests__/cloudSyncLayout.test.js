import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../../App.jsx', import.meta.url),
  'utf8',
);
const headerSource = readFileSync(
  new URL('../TopbarUtilities.jsx', import.meta.url),
  'utf8',
);
const drawerSource = readFileSync(
  new URL('../cloud/DriveSyncDrawer.jsx', import.meta.url),
  'utf8',
);
const panelSource = readFileSync(
  new URL('../cloud/DriveSyncPanel.jsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('Storage & Sync entry points', () => {
  it('keeps cloud sync out of the global tabs and lazy-loads its drawer', () => {
    expect(appSource).not.toContain(
      "['cloud', 'Cloud Sync', 'Cloud']",
    );
    expect(appSource).toContain(
      "import('./components/cloud/DriveSyncDrawer')",
    );
    expect(appSource).toContain('cloudOpen &&');
  });

  it('links the compact top bar to cloud status without loading Google eagerly', () => {
    expect(appSource).toContain('onCloudOpen');
    expect(headerSource).toContain('Drive sync');
    expect(headerSource).toContain('name="cloud"');
    expect(headerSource).not.toContain('accounts.google.com');
  });

  it('uses an accessible dismissible drawer without replacing the active section', () => {
    expect(drawerSource).toContain('role="dialog"');
    expect(drawerSource).toContain('aria-modal="true"');
    expect(drawerSource).toContain("event.key === 'Escape'");
    expect(drawerSource).toContain("event.key !== 'Tab'");
    expect(css).toContain('.fcb-cloud-drawer-backdrop');
    expect(css).toContain(
      '.fcb-app-shell > .fcb-cloud-drawer-backdrop',
    );
    expect(css).toContain('width: min(560px, 100vw)');
  });

  it('uses the existing Character Builder visual system responsively', () => {
    expect(css).toContain('.fcb-cloud-sync');
    expect(css).toContain('.fcb-cloud-summary-grid');
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.fcb-cloud-summary-grid/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.fcb-cloud-drawer\s*\{[^}]*width: 100vw;[^}]*animation: none;/,
    );
  });

  it('surfaces duplicate groups after sync and links to review', () => {
    expect(panelSource).toContain('duplicateGroups');
    expect(panelSource).toContain('Review duplicates');
  });

  it('keeps explanatory and privacy copy in a collapsed information panel', () => {
    expect(panelSource).toContain('<details className="fcb-cloud-info">');
    expect(panelSource).toContain('How Google Drive sync works');
    expect(panelSource).not.toContain(
      '<aside className="fcb-card fcb-cloud-card">',
    );
  });
});
