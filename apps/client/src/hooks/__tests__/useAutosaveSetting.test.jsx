// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_STORAGE_KEY,
  createAutosaveSettingStore,
} from '../../autosaveSetting.js';
import useAutosaveSetting from '../useAutosaveSetting.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function Probe({ store, onRender }) {
  onRender(useAutosaveSetting(store));
  return null;
}

async function mount(store) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const renders = [];
  await act(async () => {
    root.render(<Probe store={store} onRender={(value) => renders.push(value)} />);
  });
  return {
    latest: () => renders.at(-1),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('useAutosaveSetting', () => {
  it('reads the stored fcb-autosave preference on mount', async () => {
    const store = createAutosaveSettingStore({
      storage: fakeStorage({ [AUTOSAVE_STORAGE_KEY]: '0' }),
      characters: { setAutosaveEnabled: vi.fn() },
    });
    const probe = await mount(store);
    expect(probe.latest().autosaveEnabled).toBe(false);
    await act(async () => probe.latest().toggleAutosave());
    expect(probe.latest().autosaveEnabled).toBe(true);
    await probe.unmount();
  });

  it('follows a cross-tab storage event for the fcb-autosave key', async () => {
    const storage = fakeStorage();
    const store = createAutosaveSettingStore({
      storage,
      characters: { setAutosaveEnabled: vi.fn() },
    });
    const probe = await mount(store);
    expect(probe.latest().autosaveEnabled).toBe(true);
    storage.setItem(AUTOSAVE_STORAGE_KEY, '0');
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: AUTOSAVE_STORAGE_KEY, newValue: '0' }),
      );
    });
    expect(probe.latest().autosaveEnabled).toBe(false);
    await probe.unmount();
  });
});
