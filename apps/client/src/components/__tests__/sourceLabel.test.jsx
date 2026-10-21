// @vitest-environment happy-dom
// "Internal" is the content's name for rules the builder ships for its own bookkeeping. It is not a
// book, so no list a user reads shows it as a source.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import LibraryPicker from '../custom/LibraryPicker';
import { sourceLabel } from '../sourceLabel';
import { mount, settle, type } from '../custom/__tests__/harness';

const root = ['src/components', 'apps/client/src/components'].map((path) => resolve(process.cwd(), path)).find(existsSync);
const read = (file) => readFileSync(resolve(root, file), 'utf8');

describe('source labels', () => {
  it('shows a book source and hides an internal one', () => {
    expect(sourceLabel('Test Book')).toBe('Test Book');
    expect(sourceLabel('Internal')).toBe('');
    expect(sourceLabel(' internal ')).toBe('');
    expect(sourceLabel('Internal', 'Built in')).toBe('Built in');
    expect(sourceLabel(undefined)).toBe('');
  });

  it('leaves Internal out of a library search', async () => {
    const lookup = {
      search: vi.fn(async () => [{ id: 'ID_INTERNAL_SKILL_EXPERTISE_ARCANA', name: 'Skill Expertise (Arcana)', source: 'Internal' }]),
      name: vi.fn(async () => undefined),
      debounceMs: 0,
    };
    await mount(<LibraryPicker lookup={lookup} type="Proficiency" value="" label="Find a proficiency" onPick={() => {}} />);
    await type(document.querySelector('input'), 'arcana');
    await settle();
    await settle();
    const option = document.querySelector('[role="option"]');
    expect(option.textContent).toContain('Skill Expertise (Arcana)');
    expect(option.textContent).not.toContain('Internal');
  });

  it('is used by every list that prints a source', () => {
    for (const file of [
      'custom/LibraryPicker.jsx',
      'SelectionRuleCard.jsx',
      'ContentManager.jsx',
      'ContentRenderer.jsx',
      'custom/BasePicker.jsx',
      'tabs/feats/AddFeatModal.jsx',
      'tabs/magic/SpellBrowser.jsx',
      'tabs/magic/AddSpellModal.jsx',
      'tabs/magic/SpellSource.jsx',
      'tabs/manage/OptionalRulesPanel.jsx',
      'tabs/manage/AdditionalFeaturesPanel.jsx',
      'tabs/EquipmentTab.jsx',
      'tabs/CompanionSection.jsx',
    ]) {
      expect(read(file), file).toContain('sourceLabel');
    }
  });
});
