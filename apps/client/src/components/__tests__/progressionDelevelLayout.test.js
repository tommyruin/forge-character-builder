import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const flyout = readFileSync(
  new URL('../LevelUpFlyout.jsx', import.meta.url),
  'utf8',
);
const hitPoints = readFileSync(
  new URL('../LevelUpHitPoints.jsx', import.meta.url),
  'utf8',
);
const transport = readFileSync(
  new URL('../../transport/engineTransport.ts', import.meta.url),
  'utf8',
);

describe('safe progression delevel UI', () => {
  it('explains why a disabled multiclass action needs the prerequisite', () => {
    expect(flyout).toContain('data-testid="multiclass-prerequisite-message"');
    expect(flyout).toContain(
      'Multiclassing is enabled. Meet your current class’s',
    );
    expect(flyout).toContain(
      'ability-score prerequisite before starting another class.',
    );
  });

  it('shows chronological history and both removal modes', () => {
    expect(flyout).toContain('Level History');
    expect(flyout).toContain('levelHistory.map');
    expect(flyout).toContain('Undo latest level');
    expect(flyout).toContain('Lower ${classProgression.className}');
    expect(flyout).toContain('Remove ${classProgression.className} multiclass');
    expect(flyout).toContain("mode: 'last'");
    expect(flyout).toContain("mode: 'class'");
  });

  it('offers a class removal only while the engine can still unwind to it', () => {
    expect(flyout).toContain('!classProgression.canLower');
    expect(flyout).toContain('A character keeps its first level.');
    expect(flyout).toContain(
      'The levels above this one cannot be rebuilt, so this level has to stay.',
    );
  });

  it('keeps safety copy concise and offers session undo', () => {
    expect(flyout).not.toContain('Every removal is confirmed first');
    expect(flyout).not.toContain('Oldest to newest');
    expect(flyout).not.toContain('Valid later choices will be preserved');
    expect(hitPoints).not.toContain('Select a roll to edit');
    expect(flyout).toContain('Keeps and recalculates');
    expect(flyout).toContain('Invalid choices may need re-picking');
    expect(flyout).toContain('Restore removed level');
    expect(flyout).toContain('progression.canUndoDelevel');
    expect(flyout).toContain('api.characters.undoDelevel');
  });

  it('keeps every transport\'s delevel operations in lockstep', () => {
    expect(transport).toContain('delevel:');
    expect(transport).toContain('"delevel"');
    expect(transport).toContain('undoDelevel:');
    expect(transport).toContain('"undoDelevel"');
  });
});
