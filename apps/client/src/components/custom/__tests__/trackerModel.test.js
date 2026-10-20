import { describe, expect, it } from 'vitest';
import { compileCustomElement, createCustomDraft, customDraftIssues } from '@forge-cb/engine/custom';
import { sheetPreview, summarizeDraft } from '../draftModel';
import {
  describeMax,
  describeScale,
  describeTracker,
  makeScale,
  makeTracker,
  scaleToken,
  switchNamesIn,
  trackerFromUsage,
  trackerPreviewText,
} from '../trackerModel';

describe('trackers in words', () => {
  it('reads a literal maximum as the usage line', () => {
    const tracker = makeTracker({ label: 'Moonbeam', max: { kind: 'number', value: 2 }, recharge: 'shortRest' });
    expect(trackerPreviewText(tracker)).toBe('2/Short Rest');
    expect(describeTracker(tracker)).toBe('Moonbeam: 2/Short Rest');
  });

  it('describes a maximum that follows the character without showing a token', () => {
    const tracker = makeTracker({ label: 'Studied', max: { kind: 'reference', ref: 'wisdom:modifier', min: 1 } });
    expect(describeMax(tracker.max)).toBe('your wisdom modifier (at least 1)');
    expect(trackerPreviewText(tracker)).toBe('your wisdom modifier (at least 1)/Long Rest');
    expect(trackerPreviewText(tracker)).not.toContain('{{');
  });

  it('names the pool and the switch that spends a use', () => {
    const tracker = makeTracker({ label: 'Form', pool: 'Moon points', spendOnSwitch: 'Moonlit Form', unit: 'points' });
    expect(describeTracker(tracker)).toBe('Form: 1 point/Long Rest, shared pool "Moon points"; turning on Moonlit Form spends one');
  });

  it('names the scale value a maximum follows', () => {
    const scale = makeScale({ id: 's1', name: 'Gaze count', kind: 'number', steps: [{ level: 1, value: 1 }, { level: 5, value: 3 }] });
    expect(describeMax({ kind: 'scale', scale: 's1' }, [scale])).toBe('Gaze count');
    expect(describeScale(scale)).toBe('Gaze count: 1 from level 1, 3 from level 5');
    expect(scaleToken(scale)).toBe('{{scale:gaze count}}');
  });
});

describe('the summary and the sheet preview', () => {
  const draft = {
    ...createCustomDraft('boon', 'Moonlight'),
    scales: [makeScale({ id: 's1', name: 'Gaze count', kind: 'number', steps: [{ level: 1, value: 1 }] })],
    trackers: [makeTracker({ id: 't1', label: 'Gaze', max: { kind: 'scale', scale: 's1' }, recharge: 'shortRest' })],
    blocks: [{ kind: 'modifier', id: 'm1', target: 'ac:misc', mode: 'add', value: { kind: 'scale', scale: 's1' } }],
  };

  it('lists the scale value, the tracker and a bonus that follows the scale', () => {
    expect(summarizeDraft(draft)).toEqual([
      'Armor class bonus + Gaze count',
      'Gaze count: 1 from level 1',
      'Uses per rest — Gaze: Gaze count/Short Rest',
    ]);
  });

  it('previews the usage line from the trackers, in words', () => {
    expect(sheetPreview(draft).meta).toEqual(['Gaze count/Short Rest']);
    expect(customDraftIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('usage="{{uses:t1}}/Short Rest"');
  });
});

describe('older entries and switches', () => {
  it('turns an older usage line into a tracker', () => {
    expect(trackerFromUsage({ count: 2, recharge: 'Dawn' }, 'Gift')).toMatchObject({
      label: 'Gift', max: { kind: 'number', value: 2 }, recharge: 'dawn', unit: 'uses',
    });
    expect(trackerFromUsage(null, 'Gift')).toBeNull();
  });

  it('collects each switch name once, as first written', () => {
    const modifier = (name) => ({ kind: 'modifier', id: name, gates: { switch: name } });
    expect(
      switchNamesIn([
        { draft: { blocks: [modifier('Moonlit Form'), modifier('moonlit form')] } },
        { draft: { blocks: [modifier('Rage'), { kind: 'grant', id: 'g' }] } },
        { draft: { template: 'spell' } },
      ]),
    ).toEqual(['Moonlit Form', 'Rage']);
  });
});
