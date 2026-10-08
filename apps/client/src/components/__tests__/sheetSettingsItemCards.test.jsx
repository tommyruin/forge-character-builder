// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { characters } = vi.hoisted(() => ({
  characters: { setItemCards: vi.fn() },
}));

vi.mock('../../api', () => ({ api: { characters } }));

import SheetSettingsPanel from '../tabs/manage/SheetSettingsPanel.jsx';
import { WorkspaceContext } from '../WorkspaceContext';
import { sheetLayoutOptionsSettingStore } from '../../sheetLayoutOptionsSetting.js';

let host;
let root;
const run = vi.fn((operation) => operation());
const notify = vi.fn();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  characters.setItemCards.mockResolvedValue({ items: [] });
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  sheetLayoutOptionsSettingStore.set({ smartCards: false, inventoryNotes: false });
  vi.clearAllMocks();
});

async function renderPanel() {
  await act(() =>
    root.render(
      <WorkspaceContext.Provider value={{ id: 'Ada', busy: false, detail: { rulesetMode: '2014' }, run, notify }}>
        <SheetSettingsPanel />
      </WorkspaceContext.Provider>,
    ),
  );
}

const switchLabelled = (text) =>
  [...host.querySelectorAll('label')].find((label) => label.textContent.startsWith(text)).querySelector('[role="switch"]');
const buttonNamed = (text) => [...host.querySelectorAll('button')].find((button) => button.textContent === text);

describe('sheet settings item cards', () => {
  it('limits every item card to significant items in one character edit', async () => {
    await renderPanel();
    await act(async () => buttonNamed('Cards for magic & useful items only').click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(characters.setItemCards).toHaveBeenCalledWith('Ada', 'significant');
    expect(notify).toHaveBeenCalled();
  });

  it('removes every item card in one character edit', async () => {
    await renderPanel();
    await act(async () => buttonNamed('No item cards').click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(characters.setItemCards).toHaveBeenCalledWith('Ada', 'none');
  });

  it('switches smart cards for new items on and off', async () => {
    await renderPanel();
    const smart = () => switchLabelled('Only give new items a card');
    expect(smart().checked).toBe(false);
    await act(async () => smart().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().smartCards).toBe(true);
    expect(smart().checked).toBe(true);
    await act(async () => smart().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().smartCards).toBe(false);
  });

  it('switches item notes in the inventory on and off', async () => {
    await renderPanel();
    const notes = () => switchLabelled('Print item notes in the inventory');
    expect(notes().checked).toBe(false);
    await act(async () => notes().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().inventoryNotes).toBe(true);
    expect(notes().checked).toBe(true);
    await act(async () => notes().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().inventoryNotes).toBe(false);
  });
});
