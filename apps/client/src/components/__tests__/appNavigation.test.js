import { describe, expect, it } from 'vitest';
import {
  createNavigationState,
  getGlobalNavigationTabs,
  navigationReducer,
} from '../../appNavigation.js';

describe('persistent Character Builder navigation', () => {
  it('splits the character collection and open character into separate tabs', () => {
    expect(getGlobalNavigationTabs('Arannis')).toEqual([
      expect.objectContaining({
        key: 'workspace',
        label: 'Arannis',
        characterSurface: 'workspace',
      }),
      expect.objectContaining({
        key: 'collection',
        label: 'Characters',
        characterSurface: 'collection',
      }),
      expect.objectContaining({ key: 'content' }),
      expect.objectContaining({ key: 'homebrew' }),
    ]);
  });

  it('restores an open character after visiting content and homebrew', () => {
    let state = createNavigationState();

    state = navigationReducer(state, {
      type: 'open-character',
      id: 'Arannis',
    });
    state = navigationReducer(state, {
      type: 'select-section',
      section: 'content',
    });
    state = navigationReducer(state, {
      type: 'select-section',
      section: 'homebrew',
    });
    state = navigationReducer(state, {
      type: 'select-section',
      section: 'characters',
    });

    expect(state).toMatchObject({
      activeSection: 'characters',
      characterSurface: 'workspace',
      openCharacterId: 'Arannis',
    });
  });

  it('keeps the character retained when explicitly showing the collection', () => {
    let state = navigationReducer(createNavigationState(), {
      type: 'open-character',
      id: 'Arannis',
    });

    state = navigationReducer(state, { type: 'show-collection' });

    expect(state).toMatchObject({
      activeSection: 'characters',
      characterSurface: 'collection',
      openCharacterId: 'Arannis',
    });
  });

  it('returns from the collection to the retained character workspace', () => {
    let state = navigationReducer(createNavigationState(), {
      type: 'open-character',
      id: 'Arannis',
    });

    state = navigationReducer(state, { type: 'show-collection' });
    state = navigationReducer(state, { type: 'show-workspace' });

    expect(state).toMatchObject({
      activeSection: 'characters',
      characterSurface: 'workspace',
      openCharacterId: 'Arannis',
    });
  });

  it('opens and closes cloud sync without changing the active section', () => {
    let state = navigationReducer(createNavigationState(), {
      type: 'select-section',
      section: 'content',
    });

    state = navigationReducer(state, { type: 'open-cloud' });
    expect(state).toMatchObject({
      activeSection: 'content',
      cloudOpen: true,
    });

    state = navigationReducer(state, { type: 'close-cloud' });
    expect(state).toMatchObject({
      activeSection: 'content',
      cloudOpen: false,
    });
  });

  it('discards the retained workspace when its character is deleted', () => {
    let state = navigationReducer(createNavigationState(), {
      type: 'open-character',
      id: 'Arannis',
    });

    state = navigationReducer(state, {
      type: 'character-deleted',
      id: 'Arannis',
    });

    expect(state).toMatchObject({
      activeSection: 'characters',
      characterSurface: 'collection',
      openCharacterId: null,
    });
  });
});
