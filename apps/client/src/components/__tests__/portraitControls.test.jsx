import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PortraitControls from '../PortraitControls';

describe('PortraitControls', () => {
  it('offers an accessible upload when no portrait exists', () => {
    const markup = renderToStaticMarkup(
      <PortraitControls
        characterId="arya"
        characterName="Arya"
        portraitBase64={null}
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );

    expect(markup).toContain('aria-label="Add portrait for Arya"');
    expect(markup).toContain('aria-label="Upload portrait for Arya"');
    expect(markup).toContain('class="fcb-portrait-overlay"');
    expect(markup).toContain('class="fcb-portrait-overlay-action"');
    expect(markup).toContain(
      'accept="image/png,image/jpeg,image/webp,image/gif"'
    );
    expect(markup).not.toContain('>Add portrait<');
    expect(markup).not.toContain('>Remove<');
  });

  it('offers change and remove actions for an existing portrait', () => {
    const markup = renderToStaticMarkup(
      <PortraitControls
        characterId="arya"
        characterName="Arya"
        portraitBase64="iVBORw0KGgo="
        onChanged={vi.fn()}
        onError={vi.fn()}
      />
    );

    expect(markup).toContain('alt="Arya portrait"');
    expect(markup).toContain('aria-label="Change portrait for Arya"');
    expect(markup).toContain('aria-label="Remove portrait for Arya"');
    expect(markup).toContain('class="fcb-portrait-remove"');
    expect(markup).not.toContain('>Change<');
    expect(markup).not.toContain('>Remove<');
  });
});
