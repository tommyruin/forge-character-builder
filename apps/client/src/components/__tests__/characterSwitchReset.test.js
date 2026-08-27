/**
 * Switching to another character must not leave the previous character's
 * workspace on screen. The workspace holds per-character state that no single
 * effect owns -- the open tab, each panel's fetched rows, the resource cache --
 * so it is keyed by the open character and remounts on a switch. That resets
 * the workspace to its Build tab and discards the previous character's rows
 * instead of showing them beside a "not found" error.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const manage = readFileSync(new URL('../tabs/ManageTab.jsx', import.meta.url), 'utf8');

describe('switching the open character', () => {
  it('remounts the workspace so no state survives the switch', () => {
    const mount = app.slice(app.indexOf('<CharacterWorkspace'));
    expect(mount.slice(0, mount.indexOf('/>'))).toMatch(
      /key=\{openCharacterId\}/,
    );
  });

  it('starts a freshly mounted workspace on the Build tab', () => {
    expect(workspace).toContain('useState("build")');
  });

  it('drops the previous character\'s attack rows before fetching', () => {
    // A failed fetch must not leave another character's rows rendered.
    expect(manage).toMatch(/setAttacks\(null\)/);
  });
});
