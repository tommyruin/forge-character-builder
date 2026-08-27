import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ContentSourceOption,
  contentSourceOption,
} from '../ContentManager.jsx';

describe('ContentManager source options', () => {
  it('uses the stable source ID as the React key and publication name as value/display', () => {
    const source = {
      id: 'ID_WOTC_SOURCE_PLAYERS_HANDBOOK',
      name: 'Player’s Handbook',
      source: 'Core',
    };

    expect(contentSourceOption(source)).toEqual({
      key: 'ID_WOTC_SOURCE_PLAYERS_HANDBOOK',
      value: 'Player’s Handbook',
      label: 'Player’s Handbook',
    });

    const markup = renderToStaticMarkup(
      createElement(ContentSourceOption, { source }),
    );
    expect(markup).toContain('value="Player’s Handbook"');
    expect(markup).toContain('>Player’s Handbook</option>');
    expect(markup).not.toContain('[object Object]');
  });
});
