// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackEditorModal from '../tabs/manage/AttackEditorModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = {
  abilities: [
    { name: 'Strength', abbreviation: 'STR' },
    { name: 'Dexterity', abbreviation: 'DEX' },
  ],
  casters: [],
  spells: [],
  weapons: [],
  unarmed: {
    name: 'Unarmed Strike',
    range: '5 ft',
    bonus: '+6 vs AC',
    damage: '1d6+4 bludgeoning',
    description: '',
  },
};

const row = (overrides) => ({
  id: 'row-1',
  kind: 'manual',
  name: 'Thrown Rock',
  range: '20 ft',
  bonus: '+0',
  damage: '1',
  description: '',
  ...overrides,
});

const NOTICE = 'You already have an Unarmed Strike attack.';

// Resolved as a path: under happy-dom the global URL is the DOM's, which does
// not resolve a relative path against this file's own URL.
const manageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../tabs/ManageTab.jsx'),
  'utf8',
);

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(attacks, onSave = vi.fn()) {
  act(() =>
    root.render(
      <AttackEditorModal
        open
        attack={null}
        attacks={attacks}
        options={OPTIONS}
        detail={null}
        busy={false}
        onClose={() => {}}
        onSave={onSave}
      />,
    ),
  );
  return onSave;
}

function chooseTab(label) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (candidate) => candidate.textContent === label,
  );
  act(() => tab.click());
}

const addButton = () =>
  [...container.querySelectorAll('button[type="submit"]')].find(
    (button) => button.textContent === 'Add Attack',
  );

describe('attack editor unarmed strike duplicate guard', () => {
  it('shows a notice and disables Add when an unarmed row exists', () => {
    const onSave = mount([row({ kind: 'unarmed', name: 'Unarmed Strike' })]);
    chooseTab('Unarmed strike');
    expect(container.textContent).toContain(NOTICE);
    expect(addButton().disabled).toBe(true);
    act(() => addButton().click());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('treats a row named Unarmed Strike as the existing unarmed row', () => {
    mount([row({ kind: 'manual', name: ' unarmed strike ' })]);
    chooseTab('Unarmed strike');
    expect(container.textContent).toContain(NOTICE);
    expect(addButton().disabled).toBe(true);
  });

  it('enables Add on the Unarmed tab when there is no unarmed row', () => {
    mount([row()]);
    chooseTab('Unarmed strike');
    expect(container.textContent).not.toContain(NOTICE);
    expect(addButton().disabled).toBe(false);
  });

  it('keeps the other tabs usable when an unarmed row exists', () => {
    mount([row({ kind: 'unarmed', name: 'Unarmed Strike' })]);
    chooseTab('Manual');
    expect(container.textContent).not.toContain(NOTICE);
    expect(addButton().disabled).toBe(false);
  });

  it('receives the character attack list from the attacks manager', () => {
    expect(manageSource).toMatch(
      /<AttackEditorModal[^>]*\sattacks=\{attacks\}/,
    );
  });
});

describe('attack editor mode tabs', () => {
  it('wraps the five mode tabs instead of squeezing them into one row', () => {
    mount([]);
    const tablist = container.querySelector('[role="tablist"]');
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Owned weapon',
      'Manual',
      'Calculated',
      'Known spell',
      'Unarmed strike',
    ]);
    // The shared sub-tab strip splits a phone row into equal slices, which
    // made "Manual" run into "Calculated"; this strip wraps whole labels.
    expect(tablist.classList.contains('flex-wrap')).toBe(true);
    expect(tablist.classList.contains('fcb-secondary-tabs')).toBe(false);
    for (const tab of tabs) {
      expect(tab.classList.contains('fcb-tab')).toBe(true);
      expect(tab.getAttribute('type')).toBe('button');
    }
    expect(
      tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });
});
