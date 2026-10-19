// The custom-content entry point is importable from client code: the form
// catalogue, validation and the compiler need no worker and no Node modules.
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODIFIER_TARGETS,
  compileCustomElement,
  createCustomDraft,
  customDraftIssues,
} from '@forge-cb/engine/custom';

describe('@forge-cb/engine/custom', () => {
  it('offers the target catalogue and compiles a draft to an element', () => {
    expect(CUSTOM_MODIFIER_TARGETS.some((target) => target.id === 'strength')).toBe(true);
    const draft = createCustomDraft('boon', 'Ember Ward');
    draft.blocks = [{ kind: 'modifier', id: 'm1', target: 'strength', mode: 'add', value: { kind: 'number', value: 1 } }];
    expect(customDraftIssues(draft)).toEqual([]);
    expect(compileCustomElement(draft)).toContain('<stat name="strength" value="1" />');
  });

  it('names the field of a draft that cannot compile', () => {
    expect(customDraftIssues({ ...createCustomDraft('boon', ''), name: '' }).map((issue) => issue.path)).toEqual(['name']);
  });
});
