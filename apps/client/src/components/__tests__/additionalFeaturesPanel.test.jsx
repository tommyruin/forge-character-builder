import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_KEY,
  FeatureList,
  featureCategories,
  filterFeatures,
} from '../tabs/manage/AdditionalFeaturesPanel.jsx';

const manage = readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);

const feature = (overrides) => ({
  key: `item:${overrides.elementId}`,
  elementId: overrides.elementId,
  name: overrides.name,
  source: overrides.source ?? 'Test source',
  category: overrides.category ?? 'Additional Feature',
  description: '',
  enabled: overrides.enabled ?? false,
  grantedBy: overrides.grantedBy ?? [],
});

const GIFT = feature({
  elementId: 'ID_TEST_GIFT',
  name: 'Heartstone Gift',
  category: 'Supernatural Gifts',
  source: 'Homebrew',
  grantedBy: ['Heartstone Blade'],
});
const OWNED = feature({
  elementId: 'ID_TEST_OWNED',
  name: 'Keen Mind',
  enabled: true,
});
const OFFERED = feature({
  elementId: 'ID_TEST_OFFERED',
  name: 'Silver Tongue',
  category: 'Additional Proficiency',
  source: 'Player Handbook',
});
const ROWS = [GIFT, OWNED, OFFERED];

const renderList = (props) =>
  renderToStaticMarkup(
    createElement(FeatureList, {
      features: ROWS,
      busy: false,
      pendingKey: null,
      inspected: null,
      onInspect: () => {},
      onToggle: () => {},
      emptyCopy: 'No features match this search.',
      ...props,
    }),
  );

describe('Additional features sub-tab', () => {
  it('follows Optional rules in the Manage rail', () => {
    expect(manage).toMatch(
      /\['optional-rules', 'Optional rules'\],\s*\['features', 'Additional features'\]/,
    );
    expect(manage).toContain(
      "subTab === 'features' && <AdditionalFeaturesPanel",
    );
  });

  it('keeps the character text field and sends browsing to the sub-tab', () => {
    expect(manage).toContain("'Additional features & Traits'");
    expect(manage).not.toContain('<CharacterAdjustments');
    expect(manage).toContain("setSubTab('features')");
    expect(manage).toContain('Browse features');
  });

  it('leaves the character save bar off the features sub-tab', () => {
    expect(manage).toMatch(/subTab !== 'features'/);
  });
});

describe('feature categories', () => {
  it('lists Active first, then each category present with its count', () => {
    expect(featureCategories(ROWS).map((entry) => entry.key)).toEqual([
      ACTIVE_KEY,
      'Supernatural Gifts',
      'Additional Feature',
      'Additional Proficiency',
    ]);
    expect(featureCategories(ROWS)[0].label).toBe('Active (2)');
    expect(featureCategories(ROWS)[1].label).toBe('Supernatural Gifts (1)');
  });
});

describe('feature filtering', () => {
  it('counts an item-granted feature as active alongside an owned one', () => {
    expect(filterFeatures(ROWS, ACTIVE_KEY, '')).toEqual([GIFT, OWNED]);
  });

  it('matches name, category and source case-insensitively', () => {
    expect(filterFeatures(ROWS, 'Supernatural Gifts', 'heartstone')).toEqual([
      GIFT,
    ]);
    expect(
      filterFeatures(ROWS, 'Additional Proficiency', 'PROFICIENCY'),
    ).toEqual([OFFERED]);
    expect(
      filterFeatures(ROWS, 'Additional Proficiency', 'player'),
    ).toEqual([OFFERED]);
    expect(
      filterFeatures(ROWS, 'Additional Proficiency', 'heartstone'),
    ).toEqual([]);
  });
});

describe('feature cards', () => {
  it('offers Remove only for a feature the character owns', () => {
    const markup = renderList({ features: [OWNED] });
    expect(markup).toContain('fcb-button-danger');
    expect(markup).toContain('aria-label="Remove Keen Mind"');
    expect(markup).not.toContain('aria-label="Add Keen Mind"');
  });

  it('offers Add, not Remove, for a feature only an item grants', () => {
    const markup = renderList({ features: [GIFT] });
    expect(markup).toContain('Granted by Heartstone Blade');
    expect(markup).toContain('aria-label="Add Heartstone Gift"');
    expect(markup).not.toContain('fcb-button-danger');
  });

  it('names the category and source, and marks the inspected card', () => {
    const markup = renderList({
      features: [OFFERED],
      inspected: OFFERED.elementId,
    });
    expect(markup).toContain('Additional Proficiency · Player Handbook');
    expect(markup).toContain('fcb-row-inspected');
  });

  it('shows the empty copy the caller supplies when nothing matches', () => {
    const markup = renderList({
      features: [],
      emptyCopy: 'Nothing active yet.',
    });
    expect(markup).toContain('Nothing active yet.');
  });
});
