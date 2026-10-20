// @vitest-environment happy-dom
// Removing a custom entry from a list: a confirm that names the picks it would clear when there
// are any, and a toast either way, so a Remove never looks like it did nothing or silently undoes a pick.
import { describe, expect, it, vi } from 'vitest';
import { createCustomDraft } from '@forge-cb/engine/custom';
import { CustomRemovalDialog, useCustomRemoval } from '../CustomRemoval';
import { buttonByText, click, mount, settle } from './harness';

const entry = (blocks = []) => ({ elementId: 'ID_CUSTOM_ONE', draft: { ...createCustomDraft('feature', 'Moon Gift'), blocks } });
const choice = { kind: 'choice', id: 'c1', type: 'Skill', count: 1 };

function Host({ services, notify, target }) {
  const removal = useCustomRemoval({ services, notify });
  return (
    <>
      <button type="button" onClick={() => removal.request(target)}>
        go
      </button>
      <CustomRemovalDialog removal={removal} />
    </>
  );
}

const services = (report) => ({
  impact: vi.fn(async () => report),
  remove: vi.fn(async () => {}),
});

describe('removing a custom entry', () => {
  it('removes at once and says so when no pick depends on it', async () => {
    const api = services({ changes: [], hasPicks: false });
    const notify = vi.fn();
    await mount(<Host services={api} notify={notify} target={entry([choice])} />);
    await click(buttonByText('go'));
    await settle();
    expect(api.remove).toHaveBeenCalledWith('ID_CUSTOM_ONE');
    expect(notify).toHaveBeenCalledWith('Removed Moon Gift. Undo brings it back.');
    expect(document.querySelector('[role="alertdialog"], [data-testid="remove-picks-warning"]')).toBeNull();
  });

  it('asks first, listing the picks it would clear, and removes nothing until confirmed', async () => {
    const api = services({
      hasPicks: true,
      changes: [{ blockId: 'c1', name: 'Gift skill', type: 'Skill', change: 'removed', fields: [], orphanedSlots: [1], picks: [{ characterId: 'Ada', slot: 1, elementId: 'ID_SKILL_STEALTH', elementName: 'Stealth' }] }],
    });
    const notify = vi.fn();
    await mount(<Host services={api} notify={notify} target={entry([choice])} />);
    await click(buttonByText('go'));
    await settle();
    expect(api.remove).not.toHaveBeenCalled();
    const warning = document.querySelector('[data-testid="remove-picks-warning"]');
    expect(warning.textContent).toContain('Stealth');
    expect(buttonByText('Remove and clear those picks').className).toContain('fcb-button-danger');

    await click(buttonByText('Keep it'));
    expect(api.remove).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="remove-picks-warning"]')).toBeNull();

    await click(buttonByText('go'));
    await settle();
    await click(buttonByText('Remove and clear those picks'));
    await settle();
    expect(api.remove).toHaveBeenCalledWith('ID_CUSTOM_ONE');
    expect(notify).toHaveBeenCalledWith('Removed Moon Gift. Undo brings it back.');
  });

  it('asks the engine about the draft without its choices, since removing the entry removes them all', async () => {
    const api = services({ changes: [], hasPicks: false });
    await mount(<Host services={api} notify={() => {}} target={entry([choice, { kind: 'grant', id: 'g1' }])} />);
    await click(buttonByText('go'));
    await settle();
    expect(api.impact.mock.calls[0][0].blocks.map((block) => block.kind)).toEqual(['grant']);
  });
});
