import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AutosaveToggle from '../AutosaveToggle.jsx';
import SaveButton from '../SaveButton.jsx';
import UndoButton from '../UndoButton.jsx';
import UnsavedChangesDialog from '../UnsavedChangesDialog.jsx';

const render = (component, props) =>
  renderToStaticMarkup(createElement(component, props));

describe('autosave controls', () => {
  it('exposes the toggle state through aria-pressed and its title', () => {
    const on = render(AutosaveToggle, { enabled: true, onToggle: () => {} });
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('title="Autosave on"');
    expect(on).toContain('aria-label="Turn autosave off"');
    expect(on).toContain('is-on');

    const off = render(AutosaveToggle, { enabled: false, onToggle: () => {} });
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('title="Autosave off"');
    expect(off).toContain('is-off');
  });

  it('disables the Save button when the character is clean and flags unsaved work', () => {
    const clean = render(SaveButton, { dirty: false, onSave: () => {} });
    expect(clean).toContain('disabled=""');
    expect(clean).toContain('data-unsaved="false"');
    expect(clean).toContain('title="Save (all changes saved)"');
    expect(clean).toContain('fcb-icon-button');

    const dirty = render(SaveButton, { dirty: true, onSave: () => {} });
    expect(dirty).not.toContain('disabled=""');
    expect(dirty).toContain('data-unsaved="true"');
    expect(dirty).toContain('title="Save (unsaved changes)"');
    expect(dirty).toContain('fcb-manual-save-dot');

    const saving = render(SaveButton, { dirty: true, saving: true, onSave: () => {} });
    expect(saving).toContain('disabled=""');
    expect(saving).toContain('title="Saving…"');
  });

  it('disables the Undo button until there is an edit to step back from', () => {
    const idle = render(UndoButton, { available: false, onUndo: () => {} });
    expect(idle).toContain('disabled=""');
    expect(idle).toContain('title="Nothing to undo"');

    const ready = render(UndoButton, { available: true, onUndo: () => {} });
    expect(ready).not.toContain('disabled=""');
    expect(ready).toContain('aria-label="Undo last change"');
  });

  it('offers save, discard and cancel in the unsaved-changes dialog', () => {
    const markup = render(UnsavedChangesDialog, {
      open: true,
      characterName: 'Ada',
      onSave: () => {},
      onDiscard: () => {},
      onCancel: () => {},
    });
    expect(markup).toContain('“Ada” has unsaved changes.');
    expect(markup).toContain('Save and continue');
    expect(markup).toContain('Discard changes');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('role="dialog"');

    const closed = render(UnsavedChangesDialog, {
      open: false,
      characterName: 'Ada',
      onSave: () => {},
      onDiscard: () => {},
      onCancel: () => {},
    });
    expect(closed).toBe('');
  });

  it('shows a failed save inside the dialog', () => {
    const markup = render(UnsavedChangesDialog, {
      open: true,
      characterName: 'Ada',
      error: 'quota exceeded',
      onSave: () => {},
      onDiscard: () => {},
      onCancel: () => {},
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('quota exceeded');
  });
});
