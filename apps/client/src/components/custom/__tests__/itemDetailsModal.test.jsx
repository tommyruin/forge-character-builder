// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import ItemDetailsModal, { MAX_ITEM_NAME, sheetLines } from '../ItemDetailsModal';
import { $, buttonByText, byLabel, click, mount, type } from './harness';

const scimitar = {
  identifier: 'rec-1',
  type: 'Weapon',
  name: 'Scimitar',
  defaultName: 'Scimitar',
  customName: '',
  notes: '',
  amount: 1,
};

describe('sheet lines', () => {
  it('print the attack row under the new name, and the item\'s own name beside it on the equipment line', () => {
    expect(sheetLines(scimitar, "Grandfather's Blade")).toEqual([
      "Attacks: Grandfather's Blade",
      "Equipment: Grandfather's Blade (Scimitar)",
    ]);
  });

  it('read as the item\'s own name when the custom name is empty, and count a stack', () => {
    expect(sheetLines({ ...scimitar, type: 'Item', defaultName: 'Rope', amount: 2 }, '  ')).toEqual(['Equipment: Rope x2']);
  });
});

describe('the rename and notes dialog', () => {
  it('sends the trimmed name and notes, and previews the sheet as they are typed', async () => {
    const onSave = vi.fn();
    await mount(<ItemDetailsModal item={scimitar} onClose={() => {}} onSave={onSave} />);
    expect(buttonByText('Save changes').disabled).toBe(true);
    await type(byLabel('Name'), "  Grandfather's Blade ");
    await type(byLabel('Notes'), 'Hilt wrapped in green leather.');
    expect($('[data-testid="item-sheet-preview"]').textContent).toContain("Equipment: Grandfather's Blade (Scimitar)");
    await click(buttonByText('Save changes'));
    expect(onSave).toHaveBeenCalledWith(scimitar, { name: "Grandfather's Blade", notes: 'Hilt wrapped in green leather.' });
  });

  it('starts from what the record already has, and clearing the name sends an empty one', async () => {
    const onSave = vi.fn();
    const named = { ...scimitar, name: 'Blade', customName: 'Blade', notes: 'Old.' };
    await mount(<ItemDetailsModal item={named} onClose={() => {}} onSave={onSave} />);
    expect(byLabel('Name').value).toBe('Blade');
    expect(byLabel('Notes').value).toBe('Old.');
    await type(byLabel('Name'), '');
    await click(buttonByText('Save changes'));
    expect(onSave).toHaveBeenCalledWith(named, { name: '', notes: 'Old.' });
  });

  it('refuses a name the engine would refuse', async () => {
    await mount(<ItemDetailsModal item={scimitar} onClose={() => {}} onSave={vi.fn()} />);
    await type(byLabel('Name'), 'x'.repeat(MAX_ITEM_NAME + 1));
    expect(buttonByText('Save changes').disabled).toBe(true);
    expect(document.body.textContent).toContain(`at most ${MAX_ITEM_NAME} characters`);
  });

  it('is one dialog for the name and the notes', async () => {
    await mount(<ItemDetailsModal item={scimitar} onClose={() => {}} onSave={vi.fn()} />);
    expect($('[role="dialog"]').getAttribute('aria-label')).toBe('Rename or add notes to Scimitar');
    expect(document.body.textContent).toContain('Rules unchanged: it still works as Scimitar.');
  });
});
