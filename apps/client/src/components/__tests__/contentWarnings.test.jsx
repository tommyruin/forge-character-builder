import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UploadDiagnostics } from '../ContentManager.jsx';

const missingGrant = {
  kind: 'missing-grant',
  file: 'imports/homebrew-1/collection.xml',
  message: 'Moonwell Pact (ID_HB_MC_FEAT_MOONWELL_PACT) grants ID_HB_MC_SPELL_FROST_LANCE, which no loaded content defines',
  detail: 'the reference is skipped until a pack that defines it is loaded',
};

describe('Content warnings', () => {
  it('lists a missing grant with the referencing element and the missing id', () => {
    const markup = renderToStaticMarkup(createElement(UploadDiagnostics, { diagnostics: [missingGrant] }));
    expect(markup).toContain('[missing-grant]');
    expect(markup).toContain('Moonwell Pact');
    expect(markup).toContain('ID_HB_MC_SPELL_FROST_LANCE');
  });

  it('caps a long list and says how many were left out', () => {
    const many = Array.from({ length: 130 }, (_, index) => ({ ...missingGrant, message: `finding ${index}` }));
    const markup = renderToStaticMarkup(createElement(UploadDiagnostics, { diagnostics: many }));
    expect(markup).toContain('finding 99');
    expect(markup).not.toContain('finding 100');
    expect(markup).toContain('30 more warnings');
  });
});
