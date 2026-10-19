// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import SpellSource from '../SpellSource';
import { $, mount } from '../../../custom/__tests__/harness';

const spell = { name: 'Ember Spark', source: 'Test Pack' };

describe('the spell list Source column', () => {
  it('names the custom feature that granted a spell, and marks it Custom', async () => {
    await mount(
      <SpellSource spell={{ ...spell, grantedBy: { elementId: 'ID_CUSTOM_X', name: 'Ember Boon', isCustom: true } }} />,
    );
    expect(document.body.textContent).toContain('Ember Boon');
    expect(document.body.textContent).not.toContain('Test Pack');
    expect($('.fcb-custom-badge').textContent).toBe('Custom');
    expect($('span[title]').getAttribute('title')).toContain('Spell source: Test Pack');
  });

  it('names a book feature without the badge', async () => {
    await mount(<SpellSource spell={{ ...spell, grantedBy: { elementId: 'ID_X', name: 'Magic Initiate', isCustom: false } }} />);
    expect(document.body.textContent).toContain('Magic Initiate');
    expect($('.fcb-custom-badge')).toBeNull();
  });

  it('keeps the spell\'s own book for a spell no feature granted', async () => {
    await mount(<div><SpellSource spell={spell} /></div>);
    expect(document.body.textContent).toBe('Test Pack');
  });
});
