import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ContentRenderer from '../ContentRenderer';

describe('ContentRenderer requirement metadata', () => {
  it('hides a requirement that repeats the authored prerequisite', () => {
    const markup = renderToStaticMarkup(
      <ContentRenderer
        title="One with Shadows"
        prerequisite="5th level"
        requirements="[level:5]"
        content="Feature text"
      />
    );

    expect(markup).toContain('Prerequisite');
    expect(markup).toContain('5th level');
    expect(markup).not.toContain('Requirements');
    expect(markup).not.toContain('Level 5');
  });

  it('hides a class-internal multiclass grant condition', () => {
    const markup = renderToStaticMarkup(
      <ContentRenderer
        element={{
          name: 'Bard',
          type: 'Class',
          requirements: '!ID_WOTC_PHB_MULTICLASS_BARD',
          description: 'Class text',
        }}
      />
    );

    expect(markup).not.toContain('Requirements');
    expect(markup).not.toContain('Not multiclassed as Bard');
  });

  it('hides a multiclass self-exclusion and duplicate ability requirement', () => {
    const markup = renderToStaticMarkup(
      <ContentRenderer
        element={{
          name: 'Bard',
          type: 'Multiclass',
          prerequisite: 'Charisma 13',
          requirements: '!ID_WOTC_PHB_CLASS_BARD&&([cha:13])',
          description: 'Multiclass text',
        }}
      />
    );

    expect(markup).toContain('Prerequisite');
    expect(markup).toContain('Charisma 13');
    expect(markup).not.toContain('Requirements');
    expect(markup).not.toMatch(/Not.*Bard|ID_WOTC/);
  });

  it('keeps a distinct multiclass requirement visible', () => {
    const markup = renderToStaticMarkup(
      <ContentRenderer
        element={{
          name: 'Bard',
          type: 'Multiclass',
          prerequisite: 'Charisma 13',
          requirements: '!ID_WOTC_PHB_CLASS_BARD&&[dex:13]',
          description: 'Multiclass text',
        }}
      />
    );

    expect(markup).toContain('Prerequisite');
    expect(markup).toContain('Charisma 13');
    expect(markup).toContain('Requirements');
    expect(markup).toContain('Dexterity: 13');
    expect(markup).not.toMatch(/Not.*Bard|ID_WOTC/);
  });

  it('shows public equipment rarity and attunement metadata', () => {
    const markup = renderToStaticMarkup(
      <ContentRenderer
        element={{
          name: 'Staff of Power',
          type: 'Magic Item',
          description: '<p>Staff text</p>',
          rarity: 'Very Rare',
          attunement: {
            required: true,
            addition: 'by a sorcerer, warlock, or wizard',
          },
        }}
      />
    );

    expect(markup).toContain('Rarity');
    expect(markup).toContain('Very Rare');
    expect(markup).toContain('Attunement');
    expect(markup).toContain('by a sorcerer, warlock, or wizard');
  });
});
