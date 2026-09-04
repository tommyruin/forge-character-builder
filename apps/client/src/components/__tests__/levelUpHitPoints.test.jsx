// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  averageHitPoints,
  buildHitPointIndex,
  HitPointRoll,
  HitPointRuleBadge,
  HitPointTotals,
} from '../LevelUpHitPoints';
import { assertProgressionResponse } from '../LevelUpFlyout';
import {
  commitHitPointDraft,
  parseHitPointDraft,
} from '../hitPointDraft';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// This file mounts a component to press its buttons, so it runs in happy-dom -
// whose URL resolves a relative path against a page origin rather than this
// file. Source pins therefore go through the real directory instead.
const readSource = (path) =>
  readFileSync(join(import.meta.dirname, path), 'utf8');

const fighter = {
  classId: 'ID_TEST_CLASS_FIGHTER',
  className: 'Fighter',
  level: 3,
  isMulticlass: false,
  hitDie: 'd10',
  hitPointValues: [10, 7, 5],
};

const barbarian = {
  classId: 'ID_TEST_MULTICLASS_BARBARIAN',
  className: 'Barbarian',
  level: 1,
  isMulticlass: true,
  hitDie: 'd12',
  hitPointValues: [12],
};

const historyFor = (classProgressions) => {
  let totalLevel = 0;
  return classProgressions.flatMap((classProgression) =>
    (classProgression.hitPointValues ?? []).map((_, position) => {
      totalLevel += 1;
      return {
        totalLevel,
        classId: classProgression.classId,
        className: classProgression.className,
        classLevel: position + 1,
        isClassStart: position === 0,
        isPending: false,
      };
    }),
  );
};

// Mirrors how the flyout composes the section: one list, the rule badge and
// totals above it, and each level's roll rendered inside its own row.
const renderHistory = (classProgressions, usesAverageHitPoints = false) => {
  const hitPoints = buildHitPointIndex(classProgressions);
  return renderToStaticMarkup(
    <section>
      <h4>Level History</h4>
      <HitPointRuleBadge usesAverageHitPoints={usesAverageHitPoints} />
      <HitPointTotals classProgressions={classProgressions} />
      <ol data-testid="hit-point-history">
        {historyFor(classProgressions).map((entry) => (
          <li key={entry.totalLevel}>
            <span>{entry.className}</span>
            <span>{`${entry.className} level ${entry.classLevel}`}</span>
            <HitPointRoll
              entry={entry}
              hitPoints={hitPoints}
              usesAverageHitPoints={usesAverageHitPoints}
              busy={false}
              onSave={vi.fn()}
            />
          </li>
        ))}
      </ol>
    </section>,
  );
};

const progressionAfterLaterEdit = {
  canLevelUp: true,
  canLevelDown: true,
  hasMainClass: true,
  canMulticlass: false,
  hasMulticlass: false,
  multiclassRuleEnabled: true,
  usesAverageHitPoints: false,
  canUndoDelevel: false,
  levelHistory: [],
  classes: [
    {
      ...fighter,
      hitPointValues: [10, 9, 5],
    },
  ],
};

describe('LevelUpHitPoints', () => {
  it('indexes every editable roll by class and class level', () => {
    const index = buildHitPointIndex([fighter, barbarian]);

    expect(index.size).toBe(4);
    expect(index.get(`${fighter.classId}:2`)).toMatchObject({
      classLevel: 2,
      value: 7,
      maximum: 10,
      fixedFirstLevel: false,
    });
    // The main class's first level is fixed at the die maximum; a multiclass
    // rolls for its own first level.
    expect(index.get(`${fighter.classId}:1`).fixedFirstLevel).toBe(true);
    expect(index.get(`${barbarian.classId}:1`).fixedFirstLevel).toBe(false);
  });

  it('skips classes the engine gives no rollable hit die', () => {
    const index = buildHitPointIndex([
      { ...fighter, hitDie: '', hitPointValues: [10] },
      { ...barbarian, hitPointValues: [] },
    ]);

    expect(index.size).toBe(0);
  });

  it('puts each class level roll in its own history row', () => {
    const markup = renderHistory([fighter, barbarian]);

    expect(markup).toContain('Level History');
    expect(markup.match(/>Rolled</g)).toHaveLength(1);
    expect(
      markup.match(/Values shown before the Constitution modifier/g),
    ).toHaveLength(1);
    // Four class levels, so four rolls - and no separate Hit Points panel.
    expect(markup.match(/<input/g)).toHaveLength(4);
    expect(markup).not.toContain('Hit Points');
    expect(markup).toContain('aria-label="Fighter level 1 hit points"');
    expect(markup).toMatch(
      /aria-label="Fighter level 1 hit points"[^>]*disabled=""/,
    );
    expect(markup).toContain('data-fixed="true"');
    expect(markup).toContain(
      'aria-label="Fighter level 2 hit points" min="1" max="10"',
    );
    expect(markup).toContain('value="7"');
    expect(markup).toContain('value="5"');
    // The row states the class level, so the tile no longer repeats it.
    expect(markup).not.toContain('Lv 2');
  });

  it('keeps the per-class die and total without repeating the class list', () => {
    const markup = renderHistory([fighter, barbarian]);

    expect(markup).toContain('d10');
    expect(markup).toContain('Total 22');
    expect(markup).toContain('Total 12');
    expect(markup).not.toContain('Rolled hit points');
    expect(markup).not.toContain('(multiclass)');
    // The old panel repeated a "Level 3" class header above the roll grid.
    expect(markup).not.toContain('>Level 3<');
  });

  it('keeps two-digit die results readable in narrow roll tiles', () => {
    const markup = renderHistory([fighter, barbarian]);
    const css = readSource('../../index.css');

    expect(markup).toContain('fcb-hp-roll-input');
    expect(markup).toContain('fcb-level-hp');
    expect(css).toContain(
      '.fcb-hp-roll-input::-webkit-inner-spin-button',
    );
    expect(css).toContain('appearance: none');
    // The tile sizes itself; it is not a grid cell.
    expect(css).toContain('.fcb-level-hp {');
    expect(css).toContain('.fcb-level-hp .fcb-hp-roll-input {');
    // A fixed roll must stay readable rather than fading out.
    expect(css).toContain('.fcb-level-hp .fcb-hp-roll-input:disabled {');
  });

  it('labels the value outside the field and offers a nudge either side', () => {
    const markup = renderHistory([fighter, barbarian]);

    // The tag is decoration - the input already carries the accessible name.
    expect(markup).toContain('fcb-level-hp__tag');
    expect(markup).toMatch(/fcb-level-hp__tag[^>]*aria-hidden="true"/);
    // Three editable rolls, so three pairs of nudges.
    expect(markup.match(/fcb-level-hp__nudge/g)).toHaveLength(6);
    expect(markup).toContain(
      'aria-label="Decrease Fighter level 2 hit points"',
    );
    expect(markup).toContain(
      'aria-label="Increase Fighter level 2 hit points"',
    );
    // A roll already at the top of its die cannot be nudged up.
    expect(markup).toMatch(
      /aria-label="Increase Barbarian level 1 hit points"[^>]*disabled=""/,
    );
  });

  it('gives the nudges a touch-sized target', () => {
    const css = readSource('../../index.css');
    const coarse = css.slice(css.indexOf('.fcb-level-hp__nudge {'));

    expect(coarse).toContain('@media (pointer: coarse)');
    expect(coarse).toMatch(
      /@media \(pointer: coarse\) \{\s*\.fcb-level-hp__nudge \{\s*width: 2\.25rem;\s*height: 2\.5rem;/,
    );
  });

  it('leaves a fixed roll without nudges to press', () => {
    const markup = renderHistory(
      [{ ...fighter, hitPointValues: [10, 6, 6] }],
      true,
    );

    expect(markup).not.toContain('fcb-level-hp__nudge');
    expect(markup).toContain('fcb-level-hp__tag');
  });

  it('shows fixed averages and disables every value when the option is enabled', () => {
    const markup = renderHistory(
      [{ ...fighter, hitPointValues: [10, 6, 6] }],
      true,
    );

    expect(markup.match(/Average rule/g)).toHaveLength(1);
    expect(markup).toContain('Manage / Optional rules');
    expect(markup).not.toContain('Average hit points');
    expect(markup.match(/ disabled=""/g)).toHaveLength(3);
    expect(markup.match(/value="6"/g)).toHaveLength(2);
  });

  it('allows a multiclass first-level roll to be edited', () => {
    const markup = renderHistory([
      {
        classId: 'ID_TEST_MULTICLASS_WIZARD',
        className: 'Wizard',
        level: 1,
        isMulticlass: true,
        hitDie: 'd6',
        hitPointValues: [4],
      },
    ]);

    expect(markup).toContain(
      'aria-label="Wizard level 1 hit points" min="1" max="6"',
    );
    expect(markup).not.toContain(
      'aria-label="Wizard level 1 hit points" disabled=""',
    );
  });

  it('reads the average as half the die rounded up', () => {
    expect(averageHitPoints('d6')).toBe(4);
    expect(averageHitPoints('d8')).toBe(5);
    expect(averageHitPoints('d10')).toBe(6);
    expect(averageHitPoints('d12')).toBe(7);
    // No die, no average to offer.
    expect(averageHitPoints('')).toBe(0);
    expect(averageHitPoints(undefined)).toBe(0);
  });

  it('offers the average on every editable roll that is not already on it', () => {
    const markup = renderHistory([fighter, barbarian]);

    // Fighter 2 (7), Fighter 3 (5) and Barbarian 1 (12) are all off their
    // average; the fixed Fighter 1 is not editable at all.
    expect(markup.match(/fcb-level-hp__average/g)).toHaveLength(3);
    expect(markup).toContain(
      'aria-label="Use average 6 for Fighter level 2 hit points"',
    );
    expect(markup).toContain(
      'aria-label="Use average 7 for Barbarian level 1 hit points"',
    );
    expect(markup).not.toContain('for Fighter level 1 hit points"');
  });

  it('drops the average button on a roll that already holds its average', () => {
    const markup = renderHistory([{ ...fighter, hitPointValues: [10, 6, 5] }]);

    expect(markup.match(/fcb-level-hp__average/g)).toHaveLength(1);
    expect(markup).not.toContain(
      'aria-label="Use average 6 for Fighter level 2 hit points"',
    );
    expect(markup).toContain(
      'aria-label="Use average 6 for Fighter level 3 hit points"',
    );
  });

  it('hides the average button when the Average Hit Points rule fixes the values', () => {
    const markup = renderHistory([{ ...fighter, hitPointValues: [10, 6, 5] }], true);

    expect(markup).not.toContain('fcb-level-hp__average');
  });

  it('saves the class average when a row average button is pressed', async () => {
    const onSave = vi.fn(async () => true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const hitPoints = buildHitPointIndex([fighter]);

    await act(async () => {
      root.render(
        <HitPointRoll
          entry={{
            totalLevel: 3,
            classId: fighter.classId,
            className: 'Fighter',
            classLevel: 3,
            isClassStart: false,
            isPending: false,
          }}
          hitPoints={hitPoints}
          usesAverageHitPoints={false}
          busy={false}
          onSave={onSave}
        />,
      );
    });

    const button = container.querySelector('.fcb-level-hp__average');
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });

    expect(onSave).toHaveBeenCalledWith(fighter.classId, 3, 6);
    expect(container.querySelector('.fcb-hp-roll-input').value).toBe('6');

    await act(async () => root.unmount());
    container.remove();
  });

  // The bulk "use average for all" action is gone: the per-row Avg button
  // above covers a single level, and Manage / Optional rules > Average Hit
  // Points is the permanent setting.
  it('keeps the average action per row rather than in the flyout', () => {
    const flyout = readSource('../LevelUpFlyout.jsx');

    expect(flyout).not.toContain('Use average for all');
    expect(flyout).not.toContain('averageHitPoints');
  });

  it('leaves a level with no resolved class without a roll', () => {
    const hitPoints = buildHitPointIndex([fighter]);
    const markup = renderToStaticMarkup(
      <HitPointRoll
        entry={{
          totalLevel: 4,
          classId: null,
          className: 'Unresolved',
          classLevel: null,
          isPending: true,
        }}
        hitPoints={hitPoints}
        usesAverageHitPoints={false}
        busy={false}
        onSave={vi.fn()}
      />,
    );

    expect(markup).toBe('');
  });

  it('accepts only whole die results within the class hit die', () => {
    expect(parseHitPointDraft('7', 10)).toEqual({ value: 7 });
    expect(parseHitPointDraft('', 10)).toEqual({
      error: 'Enter a whole number from 1 to 10.',
    });
    expect(parseHitPointDraft('2.5', 10)).toEqual({
      error: 'Enter a whole number from 1 to 10.',
    });
    expect(parseHitPointDraft('0', 10)).toEqual({
      error: 'Enter a whole number from 1 to 10.',
    });
    expect(parseHitPointDraft('11', 10)).toEqual({
      error: 'Enter a whole number from 1 to 10.',
    });
  });

  it('clears stale validation feedback after the saved value is restored', async () => {
    const setDraft = vi.fn();
    const onSave = vi.fn();
    const onValidationError = vi.fn();
    const common = {
      maximum: 10,
      savedValue: 7,
      classId: 'ID_TEST_CLASS_FIGHTER',
      classLevel: 2,
      setDraft,
      onSave,
      onValidationError,
    };

    await commitHitPointDraft({ ...common, draft: '11' });
    expect(setDraft).toHaveBeenLastCalledWith('7');
    expect(onValidationError).toHaveBeenLastCalledWith(
      'Enter a whole number from 1 to 10.',
    );

    await commitHitPointDraft({ ...common, draft: '7' });
    expect(onValidationError).toHaveBeenLastCalledWith(null);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rerenders the real hit-point surface from the frozen progression response after a later edit', async () => {
    const setDraft = vi.fn();
    const onValidationError = vi.fn();
    const onSave = vi.fn(async () =>
      assertProgressionResponse(progressionAfterLaterEdit),
    );

    const saved = await commitHitPointDraft({
      draft: '9',
      maximum: 10,
      savedValue: 7,
      classId: fighter.classId,
      classLevel: 2,
      setDraft,
      onSave,
      onValidationError,
    });

    expect(saved).toBe(true);
    expect(onSave).toHaveBeenCalledWith(fighter.classId, 2, 9);
    const markup = renderHistory(progressionAfterLaterEdit.classes);
    expect(markup).toContain('value="9"');
    expect(markup).not.toContain('undefined');
  });

  it('surfaces a stale detail response instead of treating it as progression', () => {
    expect(() => assertProgressionResponse({ id: 'Ada', level: 3 })).toThrow(
      'setHitPointRoll must return a progression payload',
    );
  });

  it('wires hit-point edits through the shared character mutation flow', () => {
    const flyout = readSource('../LevelUpFlyout.jsx');
    const transport = readSource('../../transport/engineTransport.ts');

    expect(flyout).toContain('<HitPointRoll');
    expect(flyout).toContain('api.characters.setHitPointRoll');
    expect(transport).toContain('setHitPointRoll:');
    expect(transport).toContain('"setHitPointRoll"');

    // The rolls live inside the Level History list now, not in a panel of
    // their own below it.
    expect(flyout).not.toContain('<LevelUpHitPoints');
    const levelUpActions = flyout.indexOf('>Level Up</h4>');
    const levelHistory = flyout.indexOf('>Level History</h4>');
    const rollInRow = flyout.indexOf('<HitPointRoll');
    const lowerLevel = flyout.indexOf('>Lower Level</h4>');
    expect(levelUpActions).toBeGreaterThan(-1);
    expect(levelHistory).toBeGreaterThan(levelUpActions);
    expect(rollInRow).toBeGreaterThan(levelHistory);
    expect(rollInRow).toBeLessThan(lowerLevel);
    expect(flyout).toContain('toLocaleString()');
  });
});
