import { describe, expect, it } from 'vitest';
import { selectedElementLabel } from '../selectionRuleLabels';

describe('selection slot labels', () => {
  it('uses the persisted selected name when the current option list omits the selected id', () => {
    expect(
      selectedElementLabel({
        elementId: 'ID_RACE_VARIANT_HUMAN_VARIANT_CONSTITUTION',
        slotIndex: 1,
        options: [],
        selectedElementNames: [
          'Ability Score Increase (Wisdom)',
          'Ability Score Increase (Constitution)',
        ],
      })
    ).toBe('Ability Score Increase (Constitution)');
  });

  it('prefers a current option name and uses readable text as the final fallback', () => {
    expect(
      selectedElementLabel({
        elementId: 'ID_LANGUAGE_ABYSSAL',
        slotIndex: 0,
        options: [{ id: 'ID_LANGUAGE_ABYSSAL', name: 'Abyssal' }],
        selectedElementNames: ['Old Abyssal Label'],
      })
    ).toBe('Abyssal');

    expect(
      selectedElementLabel({
        elementId: 'ID_RACE_VARIANT_HUMAN_VARIANT_CONSTITUTION',
        slotIndex: 0,
        options: [],
        selectedElementNames: [],
      })
    ).toBe('Human Variant Constitution');
  });
});
