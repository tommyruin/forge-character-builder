import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createLibraryPickerRefreshController } from '../CharacterWorkspace.jsx';

const workspaceSource = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const magicSource = readFileSync(
  new URL('../tabs/MagicTab.jsx', import.meta.url),
  'utf8',
);
const spellBrowserSource = readFileSync(
  new URL('../tabs/magic/SpellBrowser.jsx', import.meta.url),
  'utf8',
);
const equipmentSource = readFileSync(
  new URL('../tabs/EquipmentTab.jsx', import.meta.url),
  'utf8',
);
const migrationSource = readFileSync(
  new URL('../MigrationDrawer.jsx', import.meta.url),
  'utf8',
);

describe('library-backed picker refreshes', () => {
  it('defers a hidden revision and runs exactly once when the workspace activates', async () => {
    const controller = createLibraryPickerRefreshController(0);
    const refresh = vi.fn(async () => 'fresh');

    expect(controller.request(1, false, refresh)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    const first = controller.request(1, true, refresh);
    const second = controller.request(1, true, refresh);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ stale: false, value: 'fresh' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(controller.request(1, true, refresh)).toBeNull();
  });

  it('ignores an obsolete response when a newer revision starts', async () => {
    const controller = createLibraryPickerRefreshController(0);
    let resolveFirst;
    let resolveSecond;
    const first = controller.request(
      1,
      true,
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const second = controller.request(
      2,
      true,
      () => new Promise((resolve) => (resolveSecond = resolve)),
    );

    await Promise.resolve();
    resolveFirst('old');
    resolveSecond('new');

    await expect(first).resolves.toEqual({ stale: true, value: 'old' });
    await expect(second).resolves.toEqual({ stale: false, value: 'new' });
    expect(controller.request(1, true, vi.fn())).toBeNull();
  });

  it('allows a failed revision refresh to retry', async () => {
    const controller = createLibraryPickerRefreshController(0);
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary engine failure'))
      .mockResolvedValueOnce('recovered');

    await expect(controller.request(1, true, refresh)).rejects.toThrow(
      'temporary engine failure',
    );
    await expect(controller.request(1, true, refresh)).resolves.toEqual({
      stale: false,
      value: 'recovered',
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('tracks independent picker identities at the same revision', async () => {
    const controller = createLibraryPickerRefreshController(0);
    const firstRule = vi.fn(async () => 'first');
    const secondRule = vi.fn(async () => 'second');

    await expect(
      controller.request(1, true, firstRule, 'rule-one'),
    ).resolves.toEqual({ stale: false, value: 'first' });
    await expect(
      controller.request(1, true, secondRule, 'rule-two'),
    ).resolves.toEqual({ stale: false, value: 'second' });

    expect(firstRule).toHaveBeenCalledOnce();
    expect(secondRule).toHaveBeenCalledOnce();
    expect(controller.request(1, true, vi.fn(), 'rule-one')).toBeNull();
  });

  it('does not let one picker identity reuse another identity’s in-flight result', async () => {
    const controller = createLibraryPickerRefreshController(0);
    let resolveFirst;
    let resolveSecond;
    const first = controller.request(
      1,
      true,
      () => new Promise((resolve) => (resolveFirst = resolve)),
      'rule-one',
    );
    const second = controller.request(
      1,
      true,
      () => new Promise((resolve) => (resolveSecond = resolve)),
      'rule-two',
    );

    await Promise.resolve();
    resolveSecond('second');
    resolveFirst('first');

    await expect(first).resolves.toEqual({ stale: false, value: 'first' });
    await expect(second).resolves.toEqual({
      stale: false,
      value: 'second',
    });
  });

  it('keeps activation and picker state local while exposing localized refresh status', () => {
    expect(workspaceSource).toContain('libraryRevision,');
    expect(workspaceSource).toContain('active,');
    expect(workspaceSource).toContain('createLibraryPickerRefreshController');

    for (const source of [magicSource, spellBrowserSource]) {
      expect(source).toContain('libraryRevision');
      expect(source).toContain('active');
      expect(source).toContain('Refreshing spells');
    }
    expect(magicSource).toContain('spellLevelTab');
    expect(magicSource).toContain('casterRequestGeneration');
    expect(spellBrowserSource).toContain('const [filter, setFilter]');
    expect(spellBrowserSource).toContain('browseRequestGeneration');

    expect(equipmentSource).toContain('libraryRevision');
    expect(equipmentSource).toContain('categoryKey');
    expect(equipmentSource).toContain('debouncedSearch');
    expect(equipmentSource).toContain('skip');
    expect(equipmentSource).toContain('searchRequestGeneration');
    expect(equipmentSource).toContain('categoryPageRequestGeneration');
    expect(equipmentSource).toContain('Refreshing equipment');

    expect(migrationSource).toContain('libraryRevision');
    expect(migrationSource).toContain('expanded');
    expect(migrationSource).toContain('filter');
    expect(migrationSource).toContain('optionRequestGeneration');
    expect(migrationSource).toContain('Refreshing options');
  });
});
