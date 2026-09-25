import { describe, expect, it } from 'vitest';
import { previewFinalScore } from '../AbilityEditor.jsx';

// Build's Total column: the saved score is the engine's, which a raised
// maximum (Primal Champion's 25) lets pass 20; an edited score is previewed
// against that maximum instead of a fixed 20.
describe('ability total preview', () => {
  const champion = { baseScore: 20, additionalScore: 4, finalScore: 24, maximum: 25 };

  it('shows the engine score for the saved base', () => {
    expect(previewFinalScore(champion, 20)).toBe(24);
    expect(previewFinalScore({ ...champion, additionalScore: 5 }, 20)).toBe(24);
  });

  it('caps an edited base at the raised maximum', () => {
    expect(previewFinalScore(champion, 18)).toBe(22);
    expect(previewFinalScore({ ...champion, additionalScore: 6 }, 21)).toBe(25);
  });

  it('keeps 20 as the cap when nothing raises it', () => {
    expect(previewFinalScore({ baseScore: 18, additionalScore: 2 }, 19)).toBe(20);
  });
});
