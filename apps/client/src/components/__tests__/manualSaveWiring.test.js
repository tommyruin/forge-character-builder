/**
 * Manual save is a cross-cutting feature: the header toggle, the workspace
 * Save button, the tab-close warning and the switch guard each live in a
 * different component. These source contracts pin the wiring together.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../../App.jsx');
const workspace = read('../CharacterWorkspace.jsx');
const header = read('../TopbarUtilities.jsx');

describe('manual save wiring', () => {
  it('renders Save only while autosave is off and Undo in both modes', () => {
    expect(workspace).toMatch(/\{!autosaveEnabled && \(\s*<SaveButton/);
    expect(workspace).not.toMatch(/\{!autosaveEnabled && \(\s*<>?\s*<UndoButton/);
    expect(workspace).toContain('api.characters.saveCharacter(id)');
    expect(workspace).toContain('api.characters.undoLastChange(id)');
  });

  it('groups the top bar: character actions, then storage, then site-wide', () => {
    // Export leaves the workspace portal for the storage group in the utilities.
    expect(workspace).not.toContain('<ExportMenu');
    expect(app).toMatch(/leading=\{\s*workspaceActive \? \(\s*<ExportMenu/);
    expect(app).toContain('variant="utility"');
    const utilities = header.slice(header.indexOf('fcb-topbar-utilities'));
    expect(utilities.indexOf('{leading}')).toBeLessThan(utilities.indexOf('fcb-cloud-utility'));
    expect(utilities.indexOf('<AutosaveToggle')).toBeLessThan(utilities.indexOf('fcb-topbar-divider'));
    expect(utilities.indexOf('fcb-topbar-divider')).toBeLessThan(utilities.indexOf('Switch to ${nextTheme} theme'));
  });

  it('places Undo and Save to the left of Level Up', () => {
    const levelUp = workspace.indexOf('fcb-level-up-button');
    expect(workspace.indexOf('<UndoButton')).toBeLessThan(levelUp);
    expect(workspace.indexOf('<SaveButton')).toBeLessThan(levelUp);
    expect(workspace.indexOf('<UndoButton')).toBeLessThan(workspace.indexOf('<SaveButton'));
  });

  it('puts the autosave toggle among the top bar utilities', () => {
    expect(header).toContain('<AutosaveToggle');
    expect(header).toContain('useAutosaveSetting()');
  });

  it('warns on tab close and guards character switches', () => {
    expect(app).toContain("addEventListener('beforeunload'");
    expect(app).toContain('guardUnsavedChanges(proceed)');
    expect(app).toContain('<UnsavedChangesDialog');
    expect(app).toContain('discardUnsavedChanges');
  });
});
