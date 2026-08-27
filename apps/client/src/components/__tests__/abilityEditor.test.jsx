import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AbilityEditor, { modeFromGenerationOption } from '../AbilityEditor.jsx';

const NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
const ABBREVIATIONS = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];

function abilitiesFixture(scores = [15, 14, 13, 12, 10, 8]) {
  return NAMES.map((name, index) => ({
    name,
    abbreviation: ABBREVIATIONS[index],
    baseScore: scores[index],
    additionalScore: 0,
    finalScore: scores[index],
    modifier: 0,
    additionalSummary: '',
    bonusSources: [],
  }));
}

function render(props) {
  return renderToStaticMarkup(
    createElement(AbilityEditor, {
      abilities: abilitiesFixture(),
      disabled: false,
      onSave: () => {},
      ...props,
    }),
  );
}

function activeMode(markup) {
  const match = /fcb-mode-button is-active[^>]*>([^<]+)</.exec(markup);
  return match ? match[1] : null;
}

describe('ability editor generation method persistence', () => {
  it('maps the stored generation option onto the editor modes', () => {
    // The <generationOption> enum: 0 Roll3D6, 1 Roll4D6DiscardLowest, 2 Array, 3 Points.
    expect(modeFromGenerationOption(3)).toBe('pointBuy');
    expect(modeFromGenerationOption(1)).toBe('bestOfRolls');
    expect(modeFromGenerationOption(2)).toBe('custom');
    expect(modeFromGenerationOption(0)).toBe('custom');
    expect(modeFromGenerationOption(undefined)).toBe('custom');
  });

  it('opens on Point Buy when the character stored generation option 3', () => {
    const markup = render({ generationOption: 3 });
    expect(activeMode(markup)).toBe('Point Buy');
    expect(markup).toContain('Points remaining');
  });

  it('opens on Best of Rolls with the saved scores still visible', () => {
    const markup = render({ generationOption: 1 });
    expect(activeMode(markup)).toBe('Best of Rolls');
    // The saved scores render read-only until new rolls are generated.
    expect(markup).toContain('Strength saved score');
    expect(markup).toContain('Generate scores to assign them.');
  });

  it('opens on Custom for fresh or manually entered characters', () => {
    const markup = render({ generationOption: 2 });
    expect(activeMode(markup)).toBe('Custom');
  });

  it('seeds Point Buy from the stored scores instead of resetting to 8s', () => {
    const markup = render({ generationOption: 3 });
    // 15/14/13/12/10/8 costs 9+7+5+4+2+0 = 27 of the 27-point budget.
    expect(markup).toMatch(/Points remaining<\/span><strong[^>]*>0</);
    expect(markup).not.toContain('is-warning');
  });
});

describe('ability editor with imported point-buy scores', () => {
  // An imported point-buy character: 16s cost 11 each on the extended curve,
  // so 0+5+11+0+11+0 spends the whole 27-point budget.
  const imported = { abilities: abilitiesFixture([8, 13, 16, 8, 16, 8]), generationOption: 3 };

  it('prices scores above 15 on the extended curve instead of flagging them', () => {
    const markup = render(imported);
    expect(activeMode(markup)).toBe('Point Buy');
    expect(markup).toMatch(/Points remaining<\/span><strong[^>]*>0</);
    expect(markup).toContain('fcb-ability-cost">11<');
    expect(markup).not.toContain('fcb-ability-cost">!<');
    expect(markup).not.toContain('is-warning');
    expect(markup).not.toContain('must stay between 8 and 15');
  });

  // React's static renderer keeps the camel-cased attribute name.
  const constitutionInput = (markup) =>
    (/<input[^>]*aria-label="Constitution base score"[^>]*>/i.exec(markup)?.[0] ?? '').toLowerCase();

  it('explains that the scores must be edited in Custom mode', () => {
    const markup = render(imported);
    expect(markup).toContain('switch to Custom to change them');
    expect(constitutionInput(markup)).toContain('readonly');
  });

  it('keeps the standard 8-15 editing rule for scores bought here', () => {
    const markup = render({ generationOption: 3 });
    expect(markup).not.toContain('switch to Custom to change them');
    expect(constitutionInput(markup)).not.toContain('readonly');
  });
});
