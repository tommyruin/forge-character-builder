// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ api: { characters: {} } }));

import SheetSettingsPanel from '../tabs/manage/SheetSettingsPanel.jsx';
import { sheetLayoutOptionsSettingStore } from '../../sheetLayoutOptionsSetting.js';
import { sheetTemplateSettingStore } from '../../sheetTemplateSetting.js';

let host;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  sheetLayoutOptionsSettingStore.set({ split: null });
  sheetTemplateSettingStore.set('2014');
});

async function renderPanel() {
  await act(() => root.render(<SheetSettingsPanel />));
}

const splitSwitch = () => host.querySelector('[aria-label="Split feature boxes"]');
const resetButton = () =>
  [...host.querySelectorAll('button')].find((button) => button.textContent === 'Use layout default');
const layoutButton = (label) =>
  [...host.querySelectorAll('.fcb-sheet-set-option')].find((button) => button.textContent === label);

describe('sheet settings layout options', () => {
  it('shows each layout\'s own split choice until one is set', async () => {
    await renderPanel();
    expect(splitSwitch().getAttribute('role')).toBe('switch');
    expect(splitSwitch().checked).toBe(false);
    await act(async () => layoutButton('2024 Hybrid').click());
    // The Hybrid page has always split its features.
    expect(splitSwitch().checked).toBe(true);
    await act(async () => layoutButton('2024').click());
    expect(splitSwitch().checked).toBe(false);
    expect(sheetLayoutOptionsSettingStore.getSnapshot().split).toBeNull();
    expect(resetButton()).toBeUndefined();
  });

  it('stores an explicit choice and returns to the layout default', async () => {
    await renderPanel();
    await act(async () => splitSwitch().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().split).toBe(true);
    expect(splitSwitch().checked).toBe(true);
    await act(async () => splitSwitch().click());
    // Off on a layout that is off by default is still a choice of its own.
    expect(sheetLayoutOptionsSettingStore.getSnapshot().split).toBe(false);
    expect(splitSwitch().checked).toBe(false);
    // The choice holds across layouts: Hybrid now prints unsplit too.
    await act(async () => layoutButton('2024 Hybrid').click());
    expect(splitSwitch().checked).toBe(false);
    await act(async () => resetButton().click());
    expect(sheetLayoutOptionsSettingStore.getSnapshot().split).toBeNull();
    expect(splitSwitch().checked).toBe(true);
    expect(resetButton()).toBeUndefined();
  });
});
