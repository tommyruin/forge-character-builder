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

describe('Content warnings: fixing a missing spell', () => {
  it('hands the drawer a Create spell action that opens the spell form for the pack that wrote the grant', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../ContentManager.jsx', import.meta.url), 'utf8');
    expect(source).toContain('onCreateSpell={startSpellFix}');
    expect(source).toContain('collectionStoragePath(record) === diag.file');
    expect(source).toContain('<CustomSpellModal');
  });
});

describe('Content warnings: a Background Feature nothing attaches', () => {
  const unattachable = (file) => ({
    kind: 'unattachable',
    file,
    message: "Ferry Rights (ID_HB_MC_BACKGROUND_FEATURE_FERRY_RIGHTS) is a Background Feature with no Background that grants it",
    detail: 'it cannot be added to anyone; add it as a custom feature instead',
    elementId: 'ID_HB_MC_BACKGROUND_FEATURE_FERRY_RIGHTS',
    elementName: 'Ferry Rights',
  });
  const render = (diag, props = {}) =>
    renderToStaticMarkup(createElement(UploadDiagnostics, { diagnostics: [diag], onConvertFeature: () => {}, ...props }));

  it('offers Convert to feature when a pack wrote the file', () => {
    const markup = render(unattachable('imports/homebrew-1/collection.xml'));
    expect(markup).toContain('[unattachable]');
    expect(markup).toContain('Convert to feature');
  });

  it('keeps to the advice for an uploaded file that is not a pack', () => {
    const markup = render(unattachable('imports/upload-7/ferry.xml'));
    expect(markup).toContain('add it as a custom feature instead');
    expect(markup).not.toContain('Convert to feature');
  });

  it('holds the button while a conversion runs', () => {
    const markup = render(unattachable('imports/homebrew-1/collection.xml'), { convertingKey: 'busy' });
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Convert to feature<\/button>/);
  });

  it('is wired to the pack conversion in the content manager', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../ContentManager.jsx', import.meta.url), 'utf8');
    expect(source).toContain('onConvertFeature={convertFeature}');
    expect(source).toContain('convertFindingInPack({ api, store: localStore, finding: diag })');
  });
});
