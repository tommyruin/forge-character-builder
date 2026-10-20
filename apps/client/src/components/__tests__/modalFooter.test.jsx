// @vitest-environment happy-dom
// A dialog's action row: one component, inside the dialog's one scroll area, with room kept above it
// so a field reached with Tab is never hidden behind the row.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Modal, { DialogFooter } from '../Modal';
import { $, mount } from '../custom/__tests__/harness';

// happy-dom gives the module an http URL, so the stylesheet is found from the run's folder.
const cssPath = ['src/index.css', 'apps/client/src/index.css'].map((path) => resolve(process.cwd(), path)).find(existsSync);
const css = readFileSync(cssPath, 'utf8');

describe('Modal footer', () => {
  it('renders the footer prop as the last thing in the scrolling body', async () => {
    await mount(
      <Modal open title="Remove it" onClose={() => {}} footer={<button type="button">Keep it</button>}>
        <p>Body</p>
      </Modal>,
    );
    const body = $('.fcb-modal-body');
    expect(body).not.toBeNull();
    const footer = body.lastElementChild;
    expect(footer.classList.contains('fcb-dialog-footer')).toBe(true);
    expect(footer.textContent).toBe('Keep it');
  });

  it('gives a form dialog the same row as a component', async () => {
    await mount(
      <Modal open title="Add" onClose={() => {}}>
        <form>
          <DialogFooter data-testid="row">
            <button type="submit">Add item</button>
          </DialogFooter>
        </form>
      </Modal>,
    );
    expect($('[data-testid="row"]').className).toBe('fcb-toolbar fcb-dialog-footer justify-end');
  });

  it('keeps scroll room above the sticky row and cuts long labels instead of widening the dialog', () => {
    expect(css).toMatch(/\.fcb-modal-body \{[^}]*scroll-padding-bottom: \d+px/);
    expect(css).toMatch(/\.fcb-dialog-footer \{[^}]*position: sticky/);
    expect(css).toMatch(/\.fcb-dialog-footer > \.fcb-button \{[^}]*text-overflow: ellipsis/);
    // The one-line rule is scoped to action rows, not every toolbar in the app.
    expect(css).not.toMatch(/\.fcb-toolbar > \.fcb-button,/);
  });
});
