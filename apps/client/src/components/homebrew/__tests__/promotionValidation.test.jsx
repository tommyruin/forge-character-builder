// @vitest-environment happy-dom
// Copy to a pack refuses an element that is not finished: the dialog says which one and why, in
// plain words, holds the Copy button back, and the copy itself refuses it too.
import { describe, expect, it, vi } from 'vitest';
import PromoteDialog from '../PromoteDialog';
import { promoteToPack } from '../promotion';
import { $, $$, mount } from '../../custom/__tests__/harness';

const unfinished = {
  schemaVersion: 1,
  id: 'ID_CUSTOM_UNFINISHED01',
  template: 'boon',
  name: 'Moonwell Gift',
  showsUnder: 'other',
  description: 'A gift.',
  blocks: [{ kind: 'choice', id: 'c1', type: 'Language', name: '', count: 1 }],
};
const finished = { ...unfinished, id: 'ID_CUSTOM_FINISHED001', name: 'Moonwell Blessing', blocks: [] };

describe('copying an unfinished element to a pack', () => {
  it('names the element and what is missing, and holds the Copy button back', async () => {
    const plan = { items: [{ id: unfinished.id, name: unfinished.name, draft: unfinished, linked: false }], notFound: [] };
    await mount(<PromoteDialog subject="Moonwell Gift" plan={plan} packs={[{ id: 'p1', name: 'Moonwell', elements: [] }]} defaultPackId="p1" onConfirm={() => {}} onClose={() => {}} />);
    const problems = $('[data-testid="hb-promote-problems"]');
    expect(problems.textContent).toContain('Moonwell Gift');
    expect(problems.textContent).toContain('Player choice: give the choice a name');
    expect(problems.textContent).not.toMatch(/blocks\[/);
    expect($('[data-testid="hb-promote-confirm"]').disabled).toBe(true);
  });

  it('copies a finished element as before', async () => {
    const plan = { items: [{ id: finished.id, name: finished.name, draft: finished, linked: false }], notFound: [] };
    await mount(<PromoteDialog subject="Moonwell Blessing" plan={plan} packs={[{ id: 'p1', name: 'Moonwell', elements: [] }]} defaultPackId="p1" onConfirm={() => {}} onClose={() => {}} />);
    expect($$('[data-testid="hb-promote-problems"]')).toHaveLength(0);
    expect($('[data-testid="hb-promote-confirm"]').disabled).toBe(false);
  });

  it('refuses to write an unfinished element into the pack', async () => {
    const store = { listHomebrew: vi.fn(async () => [{ id: 'p1', name: 'Moonwell', elements: [] }]), putHomebrew: vi.fn(async () => {}) };
    await expect(
      promoteToPack({ store, target: { packId: 'p1' }, items: [{ id: unfinished.id, name: unfinished.name, draft: unfinished }] }),
    ).rejects.toThrow('Moonwell Gift is not finished: Player choice: give the choice a name');
    expect(store.putHomebrew).not.toHaveBeenCalled();
  });
});
