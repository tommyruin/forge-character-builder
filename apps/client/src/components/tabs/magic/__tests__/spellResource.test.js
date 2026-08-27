import { describe, expect, it } from 'vitest';
import { spellResourceDisplay } from '../spellResource';

describe('spellResourceDisplay', () => {
  it('renders slots positionally with the breakdown in the tooltip', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [4, 3, 3, 1, 0, 0, 0, 0, 0],
        resource: { mode: 'slots', canUseSpellPoints: true },
      }),
    ).toEqual({
      label: 'SLOTS',
      compactLabel: 'SL',
      value: '4·3·3·1',
      title: 'Spell slots — 1st ×4, 2nd ×3, 3rd ×3, 4th ×1',
    });
  });

  it('trims trailing empty levels down to a single count', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [2, 0, 0, 0, 0, 0, 0, 0, 0],
        resource: { mode: 'slots', canUseSpellPoints: true },
      }),
    ).toEqual({
      label: 'SLOTS',
      compactLabel: 'SL',
      value: '2',
      title: 'Spell slots — 1st ×2',
    });
  });

  it('marks skipped lower levels so position still means level (Pact Magic)', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [0, 0, 0, 0, 2, 0, 0, 0, 0],
        resource: { mode: 'slots', canUseSpellPoints: false },
      }),
    ).toEqual({
      label: 'SLOTS',
      compactLabel: 'SL',
      value: '–·–·–·–·2',
      title: 'Spell slots — 5th ×2',
    });
  });

  it('shows a dash with no slots at all', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [],
        resource: { mode: 'slots', canUseSpellPoints: true },
      }),
    ).toEqual({
      label: 'SLOTS',
      compactLabel: 'SL',
      value: '—',
      title: 'Spell slots',
    });
  });

  it('shows the enabled maximum instead of eligible slot counts', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [4, 3, 2, 0, 0, 0, 0, 0, 0],
        resource: {
          mode: 'spellPoints',
          maximumPoints: 27,
          shared: false,
        },
      }),
    ).toEqual({
      label: 'SPELL POINTS',
      compactLabel: 'SP',
      value: '27',
      title: 'Maximum spell points',
    });
  });

  it('labels a combined multiclass pool as shared', () => {
    expect(
      spellResourceDisplay({
        slotsPerLevel: [],
        resource: {
          mode: 'spellPoints',
          maximumPoints: 14,
          shared: true,
        },
      }),
    ).toEqual({
      label: 'SPELL POINTS',
      compactLabel: 'SP',
      value: '14 · shared',
      title: 'Shared spell point pool',
    });
  });
});
