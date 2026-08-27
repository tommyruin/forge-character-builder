import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CharacterLoadingState from '../CharacterLoadingState';

describe('CharacterLoadingState', () => {
  it('renders a labelled determinate character-loading bar', () => {
    const markup = renderToStaticMarkup(
      <CharacterLoadingState
        characterName="Test Hero"
        message="Applying character elements"
        percentage={42}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('value="42"');
    expect(markup).toContain('Loading Test Hero');
    expect(markup).toContain('Applying character elements');
    expect(markup).toContain('42%');
  });

  it('stays truthful when the engine has not reported a percentage', () => {
    const markup = renderToStaticMarkup(
      <CharacterLoadingState characterName="Test Hero" />,
    );

    expect(markup).toContain('<progress');
    expect(markup).not.toContain('value=');
    expect(markup).not.toContain('aria-valuenow');
  });

  it('shows the underlying error and a Retry action', () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <CharacterLoadingState
        characterName="Test Hero"
        error="Saved character is invalid."
        onRetry={onRetry}
      />,
    );

    expect(markup).toContain('Saved character is invalid.');
    expect(markup).toContain('Retry');
  });
});
