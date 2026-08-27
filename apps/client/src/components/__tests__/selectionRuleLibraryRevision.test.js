import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const cardSource = fs.readFileSync(
  new URL('../SelectionRuleCard.jsx', import.meta.url),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const buildTabSource = fs.readFileSync(
  new URL('../tabs/BuildTab.jsx', import.meta.url),
  'utf8',
);
const manageTabSource = fs.readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);
const companionSource = fs.readFileSync(
  new URL('../tabs/magic/CompanionSection.jsx', import.meta.url),
  'utf8',
);

describe('selection picker library revisions', () => {
  it('exposes the revision and remounts locally retained picker options', () => {
    expect(workspaceSource).toContain('libraryRevision,');
    expect(cardSource).toContain("import { useState } from 'react'");
    for (const source of [buildTabSource, manageTabSource, companionSource]) {
      expect(source).toContain(
        'key={`${rule.identifier}:${libraryRevision}`}',
      );
    }
  });
});
