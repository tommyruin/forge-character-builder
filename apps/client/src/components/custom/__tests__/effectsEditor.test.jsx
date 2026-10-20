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
import { buttonByText, byLabel, click, group, mount, settle, type } from './harness';

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
    await click(buttonByText('+ Only while active'));
    await click(buttonByText('+ Spell'));
    await settle();
    expect(seen.draft().blocks[0]).toMatchObject({ kind: 'grant', switch: 'Bladesong' });
  });

  it('puts a switch turned on after the spell onto that spell grant, and renames it with the row', async () => {
    const seen = probe();
    await mount(<Host first={draftWith('Bladesong', [spellGrant()])} second={draftWith('Other', [])} onProbe={seen.onProbe} />);
    await click(buttonByText('+ Only while active'));
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
