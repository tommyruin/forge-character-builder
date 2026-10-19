// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import SpellAliasModal, { MAX_ALIAS_NAME, MAX_ALIAS_NOTE, aliasLines } from '../SpellAliasModal';
import { $, buttonByText, byLabel, click, mount, type } from './harness';

const barkskin = { id: 'ID_BARKSKIN', name: 'Barkskin', alias: undefined };

describe('the lines a renamed spell prints', () => {
  it('lead with the alias and keep the real name where there is room', () => {
    expect(aliasLines('Barkskin', 'Moonlit Ward')).toEqual([
      'Magic tab: Moonlit Ward (Barkskin)',
      'Spell list: Moonlit Ward',
      'Spell card and attack row: Moonlit Ward (Barkskin)',
    ]);
  });

  it('print the real name alone when there is no alias', () => {
    expect(aliasLines('Barkskin', '  ')).toEqual(['Magic tab: Barkskin', 'Spell list: Barkskin', 'Spell card and attack row: Barkskin']);
  });
});

describe('the spell rename dialog', () => {
  it('sends the trimmed name and note, and previews the lines as they are typed', async () => {
    const onSave = vi.fn();
    await mount(<SpellAliasModal spell={barkskin} onClose={() => {}} onSave={onSave} />);
    expect(buttonByText('Save').disabled).toBe(true);
    await type(byLabel('Display name'), '  Moonlit Ward ');
    await type(byLabel('Note'), 'Silver light, not bark.');
    expect($('[data-testid="spell-alias-preview"]').textContent).toContain('Spell list: Moonlit Ward');
    await click(buttonByText('Save'));
    expect(onSave).toHaveBeenCalledWith(barkskin, { name: 'Moonlit Ward', note: 'Silver light, not bark.' });
  });

  it('starts from the alias the spell already has, and clearing the name sends an empty one', async () => {
    const onSave = vi.fn();
    const named = { ...barkskin, alias: { name: 'Moonlit Ward', note: 'Old.' } };
    await mount(<SpellAliasModal spell={named} onClose={() => {}} onSave={onSave} />);
    expect(byLabel('Display name').value).toBe('Moonlit Ward');
    expect(byLabel('Note').value).toBe('Old.');
    await type(byLabel('Display name'), '');
    await click(buttonByText('Save'));
    expect(onSave).toHaveBeenCalledWith(named, { name: '', note: 'Old.' });
  });

  it('says what changes and what does not', async () => {
    await mount(<SpellAliasModal spell={barkskin} onClose={() => {}} onSave={vi.fn()} />);
    expect(document.body.textContent).toContain("The rules stay Barkskin's");
  });

  it('refuses a name or note the engine would refuse', async () => {
    await mount(<SpellAliasModal spell={barkskin} onClose={() => {}} onSave={vi.fn()} />);
    await type(byLabel('Display name'), 'x'.repeat(MAX_ALIAS_NAME + 1));
    expect(buttonByText('Save').disabled).toBe(true);
    expect(document.body.textContent).toContain(`at most ${MAX_ALIAS_NAME} characters`);
    await type(byLabel('Display name'), 'ok');
    await type(byLabel('Note'), 'y'.repeat(MAX_ALIAS_NOTE + 1));
    expect(buttonByText('Save').disabled).toBe(true);
  });
});
