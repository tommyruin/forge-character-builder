import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SelectionRuleCard from '../SelectionRuleCard';
import { WorkspaceContext } from '../WorkspaceContext';

const baseRule = {
  identifier: 'test-rule',
  name: 'Test choice',
  type: 'Background',
  requiredLevel: 1,
  isOptional: false,
  selectionCount: 1,
  hasSelection: false,
  selectedElementIds: [null],
  selectedElementNames: [null],
  wasInvalidated: false,
};

function renderRule(
  overrides = {},
  pendingMigration = [],
  componentProps = {},
) {
  return renderToStaticMarkup(
    <WorkspaceContext.Provider value={{ pendingMigration }}>
      <SelectionRuleCard
        characterId="test-character"
        rule={{ ...baseRule, ...overrides }}
        disabled={false}
        onSelect={vi.fn()}
        onInspect={vi.fn()}
        sectionLabel="Background"
        {...componentProps}
      />
    </WorkspaceContext.Provider>,
  );
}

describe('SelectionRuleCard incomplete notifications', () => {
  it('does not show an incomplete badge for a blank optional choice', () => {
    const markup = renderRule({ isOptional: true });

    expect(markup).toContain('Optional');
    expect(markup).not.toContain('fcb-status-needed');
    expect(markup).not.toContain('>Choose<');
  });

  it('keeps a required no-options card visible without an incomplete badge', () => {
    const markup = renderRule({ hasAvailableOptions: false });

    expect(markup).toContain('Test choice');
    expect(markup).not.toContain('fcb-status-needed');
    expect(markup).not.toContain('>Choose<');
  });

  it('does not show incomplete progress for a partially filled optional multi-choice', () => {
    const markup = renderRule({
      isOptional: true,
      selectionCount: 2,
      hasSelection: true,
      selectedElementIds: ['ID_OPTION_ONE', null],
      selectedElementNames: ['Option one', null],
    });

    expect(markup).toContain('Optional');
    expect(markup).not.toContain('fcb-status-needed');
    expect(markup).not.toContain('1/2 selected');
  });

  it.each(['Personality Trait', 'Ideal', 'Bond', 'Flaw'])(
    'does not show an incomplete reminder for blank Other choice: %s',
    (name) => {
      const markup = renderRule(
        { name, type: name },
        [],
        { sectionKey: 'other', sectionLabel: 'Other' },
      );

      expect(markup).not.toContain('Optional');
      expect(markup).not.toContain('fcb-status-needed');
      expect(markup).not.toContain('>Choose<');
    },
  );

  it('keeps required incomplete reminders visible', () => {
    const markup = renderRule();

    expect(markup).toContain('fcb-status-needed');
    expect(markup).toContain('>Choose<');
  });

  it('keeps a required reminder outside the Other section', () => {
    const markup = renderRule(
      { name: 'Personality Trait', type: 'Personality Trait' },
      [],
      { sectionKey: 'background', sectionLabel: 'Background' },
    );

    expect(markup).toContain('fcb-status-needed');
    expect(markup).toContain('>Choose<');
  });

  it('keeps completion feedback for a fully filled optional choice', () => {
    const markup = renderRule({
      isOptional: true,
      hasSelection: true,
      selectedElementIds: ['ID_OPTION_ONE'],
      selectedElementNames: ['Option one'],
    });

    expect(markup).toContain('fcb-status-complete');
    expect(markup).toContain('aria-label="Selected"');
  });

  it('exposes a clear action for a filled single-pick rule', () => {
    const markup = renderRule(
      {
        hasSelection: true,
        selectedElementIds: ['ID_OPTION_ONE'],
        selectedElementNames: ['Option one'],
      },
      [],
      { onClear: vi.fn() },
    );

    // Icon-only: the label lives on title/aria-label, not in the button text.
    expect(markup).toContain('title="Clear Test choice"');
    expect(markup).toContain('aria-label="Clear Test choice"');
    expect(markup).toContain('class="fcb-icon fcb-icon-sm"');
  });

  it('drops the Choose one placeholder once the choice is made', () => {
    // The rail already names this section, so the card's title is the
    // instruction "Choose one". Answering it makes the instruction stale —
    // the picked name is the label from then on.
    const placeholder = { name: 'Race', type: 'Race' };
    const unanswered = renderRule(placeholder, [], {
      sectionLabel: 'Race',
      showRuleType: false,
    });
    expect(unanswered).toContain('>Choose one<');

    const answered = renderRule(
      {
        ...placeholder,
        hasSelection: true,
        selectedElementIds: ['bard'],
        selectedElementNames: ['Bard'],
      },
      [],
      { sectionLabel: 'Race', showRuleType: false, onClear: vi.fn() },
    );
    expect(answered).not.toContain('>Choose one<');
    expect(answered).toContain('Bard');
    // The clear control is icon-only, so its accessible name is the only text
    // naming what it clears: it has to name the pick, not the instruction.
    expect(answered).toContain('aria-label="Clear Bard"');
  });

  it('keeps a real rule name after the choice is made', () => {
    const markup = renderRule({
      hasSelection: true,
      selectedElementIds: ['acolyte'],
      selectedElementNames: ['Acolyte'],
    });

    expect(markup).toContain('Test choice');
    expect(markup).toContain('Acolyte');
  });

  it('keeps repair warnings for invalidated optional saved choices', () => {
    const markup = renderRule({
      isOptional: true,
      wasInvalidated: true,
      previousElementName: 'Old option',
    });

    expect(markup).toContain('data-testid="repick-badge"');
    expect(markup).toContain('Re-pick needed');
  });
});
