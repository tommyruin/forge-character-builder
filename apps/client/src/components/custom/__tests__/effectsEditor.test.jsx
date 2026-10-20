// @vitest-environment happy-dom
// The "What it does" editor on its own: the "Only while active" switch reaches spell grants as well
// as bonuses, and an editor handed a different entry starts with that entry's switch, not the last
// one's.
import { act, useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { compileCustomElement, createCustomDraft, customDraftIssues } from '@forge-cb/engine/custom';
import EffectsEditor from '../EffectsEditor';
import { sheetPreview, summarizeDraft } from '../draftModel';
import { switchNamesIn } from '../trackerModel';
import { buttonByText, clickEffect, byLabel, click, group, mount, settle, type } from './harness';

const services = {
  lookup: async () => ({ items: [] }),
  casters: async () => ['Wizard'],
  list: async () => ({ entries: [] }),
  defaultCastAbility: async () => 'intelligence',
};

const spellGrant = (extra = {}) => ({
  kind: 'grant',
  id: 'g1',
  target: { by: 'id', type: 'Spell', id: 'ID_TEST_SPELL_SHIELD', label: 'Shield' },
  spell: { prepared: true, caster: 'Wizard', castAbility: 'intelligence' },
  ...extra,
});

// Keeps the draft the editor edits, and exposes it to the test.
function Host({ first, second, onProbe }) {
  const [which, setWhich] = useState(0);
  const [drafts, setDrafts] = useState([first, second]);
  const draft = drafts[which];
  // The test reads the draft and switches entries through this object, set after the render.
  useEffect(() => {
    onProbe(drafts[which], setWhich);
  }, [onProbe, drafts, which]);
  return (
    <EffectsEditor
      draft={draft}
      setDraft={(updater) =>
        setDrafts((current) => current.map((entry, index) => (index === which ? (typeof updater === 'function' ? updater(entry) : updater) : entry)))
      }
      services={services}
    />
  );
}

// What the host reports after each render: the current draft and a way to show the other entry.
function probe() {
  const seen = {
    draft: () => null,
    show: () => {},
    onProbe: (draft, show) => {
      seen.draft = () => draft;
      seen.show = show;
    },
  };
  return seen;
}

const draftWith = (name, blocks, extra = {}) => ({ ...createCustomDraft('feature', name), id: `ID_CUSTOM_${name.replace(/\W/g, '').toUpperCase()}`, blocks, ...extra });

describe('the switch on a feature with no bonus', () => {
  it('gates a spell grant added after the switch is turned on', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    await clickEffect('+ Only while active');
    await click(buttonByText('+ Spell'));
    await settle();
    expect(seen.draft().blocks[0]).toMatchObject({ kind: 'grant', switch: 'Bladesong' });
  });

  it('puts a switch turned on after the spell onto that spell grant, and renames it with the row', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [spellGrant()])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    await clickEffect('+ Only while active');
    expect(seen.draft().blocks[0].switch).toBe('Bladesong');
    await type(byLabel('Switch name'), 'Song');
    expect(seen.draft().blocks[0].switch).toBe('Song');
    expect(group('Only while active')).not.toBeNull();
  });

  it('keeps the switch row open when a saved feature is reopened with only a gated grant', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [spellGrant({ switch: 'Song' })])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    expect(byLabel('Switch name').value).toBe('Song');
  });

  it('removing the switch row clears it from the grants', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [spellGrant({ switch: 'Song' })])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    await click(byLabel('Remove only while active'));
    expect(seen.draft().blocks[0].switch).toBeUndefined();
  });

  it('reads in the summary, validates, compiles into a condition and is listed among the switches', () => {
    const draft = draftWith('Bladesong', [spellGrant({ switch: 'Song' })]);
    expect(summarizeDraft(draft).join('\n')).toContain('only while Song is on');
    expect(customDraftIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('condition="Song"');
    expect(switchNamesIn([{ draft }])).toEqual(['Song']);
    expect(sheetPreview(draft).title).toBe('Bladesong');
  });
});

describe('moving to another entry', () => {
  it('does not carry the first entry\'s switch over', async () => {
    const seen = probe();
    const first = draftWith('Bladesong', [spellGrant({ switch: 'Song' })]);
    await mount(<Host first={first} second={draftWith('Plain', [])} onProbe={seen.onProbe} />);
    expect(byLabel('Switch name').value).toBe('Song');
    await click(buttonByText('+ Ability score'));
    await act0(() => seen.show(1));
    expect(byLabel('Switch name')).toBeNull();
    await click(buttonByText('+ Ability score'));
    expect(seen.draft().blocks[0].gates).toBeUndefined();
  });
});

async function act0(run) {
  await act(async () => run());
}

describe('the effect chips', () => {
  const chipNames = () => [...document.querySelectorAll('.fcb-effect-chip-add')].map((button) => button.textContent.trim());

  it('shows the common effects first and keeps the advanced ones behind More effects', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    expect(chipNames()).toEqual(['+ Ability score', '+ Spell', '+ Proficiency', '+ Language', '+ Player choice', '+ Uses per rest']);
    await click(buttonByText('More effects ▸'));
    expect(chipNames().slice(6)).toEqual(['+ Bonus to another stat', '+ Grows with level', '+ Only while active']);
  });

  it('explains each chip in an (i) tip: always the button description, shown on hover and focus', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    const tip = byLabel('About Player choice');
    // A screen reader hears the hint with the button, open or not.
    expect(document.getElementById(tip.getAttribute('aria-describedby')).textContent).toContain('pick 2 skills');
    expect(tip.hasAttribute('aria-expanded')).toBe(false);
    expect(document.querySelector('[data-testid="info-tip"]')).toBeNull();
    await act(async () => {
      tip.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      tip.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="info-tip"]').textContent).toContain('pick 2 skills');
    await act(async () => {
      tip.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="info-tip"]')).toBeNull();
  });

  it('keeps one tip open at a time, and closes it on a tap elsewhere or a scroll', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    const shown = () => [...document.querySelectorAll('[data-testid="info-tip"]')].map((node) => node.textContent);
    await click(byLabel('About Player choice'));
    await click(byLabel('About Language'));
    expect(shown()).toHaveLength(1);
    expect(shown()[0]).toContain('language');
    await act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
    expect(shown()).toHaveLength(0);
    await click(byLabel('About Language'));
    expect(shown()).toHaveLength(1);
    await act(async () => window.dispatchEvent(new window.Event('scroll')));
    expect(shown()).toHaveLength(0);
  });

});
